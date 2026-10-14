import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

// Replaces: scripts/local-close.sh only indirectly and adds a missing start primitive.
// Related shell workflow before this change: package scripts used bash + nodemon flows,
// but there was no cross-platform Node equivalent for "local start".
//
// Step 1. Resolve the local API port and the PID file used to track the detached runtime.
// Step 2. Refuse to start if the target port is already listening.
// Step 3. Create a timestamped log file for the detached runtime process.
// Step 4. Spawn `npm run start:local:runtime` as a detached background process.
// Step 5. Persist the spawned PID into a local PID file.
// Step 6. Poll the target port until the service is reachable or the child dies.
// Step 7. Print the ready state and log path, or fail with a useful tail of the log.

const port = Number(process.env.PORT || '3000');
const pidFile = '.local-api.pid';

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(portToCheck) {
  // Step 6 helper: a small TCP probe is enough to verify that the local API is up.
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: portToCheck });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(500, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

fs.mkdirSync('logs', { recursive: true });
const ts = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const logFile = path.join('logs', `${ts}-local-start.log`);

if (await canConnect(port)) {
  console.error(`[local:start] port ${port} is already in use. Run 'npm run local:close' first.`);
  process.exit(1);
}

console.log(`[local:start] starting local runtime on port ${port}`);
console.log(`[local:start] writing to ${logFile}`);

const out = fs.openSync(logFile, 'a');
const child = spawn(npmCommand(), ['run', 'start:local:runtime'], {
  // Step 4 detail: keep the child detached so the local start script can exit cleanly.
  detached: true,
  stdio: ['ignore', out, out],
  env: { ...process.env, PORT: String(port) },
});

child.unref();
fs.writeFileSync(pidFile, String(child.pid));

for (let i = 0; i < 60; i += 1) {
  if (await canConnect(port)) {
    console.log(`[local:start] ready on port ${port} (pid ${child.pid})`);
    console.log(`[local:start] log file: ${logFile}`);
    process.exit(0);
  }

  try {
    process.kill(child.pid, 0);
  } catch {
    console.error(`[local:start] process exited before opening port ${port}`);
    try {
      const tail = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-80).join('\n');
      if (tail.trim()) console.error(tail);
    } catch {}
    process.exit(1);
  }

  await wait(1000);
}

console.error(`[local:start] timeout waiting for port ${port}`);
try {
  const tail = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).slice(-80).join('\n');
  if (tail.trim()) console.error(tail);
} catch {}
process.exit(1);
