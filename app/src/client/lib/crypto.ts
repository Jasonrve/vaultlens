import * as openpgp from 'openpgp';

export interface SecretImportPayload {
  path: string;
  data: Record<string, unknown>;
  source?: string;
  expiresAt?: number;
}

const MAX_IMPORT_BYTES = 100 * 1024;

function encodeBase64Url(value: string): string {
  const bytes = new globalThis.TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string): string {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return new globalThis.TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** Encode an agent-provided draft for a client-only URL fragment. */
export function encodeSecretImport(payload: SecretImportPayload): string {
  if (!payload.path.trim() || !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
    throw new Error('A secret path and object data are required');
  }
  const encoded = encodeBase64Url(JSON.stringify({ ...payload, path: payload.path.trim() }));
  if (encoded.length > MAX_IMPORT_BYTES) throw new Error('The import payload is too large');
  return encoded;
}

/** Decode and validate a client-only secret import fragment. */
export function decodeSecretImport(encoded: string): SecretImportPayload {
  if (!encoded || encoded.length > MAX_IMPORT_BYTES) throw new Error('Invalid or oversized import payload');
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeBase64Url(encoded));
  } catch {
    throw new Error('Invalid import payload');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid import payload');
  const candidate = parsed as Partial<SecretImportPayload>;
  if (typeof candidate.path !== 'string' || !candidate.path.trim() || !candidate.data || typeof candidate.data !== 'object' || Array.isArray(candidate.data)) {
    throw new Error('Import payload must contain a path and object data');
  }
  if (candidate.source !== undefined && typeof candidate.source !== 'string') throw new Error('Invalid import source');
  if (candidate.expiresAt !== undefined && (typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt))) {
    throw new Error('Invalid import expiry');
  }
  if (candidate.expiresAt !== undefined && candidate.expiresAt < Date.now()) throw new Error('This import link has expired');
  return { path: candidate.path.trim(), data: candidate.data as Record<string, unknown>, source: candidate.source, expiresAt: candidate.expiresAt };
}

/**
 * Encrypt a plaintext secret using OpenPGP symmetric encryption.
 * Returns the encrypted message as an armored string and the passphrase
 * (which serves as the decryption key — stored only in the URL fragment).
 */
export async function encryptSecret(plaintext: string): Promise<{
  encrypted: string;
  key: string;
}> {
  // Generate a random passphrase (32 bytes, base64url-encoded)
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const key = btoa(String.fromCharCode(...keyBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const message = await openpgp.createMessage({ text: plaintext });
  const encrypted = await openpgp.encrypt({
    message,
    passwords: [key],
    format: 'armored',
  });

  return { encrypted: encrypted as string, key };
}

/**
 * Decrypt an OpenPGP-encrypted message using the provided passphrase.
 * Returns the original plaintext.
 */
export async function decryptSecret(
  encrypted: string,
  key: string
): Promise<string> {
  const message = await openpgp.readMessage({ armoredMessage: encrypted });
  const { data } = await openpgp.decrypt({
    message,
    passwords: [key],
  });

  return data as string;
}
