// src/loggers/ConsoleLogger.ts

import { ILogger, LogContext, LogSeverity } from './ILogger';

/**
 * A concrete implementation of the ILogger interface that writes structured
 * JSON logs to the console. This is the default logger and is suitable for
 * local development and for cloud environments like Google Cloud Run, which
 * automatically ingest and parse stdout/stderr streams.
 */
export class ConsoleLogger implements ILogger {
  
  private log(severity: LogSeverity, message: string, context?: LogContext, error?: Error): void {
    const logEntry = {
      severity,
      timestamp: new Date().toISOString(),
      message,
      ...context,
    };

    // If an error is provided, add its details to the log entry for better debugging.
    if (error) {
      (logEntry as any).error = {
        message: error.message,
        stack: error.stack,
        name: error.name,
      };
    }

    const logString = JSON.stringify(logEntry);

    // Write to stderr for errors and warnings, stdout for info and debug.
    if (severity === 'ERROR' || severity === 'WARN') {
      console.error(logString);
    } else {
      console.log(logString);
    }
  }

  public debug(message: string, context?: LogContext): void {
    // In a production environment, we might choose to suppress debug logs.
    if (process.env.NODE_ENV !== 'production') {
      this.log('DEBUG', message, context);
    }
  }

  public info(message: string, context?: LogContext): void {
    this.log('INFO', message, context);
  }

  public warn(message: string, context?: LogContext): void {
    this.log('WARN', message, context);
  }

  public error(message: string, error?: Error, context?: LogContext): void {
    this.log('ERROR', message, context, error);
  }
}
