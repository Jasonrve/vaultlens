import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';
import type { VaultLensAuditEntry } from '../lib/api';

export default function VaultLensAuditPage() {
  const [entries, setEntries] = useState<VaultLensAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [filterDate, setFilterDate] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { from?: string; to?: string; limit: number; offset: number } = {
        limit: pageSize,
        offset: page * pageSize,
      };
      if (filterDate) {
        params.from = filterDate;
        params.to = filterDate;
      }
      const result = await api.getVaultLensAuditLogs(params);
      setEntries(result.entries);
      setTotal(result.total);
    } catch {
      setError('Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  }, [filterDate, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  useEffect(() => {
    api.getVaultLensAuditDates().then(setDates).catch(() => {});
  }, []);

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Sharing Audit Log</h1>
        <p className="mt-1 text-sm text-gray-500">
          View audit trail for all secret sharing activity (creates and views).
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Filter by date</label>
          <select
            value={filterDate}
            onChange={(e) => { setFilterDate(e.target.value); setPage(0); }}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm"
          >
            <option value="">All dates</option>
            {dates.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto text-sm text-gray-500">
          {total} total {total === 1 ? 'entry' : 'entries'}
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        </div>
      ) : entries.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">No audit entries found.</p>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Mode</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Creator</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Viewer</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">URL</th>
                  <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Client IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry, idx) => (
                  <tr key={`${entry.shareId}-${entry.timestamp}-${idx}`} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">
                      {new Date(entry.timestamp).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        entry.action === 'share_created'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}>
                        {entry.action === 'share_created' ? 'Created' : 'Viewed'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        entry.shareMode === 'one-time' ? 'bg-gray-100 text-gray-700' :
                        entry.shareMode === 'otp' ? 'bg-amber-100 text-amber-800' :
                        'bg-purple-100 text-purple-800'
                      }`}>
                        {entry.shareMode === 'one-time' ? 'One-time' :
                         entry.shareMode === 'otp' ? 'OTP' : 'Auth Login'}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 font-mono">{entry.creator || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-700 font-mono">{entry.viewer || '—'}</td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 font-mono max-w-[200px] truncate" title={entry.url}>
                      {entry.url}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{entry.clientIp || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-500">
                Page {page + 1} of {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
