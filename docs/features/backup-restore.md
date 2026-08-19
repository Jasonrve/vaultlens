# Backup & Restore

![Backup & Restore](/screenshots/backup-restore.png)

VaultLens can create and restore full backups of all KV secrets across all mounted engines.

## Creating a Backup

Navigate to **Admin → Backup & Restore** and click **Create Backup Now**. VaultLens:

1. Lists all KV engines
2. Recursively lists all secret paths in each engine
3. Reads every secret (using the system token)
4. Writes a single timestamped JSON file containing all secrets and their metadata

Backup files are stored in the configured `VAULTLENS_BACKUP_PATH` directory (default: `/backups`).

## Restoring a Backup

1. Click **Restore** next to any backup in the list
2. Confirm the restore
3. VaultLens writes all secrets from the backup back to Vault using the system token

::: warning
Restore is additive — it writes secrets from the backup but does not delete secrets that exist in Vault but not in the backup. Existing secrets at the same paths will be overwritten.
:::

## Backup Schedule

Configure automatic backups under **Admin → Backup & Restore → Schedule**:

| Interval | Example |
|----------|---------|
| Minutes | `30m` |
| Hours | `6h` |
| Days | `1d` |
| Weeks | `1w` |

The backup scheduler runs at server startup and checks every minute for due backups.

## Backup File Format

Backup files are JSON with the structure:

```json
{
  "version": 1,
  "created_at": "2024-01-15T10:30:00.000Z",
  "engines": {
    "secret/": {
      "type": "kv",
      "version": 2,
      "secrets": {
        "myapp/config": {
          "data": { "username": "admin", "password": "..." },
          "metadata": { ... }
        }
      }
    }
  }
}
```

## Downloading & Uploading Backups

Backup files can be downloaded directly from the Admin UI for off-site storage. You can also upload a previously downloaded backup file to restore from it.

## Application Backup

Separately from Vault secrets, VaultLens can back up **its own settings** — everything configured under **Admin → Features**, **Admin → Branding**, **Admin → Webhooks**, and the backup schedule itself, plus any custom developer integration guide overrides (**Auth Methods → Role → Developer Guide**).

Click **Create Application Backup** on the **Admin → Backup & Restore** page to produce an `app-backup-*.json` file containing:

- Every configuration section (feature toggles, branding colours/name, sharing options, webhook definitions, backup schedule, AppRole system-token credentials, etc.)
- Uploaded blobs such as the custom logo
- Any custom developer guide markdown overrides

Restoring an application backup writes these settings back via the same config storage used at runtime — like KV restore, it is additive and overwrites matching sections/keys but does not delete settings that aren't present in the backup.

::: tip
Application backups do not contain Vault secrets. Use a KV or Raft snapshot backup for secret data, and an application backup for VaultLens's own configuration.
:::

## Security Notes

- Backup files contain **all secret values in plaintext** — protect them accordingly
- Backups are performed using the system token, which requires `vaultlens-system` policy permissions
- File-mode backups are stored on the VaultLens server's filesystem; ensure appropriate filesystem permissions
- Application backups may contain encrypted AppRole credentials; they remain encrypted at rest (AES-256-GCM, key derived from `VAULT_ADDR`) but the file should still be treated as sensitive
