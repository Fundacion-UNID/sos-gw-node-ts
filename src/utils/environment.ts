// src/utils/environment.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Retrieves the current NODE_ENV value with a fallback to 'development'.
 * This utility isolates direct access to process.env, making it easier to manage
 * and test, while avoiding the need to pass the full config object everywhere.
 *
 * @returns The current node environment string.
 */
export function getEnvironment(): string {
  return process.env.NODE_ENV || 'development';
}
