import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';

const INTERVAL_PRESETS = ['1h', '6h', '12h', '24h', '7d', '30d'];

export default function SecretRotationPage() {
  const [entries, setEntries] = useState<api.RotationEntry[]>([]);
  const [grouped, setGrouped] = useState<Record<string, api.RotationEntry[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<{ schedulerRunning: boolean; lastCheck: string | null; nextCheck: string | null } | null>(null);

  // Register modal state
  const [showRegister, setShowRegister] = useState(false);
  const [secretPaths, setSecretPaths] = useState<string[]>([]);
  const [loadingPaths, setLoadingPaths] = useState(false);
  const [secretKeys, setSecretKeys] = useState<string[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(false);
  const [showPathDropdown, setShowPathDropdown] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    path: '',
    rotateInterval: '24h',
    rotateKeys: '',
    rotateFormat: '',
  });
  const [registering, setRegistering] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rotationData, statusData] = await Promise.all([
        api.getRotationEntries(),
        api.getRotationStatus(),
      ]);
      setEntries(rotationData.entries);
      setGrouped(rotationData.grouped);
      setStatus(statusData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rotation data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openRegisterModal = () => {
    setShowRegister(true);
    setRegisterForm({ path: '', rotateInterval: '24h', rotateKeys: '', rotateFormat: '' });
    setSecretKeys([]);
    setShowPathDropdown(false);
    if (secretPaths.length === 0) {
      setLoadingPaths(true);
      api.getAccessiblePaths()
        .then(setSecretPaths)
        .catch(() => {})
        .finally(() => setLoadingPaths(false));
    }
  };

  const handlePathChange = (value: string) => {
    setRegisterForm(f => ({ ...f, path: value }));
    setShowPathDropdown(true);
    setSecretKeys([]);
  };

  const selectPath = (p: string) => {
    setRegisterForm(f => ({ ...f, path: p }));
    setShowPathDropdown(false);
    // Fetch the secret's keys for suggestion
    setLoadingKeys(true);
    api.readSecretValues(p)
      .then(secret => {
        setSecretKeys(Object.keys(secret.data ?? {}));
      })
      .catch(() => setSecretKeys([]))
      .finally(() => setLoadingKeys(false));
  };

  const toggleRotateKey = (key: string) => {
    setRegisterForm(f => {
      const current = f.rotateKeys ? f.rotateKeys.split(',').map(k => k.trim()).filter(Boolean) : [];
      const idx = current.indexOf(key);
      const next = idx >= 0 ? current.filter(k => k !== key) : [...current, key];
      return { ...f, rotateKeys: next.join(', ') };
    });
  };

  const handleRegister = async () => {
    if (!registerForm.path || !registerForm.rotateInterval) return;
    setRegistering(true);
    setError(null);
    try {
      await api.configureRotation(registerForm);
      setSuccessMsg(`Registered ${registerForm.path} for rotation every ${registerForm.rotateInterval}`);
      setShowRegister(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register rotation');
    } finally {
      setRegistering(false);
    }
  };

  const handleRotate = async (path: string) => {
    setRotating(path);
    setSuccessMsg(null);
    setError(null);
    try {
      const result = await api.rotateSecret(path);
      setSuccessMsg(`Rotated ${result.rotatedKeys.length} key(s) in ${result.path}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate secret');
    } finally {
      setRotating(null);
    }
  };

  const handleRemove = async (path: string) => {
    setRemoving(path);
    setSuccessMsg(null);
    setError(null);
    try {
      await api.removeRotationRegistration(path);
      setSuccessMsg(`Removed rotation registration for ${path}`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove registration');
    } finally {
      setRemoving(null);
    }
  };

  const isOverdue = (nextRotation: string) => new Date(nextRotation).getTime() < Date.now();

  const filteredPaths = secretPaths.filter(p =>
    !registerForm.path || p.toLowerCase().includes(registerForm.path.toLowerCase())
  );

  const selectedKeys = registerForm.rotateKeys
    ? registerForm.rotateKeys.split(',').map(k => k.trim()).filter(Boolean)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Secret Auto-Rotation</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage secrets registered for automatic password rotation via KV v2 metadata.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={loadData}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
          <button
            onClick={openRegisterModal}
            className="rounded-md bg-[#1563ff] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1250d4]"
          >
            Register Secret +
          </button>
        </div>
      </div>

      {/* Scheduler Status */}
      {status && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Scheduler Status</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Status:</span>{' '}
              <span className={status.schedulerRunning ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                {status.schedulerRunning ? 'Running' : 'Stopped'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Last Check:</span>{' '}
              <span className="text-gray-700">
                {status.lastCheck ? new Date(status.lastCheck).toLocaleString() : 'Never'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Next Check:</span>{' '}
              <span className="text-gray-700">
                {status.nextCheck ? new Date(status.nextCheck).toLocaleString() : 'N/A'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Documentation */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-2">How to Register Secrets for Auto-Rotation</h3>
        <div className="text-xs text-blue-700 space-y-1">
          <p>Use the <strong>Register Secret +</strong> button or set <strong>custom metadata</strong> keys directly on any KV v2 secret:</p>
          <ul className="list-disc pl-5 space-y-0.5">
            <li><code className="bg-blue-100 px-1 rounded">rotate-interval</code> ” Rotation frequency. Supported formats: <code>1m</code>, <code>1h</code>, <code>1d</code>, <code>1w</code>, <code>1y</code></li>
            <li><code className="bg-blue-100 px-1 rounded">rotate-keys</code> ” (Optional) Comma-separated key names to rotate, e.g. <code>password,api_key</code>. Leave blank or <code>*</code> to rotate all keys.</li>
            <li><code className="bg-blue-100 px-1 rounded">rotate-format</code> ” (Optional) Default character set for generated passwords.</li>
            <li><code className="bg-blue-100 px-1 rounded">rotate-format-&lt;key&gt;</code> ” (Optional) Per-key charset override, e.g. <code>rotate-format-pin=0123456789</code>.</li>
          </ul>
        </div>
      </div>

      {successMsg && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          <p className="text-sm">No secrets registered for auto-rotation.</p>
          <p className="text-xs mt-1">Click <strong>Register Secret +</strong> to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-sm text-gray-500">
            {entries.length} secret{entries.length !== 1 ? 's' : ''} registered for rotation
          </div>

          {Object.entries(grouped).map(([mount, mountEntries]) => (
            <div key={mount} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-4 py-2.5">
                <h3 className="text-sm font-semibold text-gray-700">{mount}/</h3>
              </div>
              <div className="divide-y divide-gray-100">
                {mountEntries.map(entry => (
                  <div key={entry.path} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{entry.path}</span>
                        {isOverdue(entry.nextRotation) && (
                          <span className="inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                            OVERDUE
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                        <span>Interval: <strong>{entry.rotateInterval}</strong></span>
                        <span>
                          Rotating:{' '}
                          <strong>
                            {entry.rotateKeys.length > 0
                              ? entry.rotateKeys.join(', ')
                              : `all keys (${entry.secretKeys.length})`}
                          </strong>
                        </span>
                        {Object.keys(entry.keyFormats).length > 0 && (
                          <span>Per-key patterns: <strong>{Object.keys(entry.keyFormats).join(', ')}</strong></span>
                        )}
                        <span>Last rotated: <strong>{entry.lastRotated ? new Date(entry.lastRotated).toLocaleString() : 'Never'}</strong></span>
                        <span className={isOverdue(entry.nextRotation) ? 'text-red-600' : ''}>
                          Next: <strong>{new Date(entry.nextRotation).toLocaleString()}</strong>
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => handleRotate(entry.path)}
                        disabled={rotating === entry.path}
                        className="rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {rotating === entry.path ? 'Rotating...' : 'Rotate Now'}
                      </button>
                      <button
                        onClick={() => handleRemove(entry.path)}
                        disabled={removing === entry.path}
                        className="rounded border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        title="Remove from rotation (clears rotation metadata)"
                      >
                        {removing === entry.path ? 'Removing...' : 'Remove'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Register Secret Modal */}
      {showRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <h2 className="text-base font-semibold text-gray-900">Register Secret for Rotation</h2>
              <button onClick={() => setShowRegister(false)} className="text-gray-400 hover:text-gray-600">close</button>
            </div>
            <div className="p-5 space-y-4">
              {/* Secret path with autocomplete */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">Secret Path <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  value={registerForm.path}
                  onChange={e => handlePathChange(e.target.value)}
                  onFocus={() => setShowPathDropdown(true)}
                  placeholder="kv/my-service/credentials"
                  autoComplete="off"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
                />
                {showPathDropdown && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                    {loadingPaths ? (
                      <div className="p-3 text-center text-xs text-gray-400">Loading paths…</div>
                    ) : filteredPaths.length === 0 ? (
                      <div className="p-3 text-center text-xs text-gray-400">No matching paths</div>
                    ) : (
                      filteredPaths.slice(0, 50).map(p => (
                        <button
                          key={p}
                          type="button"
                          onMouseDown={e => { e.preventDefault(); selectPath(p); }}
                          className={`flex w-full items-center px-3 py-1.5 text-left text-xs hover:bg-gray-50 ${registerForm.path === p ? 'bg-blue-50 text-[#1563ff] font-medium' : 'text-gray-700'}`}
                        >
                          {p}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Rotation interval */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rotation Interval <span className="text-red-500">*</span></label>
                <div className="flex gap-2 flex-wrap mb-1">
                  {INTERVAL_PRESETS.map(preset => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setRegisterForm(f => ({ ...f, rotateInterval: preset }))}
                      className={`rounded px-2 py-1 text-xs ${registerForm.rotateInterval === preset ? 'bg-[#1563ff] text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={registerForm.rotateInterval}
                  onChange={e => setRegisterForm(f => ({ ...f, rotateInterval: e.target.value }))}
                  placeholder="e.g. 24h, 7d"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
                />
              </div>

              {/* Keys to rotate */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Keys to rotate <span className="text-gray-400 font-normal">(optional — blank = all)</span>
                </label>
                {loadingKeys && (
                  <div className="mb-1 text-xs text-gray-400">Loading key suggestions…</div>
                )}
                {secretKeys.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {secretKeys.map(key => {
                      const selected = selectedKeys.includes(key);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => toggleRotateKey(key)}
                          className={`rounded border px-2 py-0.5 text-xs font-mono ${selected ? 'border-[#1563ff] bg-[#1563ff] text-white' : 'border-gray-300 bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
                        >
                          {key}
                        </button>
                      );
                    })}
                  </div>
                )}
                <input
                  type="text"
                  value={registerForm.rotateKeys}
                  onChange={e => setRegisterForm(f => ({ ...f, rotateKeys: e.target.value }))}
                  placeholder="password, api_key  or leave blank for all"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
                />
              </div>

              {/* Default charset */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Default charset <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={registerForm.rotateFormat}
                  onChange={e => setRegisterForm(f => ({ ...f, rotateFormat: e.target.value }))}
                  placeholder="abcdefghijklmnopqrstuvwxyz0123456789"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-4">
              <button
                onClick={() => setShowRegister(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRegister}
                disabled={registering || !registerForm.path || !registerForm.rotateInterval}
                className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50"
              >
                {registering ? 'Registering...' : 'Register'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

