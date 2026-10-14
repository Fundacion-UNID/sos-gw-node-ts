// src/auth/__mocks__/IdentityProvider.ts

// Note: Jest automatically uses this file when mocking the module if the path matches.

export const verifyIdToken = jest.fn().mockResolvedValue({
    uid: 'mock-user-id',
    email: 'mock@example.com',
  });
  