---
description: A step-by-step process for fixing failing tests, starting with
  isolating the problematic test and verifying types with tsc before running the
  full suite.
---

When fixing a failing test, follow this workflow:
1. Isolate the single failing test file.
2. Run `tsc --noEmit` on that specific file to check for type errors first.
3. If `tsc` passes, run the single test file with the test runner (e.g., `jest <file_path>`).
4. After the isolated test passes, run the full `tsc` and test suite (e.g., `npm run test`) to check for regressions.