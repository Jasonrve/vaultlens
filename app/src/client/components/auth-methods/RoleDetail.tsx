import { useEffect, useState, useCallback, Fragment } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import type { AuditLogEntry } from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import DevIntegrationTab from './DevIntegrationTab';
import AuditContextMenu from '../common/AuditContextMenu';
import AuditWebhookModal from '../common/AuditWebhookModal';

// Fields that contain token/security policies — rendered as badges
const POLICY_FIELDS = new Set(['token_policies', 'policies', 'allowed_policies', 'disallowed_policies']);
// Fields to display under a "Tokens" sub-heading
const TOKEN_FIELD_PREFIX = 'token_';

function operationBadge(op: string) {
  const colors: Record<string, string> = {
    read: 'bg-blue-100 text-blue-700',
    create: 'bg-green-100 text-green-700',
    update: 'bg-amber-100 text-amber-700',
    delete: 'bg-red-100 text-red-700',
    list: 'bg-purple-100 text-purple-700',
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${colors[op] ?? 'bg-gray-100 text-gray-600'}`}>
      {op}
    </span>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

interface RoleAuditSectionProps {
  method: string;
}

function RoleAuditSection({ method }: RoleAuditSectionProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: AuditLogEntry } | null>(null);
  const [webhookEntry, setWebhookEntry] = useState<AuditLogEntry | null>(null);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const offset = (page - 1) * pageSize;
      const result = await api.getAuditLogs({
        offset,
        limit: pageSize,
        search: search || undefined,
        operation: operationFilter || undefined,
        mountPath: method,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [method, search, operationFilter, page, pageSize]);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  useEffect(() => { setPage(1); }, [pageSize, search, operationFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading && entries.length === 0) return <LoadingSpinner className="mt-8" />;
  if (error && entries.length === 0) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search path, user, error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-56 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
        />
        <select
          value={operationFilter}
          onChange={(e) => setOperationFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none"
        >
          <option value="">All operations</option>
          {['read', 'create', 'update', 'delete', 'list'].map((op) => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none"
        >
          <option value={10}>10 / page</option>
          <option value={20}>20 / page</option>
          <option value={50}>50 / page</option>
        </select>
        <button
          onClick={() => { void fetchLogs(); }}
          disabled={loading}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <span className="ml-auto text-sm text-gray-500">{total} entries</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Time</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Operation</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Path</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Remote Addr</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">User</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Entity</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {entries.map((entry) => {
                const isExpanded = expandedRow === entry.requestId;
                return (
                  <Fragment key={entry.requestId}>
                    <tr
                      onClick={() => setExpandedRow(isExpanded ? null : entry.requestId)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setContextMenu({ x: e.clientX, y: e.clientY, entry });
                      }}
                      className={`cursor-pointer hover:bg-gray-50 ${isExpanded ? 'bg-blue-50' : ''}`}
                    >
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">{formatTime(entry.time)}</td>
                      <td className="px-3 py-2">{operationBadge(entry.operation)}</td>
                      <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs text-gray-700" title={entry.path}>
                        {entry.path && !entry.path.startsWith('hmac-sha256:') ? entry.path : <span className="italic text-gray-400">—</span>}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-gray-600">{entry.remoteAddress || '—'}</td>
                      <td className="px-3 py-2 text-gray-600">{entry.displayName || '—'}</td>
                      <td className="max-w-[180px] truncate px-3 py-2 font-mono text-xs text-gray-600">{entry.clientTokenAccessor ? entry.clientTokenAccessor.slice(0, 20) : '—'}</td>
                      <td className="px-3 py-2">
                        {entry.error ? (
                          <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700" title={entry.error}>error</span>
                        ) : entry.hasResponse ? (
                          <span className="inline-block rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">ok</span>
                        ) : (
                          <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">pending</span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="bg-gray-50 px-4 py-4 text-xs">
                          <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="font-medium text-gray-700">Request ID</div>
                                <div className="mt-1 font-mono text-[11px] text-gray-600">{entry.requestId}</div>
                              </div>
                              {entry.clientTokenAccessor && (
                                <div>
                                  <div className="font-medium text-gray-700">Token Accessor</div>
                                  <div className="mt-1 font-mono text-[11px] text-gray-600 break-all">{entry.clientTokenAccessor}</div>
                                </div>
                              )}
                              {entry.remoteAddress && (
                                <div>
                                  <div className="font-medium text-gray-700">Remote Address</div>
                                  <div className="mt-1 font-mono text-[11px] text-gray-600">{entry.remoteAddress}</div>
                                </div>
                              )}
                              {entry.displayName && (
                                <div>
                                  <div className="font-medium text-gray-700">Display Name</div>
                                  <div className="mt-1 text-[11px] text-gray-600">{entry.displayName}</div>
                                </div>
                              )}
                            </div>
                            {entry.requestData && (
                              <div>
                                <div className="font-medium text-gray-700">Request Data</div>
                                <pre className="mt-2 overflow-auto rounded bg-gray-100 p-2 text-[10px] text-gray-700">
                                  {JSON.stringify(entry.requestData, null, 2)}
                                </pre>
                              </div>
                            )}
                            {entry.responseData && (
                              <div>
                                <div className="font-medium text-gray-700">Response Data</div>
                                <pre className="mt-2 overflow-auto rounded bg-gray-100 p-2 text-[10px] text-gray-700 max-h-[200px]">
                                  {JSON.stringify(entry.responseData, null, 2)}
                                </pre>
                              </div>
                            )}
                            {entry.error && (
                              <div className="rounded bg-red-50 p-2 text-red-700">
                                <span className="font-medium">Error:</span> {entry.error}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {entries.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                    No audit entries found for this auth method
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span className="text-gray-600">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-50 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}

      {contextMenu && (
        <AuditContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          entry={contextMenu.entry}
          onClose={() => setContextMenu(null)}
          onCreateWebhook={() => setWebhookEntry(contextMenu.entry)}
        />
      )}
      {webhookEntry && (
        <AuditWebhookModal
          entry={webhookEntry}
          onClose={() => setWebhookEntry(null)}
        />
      )}
    </div>
  );
}

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

interface GeneratedSecret {
  secretId: string;
  accessor: string;
  ttl: number;
  numUses: number;
}

function SecretIdsSection({ method, role }: { method: string; role: string }) {
  const [accessors, setAccessors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedSecret | null>(null);
  const [destroyingAccessor, setDestroyingAccessor] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<'secretId' | 'accessor' | null>(null);

  const loadAccessors = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listSecretIds(method, role);
      setAccessors(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load secret IDs');
    } finally {
      setLoading(false);
    }
  }, [method, role]);

  useEffect(() => { void loadAccessors(); }, [loadAccessors]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const result = await api.generateSecretId(method, role);
      setGenerated(result);
      void loadAccessors();
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
      setAccessors((prev) => prev.filter((a) => a !== accessor));
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

      {/* Accessor list */}
      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="overflow-hidden rounded-md border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Accessor</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {accessors.map((accessor) => (
                <tr key={accessor} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-sm text-gray-700">
                    {maskAccessor(accessor)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => { void handleRevoke(accessor); }}
                      disabled={destroyingAccessor === accessor}
                      className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                    >
                      {destroyingAccessor === accessor ? 'Revoking…' : 'Revoke'}
                    </button>
                  </td>
                </tr>
              ))}
              {accessors.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-sm text-gray-400">
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
        <RoleAuditSection method={method} />
      )}
    </div>
  );
}

