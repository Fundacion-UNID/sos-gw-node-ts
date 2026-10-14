---
{}
---

Business logic managers (e.g., PingManager, EmployeeManager) MUST NOT receive the entire IServerConfig object. Instead, they MUST be injected with only the specific dependencies they require (e.g., other managers, repositories, or specific configuration values like `apiBaseUrl` if absolutely necessary). To retrieve tenant-specific data, such as a DID, they MUST query the `TenantsCacheManager` or another appropriate service.