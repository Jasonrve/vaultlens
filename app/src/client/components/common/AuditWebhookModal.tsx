import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import type { AuditLogEntry, WebhookConfig } from '../../lib/api';

const AUDIT_FIELDS = [
  { id: 'accessor', label: 'Token Accessor' },
  { id: 'display_name', label: 'Display Name' },
  { id: 'entity_id', label: 'Entity ID' },
  { id: 'user', label: 'User' },
] as const;

const SSRF_PATTERNS = [
  /^localhost$/i, /^127\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^\[?::1\]?$/,
];

function validateUrl(url: string): string | null {
  if (!url.trim()) return 'Endpoint URL is required';
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Must use http:// or https://';
    if (SSRF_PATTERNS.some((p) => p.test(u.hostname))) return 'Must not target localhost or private addresses';
  } catch {
    return 'Invalid URL';
  }
  return null;
}

/** Returns true if entryPath could have been emitted by a webhook with the given pattern. */
function pathMatches(entryPath: string, pattern: string): boolean {
  if (!entryPath || !pattern) return false;
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + '(/.*)?$'
  );
  return re.test(entryPath);
}

interface Props {
  entry: AuditLogEntry;
  onClose: () => void;
}

const isHmac = (v: string) => !v || v.startsWith('hmac-sha256:');

export default function AuditWebhookModal({ entry, onClose }: Props) {
  const [name, setName] = useState('');
  const [secretPath, setSecretPath] = useState(() =>
    !isHmac(entry.path) ? entry.path : ''
  );
  const [endpoint, setEndpoint] = useState('');
  const [matchFields, setMatchFields] = useState<string[]>([]);
  const [matchValues, setMatchValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [hooks, setHooks] = useState<WebhookConfig[]>([]);

  useEffect(() => {
    api.getHooks().then(setHooks).catch(() => {});
  }, []);

  const toggleField = (id: string) => {
    setMatchFields((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = 'Name is required';
    if (!secretPath.trim()) errs.secretPath = 'Secret path is required';
    else if (secretPath.includes('..')) errs.secretPath = 'Path must not contain ".."';
    const urlErr = validateUrl(endpoint);
    if (urlErr) errs.endpoint = urlErr;
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    setError(null);
    try {
      await api.createHook(name.trim(), secretPath.trim(), endpoint.trim(), matchFields, matchValues);
      setSuccess(true);
      // Refresh the hooks list to show the new one
      const refreshed = await api.getHooks();
      setHooks(refreshed);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create webhook');
    } finally {
      setSaving(false);
    }
  };

  const matchingHooks = hooks.filter((h) => pathMatches(!isHmac(entry.path) ? entry.path : '', h.secretPath));
  const otherHooks = hooks.filter((h) => !pathMatches(!isHmac(entry.path) ? entry.path : '', h.secretPath));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-xl flex-col rounded-lg bg-white shadow-xl" style={{ maxHeight: '90vh' }}>
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-gray-800">Create Webhook</h2>
            <p className="mt-0.5 text-xs text-gray-500">
              Pre-filled from audit entry · {!isHmac(entry.operation) && <span className="font-medium">{entry.operation}</span>} {!isHmac(entry.path) && <span className="font-mono">{entry.path}</span>}
            </p>
          </div>
          <button onClick={onClose} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {success && (
            <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700">
              Webhook created successfully.
            </div>
          )}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
          )}

          {!success && (
            <>
              {/* Name */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Name <span className="text-red-500">*</span></label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Alert on prod writes"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                {fieldErrors.name && <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>}
              </div>

              {/* Secret path */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Secret path pattern <span className="text-red-500">*</span>
                </label>
                <input
                  value={secretPath}
                  onChange={(e) => setSecretPath(e.target.value)}
                  placeholder="e.g. kv/data/prod/* or kv/data/prod/api"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-500">Use <code>*</code> as a wildcard for a single path segment.</p>
                {fieldErrors.secretPath && <p className="mt-1 text-xs text-red-600">{fieldErrors.secretPath}</p>}
              </div>

              {/* Endpoint */}
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Endpoint URL <span className="text-red-500">*</span></label>
                <input
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  placeholder="https://hooks.example.com/vault"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                />
                {fieldErrors.endpoint && <p className="mt-1 text-xs text-red-600">{fieldErrors.endpoint}</p>}
              </div>

              {/* Match fields */}
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">Filter by audit fields (optional)</label>
                <div className="space-y-2">
                  {AUDIT_FIELDS.map(({ id, label }) => {
                    // Pre-suggest value from the audit entry
                    const suggested =
                      id === 'accessor' ? (!isHmac(entry.clientTokenAccessor) ? entry.clientTokenAccessor : '') :
                      id === 'display_name' ? (!isHmac(entry.displayName) ? entry.displayName : '') :
                      id === 'entity_id' ? (!isHmac(entry.entityId) ? entry.entityId : '') :
                      id === 'user' ? (!isHmac(entry.displayName) ? entry.displayName : '') : '';

                    const checked = matchFields.includes(id);
                    return (
                      <div key={id} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          id={`mf-${id}`}
                          checked={checked}
                          onChange={() => toggleField(id)}
                          className="mt-1 h-3.5 w-3.5 rounded border-gray-300"
                        />
                        <label htmlFor={`mf-${id}`} className="flex-1 text-sm text-gray-700">
                          <span className="font-medium">{label}</span>
                          {checked && (
                            <input
                              value={matchValues[id] ?? suggested}
                              onChange={(e) => setMatchValues((prev) => ({ ...prev, [id]: e.target.value }))}
                              placeholder={suggested || `Expected ${label.toLowerCase()}`}
                              className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono focus:border-blue-500 focus:outline-none"
                            />
                          )}
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={() => { void handleSave(); }}
                disabled={saving}
                className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? 'Creating…' : 'Create Webhook'}
              </button>
            </>
          )}

          {/* Existing webhooks */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="mb-2 text-sm font-semibold text-gray-700">
              Existing webhooks
              {matchingHooks.length > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700">
                  {matchingHooks.length} matching this path
                </span>
              )}
            </h3>
            {hooks.length === 0 ? (
              <p className="text-xs text-gray-400">No webhooks configured yet.</p>
            ) : (
              <div className="space-y-1.5">
                {[...matchingHooks, ...otherHooks].map((hook) => {
                  const isMatch = matchingHooks.includes(hook);
                  return (
                    <div
                      key={hook.id}
                      className={`rounded-md border px-3 py-2 text-xs ${isMatch ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-800">{hook.name}</span>
                        {isMatch && (
                          <span className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                            matches
                          </span>
                        )}
                        <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-medium ${hook.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}>
                          {hook.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-gray-500">{hook.secretPath}</div>
                      <div className="mt-0.5 truncate text-[10px] text-gray-400" title={hook.endpoint}>{hook.endpoint}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
