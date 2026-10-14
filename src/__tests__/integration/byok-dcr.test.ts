// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// src/__tests__/integration/end-to-end-flow.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { GatewayRequestEntryTypes } from 'gdc-common-utils-ts/constants/gateway-response';
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';
import { HttpRequestMethods } from 'gdc-common-utils-ts/constants/http';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

process.env.DEV_SEED = 'true';
process.env.NODE_ENV = 'test';
process.env.DB_PROVIDER = 'mem';
process.env.STORAGE_PROVIDER = 'mem';
process.env.QUEUE_PROVIDER = 'mem';
process.env.SECURITY_MODE = 'demo';
process.env.ALLOWED_SECTORS = 'health-care,test';
process.env.HOST_EXTERNAL_DOMAIN = 'provider.com';

import { jest } from '@jest/globals';
import type * as express from 'express';
import type { Server } from 'http';
import type { MldsaPrivateJwk, MlkemPrivateJwk, MlkemPublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { QueueAdapter } from '../../adapters/queue';
import type { IKmsService } from '../../gdc-backend-utils-node/models/IKmsService';
import type { TenantsCacheManager } from '../../managers/TenantsCacheManager';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import type { IVaultRepository } from '../../database/repositories/vault/vault.repository';
import { startServer } from '../../server';
import { CryptographyService } from 'gdc-common-utils-ts/CryptographyService';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { QueueAdapterMem } from '../../adapters/queue-mem';
import { testPayloadCreateTenant1, testTenant1Data } from '../data/end-to-end.data';
import { testTenant1AlternateName, testTenant1VaultId } from '../data/organization.data';
import {
  ClaimsIndividualProductSchemaorg,
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { createHash } from 'crypto';
import { invokeExpress } from './helpers/invokeExpress';
import { getEnvSectionId } from '../../utils/section-env';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('End-to-End API Flow (BYOK Onboarding)', () => {
  // Journey: 1) verify bootstrap JWS, 2) accept Offer, 3) accept pre-DCR Order,
  // 4) exchange its controller activation code, 5) complete signed Device DCR,
  // 6) prove that DCR persisted the registered device profile.
  // Authorization invariant: embedded keys prove possession only during the
  // explicit pre-DCR bootstrap. Persistence invariant: DCR stores the keys
  // that later requests must resolve rather than replace from their envelope.
  let app: express.Express;
  let server: Server | undefined;
  let queueAdapter: QueueAdapter;
  let addJobSpy: ReturnType<typeof jest.spyOn>;
  let cryptoService: InstanceType<typeof CryptographyService>;
  let hostEncryptionKey: MlkemPublicJwk;
  let externalSigner: MldsaPrivateJwk;
  let externalEncrypter: MlkemPrivateJwk;
  let kmsService: IKmsService;
  let tenantManager: TenantsCacheManager;
  let controllerActivationCode: string;
  let vaultRepository: IVaultRepository;


  beforeAll(async () => {
    // Start the server, which will use the mocked config and generate deterministic keys
    const serverInstance = await startServer({ listen: false });
    app = serverInstance.app;
    server = serverInstance.server;
    queueAdapter = serverInstance.queueAdapter;
    kmsService = serverInstance.kmsService!;
    tenantManager = serverInstance.tenantManager;
    vaultRepository = serverInstance.vaultRepository;
    cryptoService = serverInstance.cryptographyService;


    // Get the public key directly from the running server's KmsService.
    // This ensures the client and server are using the exact same keys.
    const hostJwkSet = await kmsService.getHostPublicJwkSet();
    hostEncryptionKey = hostJwkSet.keys.find(key => key.kty === 'OKP') as MlkemPublicJwk;
    if (!hostEncryptionKey) {
      throw new Error('Test setup failed: Could not find host encryption key (OKP) in JWKSet.');
    }
    await tenantManager.loadHost();

    // Generate deterministic keys for the "external client" (the future tenant admin)
    // This makes the test reproducible without relying on static key files.
    const externalClientSeed = 'byok-test-client-seed';
    const dsaSeed = createHash('sha256').update(externalClientSeed + '-dsa').digest().subarray(0, 32);
    const kemSeed = createHash('sha512').update(externalClientSeed + '-kem').digest().subarray(0, 64);
    
    const signerKeyPair = await cryptoService.generateKeyPairMlDsa(dsaSeed);
    const encrypterKeyPair = await cryptoService.generateKeyPairMlKem(kemSeed);

    externalSigner = { ...signerKeyPair.publicJWKey, privBytes: signerKeyPair.secretKeyBytes };
    externalEncrypter = { ...encrypterKeyPair.publicJWKey, dBytes: encrypterKeyPair.secretKeyBytes };
  });

  beforeEach(() => {
    jest.clearAllMocks();
    addJobSpy = jest.spyOn(queueAdapter, 'addJob');
  });

  afterAll(async () => {
    if (addJobSpy) {
      addJobSpy.mockRestore();
    }
    if (queueAdapter instanceof QueueAdapterMem) {
      (queueAdapter as InstanceType<typeof QueueAdapterMem>).stop();
    }
    const serverToClose = server;
    if (serverToClose) {
      await new Promise<void>((resolve, reject) => {
        serverToClose.close((err: any) => {
          if (err) {
            return reject(err);
          }
          resolve();
        });
      });
    }
  });

  it('completes encrypted BYOK Order -> Token/_exchange -> Device/_dcr without accepted errors', async () => {
    // This part tests the "Bring-Your-Own-Key" (BYOK) scenario.
    // During the very first "organization creation" request, the client's DID (`iss`)
    // is not yet registered in the system. To establish trust, the client MUST
    // embed their public keys (JWKs) directly into the JWS and JWE protected headers.
    // The server will then associate these keys with the new admin employee being created.
    const orgCreationPayload = { ...testPayloadCreateTenant1 };
    const thid = orgCreationPayload.thid;

    const jwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
      jwk: { // Public part of the signer key
        alg: externalSigner.alg,
        kid: externalSigner.kid,
        kty: externalSigner.kty,
        pub: externalSigner.pub,
      },
    };
    const jwsCompactParts = await cryptoService.signDataJws(
      orgCreationPayload,
      jwsProtectedHeader,
      externalSigner.privBytes,
    );
    const compactJws = `${jwsCompactParts.protected}.${jwsCompactParts.payload}.${jwsCompactParts.signature}`;

    const jweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
      jwk: { // Public part of the encrypter key
        crv: externalEncrypter.crv,
        kid: externalEncrypter.kid,
        kty: externalEncrypter.kty,
        x: externalEncrypter.x,
      },
    };
    const compactJwe = await cryptoService.encryptJweToCompact(
      compactJws,
      jweProtectedHeader,
      externalEncrypter,
      hostEncryptionKey, // Using the key obtained from the server
    );
    const verifySignature = jest.spyOn(cryptoService, 'verifyDetachedJws');
    const registrationUrl = `/host/cds-ES/v1/test/registry/org.schema/Organization/_batch`;

    // 1. ACT (Phase 1): Post the initial job
    const response = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: registrationUrl,
      // DemoTokenVerifier still requires a structurally valid JWT. The signature is
      // intentionally empty in demo mode, but an arbitrary bearer string is rejected.
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"byok-dcr-test"}').toString('base64url')}.`,
      },
      body: { request: compactJwe },
    });

    // 2. ASSERT (Phase 1): Check for 202 Accepted and polling location
    expect(response.status).toBe(202);
    expect(verifySignature).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(String),
      jwsProtectedHeader.jwk,
    );
    expect(response.headers.location).toBeDefined();
    const pollingUrl = response.headers.location;
    expect(addJobSpy).toHaveBeenCalledTimes(1);

    // 3. ACT (Phase 2): Wait for job completion and poll for the result
    if (queueAdapter instanceof QueueAdapterMem) {
      await (queueAdapter as InstanceType<typeof QueueAdapterMem>).waitForEmptyQueue();
    } else {
      await delay(200);
    }
    
    const pollingPath = new URL(pollingUrl).pathname;
    const pollResponse = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: pollingPath,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: { thid },
    });

    // 4. ASSERT (Phase 2): Check for 200 OK and decrypt the final response
    expect(pollResponse.status).toBe(200);
    const encryptedFinalResponse = pollResponse.text.startsWith('response=')
      ? pollResponse.text.slice('response='.length)
      : pollResponse.text;
    
    const { decryptedBytes } = await cryptoService.decryptJwe(encryptedFinalResponse, externalEncrypter);
    const finalResponse = JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IDecodedDidcommPayload;

    // 5. ASSERT (Phase 3): Verify the content of the final, decrypted Offer
    expect(finalResponse.thid).toBe(thid);
    const responseEntry = finalResponse.body.data[0];
    const claims = responseEntry.resource.meta.claims;

    expect(responseEntry.type).toBe('Organization-registration-offer-v1.0');
    expect(claims[ClaimsOfferSchemaorg.eligibleQuantityValue]).toBe(2);
    expect(claims[ClaimsOfferSchemaorg.identifier]).toBeDefined();
    expect(claims[ClaimsOfferSchemaorg.price]).toBe('0.00'); // Or the calculated price
    expect(claims[ClaimsOfferSchemaorg.offeredBy]).toBe('did:web:provider.com');

    // --- ACT (Phase 4): Accept the Offer by submitting an Order ---
    const offerId = claims[ClaimsOfferSchemaorg.identifier] as string;
    const orderThid = `${thid}-order`;
    const orderPayload = {
      thid: orderThid,
      iss: orgCreationPayload.iss,
      aud: orgCreationPayload.aud,
      jti: `jti-${orderThid}`,
      type: 'api+json',
      body: {
        data: [
          {
            type: GatewayRequestEntryTypes.OrganizationOrder,
            resource: { meta: { claims: { [ClaimsOrderSchemaorg.acceptedOfferIdentifier]: offerId } } },
          },
        ],
      },
    };

    const orderJwsProtectedHeader = {
      alg: externalSigner.alg,
      kid: externalSigner.kid,
      jwk: {
        alg: externalSigner.alg,
        kid: externalSigner.kid,
        kty: externalSigner.kty,
        pub: externalSigner.pub,
      },
    };
    const orderJwsParts = await cryptoService.signDataJws(orderPayload, orderJwsProtectedHeader, externalSigner.privBytes);
    const orderCompactJws = `${orderJwsParts.protected}.${orderJwsParts.payload}.${orderJwsParts.signature}`;

    const orderJweProtectedHeader = {
      enc: 'A256GCM',
      cty: 'JWS',
      skid: externalEncrypter.kid,
      jwk: {
        crv: externalEncrypter.crv,
        kid: externalEncrypter.kid,
        kty: externalEncrypter.kty,
        x: externalEncrypter.x,
      },
    };
    const orderCompactJwe = await cryptoService.encryptJweToCompact(
      orderCompactJws,
      orderJweProtectedHeader,
      externalEncrypter,
      hostEncryptionKey,
    );

    const orderUrl = `/host/cds-ES/v1/test/registry/org.schema/Order/_batch`;
    const orderPostResponse = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: orderUrl,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Bearer ${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"sub":"byok-dcr-test"}').toString('base64url')}.`,
      },
      body: { request: orderCompactJwe },
    });
    expect(orderPostResponse.status).toBe(202);
    expect(orderPostResponse.headers.location).toBeDefined();

    const orderPollingPath = new URL(orderPostResponse.headers.location).pathname;
    let orderPollResponse: { status: number; headers: any; text: string } | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (queueAdapter instanceof QueueAdapterMem) {
        await (queueAdapter as InstanceType<typeof QueueAdapterMem>).waitForEmptyQueue();
      } else {
        await delay(50);
      }
      orderPollResponse = await invokeExpress(app, {
        method: HttpRequestMethods.Post,
        url: orderPollingPath,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { thid: orderThid },
      });
      if (orderPollResponse.status === 200) break;
      await delay(25);
    }

    expect(orderPollResponse?.status).toBe(200);
    const encryptedOrderFinalResponse = orderPollResponse!.text.startsWith('response=')
      ? orderPollResponse!.text.slice('response='.length)
      : orderPollResponse!.text;
    const { decryptedBytes: orderDecryptedBytes } = await cryptoService.decryptJwe(encryptedOrderFinalResponse, externalEncrypter);
    const orderFinalResponse = JSON.parse(Content.bytesToStringUTF8(orderDecryptedBytes)) as IDecodedDidcommPayload;
    expect(orderFinalResponse.thid).toBe(orderThid);
    expect(orderFinalResponse.body?.data?.[0]).toMatchObject({ response: { status: String(HttpStatusCodes.Created) } });
    controllerActivationCode = String(orderFinalResponse.body.data[0]?.resource?.meta?.claims?.[
      ClaimsIndividualProductSchemaorg.serialNumber
    ] || '');
    expect(controllerActivationCode).toMatch(/^lic-[A-Za-z0-9_-]+$/);

    // Reload host + tenant caches after finalization to make subsequent tests deterministic.
    await tenantManager.loadHost();
    const tenantDid = await tenantManager.getTenantDid(testTenant1VaultId);
    if (orderFinalResponse.body?.data?.[0]?.response?.status === '201') {
      expect(tenantDid).toBeDefined();
    }
    // Continue the same stateful journey: no phase is optional and any failed
    // authorization or incomplete asynchronous result fails this one test.
    expect(controllerActivationCode).toBeTruthy();

    const makeEncryptedRequest = async (payload: Record<string, any>) => {
      const jwsHeader = {
        alg: externalSigner.alg,
        kid: externalSigner.kid,
        jwk: {
          alg: externalSigner.alg,
          kid: externalSigner.kid,
          kty: externalSigner.kty,
          pub: externalSigner.pub,
        },
      };
      const signed = await cryptoService.signDataJws(payload, jwsHeader, externalSigner.privBytes);
      const compactJws = `${signed.protected}.${signed.payload}.${signed.signature}`;
      return cryptoService.encryptJweToCompact(
        compactJws,
        {
          enc: 'A256GCM',
          cty: 'JWS',
          skid: externalEncrypter.kid,
          jwk: {
            crv: externalEncrypter.crv,
            kid: externalEncrypter.kid,
            kty: externalEncrypter.kty,
            x: externalEncrypter.x,
          },
        },
        externalEncrypter,
        hostEncryptionKey,
      );
    };
    const pollEncryptedResponse = async (location: string, thid: string) => {
      let response: { status: number; headers: any; text: string } | undefined;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await (queueAdapter as InstanceType<typeof QueueAdapterMem>).waitForEmptyQueue();
        response = await invokeExpress(app, {
          method: HttpRequestMethods.Post,
          url: new URL(location).pathname,
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: { thid },
        });
        if (response.status === HttpStatusCodes.Ok) break;
        await delay(25);
      }
      expect(response?.status).toBe(HttpStatusCodes.Ok);
      const compactResponse = response!.text.startsWith('response=')
        ? response!.text.slice('response='.length)
        : response!.text;
      const { decryptedBytes } = await cryptoService.decryptJwe(compactResponse, externalEncrypter);
      return JSON.parse(Content.bytesToStringUTF8(decryptedBytes)) as IDecodedDidcommPayload;
    };

    const accountToken = `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({
      sub: testTenant1Data.member.admin1.email,
      email: testTenant1Data.member.admin1.email,
      email_verified: true,
    })).toString('base64url')}.`;
    const exchangeThid = `${testPayloadCreateTenant1.thid}-token-exchange`;
    const exchangePayload = {
      thid: exchangeThid,
      iss: testPayloadCreateTenant1.iss,
      aud: await tenantManager.getTenantDid(testTenant1VaultId),
      type: 'application/json',
      body: {
        subject_token: controllerActivationCode,
        client_instance_id: 'byok-controller-browser',
      },
    };
    const exchangeResponse = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/Token/_exchange`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Bearer ${accountToken}`,
      },
      body: { request: await makeEncryptedRequest(exchangePayload) },
    });
    expect(exchangeResponse.status).toBe(HttpStatusCodes.Accepted);
    expect(exchangeResponse.headers.location).toBeDefined();
    const exchangeFinal = await pollEncryptedResponse(exchangeResponse.headers.location, exchangeThid);
    expect(exchangeFinal.thid).toBe(exchangeThid);
    const initialAccessToken = String((exchangeFinal.body as any)?.initial_access_token || '');
    expect(initialAccessToken.split('.')).toHaveLength(3);

    const dcrThid = `${testPayloadCreateTenant1.thid}-device-dcr`;
    const dcrPayload = {
      thid: dcrThid,
      iss: testPayloadCreateTenant1.iss,
      aud: await tenantManager.getTenantDid(testTenant1VaultId),
      type: 'application/json',
      body: {
        application_type: 'web',
        client_name: 'BYOK controller browser',
        code: controllerActivationCode,
        redirect_uris: ['https://controller.example/callback'],
        token_endpoint_auth_method: 'private_key_jwt',
        ext_device_info: {
          device_id: 'byok-controller-browser',
          device_name: 'BYOK controller browser',
          os: 'Web',
          os_version: '1',
        },
        jwks: {
          keys: [
            {
              alg: externalSigner.alg,
              kid: externalSigner.kid,
              kty: externalSigner.kty,
              pub: externalSigner.pub,
              use: 'sig',
            },
            {
              crv: externalEncrypter.crv,
              kid: externalEncrypter.kid,
              kty: externalEncrypter.kty,
              x: externalEncrypter.x,
              use: 'enc',
            },
          ],
        },
      },
    };
    const dcrResponse = await invokeExpress(app, {
      method: HttpRequestMethods.Post,
      url: `/${testTenant1AlternateName}/cds-ES/v1/health-care/identity/openid/Device/_dcr`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Bearer ${initialAccessToken}`,
      },
      body: { request: await makeEncryptedRequest(dcrPayload) },
    });
    expect(dcrResponse.status).toBe(HttpStatusCodes.Accepted);
    expect(dcrResponse.headers.location).toBeDefined();
    const dcrFinal = await pollEncryptedResponse(dcrResponse.headers.location, dcrThid);
    expect(dcrFinal.thid).toBe(dcrThid);
    expect(dcrFinal.body.data[0]).toMatchObject({
      response: { status: String(HttpStatusCodes.Created) },
      resource: { resourceType: ResourceTypesFhirR4.Device },
    });
    const clientId = String(dcrFinal.body.data[0].resource.id || '');
    expect(clientId).toBeTruthy();

    const deviceProfile = await vaultRepository.get(
      testTenant1VaultId,
      clientId,
      getEnvSectionId('device-profiles'),
    ) as ConfidentialStorageDoc | undefined;
    expect(deviceProfile).toBeDefined();
    const openedProfile = await kmsService.unprotectConfidentialData<any>(
      deviceProfile!,
      testTenant1VaultId,
    );
    expect(openedProfile.clientId).toBe(clientId);
    expect(openedProfile.jwks.keys.map((key: { kid?: string }) => key.kid)).toEqual(
      expect.arrayContaining([externalSigner.kid, externalEncrypter.kid]),
    );

    const licenseDocuments = await vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      testTenant1VaultId,
      getEnvSectionId('device-licenses'),
    );
    const openedLicenses = await Promise.all(licenseDocuments.map(async (document) =>
      document.content && typeof document.content === 'object'
        ? document.content as DeviceLicense & Record<string, any>
        : kmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(
          document,
          testTenant1VaultId,
        )));
    const activatedLicense = openedLicenses.find((license) =>
      license.activationCode === controllerActivationCode);
    expect(activatedLicense).toBeDefined();
    expect(activatedLicense!).toMatchObject({
      status: 'active',
      deviceId: clientId,
    });
    expect(activatedLicense!.deviceBindings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        clientId,
        clientInstanceId: 'byok-controller-browser',
        status: 'active',
      }),
    ]));
  });
});
