/**
 * Config encryption utility for securing sensitive credentials in config storage.
 * 
 * Uses AES-256-GCM for authenticated encryption with authenticated data (AEAD).
 * The encryption key is derived from VAULT_ADDR to ensure consistency across
 * container instances that share the same Vault instance.
 * 
 * Format in storage: "v1:base64(iv):base64(encryptedData):base64(authTag)"
 * This supports versioning for future key rotation strategies.
 */

import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits
const ENCRYPTION_VERSION = 'v1';
const APP_SALT = 'vaultlens-config-encryption-key-v1';

/**
 * Derives the encryption key from VAULT_ADDR.
 * All containers pointing to the same Vault instance will derive the same key,
 * enabling decryption across multiple instances and restarts.
 */
function deriveKey(): Buffer {
  const keyMaterial = `${config.vaultAddr}:${APP_SALT}`;
  return crypto.createHash('sha256').update(keyMaterial).digest();
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
