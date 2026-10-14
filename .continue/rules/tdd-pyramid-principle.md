---
{}
---

When adding or modifying functionality, I MUST follow the TDD pyramid:
1.  Write unit tests for the new component(s) first, ensuring they cover all core functionality.
2.  Ensure all unit tests pass.
3.  Only then, write or modify integration tests that use the new, unit-tested component(s).