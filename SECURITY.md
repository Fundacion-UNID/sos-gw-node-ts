# Security Policy

## Auditable Communication Model

As of `1.3.12`, gateway communication ingestion follows this security-oriented separation:

- `CommMsgExtended` is the atomic message/event persisted for the subject-scoped confidential communication channel.
- `FHIR Communication` is the interoperable health projection used for standards-facing APIs and downstream health systems.
- `DocumentReference` is the atomic attachment/document projection derived from `Communication.payload.contentAttachment`.

This separation exists to avoid two classes of security/design errors:

1. treating UI/message projections as the only auditable artifact,
2. collapsing multi-attachment communication flows into opaque, non-recoverable blobs.

## Storage Rules

- One communication event persists as one auditable `CommMsgExtended` channel record.
- One attachment persists as one `DocumentReference` projection.
- Attachment projections must preserve a content-integrity identifier (`DocumentReference.contenthash`).
- Communication channel records should point to atomized attachment records through canonical `Communication.content-reference` values.

Current GW linkage convention:

- `Communication.content-reference = DocumentReference/<logical-record-id>`

## Client and Backend Expectations

- Public clients must not be treated as the authoritative audit layer.
- Gateway/business audit semantics belong in backend-controlled storage and projections.
- Transport-level logs do not replace business-level communication audit trails.

## Operational Notes

- `Communication` / `CommMsgExtended` timelines are auditable business records, not a substitute for low-level auth, token, or infrastructure logs.
- Sensitive document retrieval should prefer atomic `DocumentReference` lookup and integrity verification instead of replaying full conversation blobs.
