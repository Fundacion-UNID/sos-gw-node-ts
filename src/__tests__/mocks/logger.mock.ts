// src/__tests__/mocks/logger.mock.ts
import { ILogger } from '../../loggers/ILogger';

export const mockLogger: jest.Mocked<ILogger> = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};
