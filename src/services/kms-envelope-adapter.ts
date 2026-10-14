import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { DecryptCommand, EncryptCommand, KMSClient } from '@aws-sdk/client-kms';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { GoogleAuth } from 'google-auth-library';

export interface KmsEnvelopeAdapter {
  wrapKeyMaterial(plaintext: Uint8Array, context: { entityVaultId: string; purpose: string }): Promise<string>;
  unwrapKeyMaterial(wrapped: string, context: { entityVaultId: string; purpose: string }): Promise<Uint8Array>;
}

const RUNTIME_KEK_PREFIX = 'rkek1.';

/**
 * Per-process envelope boundary backed by a 32-byte service KEK.
 *
 * The key is supplied by the composition root after one external KMS unwrap.
 * Tenant operations use AES-256-GCM locally and therefore never call KMS.
 */
export class RuntimeKekEnvelopeAdapter implements KmsEnvelopeAdapter {
  private readonly kek: Buffer;

  constructor(runtimeKek: Uint8Array, private readonly legacyRootAdapter?: KmsEnvelopeAdapter) {
    if (runtimeKek.byteLength !== 32) throw new Error('Runtime service KEK must contain exactly 32 bytes.');
    this.kek = Buffer.from(runtimeKek);
  }

  async wrapKeyMaterial(plaintext: Uint8Array, context: { entityVaultId: string; purpose: string }): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.kek, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(context), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    return `${RUNTIME_KEK_PREFIX}${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
  }

  async unwrapKeyMaterial(wrapped: string, context: { entityVaultId: string; purpose: string }): Promise<Uint8Array> {
    if (!wrapped.startsWith(RUNTIME_KEK_PREFIX)) {
      if (this.legacyRootAdapter) return this.legacyRootAdapter.unwrapKeyMaterial(wrapped, context);
      throw new Error('Wrapped key material is not a runtime-KEK v1 envelope.');
    }
    const bytes = Buffer.from(wrapped.slice(RUNTIME_KEK_PREFIX.length), 'base64url');
    if (bytes.length < 28) throw new Error('Wrapped key material is invalid or truncated.');
    const decipher = createDecipheriv('aes-256-gcm', this.kek, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(JSON.stringify(context), 'utf8'));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
  }

  destroy(): void {
    this.kek.fill(0);
  }
}

export function isRuntimeKekEnvelope(value: string): boolean {
  return value.startsWith(RUNTIME_KEK_PREFIX);
}

type FetchLike = typeof fetch;

/**
 * Development adapter that keeps behavior deterministic and side-effect free.
 * Production should replace this implementation with Cloud KMS/HSM calls.
 */
export class InMemoryEnvelopeAdapter implements KmsEnvelopeAdapter {
  async wrapKeyMaterial(plaintext: Uint8Array): Promise<string> {
    return Buffer.from(plaintext).toString('base64url');
  }

  async unwrapKeyMaterial(wrapped: string): Promise<Uint8Array> {
    return Buffer.from(wrapped, 'base64url');
  }
}

export class AesGcmEnvelopeAdapter implements KmsEnvelopeAdapter {
  private readonly kek: Buffer;

  constructor(secret: string) {
    const normalized = String(secret || '').trim();
    if (!normalized) {
      throw new Error('AesGcmEnvelopeAdapter requires a non-empty KEK secret.');
    }
    this.kek = createHash('sha256').update(normalized, 'utf8').digest();
  }

  async wrapKeyMaterial(plaintext: Uint8Array): Promise<string> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.kek, iv);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
  }

  async unwrapKeyMaterial(wrapped: string): Promise<Uint8Array> {
    const bytes = Buffer.from(wrapped, 'base64url');
    if (bytes.length < 28) {
      throw new Error('Wrapped key material is invalid or truncated.');
    }
    const iv = bytes.subarray(0, 12);
    const authTag = bytes.subarray(12, 28);
    const ciphertext = bytes.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.kek, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return new Uint8Array(plaintext);
  }
}

function encodeContext(context: { entityVaultId: string; purpose: string }): string {
  return Buffer.from(JSON.stringify(context), 'utf8').toString('base64');
}

async function parseJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Envelope adapter returned non-JSON response (${response.status}).`);
  }
}

