import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function BackupRestorePage() {
  const [backups, setBackups] = useState<api.BackupEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [raftAvailable, setRaftAvailable] = useState(true);
  const [schedule, setSchedule] = useState<{
    enabled: boolean;
    cron: string;
    lastBackup: string | null;
    nextBackup: string | null;
  } | null>(null);
  const [scheduleForm, setScheduleForm] = useState({ enabled: false, cron: '0 2 * * *' });
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [backupList, scheduleData, statusData] = await Promise.all([
        api.listBackups(),
        api.getBackupSchedule(),
        api.getBackupStatus(),
      ]);
      setBackups(backupList);
      setSchedule(scheduleData);
      setScheduleForm({ enabled: scheduleData.enabled, cron: scheduleData.cron });
      setRaftAvailable(statusData.raftAvailable);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load backup data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async () => {
    setCreating(true);
    setSuccessMsg(null);
    setError(null);
    try {
      const result = await api.createBackup();
      setSuccessMsg(`Vault snapshot created: ${result.filename} (${formatSize(result.size)})`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create snapshot');
    } finally {
      setCreating(false);
    }
  };

  const handleCreateKv = async () => {
    setCreating(true);
    setSuccessMsg(null);
    setError(null);
    try {
      const result = await api.createKvBackup();
      setSuccessMsg(`KV backup created: ${result.filename} — ${result.secretCount} secrets backed up (${formatSize(result.size)})`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create KV backup');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (filename: string) => {
    setRestoring(filename);
    setSuccessMsg(null);
    setError(null);
    setConfirmRestore(null);
    try {
      if (filename.startsWith('kv-backup-') && filename.endsWith('.json')) {
        const result = await api.restoreKvBackup(filename);
        setSuccessMsg(`KV backup restored: ${result.restoredCount} secrets written${result.failedCount > 0 ? `, ${result.failedCount} failed` : ''}`);
      } else {
        const result = await api.restoreBackup(filename);
        setSuccessMsg(`Vault snapshot restored: ${result.filename}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup');
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (filename: string) => {
    setDeleting(filename);
    setError(null);
    try {
      await api.deleteBackup(filename);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete backup');
    } finally {
      setDeleting(null);
    }
  };

  const handleSaveSchedule = async () => {
    try {
      setError(null);
      const result = await api.updateBackupSchedule(scheduleForm.enabled, scheduleForm.cron);
      setSchedule(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Backup & Restore</h1>
          <p className="mt-1 text-sm text-gray-500">
            {raftAvailable
              ? 'Create and manage native Vault Raft snapshots.'
              : 'Create and manage KV secret backups (JSON format).'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
          {raftAvailable ? (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Backup'}
            </button>
          ) : (
            <button
              onClick={handleCreateKv}
              disabled={creating}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create KV Backup'}
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      {!raftAvailable && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h3 className="text-sm font-semibold text-blue-900 mb-1">KV Backup Mode</h3>
          <p className="text-sm text-blue-800">
            Vault Raft snapshots are not available with this storage backend. KV secret backups are enabled instead — all secret values from every KV engine are exported to an encrypted JSON file that can be restored to any Vault instance.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Schedule Configuration */}
      {raftAvailable && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Backup Schedule</h2>
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={scheduleForm.enabled}
                onChange={e => setScheduleForm(prev => ({ ...prev, enabled: e.target.checked }))}
                className="rounded border-gray-300"
              />
              Enable scheduled backups
            </label>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Cron expression <span className="text-gray-400">(MIN HOUR DOM MON DOW)</span>
              </label>
              {/* Preset buttons */}
              <div className="mb-2 flex flex-wrap gap-1.5">
                {[
                  { label: 'Daily 2 AM', value: '0 2 * * *' },
                  { label: 'Hourly', value: '0 * * * *' },
                  { label: 'Every 6h', value: '0 */6 * * *' },
                  { label: 'Weekly Sun 2 AM', value: '0 2 * * 0' },
                  { label: 'Monthly 1st', value: '0 2 1 * *' },
                ].map(preset => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => setScheduleForm(prev => ({ ...prev, cron: preset.value }))}
                    className={`rounded px-2 py-1 text-xs ${scheduleForm.cron === preset.value ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <input
                type="text"
                value={scheduleForm.cron}
                onChange={e => setScheduleForm(prev => ({ ...prev, cron: e.target.value }))}
                placeholder="0 2 * * *"
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm font-mono focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-400">
                Examples: <code>0 2 * * *</code> (daily at 2 AM) · <code>0 */6 * * *</code> (every 6 hours) · <code>0 2 * * 1</code> (every Monday)
              </p>
            </div>
            <button
              onClick={handleSaveSchedule}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Save Schedule
            </button>
        </div>
        {schedule && (
          <div className="mt-3 flex gap-4 text-xs text-gray-500">
            <span>Last backup: {schedule.lastBackup ? new Date(schedule.lastBackup).toLocaleString() : 'Never'}</span>
            <span>Next backup: {schedule.nextBackup ? new Date(schedule.nextBackup).toLocaleString() : 'N/A'}</span>
          </div>
        )}
        </div>
      )}

      {/* Backup List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        </div>
      ) : backups.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          <p className="text-sm">No backups found.</p>
          <p className="text-xs mt-1">Click &quot;Create Backup&quot; to create your first backup.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Filename</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Size</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-600">Created</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {backups.map(backup => (
                <tr key={backup.filename} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-gray-900">
                    {backup.filename}
                    {backup.type === 'legacy-json' && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">legacy</span>
                    )}
                    {backup.type === 'kv-json' && (
                      <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">kv</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">{formatSize(backup.size)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{new Date(backup.createdAt).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-2">
                      {confirmRestore === backup.filename ? (
                        <>
                          <button
                            onClick={() => handleRestore(backup.filename)}
                            disabled={restoring === backup.filename}
                            className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
                          >
                            {restoring === backup.filename ? 'Restoring...' : 'Confirm Restore'}
                          </button>
                          <button
                            onClick={() => setConfirmRestore(null)}
                            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <>
                          {(backup.type === 'snapshot' || backup.type === 'kv-json') && (
                            <button
                              onClick={() => setConfirmRestore(backup.filename)}
                              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              Restore
                            </button>
                          )}
                          <button
                            onClick={() => api.downloadBackup(backup.filename)}
                            className="rounded border border-blue-300 px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                          >
                            Download
                          </button>
                          <button
                            onClick={() => handleDelete(backup.filename)}
                            disabled={deleting === backup.filename}
                            className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                          >
                            {deleting === backup.filename ? 'Deleting...' : 'Delete'}
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
