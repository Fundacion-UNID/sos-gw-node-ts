---
{}
---

When creating a resource entry (BundleEntry/DataEntry), the structure MUST follow the hybrid FHIR/JSON:API pattern:
1. The top-level 'type' field indicates the JSON:API resource type (e.g., 'Organization', 'Person').
2. The nested 'resource' object MUST contain a 'resourceType' field, indicating the FHIR resource type (e.g., 'Organization', 'Practitioner').
3. The original claims for the resource MUST be preserved in 'resource.meta.claims'.