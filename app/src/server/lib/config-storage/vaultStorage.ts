import { VaultClient } from '../vaultClient.js';
import { getSystemToken } from '../systemToken.js';
import { config } from '../../config/index.js';
import type { ConfigStorageProvider } from './types.js';

const KV_MOUNT = 'vaultlens-conf';

/**
 * Vault KV-based configuration storage.
 * Stores all configuration in a dedicated KV v2 engine named 'vaultlens-conf'.
 */
export class VaultConfigStorage implements ConfigStorageProvider {
  private vaultClient: VaultClient;

  constructor() {
    this.vaultClient = new VaultClient(config.vaultAddr, config.vaultSkipTlsVerify);
  }

  async get(section: string): Promise<Record<string, string> | null> {
    try {
      const token = await getSystemToken();
      const resp = await this.vaultClient.get<{
        data: { data: Record<string, string> };
      }>(`/${KV_MOUNT}/data/${encodeURIComponent(section)}`, token);
      return resp.data.data ?? null;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async set(section: string, data: Record<string, string>): Promise<void> {
    const token = await getSystemToken();
    await this.vaultClient.post(
      `/${KV_MOUNT}/data/${encodeURIComponent(section)}`,
      token,
      { data },
    );
  }

  async delete(section: string): Promise<void> {
    try {
      const token = await getSystemToken();
      await this.vaultClient.delete(
        `/${KV_MOUNT}/metadata/${encodeURIComponent(section)}`,
        token,
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return; // Already deleted
      throw err;
    }
  }

  async list(): Promise<string[]> {
    try {
      const token = await getSystemToken();
      const resp = await this.vaultClient.list<{
        data: { keys: string[] };
      }>(`/${KV_MOUNT}/metadata`, token);
      return resp.data.keys ?? [];
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return [];
      throw err;
    }
  }

  async getBlob(key: string): Promise<{ data: Buffer; mimeType: string } | null> {
    try {
      const token = await getSystemToken();
      const resp = await this.vaultClient.get<{
        data: { data: { blob: string; mimeType: string } };
      }>(`/${KV_MOUNT}/data/_blob_${encodeURIComponent(key)}`, token);
      const { blob, mimeType } = resp.data.data;
      return { data: Buffer.from(blob, 'base64'), mimeType };
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  async setBlob(key: string, data: Buffer, mimeType: string): Promise<void> {
    const token = await getSystemToken();
    await this.vaultClient.post(
      `/${KV_MOUNT}/data/_blob_${encodeURIComponent(key)}`,
      token,
      { data: { blob: data.toString('base64'), mimeType } },
    );
  }

  async deleteBlob(key: string): Promise<void> {
    try {
      const token = await getSystemToken();
      await this.vaultClient.delete(
        `/${KV_MOUNT}/metadata/_blob_${encodeURIComponent(key)}`,
        token,
      );
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404) return;
      throw err;
    }
  }
}
