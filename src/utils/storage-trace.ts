import fs from 'node:fs';
import path from 'node:path';

const STORAGE_TRACE_ENABLED = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.GDC_STORAGE_TRACE || '').trim().toLowerCase(),
);

function resolveDefaultTraceFilePath(): string {
  const explicit = String(process.env.GDC_STORAGE_TRACE_FILE || '').trim();
  if (explicit) return explicit;
  return path.join(process.cwd(), 'test-results', 'storage-trace.jsonl');
}

export function isStorageTraceEnabled(): boolean {
  return STORAGE_TRACE_ENABLED;
}

export function appendStorageTrace(
  backend: 'firestore' | 'gcs' | 'ipfs',
  operation: string,
  details: Record<string, unknown>,
): void {
  if (!STORAGE_TRACE_ENABLED) return;

  const entry = {
    ts: new Date().toISOString(),
    backend,
    operation,
    ...details,
  };

  const line = `${JSON.stringify(entry)}\n`;
  const traceFile = resolveDefaultTraceFilePath();

  try {
    fs.mkdirSync(path.dirname(traceFile), { recursive: true });
    fs.appendFileSync(traceFile, line);
  } catch {
    // Trace persistence must never break storage operations.
  }
}
