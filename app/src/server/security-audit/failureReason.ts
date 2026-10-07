/** Never persist raw worker exceptions, which can contain paths or input values. */
export function importFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message === 'Python snapshot target must match VAULT_ADDR')
    return 'The snapshot Vault address does not match this connection.';
  if (message === 'Only Python snapshot schemas 2 and 3 are supported')
    return 'Unsupported Python snapshot schema. Export a schema-2 or schema-3 snapshot.';
  if (
    message ===
    'Import requires a finished Python snapshot with valid timestamps'
  )
    return 'The Python snapshot is unfinished or has invalid timestamps.';
  if (message === 'Python policy source digest mismatch')
    return 'A policy source does not match its stored SHA-256 digest.';
  if (
    message === 'Python snapshot exceeds 256 MiB' ||
    message === 'Python snapshot exceeds one million records'
  )
    return 'The snapshot exceeds the supported import size or record limit.';
  return 'The SQLite snapshot could not be imported. Check its schema and data integrity.';
}
