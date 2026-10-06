export function collectionSettings(env: NodeJS.ProcessEnv = process.env) {
  function integer(name: string, fallback: number, max: number) {
    const raw = env[name];
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > max)
      throw new Error(`${name} must be an integer between 1 and ${max}`);
    return Number(raw);
  }
  return {
    concurrency: integer("VAULTLENS_PKI_CONCURRENCY", 4, 16),
    requestsPerSecond: integer("VAULTLENS_PKI_REQUESTS_PER_SECOND", 20, 100),
  };
}
