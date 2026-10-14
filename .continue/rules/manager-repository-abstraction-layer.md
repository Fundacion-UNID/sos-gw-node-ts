---
alwaysApply: true
---

Business logic managers (e.g., `HostingManager`, `TenantsCacheManager`) MUST operate using logical identifiers (`vaultId`s like 'host' or 'sector_alternateName'). They MUST NOT have knowledge of physical storage details like collection names. The `IVaultRepository` interface is the SOLE layer responsible for translating logical identifiers into physical storage locations. Managers MUST call repository methods like `get('host', ...)` and trust the repository implementation (e.g., `FirestoreVaultRepository`, `VaultMemRepository`) to handle the translation.