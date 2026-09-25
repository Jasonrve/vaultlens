import { isAxiosError } from 'axios';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSecurityAuditDiff } from '../lib/api';

export default function AuditDiffPanel({
  oldId,
  currentId,
}: {
  oldId: string;
  currentId: string;
}) {
  const [category, setCategory] = useState('findings');
  const [changeType, setChangeType] = useState('all');
  const [limit, setLimit] = useState(50);
  const query = useQuery({
    queryKey: ['security-audit-diff', oldId, currentId],
    queryFn: () => getSecurityAuditDiff(oldId, currentId),
    enabled: !!oldId,
    retry: false,
  });
  const changes = (query.data?.changes[category] ?? []).filter((c) =>
    changeType === 'all' ? c.change !== 'unchanged' : c.change === changeType,
  );
  return (
    <section aria-label="Run comparison" className="rounded border p-4 text-sm">
      <h3 className="font-medium">Run comparison</h3>
      {query.isFetching && <p className="mt-3">Comparing saved snapshots…</p>}
      {query.error && (
        <p role="alert" className="mt-3 text-red-700">
          {isAxiosError(query.error) &&
          typeof query.error.response?.data?.error === 'string'
            ? query.error.response.data.error
            : query.error.message}
        </p>
      )}
      {query.data && (
        <>
          {query.data.warnings.map((w) => (
            <p key={w} role="alert" className="mt-3 text-amber-800">
              {w}
            </p>
          ))}
          <p className="my-3 text-xs text-gray-500">
            Old: {oldId} → New: {currentId}. Removed means absent from this
            result, not verified remediation.
          </p>
          <div className="overflow-auto">
            <table className="w-full text-left">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Added</th>
                  <th>Removed</th>
                  <th>Changed</th>
                  <th>Unchanged</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(query.data.statistics).map(([name, stats]) => (
                  <tr key={name} className="border-t">
                    <td>{name}</td>
                    {['added', 'removed', 'changed', 'unchanged'].map((key) => (
                      <td key={key}>{stats[key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="my-3 flex gap-3">
            <select
              aria-label="Diff category"
              className="rounded border p-2"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setLimit(50);
              }}
            >
              {Object.keys(query.data.changes).map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
            <select
              aria-label="Diff change type"
              className="rounded border p-2"
              value={changeType}
              onChange={(e) => {
                setChangeType(e.target.value);
                setLimit(50);
              }}
            >
              <option value="all">All changes</option>
              {['added', 'removed', 'changed'].map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </div>
          <p>{changes.length} matching changes</p>
          {changes.slice(0, limit).map((change, index) => (
            <details
              key={`${category}:${index}`}
              className="mt-2 rounded border p-2"
            >
              <summary>
                {change.change} · {index + 1}
              </summary>
              <div className="grid gap-2 lg:grid-cols-2">
                {change.old !== undefined && (
                  <div>
                    <h4>Before</h4>
                    <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(change.old, null, 2)}
                    </pre>
                  </div>
                )}
                {change.new !== undefined && (
                  <div>
                    <h4>After</h4>
                    <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(change.new, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          ))}
          {changes.length > limit && (
            <button
              className="mt-3 rounded border px-3 py-2"
              onClick={() => setLimit((n) => n + 50)}
            >
              Show 50 more changes
            </button>
          )}
        </>
      )}
    </section>
  );
}
