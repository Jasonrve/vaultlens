import { config } from '../../config/index.js';
import type { ConfigStorageProvider } from './types.js';
import { FileConfigStorage } from './fileStorage.js';
// VaultConfigStorage kept for future extension — not used in current builds
// import { VaultConfigStorage } from './vaultStorage.js';
import { configStorageOpsTotal, configStorageDurationSeconds } from '../metrics.js';

export type { ConfigStorageProvider } from './types.js';

let instance: ConfigStorageProvider | null = null;

function instrumentStorage(
  provider: ConfigStorageProvider,
  backend: 'file' | 'vault',
): ConfigStorageProvider {
  const time = async <T>(
    operation: 'get' | 'set' | 'delete' | 'list' | 'getBlob' | 'setBlob' | 'deleteBlob',
    fn: () => Promise<T>,
  ): Promise<T> => {
    const start = process.hrtime.bigint();
    try {
      return await fn();
    } finally {
      const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
      configStorageOpsTotal.inc({ operation, backend });
      configStorageDurationSeconds.observe({ operation, backend }, durationSec);
    }
  };

  return {
    get: (section: string) => time('get', () => provider.get(section)),
    set: (section: string, data: Record<string, string>) =>
      time('set', () => provider.set(section, data)),
    delete: (section: string) => time('delete', () => provider.delete(section)),
    list: () => time('list', () => provider.list()),
    getBlob: (key: string) => time('getBlob', () => provider.getBlob(key)),
    setBlob: (key: string, data: Buffer, mimeType: string) =>
      time('setBlob', () => provider.setBlob(key, data, mimeType)),
    deleteBlob: (key: string) => time('deleteBlob', () => provider.deleteBlob(key)),
  };
}

/**
 * Get the singleton configuration storage provider.
 * Always uses the file backend (config.ini on disk).
 * The pluggable interface is retained so additional backends can be added in future.
 */
export function getConfigStorage(): ConfigStorageProvider {
  if (!instance) {
    instance = instrumentStorage(new FileConfigStorage(config.configStoragePath || undefined), 'file');
    console.log(`[Config] Using file storage backend (${config.configStoragePath || 'data/config.ini'})`);
  }
  return instance;
}
