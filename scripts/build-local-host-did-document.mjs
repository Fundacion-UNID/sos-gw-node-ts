import { deriveDeterministicEcJwkPair } from 'gdc-common-utils-ts/utils/deterministic-jwk'
import { buildAuthorityDidWeb } from 'gdc-common-utils-ts/utils/authority-resolution'

const authority = required(process.env.HOST_AUTHORITY_BASE_URL, 'HOST_AUTHORITY_BASE_URL')
const seed = required(process.env.HOST_PREAUTHORIZATION_TEST_SEED, 'HOST_PREAUTHORIZATION_TEST_SEED')
const did = buildAuthorityDidWeb({ authority })
const { publicJwk } = deriveDeterministicEcJwkPair({
  seed,
  purpose: 'local-vetchain-host-preauthorization',
  alg: 'ES384',
})
const kid = `${did}#${publicJwk.kid}`

process.stdout.write(JSON.stringify([{
  id: did,
  verificationMethod: [{
    id: kid,
    type: 'JsonWebKey2020',
    controller: did,
    publicKeyJwk: publicJwk,
  }],
  authentication: [kid],
  assertionMethod: [kid],
}]))

function required(value, error) {
  const normalized = String(value || '').trim()
  if (!normalized) throw new Error(error)
  return normalized
}
