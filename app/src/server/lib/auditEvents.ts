import type { Response } from 'express';

// Coalesces bursts of incoming audit errors into a single SSE notification —
// several errors can arrive within milliseconds of each other, but the UI
// only needs to know "something changed, go refetch" every so often.
const NOTIFY_DEBOUNCE_MS = 4000;

const clients = new Set<Response>();
let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/** Registers an SSE client to receive audit-update notifications. Returns an unsubscribe function. */
export function subscribeToAuditEvents(res: Response): () => void {
  clients.add(res);
  return () => clients.delete(res);
}

/** Schedules a debounced "refresh" notification to all connected SSE clients. */
export function notifyAuditUpdate(): void {
  if (pendingTimer) return; // a broadcast is already scheduled — coalesce
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    for (const res of clients) {
      try {
        res.write('data: refresh\n\n');
      } catch {
        clients.delete(res);
      }
    }
  }, NOTIFY_DEBOUNCE_MS);
}
