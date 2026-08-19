import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import DevIntegrationTab from './DevIntegrationTab';
import FilteredAuditLog from '../common/FilteredAuditLog';

// Fields that contain token/security policies — rendered as badges
const POLICY_FIELDS = new Set(['token_policies', 'policies', 'allowed_policies', 'disallowed_policies']);
// Fields to display under a "Tokens" sub-heading
const TOKEN_FIELD_PREFIX = 'token_';

function formatValue(val: unknown): string {
  if (val === null || val === undefined || val === '') return '—';
  if (Array.isArray(val)) return val.length === 0 ? '—' : val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function toLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface FieldRowProps {
  label: string;
  value: unknown;
  isPolicy?: boolean;
}

function FieldRow({ label, value, isPolicy }: FieldRowProps) {
  const formatted = formatValue(value);
  return (
    <div className="flex border-b border-gray-100 px-4 py-3 last:border-0">
      <span className="w-1/2 text-sm font-medium text-gray-600">{label}</span>
      <span className="w-1/2 text-sm text-gray-800 break-all">
        {isPolicy && Array.isArray(value) && value.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {(value as string[]).map((p) => (
              <span key={p} className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {p}
              </span>
            ))}
          </span>
        ) : (
          formatted
        )}
      </span>
    </div>
  );
}

// ── AppRole Secret ID Section ───────────────────────────────────────────────

