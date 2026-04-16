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
    const token = await getSystemToken();
    // If no system token is available yet (e.g. during initial setup before AppRole is
    // configured), treat this as "no data stored" rather than forwarding a tokenless
    // request to Vault which would return a 403 and break the setup wizard.
    if (!token) return null;
    try {
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
    if (!token) throw new Error('No system token available — cannot write to Vault config storage');
    await this.vaultClient.post(
      `/${KV_MOUNT}/data/${encodeURIComponent(section)}`,
      token,
      { data },
    );
  }

  async delete(section: string): Promise<void> {
    const token = await getSystemToken();
    if (!token) throw new Error('No system token available — cannot delete from Vault config storage');
    try {
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
    const token = await getSystemToken();
    if (!token) return [];
    try {
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
    const token = await getSystemToken();
    if (!token) return null;
    try {
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
    if (!token) throw new Error('No system token available — cannot write blob to Vault config storage');
    await this.vaultClient.post(
      `/${KV_MOUNT}/data/_blob_${encodeURIComponent(key)}`,
      token,
      { data: { blob: data.toString('base64'), mimeType } },
    );
  }

  async deleteBlob(key: string): Promise<void> {
    const token = await getSystemToken();
    if (!token) return; // Nothing to delete if no token
    try {
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
