---
name: Tenant Existence and Resolution
alwaysApply: true
---

The single source of truth for a tenant's existence is a document within the 'tenants' section of the 'host's physical collection. The `IVaultRepository` interface abstracts the details of this check.

**Rule:** Business logic managers (like `HostingManager`) MUST check for a tenant's existence by calling the `vaultRepository.vaultExists(vaultId)` method. They MUST NOT implement their own existence checks (e.g., by calling `repository.get(...)` directly), as this would violate the repository abstraction layer.

The `vaultExists` method's implementation within a specific repository (like `FirestoreVaultRepository`) is responsible for querying the host's collection correctly to determine if the tenant's registration document exists.