async function assertOk(response: Response, providerName: string): Promise<any> {
  const body = await parseJsonResponse(response);
  if (response.ok) {
    return body;
  }
  const details = body?.error?.message || body?.errors?.join?.(', ') || JSON.stringify(body);
  throw new Error(`${providerName} request failed (${response.status}): ${details}`);
}

export class CloudKmsEnvelopeAdapter implements KmsEnvelopeAdapter {
  private readonly keyName: string;
  private readonly fetchImpl: FetchLike;
  private readonly tokenProvider: () => Promise<string>;

  constructor(
    keyName: string,
    deps?: {
      fetchImpl?: FetchLike;
      tokenProvider?: () => Promise<string>;
    },
  ) {
    const normalized = String(keyName || '').trim();
    if (!normalized) {
      throw new Error('CloudKmsEnvelopeAdapter requires a non-empty KMS key resource name.');
    }
    this.keyName = normalized;
    this.fetchImpl = deps?.fetchImpl || fetch;
    this.tokenProvider = deps?.tokenProvider || this.buildDefaultTokenProvider();
  }

  async wrapKeyMaterial(plaintext: Uint8Array, context: { entityVaultId: string; purpose: string }): Promise<string> {
    const accessToken = await this.tokenProvider();
    const response = await this.fetchImpl(`https://cloudkms.googleapis.com/v1/${this.keyName}:encrypt`, {
      method: HttpRequestMethods.Post,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plaintext: Buffer.from(plaintext).toString('base64'),
        additionalAuthenticatedData: encodeContext(context),
      }),
    });
    const body = await assertOk(response, 'Cloud KMS encrypt');
    const ciphertext = String(body?.ciphertext || '');
    if (!ciphertext) {
      throw new Error('Cloud KMS encrypt response did not include ciphertext.');
    }
    return ciphertext;
  }

  async unwrapKeyMaterial(wrapped: string, context: { entityVaultId: string; purpose: string }): Promise<Uint8Array> {
    const accessToken = await this.tokenProvider();
    const response = await this.fetchImpl(`https://cloudkms.googleapis.com/v1/${this.keyName}:decrypt`, {
      method: HttpRequestMethods.Post,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ciphertext: wrapped,
        additionalAuthenticatedData: encodeContext(context),
      }),
    });
    const body = await assertOk(response, 'Cloud KMS decrypt');
    const plaintext = String(body?.plaintext || '');
    if (!plaintext) {
      throw new Error('Cloud KMS decrypt response did not include plaintext.');
    }
    return Buffer.from(plaintext, 'base64');
  }

  private buildDefaultTokenProvider(): () => Promise<string> {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    return async () => {
      const client = await auth.getClient();
      const accessToken = await client.getAccessToken();
      const token = typeof accessToken === 'string' ? accessToken : accessToken?.token;
      if (!token) {
        throw new Error('Cloud KMS token provider did not return an access token.');
      }
      return token;
    };
  }
}

type AwsKmsCommand = EncryptCommand | DecryptCommand;
type AwsKmsSend = (command: AwsKmsCommand) => Promise<any>;

/** AWS KMS root adapter. Credentials use the AWS SDK chain; region is explicit GW configuration. */
export class KmsEnvelopeAdapterAws implements KmsEnvelopeAdapter {
  private readonly keyId: string;
  private readonly send: AwsKmsSend;

  constructor(keyId: string, deps?: { region?: string; send?: AwsKmsSend }) {
    const normalized = String(keyId || '').trim();
    if (!normalized) throw new Error('KmsEnvelopeAdapterAws requires a non-empty KMS key id or ARN.');
    this.keyId = normalized;
    if (deps?.send) {
      this.send = deps.send;
    } else {
      const region = String(deps?.region || '').trim();
      if (!region) throw new Error('KmsEnvelopeAdapterAws requires KMS_REGION.');
      const client = new KMSClient({ region });
      this.send = (command) => client.send(command as any);
    }
  }

