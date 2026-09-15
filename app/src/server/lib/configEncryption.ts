/**
 * Config encryption utility for securing sensitive credentials in config storage.
 *
 * Uses AES-256-GCM for authenticated encryption with authenticated data (AEAD).
 * The encryption key comes from VAULTLENS_ENCRYPTION_KEY if set; otherwise a random
 * key is generated on first use and persisted next to config.ini so it survives
 * restarts. The key is never derived from VAULT_ADDR or any other non-secret value —
 * anyone who can read config.ini could otherwise recompute it.
 *
 * Format in storage: "v1:base64(iv):base64(encryptedData):base64(authTag)"
 * This supports versioning for future key rotation strategies.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const ENCRYPTION_VERSION = 'v1';

let cachedKey: Buffer | null = null;

/**
 * Returns the persisted (or freshly generated) local encryption key file path,
 * co-located with config.ini so both survive the same volume mount / backup.
 */
function keyFilePath(): string {
  const configDir = config.configStoragePath || path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  return path.join(configDir, '.encryption-key');
}

function loadOrCreateLocalKey(): Buffer {
  const file = keyFilePath();
  try {
    if (fs.existsSync(file)) {
      const raw = fs.readFileSync(file, 'utf-8').trim();
      const key = Buffer.from(raw, 'hex');
      if (key.length === 32) return key;
    }
  } catch {
    // fall through and regenerate
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('hex'), { encoding: 'utf-8', mode: 0o600 });
  return key;
}

/**
 * Derives/loads the encryption key. Explicit VAULTLENS_ENCRYPTION_KEY (any length
 * string) takes precedence and is hashed to 32 bytes; otherwise a random key is
 * generated once and persisted locally.
 */
function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  cachedKey = config.configEncryptionKey
    ? crypto.createHash('sha256').update(config.configEncryptionKey).digest()
    : loadOrCreateLocalKey();
  return cachedKey;
}

/**
 * Encrypts a string value for storage in config.ini.
 * Returns encrypted value with IV and auth tag encoded in the output.
 * 
 * @param plaintext The value to encrypt
 * @returns Encrypted value in format "v1:base64(iv):base64(encryptedData):base64(authTag)"
 */
export function encryptConfigValue(plaintext: string): string {
  try {
    const key = deriveKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encryptedData = cipher.update(plaintext, 'utf-8', 'binary');
    encryptedData += cipher.final('binary');
    
    const authTag = cipher.getAuthTag();
    
    // Encode all components in base64 for safe storage in INI file
    const encryptedDataB64 = Buffer.from(encryptedData, 'binary').toString('base64');
    const ivB64 = iv.toString('base64');
    const authTagB64 = authTag.toString('base64');
    
    return `${ENCRYPTION_VERSION}:${ivB64}:${encryptedDataB64}:${authTagB64}`;
  } catch (error) {
    throw new Error(`Failed to encrypt config value: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Decrypts a value that was encrypted with encryptConfigValue.
 * 
 * @param encrypted The encrypted value from config storage
 * @returns The decrypted plaintext string
 */
export function decryptConfigValue(encrypted: string): string {
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 4) {
      throw new Error('Invalid encrypted format');
    }

    const [version, ivB64, encryptedDataB64, authTagB64] = parts;

    if (version !== ENCRYPTION_VERSION) {
      throw new Error(`Unsupported encryption version: ${version}`);
    }

    const key = deriveKey();
    const iv = Buffer.from(ivB64, 'base64');
    const encryptedData = Buffer.from(encryptedDataB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf-8');
  } catch (error) {
    throw new Error(`Failed to decrypt config value: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Safely retrieves a decrypted config value.
 * If the value is not encrypted (for backwards compatibility), returns it as-is.
 * If decryption fails, returns null.
 * 
 * @param value The value from config storage (may be encrypted or plaintext)
 * @returns Decrypted value or null if already plaintext or decryption fails
 */
export function tryDecryptConfigValue(value: string): string | null {
  // Check if it looks like an encrypted value (starts with version prefix)
  if (!value.startsWith('v1:')) {
    // Not encrypted, return as-is
    return value;
  }

  try {
    return decryptConfigValue(value);
  } catch (error) {
    console.error('Failed to decrypt config value:', error instanceof Error ? error.message : 'unknown error');
    return null;
  }
}
