import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';

export default function HooksPage() {
  const [hooks, setHooks] = useState<api.WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', secretPath: '', endpoint: '' });
  const [testing, setTesting] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const hookList = await api.getHooks();
      setHooks(hookList);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async () => {
    setError(null);
    setSuccessMsg(null);
    try {
      if (editingId) {
        await api.updateHook(editingId, form);
        setSuccessMsg('Webhook updated');
      } else {
        await api.createHook(form.name, form.secretPath, form.endpoint);
        setSuccessMsg('Webhook created');
      }
      setShowForm(false);
      setEditingId(null);
      setForm({ name: '', secretPath: '', endpoint: '' });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save webhook');
    }
  };

  const handleEdit = (hook: api.WebhookConfig) => {
    setForm({ name: hook.name, secretPath: hook.secretPath, endpoint: hook.endpoint });
    setEditingId(hook.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    setDeleting(id);
    setError(null);
    try {
      await api.deleteHook(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete webhook');
    } finally {
      setDeleting(null);
    }
  };

  const handleToggle = async (hook: api.WebhookConfig) => {
    try {
      await api.updateHook(hook.id, { enabled: !hook.enabled });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle webhook');
    }
  };

  const handleTest = async (id: string) => {
    setTesting(id);
    setError(null);
    setSuccessMsg(null);
    try {
      const result = await api.testHook(id);
      if (result.success) {
        setSuccessMsg(`Test webhook delivered successfully (HTTP ${result.statusCode})`);
      } else {
        setError(result.error ?? `Webhook endpoint returned HTTP ${result.statusCode}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Webhook test failed');
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Webhooks</h1>
          <p className="mt-1 text-sm text-gray-500">
            Configure webhooks to be notified when secrets at specific paths are modified.
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
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', secretPath: '', endpoint: '' }); }}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add Webhook
          </button>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <h3 className="text-sm font-semibold text-blue-800 mb-1">How Webhooks Work</h3>
        <p className="text-xs text-blue-700">
          VaultLens monitors the Vault audit log for write operations (create, update, delete) on secret paths.
          When a change is detected that matches a webhook&apos;s configured path, a POST request is sent to the endpoint
          with details about the change. The payload includes the event type, hook info, changed path, and timestamp.
        </p>
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

      {/* Create/Edit Form */}
      {showForm && (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">
            {editingId ? 'Edit Webhook' : 'New Webhook'}
          </h2>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g. Notify DevOps"
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Secret Path (prefix)</label>
              <input
                type="text"
                value={form.secretPath}
                onChange={e => setForm(prev => ({ ...prev, secretPath: e.target.value }))}
                placeholder="e.g. kv/data/production/"
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
              <p className="text-[11px] text-gray-400 mt-0.5">Any change under this path will trigger the webhook.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Endpoint URL</label>
              <input
                type="url"
                value={form.endpoint}
                onChange={e => setForm(prev => ({ ...prev, endpoint: e.target.value }))}
                placeholder="https://hooks.example.com/webhook"
                className="w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={!form.name || !form.secretPath || !form.endpoint}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {editingId ? 'Update' : 'Create'}
              </button>
              <button
                onClick={() => { setShowForm(false); setEditingId(null); }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hooks List */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        </div>
      ) : hooks.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
          <p className="text-sm">No webhooks configured.</p>
          <p className="text-xs mt-1">Click &quot;Add Webhook&quot; to create your first webhook.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="divide-y divide-gray-100">
            {hooks.map(hook => (
              <div key={hook.id} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggle(hook)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${hook.enabled ? 'bg-green-500' : 'bg-gray-300'}`}
                    >
                      <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${hook.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                    <div>
                      <span className="text-sm font-medium text-gray-900">{hook.name}</span>
                      <span className={`ml-2 text-xs ${hook.enabled ? 'text-green-600' : 'text-gray-400'}`}>
                        {hook.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleTest(hook.id)}
                      disabled={testing === hook.id}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {testing === hook.id ? 'Testing...' : 'Test'}
                    </button>
                    <button
                      onClick={() => handleEdit(hook)}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(hook.id)}
                      disabled={deleting === hook.id}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      {deleting === hook.id ? '...' : 'Delete'}
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-gray-500">
                  <span>Path: <code className="bg-gray-100 px-1 rounded">{hook.secretPath}</code></span>
                  <span>Endpoint: <code className="bg-gray-100 px-1 rounded">{hook.endpoint}</code></span>
                  <span>Triggered: {hook.triggerCount} time{hook.triggerCount !== 1 ? 's' : ''}</span>
                  {hook.lastTriggered && <span>Last: {new Date(hook.lastTriggered).toLocaleString()}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