  async wrapKeyMaterial(plaintext: Uint8Array, context: { entityVaultId: string; purpose: string }): Promise<string> {
    const result = await this.send(new EncryptCommand({
      KeyId: this.keyId,
      Plaintext: plaintext,
      EncryptionContext: context,
    }));
    if (!result.CiphertextBlob) throw new Error('AWS KMS encrypt response did not include CiphertextBlob.');
    return Buffer.from(result.CiphertextBlob).toString('base64');
  }

  async unwrapKeyMaterial(wrapped: string, context: { entityVaultId: string; purpose: string }): Promise<Uint8Array> {
    const result = await this.send(new DecryptCommand({
      KeyId: this.keyId,
      CiphertextBlob: Buffer.from(wrapped, 'base64'),
      EncryptionContext: context,
    }));
    if (!result.Plaintext) throw new Error('AWS KMS decrypt response did not include Plaintext.');
    return Buffer.from(result.Plaintext);
  }
}

export class HashicorpTransitEnvelopeAdapter implements KmsEnvelopeAdapter {
  private readonly baseUrl: string;
  private readonly mountPath: string;
  private readonly keyName: string;
  private readonly token: string;
  private readonly namespace?: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: {
    baseUrl: string;
    keyName: string;
    token: string;
    mountPath?: string;
    namespace?: string;
    fetchImpl?: FetchLike;
  }) {
    const baseUrl = String(options.baseUrl || '').trim().replace(/\/$/, '');
    const keyName = String(options.keyName || '').trim();
    const token = String(options.token || '').trim();
    if (!baseUrl || !keyName || !token) {
      throw new Error('HashicorpTransitEnvelopeAdapter requires baseUrl, keyName, and token.');
    }
    this.baseUrl = baseUrl;
    this.mountPath = String(options.mountPath || 'transit').trim().replace(/^\/+|\/+$/g, '');
    this.keyName = keyName;
    this.token = token;
    this.namespace = options.namespace ? String(options.namespace).trim() : undefined;
    this.fetchImpl = options.fetchImpl || fetch;
  }

  async wrapKeyMaterial(plaintext: Uint8Array, context: { entityVaultId: string; purpose: string }): Promise<string> {
    const response = await this.fetchImpl(this.buildUrl(`encrypt/${this.keyName}`), {
      method: HttpRequestMethods.Post,
      headers: this.buildHeaders(),
      body: JSON.stringify({
        plaintext: Buffer.from(plaintext).toString('base64'),
        context: encodeContext(context),
      }),
    });
    const body = await assertOk(response, 'HashiCorp Transit encrypt');
    const ciphertext = String(body?.data?.ciphertext || '');
    if (!ciphertext) {
      throw new Error('HashiCorp Transit encrypt response did not include ciphertext.');
    }
    return ciphertext;
  }

  async unwrapKeyMaterial(wrapped: string, context: { entityVaultId: string; purpose: string }): Promise<Uint8Array> {
    const response = await this.fetchImpl(this.buildUrl(`decrypt/${this.keyName}`), {
      method: HttpRequestMethods.Post,
      headers: this.buildHeaders(),
      body: JSON.stringify({
        ciphertext: wrapped,
        context: encodeContext(context),
      }),
    });
    const body = await assertOk(response, 'HashiCorp Transit decrypt');
    const plaintext = String(body?.data?.plaintext || '');
    if (!plaintext) {
      throw new Error('HashiCorp Transit decrypt response did not include plaintext.');
    }
    return Buffer.from(plaintext, 'base64');
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Vault-Token': this.token,
    };
    if (this.namespace) {
      headers['X-Vault-Namespace'] = this.namespace;
    }
    return headers;
  }

  private buildUrl(path: string): string {
    return `${this.baseUrl}/v1/${this.mountPath}/${path}`;
  }
}
