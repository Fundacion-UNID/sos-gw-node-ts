import { createPrivateKey, createSign } from 'node:crypto'
import { buildAuthorityDidWeb } from 'gdc-common-utils-ts/utils/authority-resolution'
import { deriveDeterministicEcJwkPair } from 'gdc-common-utils-ts/utils/deterministic-jwk'
import { buildOrganizationDidWeb } from 'gdc-common-utils-ts/utils/did'

let serializedInput = ''
for await (const chunk of process.stdin) serializedInput += chunk
const input = JSON.parse(serializedInput)
// The host-side smoke URL can differ from the authority URL visible inside the
// gateway container. Sign with the gateway authority so DID resolution never
// points the container back at an unreachable host-mapped port.
const baseUrl = required(
  process.env.HOST_AUTHORITY_BASE_URL || process.env.BASE_URL,
  'HOST_AUTHORITY_BASE_URL',
)
const jurisdiction = required(process.env.HOST_JURISDICTION, 'HOST_JURISDICTION').toUpperCase()
const sector = required(process.env.SECTOR, 'SECTOR')
const networkKind = required(process.env.HOST_NETWORK, 'HOST_NETWORK')
const seed = required(process.env.HOST_PREAUTHORIZATION_TEST_SEED, 'HOST_PREAUTHORIZATION_TEST_SEED')
const hostDid = buildAuthorityDidWeb({ authority: baseUrl })
const entry = input?.body?.data?.[0]
const claims = entry?.resource?.meta?.claims
if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
  throw new Error('organization_transaction_claims_required')
}
const controllerEmail = required(claims['org.schema.Person.email'], 'organization_controller_email_required')
const organizationId = required(
  claims['org.schema.Organization.identifier.value'],
  'organization_identifier_required',
)
const organizationDid = buildOrganizationDidWeb({
  hostDidWeb: hostDid,
  tenantId: organizationId,
  jurisdiction,
  sector,
})
const canonicalClaims = {
  ...claims,
  'org.schema.Organization.alternateName': organizationId,
  'org.schema.Service.identifier': organizationDid,
}
const resource = {
  meta: { claims: canonicalClaims },
  organization: { did: organizationDid },
  legalRepresentative: { email: controllerEmail },
  verification: { resourceType: 'contract' },
}
const { privateJwk, publicJwk } = deriveDeterministicEcJwkPair({
  seed,
  purpose: 'local-vetchain-host-preauthorization',
  alg: 'ES384',
})
const kid = `${hostDid}#${publicJwk.kid}`
const protectedEncoded = Buffer.from(JSON.stringify({ alg: 'ES384', kid })).toString('base64url')
const payloadEncoded = Buffer.from(JSON.stringify({
  jurisdiction,
  sector,
  networkKind,
  resourceType: 'contract',
  resource,
})).toString('base64url')
const signer = createSign('sha384')
signer.update(`${protectedEncoded}.${payloadEncoded}`)
signer.end()
const signatureEncoded = signer.sign({
  key: createPrivateKey({ key: privateJwk, format: 'jwk' }),
  dsaEncoding: 'ieee-p1363',
}).toString('base64url')

input.iss = hostDid
input.body = {
  ...input.body,
  hostAuthorizationProof: { jws: `${protectedEncoded}.${payloadEncoded}.${signatureEncoded}` },
  data: [{ ...entry, meta: undefined, resource }],
}
process.stdout.write(JSON.stringify(input))

function required(value, error) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(error)
  return normalized
}
