import { useEffect, useState, useCallback, Fragment } from 'react';
import * as api from '../../lib/api';
import type { AuditLogEntry } from '../../lib/api';
import LoadingSpinner from './LoadingSpinner';
import ErrorMessage from './ErrorMessage';
import AuditContextMenu from './AuditContextMenu';
import AuditWebhookModal from './AuditWebhookModal';

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

interface FilteredAuditLogProps {
  /** Auth method mount path, e.g. "kubernetes" */
  mountPath: string;
  /** Scopes results to a single role using the same matching as the error badges */
  roleFilter?: string;
  /** Start with the "errors only" toggle checked */
  defaultErrorOnly?: boolean;
}

/** Reusable audit log table filtered to a single auth method mount, optionally scoped to a role. */
export default function FilteredAuditLog({ mountPath, roleFilter, defaultErrorOnly = false }: FilteredAuditLogProps) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [errorOnly, setErrorOnly] = useState(defaultErrorOnly);
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
        mountPath,
        role: roleFilter || undefined,
        errorOnly: errorOnly || undefined,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [mountPath, roleFilter, search, operationFilter, errorOnly, page, pageSize]);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  useEffect(() => { setPage(1); }, [pageSize, search, operationFilter, errorOnly]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading && entries.length === 0) return <LoadingSpinner className="mt-8" />;
  if (error && entries.length === 0) return <ErrorMessage message={error} />;

  return (
    <div className="space-y-3">
      {roleFilter && (
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          Scoped to role
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700">{roleFilter}</span>
        </div>
      )}
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
        <label className="flex items-center gap-1.5 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={errorOnly}
            onChange={(e) => setErrorOnly(e.target.checked)}
            className="rounded border-gray-300"
          />
          Errors only
        </label>
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
                    No audit entries found
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
