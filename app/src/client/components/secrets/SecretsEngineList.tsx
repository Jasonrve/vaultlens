import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useVaultStore } from '../../stores/vaultStore';
import * as api from '../../lib/api';
import type { SecretEngine } from '../../types';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import Modal from '../common/Modal';

function engineIcon(type: string) {
  switch (type) {
    case 'kv':
      return '📋';
    case 'ssh':
      return '💻';
    case 'transit':
      return '🔄';
    case 'pki':
      return '📜';
    case 'cubbyhole':
      return '🔒';
    case 'aws':
      return '☁️';
    case 'database':
      return '🗄️';
    default:
      return '📦';
  }
}

export default function SecretsEngineList() {
  const { engines, fetchEngines } = useVaultStore();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [nameFilter, setNameFilter] = useState('');
  const [showEnableModal, setShowEnableModal] = useState(false);
  const [canEnable, setCanEnable] = useState(false);
  const [newEngine, setNewEngine] = useState({ path: '', type: 'kv', description: '', version: '2' });
  const [enabling, setEnabling] = useState(false);
  const [enableError, setEnableError] = useState<string | null>(null);

  // Engine row menu state
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchEngines()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));

    // Check if user has sys/mounts permissions (proxy test for enabling engines)
    api.testPermissions(['sys/mounts'])
      .then((results) => {
        const caps = results['sys/mounts'] ?? [];
        setCanEnable(caps.includes('create') || caps.includes('sudo') || caps.includes('root'));
      })
      .catch(() => setCanEnable(false));
  }, [fetchEngines]);

  const ENGINE_TYPES = [
    { value: 'kv', label: 'KV (Key/Value)', hasVersion: true },
    { value: 'transit', label: 'Transit (Encryption)' },
    { value: 'pki', label: 'PKI (Certificates)' },
    { value: 'ssh', label: 'SSH' },
    { value: 'aws', label: 'AWS' },
    { value: 'database', label: 'Database' },
    { value: 'cubbyhole', label: 'Cubbyhole' },
    { value: 'totp', label: 'TOTP' },
  ];

  async function handleEnableEngine() {
    if (!newEngine.path.trim() || !newEngine.type) return;
    setEnabling(true);
    setEnableError(null);
    try {
      const options = newEngine.type === 'kv' ? { version: newEngine.version } : undefined;
      await api.enableSecretsEngine(newEngine.path.trim(), newEngine.type, newEngine.description, options);
      setShowEnableModal(false);
      setNewEngine({ path: '', type: 'kv', description: '', version: '2' });
      await fetchEngines();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setEnableError(msg ?? (e instanceof Error ? e.message : 'Failed to enable engine'));
    } finally {
      setEnabling(false);
    }
  }

  async function handleDeleteEngine(enginePath: string) {
    setDeleting(enginePath);
    setActionError(null);
    try {
      await api.disableSecretsEngine(enginePath);
      setConfirmDelete(null);
      await fetchEngines();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setActionError(msg ?? (e instanceof Error ? e.message : 'Failed to disable engine'));
    } finally {
      setDeleting(null);
    }
  }

  // Filter out internal Vault system engines that are not navigable KV stores.
  // The official Vault UI hides these from the secrets engines list.
  const HIDDEN_ENGINE_TYPES = new Set(['identity', 'system']);

  const filtered = engines.filter((e: SecretEngine) => {
    if (HIDDEN_ENGINE_TYPES.has(e.type)) return false;
    const matchType = !typeFilter || e.type.toLowerCase().includes(typeFilter.toLowerCase());
    const matchName = !nameFilter || e.path.toLowerCase().includes(nameFilter.toLowerCase());
    return matchType && matchName;
  });

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} onRetry={() => window.location.reload()} />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">Secrets Engines</h1>
        {canEnable && (
          <button
            onClick={() => setShowEnableModal(true)}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4]"
          >
            Enable new engine +
          </button>
        )}
      </div>

      {actionError && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {actionError}
        </div>
      )}

      <div className="mb-4 flex gap-3">
        <input
          type="text"
          placeholder="Filter by type…"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
        />
        <input
          type="text"
          placeholder="Filter by name…"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
        />
      </div>

      <div className="overflow-hidden rounded-md border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-semibold tracking-wider text-gray-500 uppercase">
                Description
              </th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filtered.map((engine) => (
              <tr key={engine.path} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <Link
                    to={`/secrets/${engine.path}`}
                    className="flex items-center gap-2 font-medium text-[#1563ff] hover:text-[#1250d4]"
                  >
                    <span>{engineIcon(engine.type)}</span>
                    <span>{engine.path}</span>
                  </Link>
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">
                  {engine.type}
                  {engine.options?.version && (
                    <span className="ml-2 inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                      v{engine.options.version}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500">
                  {engine.accessor}
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {engine.description || '—'}
                </td>
                <td className="px-2 py-3 text-center relative">
                  {confirmDelete === engine.path ? (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleDeleteEngine(engine.path.replace(/\/$/, ''))}
                        disabled={deleting === engine.path}
                        className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        {deleting === engine.path ? '…' : 'Confirm'}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === engine.path ? null : engine.path)}
                        className="text-gray-400 hover:text-gray-600 px-1"
                      >
                        ⋯
                      </button>
                      {menuOpen === engine.path && (
                        <div className="absolute right-0 top-6 z-10 w-32 rounded-md border border-gray-200 bg-white shadow-lg">
                          <button
                            onClick={() => { setMenuOpen(null); setConfirmDelete(engine.path); }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                          >
                            Disable engine
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal isOpen={showEnableModal} onClose={() => setShowEnableModal(false)} title="Enable Secrets Engine">
        <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Path</label>
              <input
                type="text"
                value={newEngine.path}
                onChange={(e) => setNewEngine({ ...newEngine, path: e.target.value })}
                placeholder="my-secrets"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
              />
              <p className="mt-1 text-xs text-gray-400">The path where this engine will be mounted</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
              <select
                value={newEngine.type}
                onChange={(e) => setNewEngine({ ...newEngine, type: e.target.value })}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:outline-none"
              >
                {ENGINE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {newEngine.type === 'kv' && (
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">KV Version</label>
                <select
                  value={newEngine.version}
                  onChange={(e) => setNewEngine({ ...newEngine, version: e.target.value })}
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:outline-none"
                >
                  <option value="2">Version 2 (recommended)</option>
                  <option value="1">Version 1</option>
                </select>
              </div>
            )}
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Description (optional)</label>
              <input
                type="text"
                value={newEngine.description}
                onChange={(e) => setNewEngine({ ...newEngine, description: e.target.value })}
                placeholder="Optional description"
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
              />
            </div>
            {enableError && (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {enableError}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowEnableModal(false)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => { void handleEnableEngine(); }}
                disabled={enabling || !newEngine.path.trim()}
                className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50"
              >
                {enabling ? 'Enabling…' : 'Enable Engine'}
              </button>
            </div>
          </div>
        </Modal>
    </div>
  );
}