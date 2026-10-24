# Identifier-free public-health statistics

This product-neutral capability is shared by human-health, animal-health and
emergency clients. It uses the existing Communication ingestion route and the
existing `artifact-sc` CCAAS; it does not add a public route or a separate
chaincode.

The client does not select the ledger shape. The trusted provider context
does: an `animal-*` sector contributes `animal` statistics and a `health-*`
sector contributes `human` statistics. A mixed sector requires an
authoritative server-side subject-kind decision. No subject identifier is used
as statistical data or serialized to the ledger.

Three statistical contribution paths are supported:

1. During professional certification, the attached Bundle may contain
   `registerResearchMetadata: true`. The gateway treats it only as intent and
   independently verifies the professional creator binding, exact attestation,
   final status, canonical code and attachment.
2. An authenticated individual may later submit a claims-first Parameters
   operation at `PublicHealthStatistic/$report` with
   `Parameters.reportKind = clinical-record`, `Parameters.resourceType` and
   `Parameters.resourceId`. The gateway reopens that subject-scoped private
   record and rejects self-created or unverified professional evidence.
3. An authenticated individual may submit
   `Parameters.reportKind = self-report` with a canonical code, section and
   date, for example a symptom report. This path does not require or create a
   private clinical record.

Each accepted event receives a fresh random UUID. The ledger payload contains
only that UUID, human/animal kind, section, canonical coding, jurisdiction,
coarse date and optional coarse demographics. It contains no source record id,
source hash, signature or stable pseudonym, so separate events cannot be joined
into a person, animal or Digital Twin history. Routing to the research channel
is derived from the trusted gateway sector and jurisdiction. No patient,
animal, subject, professional, clinic or organization identifier is serialized.

These public statistics are separate from all three other planes: private
tenant spreadsheet imports, private tenant Digital Twin datasets, and an
individual's later consent to create a Digital Twin from clinical history.
They are also independent from SHC issuance and from the separate anchoring of
a clinical record hash or signature. A failure during the optional
certification-time registration returns a warning without rolling back the
private clinical write; a later explicit report fails if the ledger
transaction is not accepted.

The separate individual-directed Digital Twin contract lets the person choose
the target `ResearchStudy`. The private alias registry is keyed by the
operational subject plus the exact research-use reference, so two studies
receive different random `urn:uuid` subjects and cannot correlate them through
the gateway identifier. Each study decision can be enabled or disabled
independently. The private index retains the chosen study reference, its twin
UUID and the last successful sharing time; public `ResearchSubject` results
carry the matching standard `study` reference.

Before deidentification and projection, the gateway verifies the origin and
professional provenance of genuine clinical records. The receiving study
therefore gets an assurance established before projection even though the
resulting twin cannot expose the source needed to repeat that verification.
The chosen study may also receive direct individual reports, but neither path
creates public statistical events. The public-statistics builders do not
create, update or index these study-specific twins. Discovery of external
studies and the cross-organization transfer UI remain separate portal work.
