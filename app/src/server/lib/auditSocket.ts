/**
 * Vault Audit Socket Server
 *
 * Listens on a TCP socket for Vault audit log entries (newline-delimited JSON).
 * Vault's built-in "socket" audit device sends each request/response entry as a
 * single JSON line terminated by "\n", so we split on newlines and parse each.
 *
 * The server keeps a bounded in-memory ring buffer of the most recent entries.
 * When socket mode is active the audit route reads from this buffer instead of
 * the on-disk log file, proving that the file is not used.
 */

import net from 'net';
import https from 'https';
import http from 'http';

// Maximum number of raw audit entries to keep in memory.
const MAX_BUFFER_ENTRIES = 50_000;

// Ring buffer — newest entries are at the end.
const ringBuffer: unknown[] = [];

let socketServer: net.Server | null = null;
let serverHost = '0.0.0.0';
let serverPort = 9090;
let _isListening = false;
let connectedClients = 0;
let totalEventsReceived = 0;
let firstEventAt: Date | null = null;
let lastEventAt: Date | null = null;

export interface AuditSocketStats {
  enabled: boolean;
  listening: boolean;
  port: number;
  host: string;
  connectedClients: number;
  totalEventsReceived: number;
  bufferSize: number;
  firstEventAt: string | null;
  lastEventAt: string | null;
}

/**
 * Start the TCP socket server. Idempotent — calling again is a no-op.
 */
export function startAuditSocketServer(port: number, host: string): void {
  if (socketServer) return; // already started

  serverPort = port;
  serverHost = host;

  socketServer = net.createServer((socket) => {
    connectedClients++;
    const remote = `${socket.remoteAddress ?? 'unknown'}:${socket.remotePort ?? '?'}`;
    console.log(`[Audit Socket] Vault connected from ${remote}. Active clients: ${connectedClients}`);

    let lineBuffer = '';

    socket.on('data', (chunk: Buffer) => {
      lineBuffer += chunk.toString('utf-8');
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop() ?? ''; // last element may be an incomplete line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const entry = JSON.parse(trimmed) as unknown;
          ringBuffer.push(entry);
          totalEventsReceived++;
          const now = new Date();
          if (!firstEventAt) firstEventAt = now;
          lastEventAt = now;
          // Trim buffer if it grows beyond MAX_BUFFER_ENTRIES
          if (ringBuffer.length > MAX_BUFFER_ENTRIES) {
            ringBuffer.splice(0, ringBuffer.length - MAX_BUFFER_ENTRIES);
          }
        } catch {
          // Malformed line — skip silently
        }
      }
    });

    socket.on('close', () => {
      connectedClients = Math.max(0, connectedClients - 1);
      console.log(`[Audit Socket] Client ${remote} disconnected. Active clients: ${connectedClients}`);
    });

    socket.on('error', (err: Error) => {
      connectedClients = Math.max(0, connectedClients - 1);
      console.warn(`[Audit Socket] Client ${remote} error: ${err.message}`);
    });
  });

  socketServer.on('error', (err: Error) => {
    console.error(`[Audit Socket] Server error: ${err.message}`);
    _isListening = false;
  });

  socketServer.listen(serverPort, serverHost, () => {
    _isListening = true;
    console.log(`[Audit Socket] Listening for Vault audit events on ${serverHost}:${serverPort}`);
  });
}

/** Return a snapshot of the ring buffer (newest entries last). */
export function getAuditBuffer(): unknown[] {
  return ringBuffer;
}

/** Return connection statistics. */
export function getAuditSocketStats(): AuditSocketStats {
  return {
    enabled: socketServer !== null,
    listening: _isListening,
    port: serverPort,
    host: serverHost,
    connectedClients,
    totalEventsReceived,
    bufferSize: ringBuffer.length,
    firstEventAt: firstEventAt?.toISOString() ?? null,
    lastEventAt: lastEventAt?.toISOString() ?? null,
  };
}

/**
 * Auto-register this socket server as a Vault audit device.
 *
 * Uses the system token to call Vault's `/sys/audit/vaultlens-socket` API.
 * `vaultAddress` is the address from Vault's perspective (e.g. `host.docker.internal:9090`).
 * This is idempotent — Vault returns 400 if already enabled, which is silently ignored.
 */
export async function autoRegisterSocketAuditWithVault(
  vaultAddr: string,
  systemToken: string,
  vaultAddress: string,
  skipTlsVerify = false,
): Promise<void> {
  const url = `${vaultAddr}/v1/sys/audit/vaultlens-socket`;

  const body = JSON.stringify({
    type: 'socket',
    description: 'VaultLens real-time audit socket (auto-registered)',
    options: {
      address: vaultAddress,
      socket_type: 'tcp',
      write_timeout: '5s',
      // Keep hmac_accessor=false so VaultLens can display human-readable token accessors
      hmac_accessor: 'false',
    },
  });

  const requestVault = (method: 'PUT' | 'DELETE') => new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;

    const req = lib.request(
      {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname,
        method,
        headers: {
          ...(method === 'PUT' ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          } : {}),
          'X-Vault-Token': systemToken,
        },
        ...(isHttps && skipTlsVerify ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        let responseBody = '';
        res.on('data', (chunk: Buffer) => { responseBody += chunk.toString(); });
        res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body: responseBody }));
      },
    );

    req.on('error', reject);
    if (method === 'PUT') req.write(body);
    req.end();
  });

  await new Promise<void>((resolve, reject) => {
    requestVault('PUT')
      .then(async ({ statusCode, body: responseBody }) => {
        if (statusCode === 204) {
          console.log(`[Audit Socket] Registered socket audit device with Vault (address: ${vaultAddress})`);
          resolve();
          return;
        }

        if (statusCode === 400) {
          if (responseBody.includes('already in use') || responseBody.includes('path is already in use')) {
            const deleteResult = await requestVault('DELETE');
            if (deleteResult.statusCode !== 204) {
              console.warn(`[Audit Socket] Could not replace existing socket audit device: HTTP ${deleteResult.statusCode} — ${deleteResult.body.trim()}`);
              resolve();
              return;
            }

            const retry = await requestVault('PUT');
            if (retry.statusCode === 204) {
              console.log(`[Audit Socket] Replaced socket audit device with Vault (address: ${vaultAddress})`);
            } else {
              console.error(`[Audit Socket] Failed to register socket audit device after replacement: HTTP ${retry.statusCode} — ${retry.body.trim()}`);
            }
            resolve();
            return;
          }

          console.error(`[Audit Socket] Failed to register socket audit device (Vault returned 400): ${responseBody.trim()}`);
          resolve();
          return;
        }

        console.error(`[Audit Socket] Failed to register socket audit device: HTTP ${statusCode || 'unknown'} — ${responseBody.trim()}`);
        resolve();
      })
      .catch(reject);
  });
}
