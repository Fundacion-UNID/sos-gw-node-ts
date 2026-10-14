---
alwaysApply: true
---

The 'id' field of a JSON:API resource object MUST be derived from the 'org.schema.<Type>.identifier' claim. The logic to extract the UUID from the URN ('urn:uuid:<value>') is handled by the 'determineResourceId' utility. The original 'identifier' claim MUST be preserved within the resource's 'meta.claims' object. For an Organization, the 'taxID' claim is a secondary identifier and should NOT be used as the resource 'id'.