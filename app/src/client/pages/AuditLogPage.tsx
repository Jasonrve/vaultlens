import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import type { AuditLogEntry } from '../lib/api';
import LoadingSpinner from '../components/common/LoadingSpinner';
import ErrorMessage from '../components/common/ErrorMessage';

function mountIcon(mountType: string): string {
  switch (mountType) {
    case 'token': return '🔑';
    case 'kubernetes': return '☸️';
    case 'github': return '🐙';
    case 'oidc': case 'jwt': return '🔐';
    case 'approle': return '🤖';
    case 'ldap': return '📂';
    case 'aws': return '☁️';
    case 'kv': return '📋';
    case 'cubbyhole': return '🔒';
    case 'system': case 'sys': return '⚙️';
    case 'identity': return '👤';
    case 'pki': return '📜';
    case 'transit': return '🔄';
    default: return '📦';
  }
}

function mountLinkPath(mountType: string, mountPoint: string): string | null {
  const cleanMount = mountPoint.replace(/\/$/, '').replace(/^auth\//, '');
  switch (mountType) {
    case 'token':
    case 'kubernetes':
    case 'github':
    case 'oidc':
    case 'jwt':
    case 'approle':
    case 'ldap':
      return `/access/auth-methods/${cleanMount}`;
    case 'kv':
    case 'cubbyhole':
      return `/secrets/${mountPoint}`;
    case 'identity':
      return '/access/entities';
    default:
      return null;
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

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

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [operationFilter, setOperationFilter] = useState('');
  const [mountTypeFilter, setMountTypeFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);

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
        mountType: mountTypeFilter || undefined,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [search, operationFilter, mountTypeFilter, page, pageSize]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Reset to first page when pageSize changes
  useEffect(() => {
    setPage(1);
  }, [pageSize]);

  // Reset to first page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, operationFilter, mountTypeFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const displayedEntries = entries;

  // Derive unique operations and mount types
  const { operations, mountTypes } = useMemo(() => {
    const ops = new Set<string>();
    const mounts = new Set<string>();
    for (const e of entries) {
      if (e.operation) ops.add(e.operation);
      if (e.mountType) mounts.add(e.mountType);
    }
    return { operations: [...ops].sort(), mountTypes: [...mounts].sort() };
  }, [entries]);

  if (loading && entries.length === 0) return <LoadingSpinner className="mt-12" />;
  if (error && entries.length === 0) return <ErrorMessage message={error} onRetry={fetchLogs} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Audit Log</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {total} entries {total > entries.length && `(showing ${entries.length})`}
          </p>
        </div>
        <button
          onClick={fetchLogs}
          disabled={loading}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Inline filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search path, user, error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
        />
        <select
          value={operationFilter}
          onChange={(e) => setOperationFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none"
        >
          <option value="">All operations</option>
          {operations.map((op) => (
            <option key={op} value={op}>{op}</option>
          ))}
        </select>
        <select
          value={mountTypeFilter}
          onChange={(e) => setMountTypeFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none"
        >
          <option value="">All sources</option>
          {mountTypes.map((mt) => (
            <option key={mt} value={mt}>{mt}</option>
          ))}
        </select>
        <select
          value={pageSize}
          onChange={(e) => setPageSize(Number(e.target.value))}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none"
        >
          <option value={10}>10 per page</option>
          <option value={20}>20 per page</option>
          <option value={50}>50 per page</option>
          <option value={100}>100 per page</option>
          <option value={200}>200 per page</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="w-10 px-2 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase" title="Source">
                  <span className="sr-only">Source</span>
                </th>
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
              {displayedEntries.map((entry) => {
                const link = mountLinkPath(entry.mountType, entry.mountPoint);
                const isExpanded = expandedRow === entry.requestId;
                return (
                  <Fragment key={entry.requestId}>
                    <tr
                      onClick={() => setExpandedRow(isExpanded ? null : entry.requestId)}
                      className="cursor-pointer hover:bg-gray-50"
                    >
                      <td className="w-10 px-2 py-2 text-center">
                        {link ? (
                          <Link
                            to={link}
                            onClick={(e) => e.stopPropagation()}
                            title={entry.mountType}
                            className="hover:opacity-75"
                          >
                            {mountIcon(entry.mountType)}
                          </Link>
                        ) : (
                          <span title={entry.mountType || 'unknown'}>{mountIcon(entry.mountType)}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-gray-600">
                        {formatTime(entry.time)}
                      </td>
                      <td className="px-3 py-2">
                        {operationBadge(entry.operation)}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2 font-mono text-xs text-gray-700" title={entry.path}>
                        {entry.path && !entry.path.startsWith('hmac-sha256:') ? entry.path : <span className="italic text-gray-400">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-500">
                        {entry.remoteAddress || '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {entry.displayName || '—'}
                      </td>
                      <td className="px-3 py-2">
                        {entry.entityId ? (
                          <Link
                            to={`/access/entities/${entry.entityId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs text-[#1563ff] hover:text-[#1250d4]"
                          >
                            {entry.entityId.slice(0, 8)}…
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {entry.error ? (
                          <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700" title={entry.error}>
                            error
                          </span>
                        ) : entry.hasResponse ? (
                          <span className="inline-block rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">
                            ok
                          </span>
                        ) : (
                          <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">
                            pending
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr>
                        <td colSpan={8} className="bg-gray-50 px-4 py-3">
                          <div className="grid grid-cols-2 gap-4 text-xs">
                            <div>
                              <h4 className="mb-1 font-semibold text-gray-700">Request Details</h4>
                              <dl className="space-y-1">
                                <div className="flex gap-2">
                                  <dt className="font-medium text-gray-500">Request ID:</dt>
                                  <dd className="font-mono text-gray-700">{entry.requestId}</dd>
                                </div>

                                <div className="flex gap-2">
                                  <dt className="font-medium text-gray-500">Token Accessor:</dt>
                                  <dd className="font-mono text-gray-700">{entry.clientTokenAccessor || '—'}</dd>
                                </div>
                                <div className="flex gap-2">
                                  <dt className="font-medium text-gray-500">Policies:</dt>
                                  <dd className="flex flex-wrap gap-1">
                                    {entry.policies.length > 0 ? entry.policies.map((p) => (
                                      <Link
                                        key={p}
                                        to={`/policies/${p}`}
                                        className="rounded bg-blue-100 px-1.5 py-0.5 text-[11px] text-blue-700 hover:bg-blue-200"
                                      >
                                        {p}
                                      </Link>
                                    )) : <span className="text-gray-400">—</span>}
                                  </dd>
                                </div>
                                {entry.error && (
                                  <div className="flex gap-2">
                                    <dt className="font-medium text-red-500">Error:</dt>
                                    <dd className="text-red-700">{entry.error}</dd>
                                  </div>
                                )}
                              </dl>
                              {entry.requestData && Object.keys(entry.requestData).length > 0 && (
                                <div className="mt-2">
                                  <h5 className="mb-1 font-semibold text-gray-500">Request Data</h5>
                                  <pre className="max-h-40 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700">
                                    {JSON.stringify(entry.requestData, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 className="mb-1 font-semibold text-gray-700">Response</h4>
                              {entry.responseData && Object.keys(entry.responseData).length > 0 ? (
                                <pre className="max-h-60 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700">
                                  {JSON.stringify(entry.responseData, null, 2)}
                                </pre>
                              ) : (
                                <p className="text-gray-400">No response data</p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">
                    No audit log entries found. Make some requests to Vault to generate audit data.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination controls */}
      {entries.length > 0 && (
        <div className="flex items-center justify-between border-t border-gray-200 pt-3">
          <p className="text-sm text-gray-500">
            Showing {entries.length === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, entries.length)} of {entries.length} entries
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-sm text-gray-700">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

