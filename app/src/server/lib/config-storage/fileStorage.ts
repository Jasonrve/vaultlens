import fs from 'fs';
import path from 'path';
import type { ConfigStorageProvider } from './types.js';

/**
 * INI-format configuration file parser/writer.
 *
 * Format:
 * [section]
 * key=value
 */
function parseIni(content: string): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  let currentSection = '';
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const sectionMatch = trimmed.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!;
      if (!result[currentSection]) result[currentSection] = {};
      continue;
    }
    if (currentSection) {
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        result[currentSection]![key] = value;
      }
    }
  }
  return result;
}

function serializeIni(data: Record<string, Record<string, string>>): string {
  const lines: string[] = [];
  for (const [section, entries] of Object.entries(data)) {
    lines.push(`[${section}]`);
    for (const [key, value] of Object.entries(entries)) {
      lines.push(`${key}=${value}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * File-based configuration storage using config.ini format.
 * Default storage backend when VAULTLENS_CONFIG_STORAGE is not set or set to 'file'.
 */
export class FileConfigStorage implements ConfigStorageProvider {
  private configDir: string;
  private configFile: string;
  private blobDir: string;

  constructor(configPath?: string) {
    this.configDir = configPath || path.resolve(process.cwd(), 'data');
    this.configFile = path.join(this.configDir, 'config.ini');
    this.blobDir = path.join(this.configDir, 'blobs');
    this.ensureDirs();
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.configDir)) fs.mkdirSync(this.configDir, { recursive: true });
    if (!fs.existsSync(this.blobDir)) fs.mkdirSync(this.blobDir, { recursive: true });
  }

  private readAll(): Record<string, Record<string, string>> {
    this.ensureDirs();
    try {
      if (fs.existsSync(this.configFile)) {
        return parseIni(fs.readFileSync(this.configFile, 'utf-8'));
      }
    } catch {
      // Corrupted file, return empty
    }
    return {};
  }

  private writeAll(data: Record<string, Record<string, string>>): void {
    this.ensureDirs();
    fs.writeFileSync(this.configFile, serializeIni(data), 'utf-8');
  }

  async get(section: string): Promise<Record<string, string> | null> {
    const all = this.readAll();
    return all[section] ?? null;
  }

  async set(section: string, data: Record<string, string>): Promise<void> {
    const all = this.readAll();
    all[section] = data;
    this.writeAll(all);
  }

  async delete(section: string): Promise<void> {
    const all = this.readAll();
    delete all[section];
    this.writeAll(all);
  }

  async list(): Promise<string[]> {
    return Object.keys(this.readAll());
  }

  async getBlob(key: string): Promise<{ data: Buffer; mimeType: string } | null> {
    const safeKey = path.basename(key);
    const blobPath = path.join(this.blobDir, safeKey);
    const metaPath = path.join(this.blobDir, `${safeKey}.meta`);
    if (!fs.existsSync(blobPath)) return null;
    const data = fs.readFileSync(blobPath);
    let mimeType = 'application/octet-stream';
    try {
      if (fs.existsSync(metaPath)) {
        mimeType = fs.readFileSync(metaPath, 'utf-8').trim();
      }
    } catch {
      // default mime
    }
    return { data, mimeType };
  }

  async setBlob(key: string, data: Buffer, mimeType: string): Promise<void> {
    this.ensureDirs();
    const safeKey = path.basename(key);
    fs.writeFileSync(path.join(this.blobDir, safeKey), data);
    fs.writeFileSync(path.join(this.blobDir, `${safeKey}.meta`), mimeType, 'utf-8');
  }

  async deleteBlob(key: string): Promise<void> {
    const safeKey = path.basename(key);
    const blobPath = path.join(this.blobDir, safeKey);
    const metaPath = path.join(this.blobDir, `${safeKey}.meta`);
    if (fs.existsSync(blobPath)) fs.unlinkSync(blobPath);
    if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
  }
}
