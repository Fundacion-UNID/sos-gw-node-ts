# Artifact smart contract

`artifact-sc` stores a content-addressed asset for each submitted resource. Its
stable identity is the resource CID; the original clinical resource, FHIR
`fullUrl`, indexed claims, display text and notes never cross the ledger
boundary.

Version 1.1 keeps the 1.0 `data[]` contract and adds two optional fields to each
entry:

- `relationships`: arrays (or legacy CSV input) of opaque multibase hashes,
  keyed by provenance role such as `author`, `attester`, `sender`, `submitter`
  or `signingKey`;
- `ownerships`: opaque multibase hashes for the represented subject or owner.

The contract rejects raw identifiers in either field. Hash construction and
the Fabric channel and contract selection remain manager-owned; BFF and portal
callers submit clinical intent, never ledger routing or unhashed provenance.
For UUID-backed references the manager hashes the canonical 16 UUID bytes, so
equivalent bare, `urn:uuid:...`, FHIR relative and employee-instance references
produce the same SHA3-384 multihash.
