import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../lib/api';
import type { AuditLogEntry, AuditSourceInfo } from '../lib/api';
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

function AuditSourceBadge({ source, isLive }: { source: AuditSourceInfo | null; isLive?: boolean }) {
  if (!source) return null;
  if (source.source === 'socket') {
    const connected = source.socket.connectedClients > 0;
    return (
      <span
        title={`Socket audit — listening· ${source.socket.connectedClients} client(s) connected · ${source.socket.bufferSize.toLocaleString()} events in buffer`}
        className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm0 14a6 6 0 110-12 6 6 0 010 12z" />
          <path fillRule="evenodd" d="M10 6a1 1 0 011 1v3.586l2.707 2.707a1 1 0 01-1.414 1.414l-3-3A1 1 0 019 11V7a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        Socket
        {isLive && connected && (
          <span className="inline-flex items-center gap-1 text-green-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
            Live
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      title="File audit — reading from disk log file"
      className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
      File
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
  const [auditSource, setAuditSource] = useState<AuditSourceInfo | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.getAuditSource().then(setAuditSource).catch(() => { /* non-critical */ });
  }, []);

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
      setLastRefreshed(new Date());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [search, operationFilter, mountTypeFilter, page, pageSize]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  // Auto-refresh every 5 seconds in socket mode when Vault is connected
  useEffect(() => {
    const isSocketConnected =
      auditSource?.source === 'socket' &&
      (auditSource.socket.connectedClients ?? 0) > 0;

    if (isSocketConnected) {
      autoRefreshRef.current = setInterval(() => {
        // Silently re-fetch source stats and logs
        api.getAuditSource().then(setAuditSource).catch(() => {});
        fetchLogs();
      }, 5000);
    }

    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };
  }, [auditSource?.source, auditSource?.socket?.connectedClients, fetchLogs]);

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

  // Derive unique operations, mount types, paths, and display names for filter suggestions
  const { operations, mountTypes, uniquePaths, uniqueUsers } = useMemo(() => {
    const ops = new Set<string>();
    const mounts = new Set<string>();
    const paths = new Set<string>();
    const users = new Set<string>();
    for (const e of entries) {
      if (e.operation) ops.add(e.operation);
      if (e.mountType) mounts.add(e.mountType);
      if (e.path && !e.path.startsWith('hmac-sha256:')) paths.add(e.path);
      if (e.displayName && !e.displayName.startsWith('hmac-sha256:')) users.add(e.displayName);
    }
    return {
      operations: [...ops].sort(),
      mountTypes: [...mounts].sort(),
      uniquePaths: [...paths].sort(),
      uniqueUsers: [...users].sort(),
    };
  }, [entries]);

  const isLive =
    auditSource?.source === 'socket' &&
    (auditSource.socket.connectedClients ?? 0) > 0;

  if (loading && entries.length === 0) return <LoadingSpinner className="mt-12" />;
  if (error && entries.length === 0) return <ErrorMessage message={error} onRetry={fetchLogs} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Audit Log</h1>
            <p className="mt-0.5 text-sm text-gray-500">
              {total} entries {total > entries.length && `(showing ${entries.length})`}
              {lastRefreshed && (
                <span className="ml-2 text-xs text-gray-400">
                  · updated {lastRefreshed.toLocaleTimeString()}
                </span>
              )}
            </p>
          </div>
          <AuditSourceBadge source={auditSource} isLive={isLive} />
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
          list="audit-search-suggestions"
          placeholder="Search path, user, error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-64 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
        />
        <datalist id="audit-search-suggestions">
          {uniquePaths.map((p) => <option key={`path:${p}`} value={p} />)}
          {uniqueUsers.map((u) => <option key={`user:${u}`} value={u} />)}
        </datalist>
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
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                              error
                            </span>
                            <span className="max-w-[180px] truncate text-[11px] text-red-600" title={entry.error}>
                              {entry.error}
                            </span>
                          </div>
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
                          {entry.error && (
                            <div className="mb-3 rounded border border-red-200 bg-red-50 p-2">
                              <span className="text-xs font-semibold text-red-700">Error: </span>
                              <span className="break-words text-xs text-red-700">{entry.error}</span>
                            </div>
                          )}
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
                              </dl>
                              {entry.requestData && Object.keys(entry.requestData).length > 0 && (
                                <div className="mt-2">
                                  <h5 className="mb-1 font-semibold text-gray-500">Request Data</h5>
                                  <pre className="max-h-60 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700 break-all whitespace-pre-wrap">
                                    {JSON.stringify(entry.requestData, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                            <div>
                              <h4 className="mb-1 font-semibold text-gray-700">Response</h4>
                              {entry.responseData && Object.keys(entry.responseData).length > 0 ? (
                                <pre className="max-h-60 overflow-auto rounded border border-gray-200 bg-white p-2 text-[11px] text-gray-700 break-all whitespace-pre-wrap">
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