function maskAccessor(accessor: string): string {
  if (accessor.length <= 4) return accessor;
  return `${accessor.slice(0, 2)}${'•'.repeat(accessor.length - 4)}${accessor.slice(-2)}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface GeneratedSecret {
  secretId: string;
  accessor: string;
  ttl: number;
  numUses: number;
}

function SecretIdsSection({ method, role }: { method: string; role: string }) {
  const [secretIds, setSecretIds] = useState<api.SecretIdInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedSecret | null>(null);
  const [destroyingAccessor, setDestroyingAccessor] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'secretId' | 'accessor' | null>(null);

  const loadSecretIds = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listSecretIds(method, role);
      setSecretIds(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load secret IDs');
    } finally {
      setLoading(false);
    }
  }, [method, role]);

  useEffect(() => { void loadSecretIds(); }, [loadSecretIds]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await api.generateSecretId(method, role);
      setGenerated(result);
      void loadSecretIds();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to generate secret ID');
    } finally {
      setGenerating(false);
    }
  }

  async function handleRevoke(accessor: string) {
    if (!window.confirm(`Revoke this secret ID?\n\nThis cannot be undone.`)) return;
    setDestroyingAccessor(accessor);
    try {
      await api.destroySecretId(method, role, accessor);
      setSecretIds((prev) => prev.filter((s) => s.accessor !== accessor));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to revoke secret ID');
    } finally {
      setDestroyingAccessor(null);
    }
  }

  function handleCopy(field: 'secretId' | 'accessor', value: string) {
    void navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Secret IDs</h2>
          <p className="text-sm text-gray-500">Active secret ID accessors for this role. Secret ID values are shown only once at creation and cannot be retrieved later.</p>
        </div>
        <button
          onClick={() => { void handleGenerate(); }}
          disabled={generating}
          className="rounded bg-[#1563ff] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50"
        >
          {generating ? 'Generating…' : '+ Generate Secret ID'}
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {/* One-time reveal modal */}
      {generated && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
                <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-base font-semibold text-gray-900">New Secret ID Generated</h3>
                <p className="mt-1 text-sm font-medium text-amber-700">Copy and store the Secret ID now — it will never be shown again.</p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Secret ID</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-gray-100 px-3 py-2 text-sm font-mono text-gray-800 break-all select-all">
                    {generated.secretId}
                  </code>
                  <button
                    onClick={() => handleCopy('secretId', generated.secretId)}
                    className="shrink-0 rounded border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    {copiedField === 'secretId' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Accessor</label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-gray-100 px-3 py-2 text-sm font-mono text-gray-700 break-all select-all">
                    {generated.accessor}
                  </code>
                  <button
                    onClick={() => handleCopy('accessor', generated.accessor)}
                    className="shrink-0 rounded border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    {copiedField === 'accessor' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {generated.ttl > 0 && (
                <p className="text-xs text-gray-500">TTL: {generated.ttl}s · Uses: {generated.numUses === 0 ? 'unlimited' : generated.numUses}</p>
              )}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setGenerated(null)}
                className="rounded bg-gray-800 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
              >
                I&apos;ve saved the Secret ID
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Secret ID list */}
      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="overflow-x-auto overflow-hidden rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Accessor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Expires</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Uses remaining</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {secretIds.map((s) => {
                const isExpired = s.expirationTime && new Date(s.expirationTime) < new Date();
                return (
                  <tr key={s.accessor} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-sm text-gray-700" title={s.accessor}>
                      {maskAccessor(s.accessor)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {fmtDate(s.creationTime)}
                    </td>
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      {s.expirationTime ? (
                        <span className={isExpired ? 'text-red-600 font-medium' : 'text-gray-600'}>
                          {fmtDate(s.expirationTime)}
                          {isExpired && ' (expired)'}
                        </span>
                      ) : (
                        <span className="text-gray-400">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {s.numUses === 0
                        ? <span className="text-gray-400">Unlimited</span>
                        : <span className={s.numUses <= 1 ? 'text-amber-600 font-medium' : ''}>{s.numUses}</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => { void handleRevoke(s.accessor); }}
                        disabled={destroyingAccessor === s.accessor}
                        className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                      >
                        {destroyingAccessor === s.accessor ? 'Revoking…' : 'Revoke'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {secretIds.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">
                    No active secret IDs — generate one to get started
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function RoleDetail() {
  const { method = '', role = '' } = useParams();
  const navigate = useNavigate();
  const [roleData, setRoleData] = useState<Record<string, unknown> | null>(null);
  const [authType, setAuthType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'developer' | 'audits' | 'secret-ids'>('details');
  const [templateContent, setTemplateContent] = useState('');
  const [canCustomize, setCanCustomize] = useState(false);
  const [devGuidesEnabled, setDevGuidesEnabled] = useState(true);

  useEffect(() => {
    api
      .getRole(method, role)
      .then((result) => {
        setRoleData(result.data);
        setAuthType(result.authType ?? '');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, [method, role]);

  useEffect(() => {
    api
      .getDevTemplate(method, role)
      .then((data) => {
        setTemplateContent(data.content);
        setCanCustomize(data.canCustomize);
        setDevGuidesEnabled(data.enabled);
      })
      .catch(() => {
        // Silent fail — template loading errors don't block the page
        setTemplateContent('');
      });
  }, [method, role]);

  async function handleDelete() {
    if (!window.confirm(`Delete role "${role}"? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await api.deleteRole(method, role);
      navigate(`/access/auth-methods/${method}/roles`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete role');
      setDeleting(false);
    }
  }

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;
  if (!roleData) return <ErrorMessage message="No role data found" />;

  const allEntries = Object.entries(roleData);
  const generalFields = allEntries.filter(([k]) => !k.startsWith(TOKEN_FIELD_PREFIX));
  const tokenFields = allEntries.filter(([k]) => k.startsWith(TOKEN_FIELD_PREFIX));

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
        <Link to="/access/auth-methods" className="hover:text-[#1563ff]">Auth Methods</Link>
        <span>/</span>
        <Link to={`/access/auth-methods/${method}`} className="hover:text-[#1563ff]">{method}</Link>
        <span>/</span>
        <span className="text-gray-700">{role}</span>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-800">{role}</h1>
        <button
          onClick={() => { void handleDelete(); }}
          disabled={deleting}
          className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? 'Deleting…' : 'Delete Role'}
        </button>
      </div>

      {/* Tabs */}
      <div className="mb-5 flex gap-1 border-b border-gray-200">
        {(() => {
          const hasContent = templateContent.trim().length > 0;
          const showDevGuide = devGuidesEnabled && (hasContent || canCustomize);
          const tabs = [
            'details' as const,
            ...(authType === 'approle' ? ['secret-ids' as const] : []),
            ...(showDevGuide ? ['developer' as const] : []),
            'audits' as const,
          ];
          const tabLabels: Record<string, string> = {
            'details': 'Role Details',
            'secret-ids': 'Secret IDs',
            'developer': '⚙ Developer Guide',
            'audits': '📋 Audits',
          };
          return tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              className={[
                'px-4 py-2 text-sm font-medium rounded-t transition-colors',
                activeTab === tab
                  ? 'border-b-2 border-blue-600 text-blue-600 bg-white'
                  : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {tabLabels[tab] ?? tab}
            </button>
          ));
        })()}
      </div>

      {/* Tab: Role Details */}
      {activeTab === 'details' && (
        <>
          {/* General fields */}
          {generalFields.length > 0 && (
            <div className="mb-6 overflow-hidden rounded-md border border-gray-200 bg-white">
              {generalFields.map(([key, val]) => (
                <FieldRow
                  key={key}
                  label={toLabel(key)}
                  value={val}
                  isPolicy={POLICY_FIELDS.has(key)}
                />
              ))}
            </div>
          )}

          {/* Token fields */}
          {tokenFields.length > 0 && (
            <>
              <h2 className="mb-3 text-base font-semibold text-gray-700">Tokens</h2>
              <div className="overflow-hidden rounded-md border border-gray-200 bg-white">
                {tokenFields.map(([key, val]) => (
                  <FieldRow
                    key={key}
                    label={toLabel(key)}
                    value={val}
                    isPolicy={POLICY_FIELDS.has(key)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Tab: Secret IDs (AppRole only) */}
      {activeTab === 'secret-ids' && (
        <SecretIdsSection method={method} role={role} />
      )}

      {/* Tab: Developer Guide */}
      {activeTab === 'developer' && (
        <DevIntegrationTab method={method} role={role} />
      )}

      {/* Tab: Audits */}
      {activeTab === 'audits' && (
        <FilteredAuditLog mountPath={method} roleFilter={role} />
      )}
    </div>
  );
}

