---
{}
---

When creating an error entry in a response, the entry MUST include the original, unprocessed 'meta' object (containing the original 'claims') from the corresponding request entry. This ensures the client can correlate the exact input that caused the failure.