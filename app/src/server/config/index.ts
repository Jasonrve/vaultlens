import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env['PORT'] || '3001', 10),
  vaultAddr: process.env['VAULT_ADDR'] || 'http://127.0.0.1:8200',
  vaultSystemToken: process.env['VAULT_SYSTEM_TOKEN'] || '',
  nodeEnv: process.env['NODE_ENV'] || 'development',
  corsOrigin: process.env['CORS_ORIGIN'] || '',
  vaultSkipTlsVerify: process.env['VAULT_SKIP_TLS_VERIFY'] === 'true',
  // Kubernetes auth — when set, replaces VAULT_SYSTEM_TOKEN
  vaultK8sAuthRole: process.env['VAULT_K8S_AUTH_ROLE'] || '',
  vaultK8sAuthMount: process.env['VAULT_K8S_AUTH_MOUNT'] || 'kubernetes',
  vaultK8sTokenPath: process.env['VAULT_K8S_TOKEN_PATH'] || '/var/run/secrets/kubernetes.io/serviceaccount/token',
  // Rate limiting
  rateLimitMax: parseInt(process.env['RATE_LIMIT_MAX'] || '500', 10),
  rateLimitWindowMs: parseInt(process.env['RATE_LIMIT_WINDOW_MS'] || String(15 * 60 * 1000), 10),
  sharingRateLimitMax: parseInt(process.env['SHARING_RATE_LIMIT_MAX'] || '20', 10),
  // Audit log
  auditLogPath: process.env['VAULT_AUDIT_LOG_PATH'] || '',
  // Configuration storage: 'file' (default) or 'vault'
  configStorage: (process.env['VAULTLENS_CONFIG_STORAGE'] || 'file') as 'file' | 'vault',
  configStoragePath: process.env['VAULTLENS_CONFIG_PATH'] || '',
  // Backup storage directory
  backupStoragePath: process.env['VAULTLENS_BACKUP_PATH'] || '',
} as const;
