/**
 * predev.mjs — runs before `npm run dev`
 * 1. Creates .env from .env.example if missing
 * 2. Refreshes the local k3s fixture token when Docker is running
 * 3. Kills any process already listening on PORT (default 3001)
 *    so `tsx watch` never crashes with EADDRINUSE.
 */
import fs from 'fs';
import { execSync } from 'child_process';

// ── 1. Bootstrap .env ────────────────────────────────────────────────────────
if (!fs.existsSync('.env')) {
  fs.copyFileSync('.env.example', '.env');
  console.log('[predev] Created .env from .env.example');
}

// ── 2. Refresh the local k3s fixture token ───────────────────────────────────
try {
  const token = execSync('docker exec vaultlens-k3s cat /shared/token', {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  if (token) {
    const envPath = '.env';
    const envText = fs.readFileSync(envPath, 'utf8');
    const line = `K8S_ACCESS_K3S=${token}`;
    const updated = /^K8S_ACCESS_K3S=.*$/m.test(envText)
      ? envText.replace(/^K8S_ACCESS_K3S=.*$/m, line)
      : `${envText.trimEnd()}\n${line}\n`;
    if (updated !== envText) {
      fs.writeFileSync(envPath, updated);
      console.log('[predev] Refreshed K8S_ACCESS_K3S from the local k3s fixture');
    }
  }
} catch {
  // Docker is optional for host-only development.
}

// ── 3. Free the port ─────────────────────────────────────────────────────────
const port = parseInt(process.env.PORT ?? '3001', 10);

try {
  let pids = [];
  if (process.platform === 'win32') {
    // Find all PIDs listening on the port (IPv4 and IPv6)
    const out = execSync(`netstat -ano`, { encoding: 'utf8' });
    pids = [...new Set(
      out.split('\n')
        .filter(l => l.includes(`:${port} `) || l.includes(`:${port}\t`))
        .filter(l => l.includes('LISTENING'))
        .map(l => l.trim().split(/\s+/).pop())
        .filter(p => p && /^\d+$/.test(p) && p !== '0')
    )];
  } else {
    const out = execSync(`lsof -ti tcp:${port} 2>/dev/null || true`, { encoding: 'utf8' });
    pids = out.trim().split('\n').filter(Boolean);
  }

  // Never kill Docker Desktop's own processes — they proxy ports for every
  // running container, not just the one we're trying to free, and killing
  // them takes down the whole Docker network stack (Vault included).
  const DOCKER_PROCESS_NAMES = ['docker desktop.exe', 'com.docker.backend.exe', 'com.docker.proxy.exe', 'host-switch.exe', 'wslrelay.exe', 'wsl.exe', 'wslhost.exe', 'dockerd', 'docker'];

  if (pids.length > 0) {
    for (const pid of pids) {
      let name = 'unknown process';
      try {
        name = process.platform === 'win32'
          ? execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: 'utf8' }).split(',')[0]?.replaceAll('"', '').trim() || name
          : execSync(`ps -p ${pid} -o comm=`, { encoding: 'utf8' }).trim() || name;
      } catch { /* best-effort only */ }

      if (DOCKER_PROCESS_NAMES.includes(name.toLowerCase())) {
        console.warn(`[predev] Port ${port} is held by ${name} (PID ${pid}), which looks like a Docker/WSL process. Refusing to kill it — this usually means a Docker container is publishing port ${port}. Stop that container (e.g. "docker compose down") instead.`);
        continue;
      }

      console.log(`[predev] Port ${port} in use by PID ${pid} (${name}) — killing...`);
      try {
        if (process.platform === 'win32') {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
        } else {
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        }
      } catch { /* already gone */ }
    }
    // Give the OS a moment to release the port
    await new Promise(r => setTimeout(r, 600));
    console.log(`[predev] Port ${port} is now free.`);
  }
} catch {
  // netstat/lsof unavailable — proceed and let the server fail with a clear message
}
