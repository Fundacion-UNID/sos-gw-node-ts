// src/__tests__/unit/utils/time.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { parseValidityPeriod } from '../../../utils/time';

describe('parseValidityPeriod', () => {
  const startDate = new Date('2025-01-15T12:00:00.000Z');

  it('should correctly add 1 year', () => {
    const result = parseValidityPeriod('1y', startDate);
    expect(result.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('should correctly add 6 months', () => {
    const result = parseValidityPeriod('6M', startDate);
    expect(result.toISOString()).toBe('2025-07-15T12:00:00.000Z');
  });

  it('should correctly add 30 days', () => {
    const result = parseValidityPeriod('30d', startDate);
    expect(result.toISOString()).toBe('2025-02-14T12:00:00.000Z');
  });
  
  it('should correctly add 5 hours', () => {
    const result = parseValidityPeriod('5h', startDate);
    expect(result.toISOString()).toBe('2025-01-15T17:00:00.000Z');
  });

  it('should correctly add 15 minutes', () => {
    const result = parseValidityPeriod('15m', startDate);
    expect(result.toISOString()).toBe('2025-01-15T12:15:00.000Z');
  });

  it('should handle multiple digits in duration', () => {
    const result = parseValidityPeriod('10y', startDate);
    expect(result.getFullYear()).toBe(2035);
  });

  it('should use current date if startDate is not provided', () => {
    const now = new Date();
    // Freeze time to ensure consistency
    jest.useFakeTimers().setSystemTime(now);
    const result = parseValidityPeriod('1y');
    const expected = new Date(now);
    expected.setFullYear(now.getFullYear() + 1);
    expect(result.getTime()).toBe(expected.getTime());
    jest.useRealTimers();
  });

  it('should throw an error for an invalid unit', () => {
    expect(() => parseValidityPeriod('1w', startDate)).toThrow(
      'Invalid unit in period string: "1w". Use \'y\', \'M\', \'d\', \'h\', or \'m\'.'
    );
  });

  it('should throw an error for an invalid duration', () => {
    expect(() => parseValidityPeriod('xy', startDate)).toThrow(
      'Invalid duration in period string: "xy"'
    );
  });
});
