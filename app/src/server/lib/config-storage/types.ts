/**
 * Configuration storage abstraction.
 * Supports both file-based (config.ini) and Vault KV storage backends.
 */
export interface ConfigStorageProvider {
  /** Read a configuration section. Returns null if not found. */
  get(section: string): Promise<Record<string, string> | null>;

  /** Write a configuration section. */
  set(section: string, data: Record<string, string>): Promise<void>;

  /** Delete a configuration section. */
  delete(section: string): Promise<void>;

  /** List all configuration sections. */
  list(): Promise<string[]>;

  /** Read a binary blob (e.g. logo file). Returns null if not found. */
  getBlob(key: string): Promise<{ data: Buffer; mimeType: string } | null>;

  /** Write a binary blob. */
  setBlob(key: string, data: Buffer, mimeType: string): Promise<void>;

  /** Delete a binary blob. */
  deleteBlob(key: string): Promise<void>;
}
