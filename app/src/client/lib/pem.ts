const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/g;

/** Re-wrap every PEM block at 64 columns on its own lines. Returns null if the value holds no PEM block. */
export function formatPem(value: string): string | null {
  const blocks = [...value.matchAll(PEM_BLOCK)];
  if (blocks.length === 0) return null;
  return blocks.map(([whole, label, body]) => {
    if (body.includes(':')) return whole; // encrypted key headers (Proc-Type etc.) — leave alone
    const lines = body.replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
    return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join('\n');
  }).join('\n') + '\n';
}

/** True when a PEM block is malformed (header/footer not on own lines, spaces or CRLF in the body, e.g. pasted into a single-line input). Line width is not checked. */
export function pemNeedsFormatting(value: string): boolean {
  return [...value.matchAll(PEM_BLOCK)].some(([whole, label, body]) =>
    !body.includes(':') && !new RegExp(`^-----BEGIN ${label}-----\n\\S+(\n\\S+)*\n-----END ${label}-----$`).test(whole));
}
