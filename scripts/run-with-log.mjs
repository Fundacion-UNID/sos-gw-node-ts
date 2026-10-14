import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Replaces: scripts/run-with-log.sh
//
// Step 1. Validate the CLI input: a label plus a command to execute.
// Step 2. Create the logs directory if it does not exist.
// Step 3. Build a timestamped, filesystem-safe log filename.
// Step 4. Spawn the target command and stream stdout/stderr live.
// Step 5. Mirror the live output both to the terminal and to the log file.
// Step 6. Exit with the same status code or signal as the wrapped command.

const [, , label, ...commandArgs] = process.argv;

if (!label || commandArgs.length === 0) {
  console.error('Usage: node ./scripts/run-with-log.mjs <label> <command> [args...]');
  process.exit(2);
}

fs.mkdirSync('logs', { recursive: true });
const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const safeLabel = label.replace(/[ /:]+/g, '-').replace(/[^A-Za-z0-9_.-]/g, '');
const logFile = path.join('logs', `${ts}-${safeLabel}.log`);

console.log(`[run-with-log] writing to ${logFile}`);
const stream = fs.createWriteStream(logFile, { flags: 'a' });
const child = spawn(commandArgs[0], commandArgs.slice(1), {
  stdio: ['inherit', 'pipe', 'pipe'],
  shell: false,
});

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  stream.write(chunk);
});

child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  stream.write(chunk);
});

child.on('exit', (code, signal) => {
  stream.end();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
