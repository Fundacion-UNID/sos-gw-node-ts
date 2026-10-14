// src/loggers/ILogger.ts

/**
 * Defines the severity levels for log entries, aligned with common logging standards.
 */
export type LogSeverity = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

/**
 * Represents the structured context to be included with every log entry.
 * This ensures that logs are filterable and searchable in any logging provider.
 */
export interface LogContext {
  /** The unique identifier for the tenant (e.g., 'host', 'health-care_acme'). */
  vaultId?: string;

  /** The transaction or thread ID, used for correlating related log entries. */
  thid?: string;

  /** The API endpoint path related to the log entry. */
  path?: string;

  /** The HTTP method used for the request. */
  method?: string;

  /** The name of the function or component where the log originated. */
  component?: string;

  /** Any additional, arbitrary data to include in the log. */
  [key: string]: any;
}

/**
 * Defines the standard interface for a logging service.
 * This abstraction allows for different logging implementations (e.g., Console, Sentry, CloudWatch)
 * to be used interchangeably throughout the application.
 */
export interface ILogger {
  /**
   * Logs a debug message. Useful for detailed, verbose developer-level information.
   * @param message The primary log message.
   * @param context Optional structured data.
   */
  debug(message: string, context?: LogContext): void;

  /**
   * Logs an informational message. Used for routine actions and state changes.
   * @param message The primary log message.
   * @param context Optional structured data.
   */
  info(message: string, context?: LogContext): void;

  /**
   * Logs a warning message. Indicates a potential issue that does not prevent the
   * current operation from completing but should be investigated.
   * @param message The primary log message.
   * @param context Optional structured data.
   */
  warn(message: string, context?: LogContext): void;

  /**
   * Logs an error message. Signifies a failure in a specific operation,
   * but the application as a whole can continue running.
   * @param message The primary log message.
   * @param error An optional Error object to capture stack trace and other details.
   * @param context Optional structured data.
   */
  error(message: string, error?: Error, context?: LogContext): void;
}
