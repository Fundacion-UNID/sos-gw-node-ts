import type { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';
import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import type { DidDocument, VerificationMethod } from 'gdc-common-utils-ts/models/did';
import type { VerifiableCredentialV2 } from 'gdc-common-utils-ts/models/verifiable-credential';
import {
  ActivationCredentialTypes,
  ContractCredentialTypes,
  EnvironmentCredentialTypes,
} from 'gdc-common-utils-ts/constants/verifiable-credentials';
import {
  canonicalizeOrganizationTestNetworkCredential,
} from 'gdc-common-utils-ts/utils/organization-test-network-credential';
import {
  canonicalizeTestNetworkOrganizationCredential,
} from 'gdc-common-utils-ts/utils/test-network-organization-credentials';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
import { toJwkThumbprintSha256Urn } from 'gdc-common-utils-ts/utils/jwk-thumbprint';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';

type VerificationInput = Readonly<{
  credential: VerifiableCredentialV2;
  claims: Record<string, unknown>;
  controller?: Record<string, unknown>;
  organization?: Record<string, unknown>;
  controllerEmail?: string;
  legalRepresentativeEmail?: string;
  testNetworkCredentials?: readonly VerifiableCredentialV2[];
  cryptography: ICryptography;
  trustedIssuers: string[];
  trustedSigners?: ReadonlyArray<Readonly<{
    issuer: string;
    actorDid: string;
    role: string;
    jwkThumbprints: readonly string[];
    status?: 'active' | 'revoked';
  }>>;
  fetchImpl?: typeof fetch;
  now?: Date;
}>;

export type TestNetworkAdmissionVerificationResult = Readonly<{
  mode: 'organization-test-network-vc';
  credentialId: string;
  issuer: string;
  signer: string;
  checks: Readonly<{
    trustedIssuer: true;
    signerCurrentlyAuthorizedByIssuer: true;
    signerMethodActive: true;
    detachedPqcProof: true;
    applicationBinding: true;
  }>;
  credentials: readonly VerifiableCredentialV2[];
}>;

/**
 * Verifies the Test Network VC without calling ICA. Published DID governance
 * is preferred. The Test Network MVP can instead use an issuer-maintained
 * employee DID, role and key-thumbprint registry until employee governance
 * keys are published; deleting or revoking an entry fails closed.
 */
export async function verifyOrganizationTestNetworkCredential(
  input: VerificationInput,
): Promise<TestNetworkAdmissionVerificationResult> {
  const credential = input.credential;
  const issuer = typeof credential.issuer === 'string'
    ? credential.issuer
    : String((credential.issuer as { id?: string } | undefined)?.id || '');
  if (!credential.type.includes(ContractCredentialTypes.OrganizationTestNetworkCredential)) {
    fail('Unexpected organization Test Network credential type.');
  }
  if (!input.trustedIssuers.includes(issuer)) fail('Organization Test Network admission issuer is not trusted.');
  const now = input.now || new Date();
  if (credential.validFrom && now < new Date(credential.validFrom)) fail('Organization Test Network admission is not active yet.');
  if (credential.validUntil && now >= new Date(credential.validUntil)) fail('Organization Test Network admission has expired.');

  const subject = credential.credentialSubject as Record<string, any>;
  const organizationIdentifier = String(
    input.claims[ClaimsOrganizationSchemaorg.identifierValue]
      || input.claims[ClaimsOrganizationSchemaorg.taxId]
      || '',
  ).trim();
  if (!organizationIdentifier || subject.organization?.identifier !== organizationIdentifier) {
    fail('Admission organization identifier does not match transaction claims.');
  }
  if (String(input.organization?.did || '') !== String(subject.id || '')) {
    fail('Admission subject DID does not match the requested organization DID.');
  }
  if (String(input.controllerEmail || '').trim().toLowerCase()
    !== String(subject.controller?.email || '').trim().toLowerCase()) {
    fail('Admission controller email does not match the transaction.');
  }
  const controllerJwk = input.controller?.publicKeyJwk as PublicJwk | undefined;
  if (!controllerJwk
    || toJwkThumbprintSha256Urn(controllerJwk) !== subject.controller?.hasCredential?.material) {
    fail('Admission controller key does not match the transaction.');
  }

  const proofs = Array.isArray(credential.proof) ? credential.proof : credential.proof ? [credential.proof] : [];
  const proof = proofs.find(item => item.proofPurpose === 'contractAgreement' && item.jws && item.verificationMethod);
  if (!proof) fail('Organization Test Network admission requires a contractAgreement proof.');
  const verificationMethod = String(proof.verificationMethod);
  const signerDid = verificationMethod.split('#')[0];
  const fetchImpl = input.fetchImpl || fetch;
  const embeddedJwk = (proof as any).publicKeyJwk as PublicJwk | undefined;
  const registeredSigner = input.trustedSigners?.find(entry => entry.issuer === issuer && entry.actorDid === signerDid);
  let signerJwk: PublicJwk;
  if (registeredSigner) {
    if (registeredSigner.status === 'revoked') fail('Admission signer is revoked.');
    if (registeredSigner.role !== 'RESPRSN') fail('Admission signer role is not authorized.');
    if (!embeddedJwk) fail('Registered admission signer proof must embed its public JWK.');
    const thumbprint = toJwkThumbprintSha256Urn(embeddedJwk);
    if (!registeredSigner.jwkThumbprints.includes(thumbprint)) {
      fail('Admission signer key is not active in the host registry.');
    }
    if (verificationMethod !== `${signerDid}#${embeddedJwk.kid}`) {
      fail('Admission verification method does not match its registered public key.');
    }
    signerJwk = embeddedJwk;
  } else {
    const [issuerDocument, signerDocument] = await Promise.all([
      resolveDidWebDocument(issuer, fetchImpl),
      resolveDidWebDocument(signerDid, fetchImpl),
    ]);
    const issuerControllers = Array.isArray(issuerDocument.controller)
      ? issuerDocument.controller
      : issuerDocument.controller ? [issuerDocument.controller] : [];
    if (!issuerControllers.includes(signerDid)) fail('Admission signer is not a current issuer controller.');
    if ((signerDocument as any).deactivated === true || String((signerDocument as any).status || '') === 'revoked') {
      fail('Admission signer is revoked.');
    }
    const method = (signerDocument.verificationMethod || []).find(item => item.id === verificationMethod);
    if (!method?.publicKeyJwk || !relationshipContains(signerDocument.assertionMethod, verificationMethod)) {
      fail('Admission signer method is not an active assertion method.');
    }
    signerJwk = method.publicKeyJwk as PublicJwk;
  }
  const header = JSON.parse(Buffer.from(String(proof.jws).split('.')[0] || '', 'base64url').toString('utf8'));
  if (header.alg !== 'ML-DSA-65') fail('Organization Test Network admission requires ML-DSA-65.');
  const valid = await input.cryptography.verifyDetachedJws(
    new TextEncoder().encode(canonicalizeOrganizationTestNetworkCredential(credential)),
    String(proof.jws),
    signerJwk,
  );
  if (!valid) fail('Organization Test Network admission proof is invalid.');

  const credentials = await verifyTestNetworkDomainCredentials({
    credentials: input.testNetworkCredentials,
    organizationTestNetworkCredential: credential,
    signerJwk,
    verificationMethod,
    controllerEmail: input.controllerEmail,
    legalRepresentativeEmail: input.legalRepresentativeEmail,
    cryptography: input.cryptography,
  });

  return {
    mode: 'organization-test-network-vc',
    credentialId: String(credential.id || ''),
    issuer,
    signer: signerDid,
    checks: {
      trustedIssuer: true,
      signerCurrentlyAuthorizedByIssuer: true,
      signerMethodActive: true,
      detachedPqcProof: true,
      applicationBinding: true,
    },
    credentials,
  };
}

async function verifyTestNetworkDomainCredentials(input: Readonly<{
  credentials?: readonly VerifiableCredentialV2[];
  organizationTestNetworkCredential: VerifiableCredentialV2;
  signerJwk: PublicJwk;
  verificationMethod: string;
  controllerEmail?: string;
  legalRepresentativeEmail?: string;
  cryptography: ICryptography;
}>): Promise<readonly VerifiableCredentialV2[]> {
  const credentials = input.credentials || [];
  if (credentials.length !== 3) fail('Test Network admission requires exactly three domain credentials.');
  const find = (type: string) => credentials.filter(credential => credential.type.includes(type));
  const organization = find(ActivationCredentialTypes.OrganizationCredential);
  const representative = find(ActivationCredentialTypes.LegalRepresentativeCredential);
  const controller = find(ActivationCredentialTypes.ServiceControllerCredential);
  if (organization.length !== 1 || representative.length !== 1 || controller.length !== 1) {
    fail('Test Network admission requires Organization, LegalRepresentative and ServiceController credentials.');
  }
  const admissionSubject = input.organizationTestNetworkCredential.credentialSubject as Record<string, any>;
  const pdfEvidenceId = `urn:sha256:${String(admissionSubject.applicationEvidence?.pdfSha256 || '')}`;
  const controllerActor = buildStableActorIdentifier({
    contactKind: 'email', contact: String(input.controllerEmail || ''),
  });
  const representativeActor = buildStableActorIdentifier({
    contactKind: 'email', contact: String(input.legalRepresentativeEmail || ''),
  });
  if (organization[0].credentialSubject.id !== admissionSubject.id
    || String(organization[0].credentialSubject.legalName || '') !== String(admissionSubject.organization?.legalName || '')) {
    fail('Test Network OrganizationCredential does not match the admission VC.');
  }
  if (representative[0].credentialSubject.sameAs !== representativeActor) {
    fail('Test Network LegalRepresentativeCredential does not match the reviewed representative.');
  }
  if (controller[0].credentialSubject.owner?.sameAs !== controllerActor
    || controller[0].credentialSubject.owner?.additionalType !== 'RESPRSN'
    || controller[0].credentialSubject.owner?.hasCredential?.material
      !== admissionSubject.controller?.hasCredential?.material) {
    fail('Test Network ServiceControllerCredential does not match controller authority and key.');
  }
  for (const domainCredential of credentials) {
    if (!domainCredential.type.includes(EnvironmentCredentialTypes.TestNetworkCredential)
      || domainCredential.issuer !== input.organizationTestNetworkCredential.issuer
      || !Array.isArray(domainCredential.evidence)
      || !(domainCredential.evidence as any[]).some(item => item?.id === pdfEvidenceId)) {
      fail('Test Network domain credential scope, issuer or PDF evidence is invalid.');
    }
    const proofs = Array.isArray(domainCredential.proof)
      ? domainCredential.proof : domainCredential.proof ? [domainCredential.proof] : [];
    const proof = proofs.find(item => item.proofPurpose === 'assertionMethod'
      && item.verificationMethod === input.verificationMethod && item.jws);
    if (!proof) fail('Test Network domain credential requires the reviewer assertion proof.');
    const header = JSON.parse(Buffer.from(String(proof.jws).split('.')[0] || '', 'base64url').toString('utf8'));
    if (header.alg !== 'ML-DSA-65') fail('Test Network domain credentials require ML-DSA-65.');
    const valid = await input.cryptography.verifyDetachedJws(
      new TextEncoder().encode(canonicalizeTestNetworkOrganizationCredential(domainCredential)),
      String(proof.jws),
      input.signerJwk,
    );
    if (!valid) fail('Test Network domain credential proof is invalid.');
  }
  return credentials;
}

function relationshipContains(
  relationship: Array<string | VerificationMethod> | undefined,
  methodId: string,
): boolean {
  return (relationship || []).some(item => typeof item === 'string' ? item === methodId : item.id === methodId);
}

async function resolveDidWebDocument(did: string, fetchImpl: typeof fetch): Promise<DidDocument> {
  if (!did.startsWith('did:web:')) fail('Admission proof requires did:web identities.');
  const parts = did.slice('did:web:'.length).split(':');
  const domain = decodeURIComponent(parts.shift() || '');
  const url = parts.length > 0
    ? `https://${domain}/${parts.map(decodeURIComponent).join('/')}/did.json`
    : `https://${domain}/.well-known/did.json`;
  const response = await fetchImpl(url, { headers: { accept: 'application/did+json, application/json' } });
  if (!response.ok) fail(`Could not resolve authorization DID '${did}'.`);
  const document = await response.json() as DidDocument;
  if (document.id !== did) fail(`Resolved authorization DID does not match '${did}'.`);
  return document;
}

function fail(message: string): never {
  throw new ManagerError(message, IssueType.Security);
}
