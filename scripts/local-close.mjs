import fs from 'node:fs';
import net from 'node:net';

// Replaces: scripts/local-close.sh
//
// Step 1. Resolve the managed ports and the PID file created by local-start.
// Step 2. Detect whether any managed local port is still reachable.
// Step 3. If a PID file exists, send SIGTERM to that process first.
// Step 4. Wait briefly and escalate to SIGKILL only if a managed port is still open.
// Step 5. Remove the PID file once shutdown completes.
// Step 6. Fail loudly if any managed port still appears to be listening afterwards.

const portsRaw = process.env.PORTS || '3000';
const pidFile = '.local-api.pid';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canConnect(portToCheck) {
  // Step 2 helper: TCP connectivity is our cross-platform replacement for `lsof`.
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

function tryKill(pid, signal) {
  // Step 3/4 helper: best-effort signal delivery without throwing into the main flow.
  try {
    process.kill(pid, signal);
    return true;
  } catch {
    return false;
  }
}

const ports = portsRaw.split(',').map((value) => Number(String(value).trim())).filter(Number.isFinite);
const pidRaw = fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8').trim() : '';
const pid = Number(pidRaw);

const anyPortOpen = async () => {
  for (const port of ports) {
    if (await canConnect(port)) return true;
  }
  return false;
};

if (!pidRaw && !(await anyPortOpen())) {
  for (const port of ports) {
    console.log(`[local:close] no process is listening on port ${port}`);
  }
  process.exit(0);
}

if (Number.isFinite(pid) && pid > 0) {
  console.log(`[local:close] closing process from ${pidFile}: ${pid}`);
  tryKill(pid, 'SIGTERM');
  await wait(1000);
  if (await anyPortOpen()) {
    console.log(`[local:close] forcing close on pid ${pid}`);
    tryKill(pid, 'SIGKILL');
    await wait(500);
  }
} else if (await anyPortOpen()) {
  console.warn(`[local:close] one configured port is in use but ${pidFile} is missing or invalid. Close it manually.`);
  process.exit(1);
}

fs.rmSync(pidFile, { force: true });
if (await anyPortOpen()) {
  console.warn('[local:close] process still appears to be listening on at least one configured port');
  process.exit(1);
}

console.log('[local:close] done');
