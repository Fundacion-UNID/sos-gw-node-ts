---
alwaysApply: true
---

When creating or modifying core modules (controllers, services, managers, models, adapters), I must strictly follow Test-Driven Development. This means: 1. Write a failing test that defines the desired new feature or fix. 2. Write the minimum amount of application code required to make the test pass. 3. Refactor the code. This process must be followed for services like IKmsService implementations.