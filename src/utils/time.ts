// src/utils/time.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Parses a validity period string and returns the corresponding expiration date.
 * @param period A string representing the period (e.g., "1y", "6m", "30d", "5m").
 * @param startDate The date from which the period should be calculated. Defaults to now.
 * @returns The calculated expiration Date object.
 * @throws An error if the period format is invalid.
 */
export function parseValidityPeriod(period: string, startDate: Date = new Date()): Date {
  const date = new Date(startDate.getTime());
  const duration = parseInt(period.slice(0, -1), 10);
  const unit = period.slice(-1);

  if (isNaN(duration)) {
    throw new Error(`Invalid duration in period string: "${period}"`);
  }

  switch (unit) {
    case 'y':
      date.setUTCFullYear(date.getUTCFullYear() + duration);
      break;
    case 'M': // Note: 'm' is for minutes, 'M' is for months
      date.setUTCMonth(date.getUTCMonth() + duration);
      break;
    case 'd':
      date.setUTCDate(date.getUTCDate() + duration);
      break;
    case 'h':
       date.setUTCHours(date.getUTCHours() + duration);
       break;
    case 'm':
      date.setUTCMinutes(date.getUTCMinutes() + duration);
      break;
    default:
      throw new Error(`Invalid unit in period string: "${period}". Use 'y', 'M', 'd', 'h', or 'm'.`);
  }

  return date;
}
