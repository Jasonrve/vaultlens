import { MAX_KEY_LENGTH, MAX_SECRET_KEYS, MAX_SECRET_PAYLOAD_LENGTH, MAX_VALUE_LENGTH } from '../../../shared/secretValidation';

export function flattenConfig(input: unknown, separator = '__', includeParentPath = true): Record<string, string> {
  const output: Record<string, string> = {};

  function visit(value: unknown, prefix: string): void {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, prefix ? `${prefix}${separator}${index}` : String(index)));
      return;
    }

    if (value !== null && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        visit(child, prefix ? `${prefix}${separator}${key}` : key);
      }
      return;
    }

    if (!prefix) {
      throw new Error('Configuration must contain an object with at least one key');
    }
    const separatorIndex = prefix.lastIndexOf(separator);
    const key = includeParentPath || separatorIndex < 0
      ? prefix
      : prefix.slice(separatorIndex + separator.length);
    if (key in output) throw new Error(`Duplicate key "${key}" after removing parent names`);
    output[key] = value === null ? '' : String(value);
  }

  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Configuration must contain an object with at least one key');
  }
  visit(input, '');

  if (Object.keys(output).length > MAX_SECRET_KEYS) {
    throw new Error(`Configuration contains too many keys (maximum ${MAX_SECRET_KEYS})`);
  }
  for (const [key, value] of Object.entries(output)) {
    if (key.length > MAX_KEY_LENGTH) throw new Error(`Key "${key.slice(0, 50)}" is too long`);
    if (value.length > MAX_VALUE_LENGTH) throw new Error(`Value for key "${key.slice(0, 50)}" is too long`);
  }
  const payloadSize = JSON.stringify(output).length;
  if (payloadSize > MAX_SECRET_PAYLOAD_LENGTH) {
    throw new Error(`Configuration is too large (maximum ${MAX_SECRET_PAYLOAD_LENGTH} bytes)`);
  }

  return output;
}