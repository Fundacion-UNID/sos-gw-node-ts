---
{}
---

When writing tests, I MUST reuse existing test data fixtures and constants from the 'src/__tests__/data/' directory wherever possible. I MUST NOT use hardcoded 'magic strings' or values (e.g., URLs, identifiers, categories) in the body of a test when a constant for that value already exists. Tests should be self-documenting through the use of descriptive variable names from the data fixtures.