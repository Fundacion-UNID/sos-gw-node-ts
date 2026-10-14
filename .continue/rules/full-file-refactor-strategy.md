---
{}
---

When refactoring an entire file, I MUST first use the `read_file` tool to get the complete current content. Then, I MUST use the `multi_edit` tool by setting the `old_string` parameter to the *entire file content* I just read, and the `new_string` parameter to the complete refactored code. This guarantees the operation will not fail due to a string mismatch.