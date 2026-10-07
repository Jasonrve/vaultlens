import { zipSync, strToU8 } from 'fflate';
import type { AuditDetail } from '../../shared/securityAudit.js';
import { reportFiles } from './reportDirectory.js';

export function reportArchive(
  detail: AuditDetail,
  redactPolicySource = false,
): Buffer {
  if ((detail.snapshot?.resources.length ?? 0) > 5000)
    throw new Error(
      'ZIP reports support up to 5000 resources; use CLI export-directory for larger reports',
    );
  const entries: Record<string, Uint8Array> = Object.create(null);
  let size = 0;
  for (const [path, content] of reportFiles(detail, redactPolicySource)) {
    const bytes = strToU8(content);
    size += bytes.byteLength;
    if (size > 64 * 1024 * 1024)
      throw new Error('ZIP report exceeds 64 MiB; use CLI export-directory');
    entries[path] = bytes;
  }
  // Store entries without compression to bound CPU use in the request handler.
  return Buffer.from(
    zipSync(entries, { level: 0, mtime: new Date('2000-01-01T00:00:00Z') }),
  );
}
