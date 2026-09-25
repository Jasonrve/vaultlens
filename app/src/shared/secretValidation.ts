export const MAX_SECRET_KEYS = 1000;
export const MAX_KEY_LENGTH = 512;
export const MAX_VALUE_LENGTH = 1024 * 1024;
export const MAX_SECRET_PAYLOAD_LENGTH = 900 * 1024;

export function validateFlatSecretData(data: unknown): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Request body must be a plain object';
  }

  const entries = Object.entries(data as Record<string, unknown>);
  if (entries.length > MAX_SECRET_KEYS) {
    return `Too many keys (max ${MAX_SECRET_KEYS})`;
  }

  let payloadLength = 2;
  for (const [key, value] of entries) {
    if (key.length > MAX_KEY_LENGTH) {
      return `Key "${key.slice(0, 50)}…" exceeds max length (${MAX_KEY_LENGTH})`;
    }
    if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
      return `Value for key "${key.slice(0, 50)}" exceeds max length (1 MB)`;
    }
    if (value !== null && typeof value === 'object') {
      return 'Nested objects/arrays are not allowed in secret data';
    }
    payloadLength += JSON.stringify(key).length + 1 + JSON.stringify(value).length + 1;
    if (payloadLength > MAX_SECRET_PAYLOAD_LENGTH) {
      return `Secret payload exceeds the maximum size (${MAX_SECRET_PAYLOAD_LENGTH} bytes)`;
    }
  }

  return null;
}