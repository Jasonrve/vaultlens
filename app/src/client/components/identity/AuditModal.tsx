import { useEffect, useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import Modal from '../common/Modal';
import LoadingSpinner from '../common/LoadingSpinner';
import AuditContextMenu from '../common/AuditContextMenu';
import AuditWebhookModal from '../common/AuditWebhookModal';
import * as api from '../../lib/api';
import type { AuditLogEntry } from '../../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  entityId?: string;
  entityName?: string;
}

export default function AuditModal({ open, onClose, entityId, entityName }: Props) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry: AuditLogEntry } | null>(null);
  const [webhookEntry, setWebhookEntry] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    if (!open) return;
    const abort = { cancelled: false } as { cancelled: boolean };
    async function fetch() {
      setLoading(true);
      try {
        const offset = (page - 1) * pageSize;
        const res = await api.getAuditLogs({
          offset,
          limit: pageSize,
          entityId: entityId || undefined,
          displayName: entityName || undefined,
        });
        if (abort.cancelled) return;
        setEntries(res.entries);
        setTotal(res.total);
      } catch (e) {
        setEntries([]);
        setTotal(0);
      } finally {
        if (!abort.cancelled) setLoading(false);
      }
    }
    void fetch();
    return () => { abort.cancelled = true; };
  }, [open, page, pageSize, entityId, entityName]);

  useEffect(() => {
    if (!open) {
      setPage(1);
      setEntries([]);
      setTotal(0);
      setExpandedRow(null);
      setContextMenu(null);
    }
  }, [open]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Modal open={open} onClose={onClose} title={`Audit — ${entityName ?? entityId ?? 'Entity'}`}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm text-gray-600">Showing audit for <span className="font-medium text-gray-800">{entityName ?? entityId}</span></div>
        <div className="flex items-center gap-2">
          <Link
            to={`/admin/audit-log?${new URLSearchParams({ ...(entityId ? { entityId } : {}), ...(entityName ? { displayName: entityName } : {}) }).toString()}`}
            className="text-sm text-[#1563ff] hover:text-[#1250d4]"
          >
            View full audit ↗
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="py-6"><LoadingSpinner /></div>
      ) : (
        <div className="rounded-md border border-gray-200 bg-white">
          <div className="overflow-auto">
            <table className="min-w-full divide-y divide-gray-100 text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 font-medium text-gray-500">Time</th>
                  <th className="px-3 py-2 font-medium text-gray-500">Op</th>
                  <th className="px-3 py-2 font-medium text-gray-500">Path</th>
                  <th className="px-3 py-2 font-medium text-gray-500">Mount</th>
                  <th className="px-3 py-2 font-medium text-gray-500">User</th>
                  <th className="px-3 py-2 font-medium text-gray-500">Status</th>
                  <th className="px-3 py-2 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((entry) => {
                  const isExpanded = expandedRow === entry.requestId;
                  return (
                    <Fragment key={entry.requestId}>
                      <tr
                        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry }); }}
                        className="hover:bg-gray-50"
                      >
                        <td className="px-3 py-2">
                          <div className="text-xs text-gray-500">{new Date(entry.time).toLocaleString()}</div>
                        </td>
                        <td className="px-3 py-2">{entry.operation}</td>
                        <td className="px-3 py-2 max-w-[280px] truncate" title={entry.path}>{entry.path}</td>
                        <td className="px-3 py-2">{entry.mountPoint}</td>
                        <td className="px-3 py-2">
                          {entry.displayName ? (
                            <span className="text-sm text-gray-700">{entry.displayName}</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {entry.error ? (
                            <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">error</span>
                          ) : entry.hasResponse ? (
                            <span className="inline-block rounded bg-green-100 px-1.5 py-0.5 text-[11px] font-medium text-green-700">ok</span>
                          ) : (
                            <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-500">pending</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setExpandedRow((cur) => (cur === entry.requestId ? null : entry.requestId))}
                              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >{isExpanded ? 'Collapse' : 'Expand'}</button>
                            <button
                              onClick={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, entry }); }}
                              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                            >…</button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={7} className="bg-gray-50 px-4 py-3">
                            <div className="grid grid-cols-2 gap-4 text-xs">
                              <div>
                                <h4 className="mb-1 font-semibold text-gray-700">Request</h4>
                                <div className="font-mono text-xs text-gray-700 break-words">{entry.requestData ? JSON.stringify(entry.requestData, null, 2) : '—'}</div>
                              </div>
                              <div>
                                <h4 className="mb-1 font-semibold text-gray-700">Response</h4>
                                <div className="font-mono text-xs text-gray-700 break-words">{entry.responseData ? JSON.stringify(entry.responseData, null, 2) : 'No response'}</div>
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
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-gray-400">No audit log entries found for this entity.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {entries.length > 0 && (
            <div className="flex items-center justify-between border-t border-gray-200 pt-3">
              <p className="text-sm text-gray-500">Page {page} of {totalPages} — {total} total</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">Previous</button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">Next</button>
              </div>
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
            <AuditWebhookModal entry={webhookEntry} onClose={() => setWebhookEntry(null)} />
          )}
        </div>
      )}

    </Modal>
  );
}
