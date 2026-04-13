/**
 * predev.mjs — runs before `npm run dev`
 * 1. Creates .env from .env.example if missing
 * 2. Kills any process already listening on PORT (default 3001)
 *    so `tsx watch` never crashes with EADDRINUSE.
 */
import fs from 'fs';
import { execSync } from 'child_process';

// ── 1. Bootstrap .env ────────────────────────────────────────────────────────
if (!fs.existsSync('.env')) {
  fs.copyFileSync('.env.example', '.env');
  console.log('[predev] Created .env from .env.example');
}

// ── 2. Free the port ─────────────────────────────────────────────────────────
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

  if (pids.length > 0) {
    console.log(`[predev] Port ${port} in use by PID(s) ${pids.join(', ')} — killing...`);
    for (const pid of pids) {
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
