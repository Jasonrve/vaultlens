import { config } from '../../config/index.js';
import type { ConfigStorageProvider } from './types.js';
import { FileConfigStorage } from './fileStorage.js';
import { VaultConfigStorage } from './vaultStorage.js';

export type { ConfigStorageProvider } from './types.js';

let instance: ConfigStorageProvider | null = null;

/**
 * Get the singleton configuration storage provider.
 * Uses VAULTLENS_CONFIG_STORAGE env var to determine backend:
 * - 'vault': Stores config in Vault KV engine 'vaultlens-conf'
 * - 'file' (default): Stores config in a config.ini file on disk
 */
export function getConfigStorage(): ConfigStorageProvider {
  if (!instance) {
    const storageType = config.configStorage;
    if (storageType === 'vault') {
      instance = new VaultConfigStorage();
      console.log('[Config] Using Vault KV storage backend (vaultlens-conf)');
    } else {
      instance = new FileConfigStorage(config.configStoragePath || undefined);
      console.log(`[Config] Using file storage backend (${config.configStoragePath || 'data/config.ini'})`);
    }
  }
  return instance;
}
