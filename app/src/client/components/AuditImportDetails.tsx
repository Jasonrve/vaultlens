import { useState } from 'react';
import type { AuditSnapshot } from '../../shared/securityAudit';

export default function AuditImportDetails({
  snapshot,
}: {
  snapshot: AuditSnapshot;
}) {
  const [filter, setFilter] = useState('');
  const [limit, setLimit] = useState(100);
  const source = snapshot.importedFrom;
  if (!source) return null;
  const rows = (snapshot.importedCoverage ?? []).filter((row) =>
    [row.namespace || 'root', row.source, row.status].some((value) =>
      value.toLowerCase().includes(filter.toLowerCase()),
    ),
  );
  return (
    <details className="rounded border p-3 text-sm">
      <summary>Imported Python snapshot · {source.scanId}</summary>
      <p className="my-2">
        Schema {source.schemaVersion} · collected {snapshot.startedAt} to{' '}
        {snapshot.finishedAt}
      </p>
      <p className="text-xs text-gray-500">
        Configuration imported for native analysis. Original Python findings and
        exception decisions are not applied.
      </p>
      {!source.collection && (
        <p className="my-2">
          Original collection scope is unknown; snapshot comparison is
          unavailable.
        </p>
      )}
      {source.collection && (
        <div className="my-2 space-y-1">
          <p>
            Policy filters:{' '}
            {source.collection.scope.policyFilters.join(', ') || 'All'}
          </p>
          <p>
            Auth mount filters:{' '}
            {source.collection.scope.authMountFilters.join(', ') || 'All'}
          </p>
          <p>
            Auth types:{' '}
            {source.collection.scope.authTypeFilters.join(', ') || 'All'}
          </p>
          <p>
            Identity:{' '}
            {source.collection.scope.skipIdentity ? 'Skipped' : 'Included'} ·
            Object limit: {source.collection.maxObjects || 'Unlimited'}
          </p>
          <p>Sources: {source.collection.sources.join(', ')}</p>
          <p>
            Recursive namespaces:{' '}
            {source.collection.recursiveNamespaces ? 'Yes' : 'No'} · Namespace
            filters: {source.collection.namespaceFilters.join(', ') || 'All'}
          </p>
        </div>
      )}
      <input
        aria-label="Filter imported coverage"
        placeholder="Filter namespace, source or status"
        className="my-2 w-full rounded border p-2"
        value={filter}
        onChange={(event) => {
          setFilter(event.target.value);
          setLimit(100);
        }}
      />
      <p className="mb-2 text-xs">
        Showing {Math.min(limit, rows.length)} of {rows.length} original
        coverage records
      </p>
      <div className="overflow-auto">
        <table className="w-full text-left">
          <thead>
            <tr>
              {[
                'Namespace',
                'Source',
                'Status',
                'Scanned / discovered',
                'Details',
              ].map((title) => (
                <th key={title} className="p-2">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((row, index) => (
              <tr key={index} className="border-t">
                <td className="p-2">{row.namespace || 'root'}</td>
                <td className="p-2">{row.source}</td>
                <td className="p-2">{row.status}</td>
                <td className="p-2">
                  {row.scanned} / {row.discovered}
                </td>
                <td className="p-2">{row.details || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > limit && (
        <button
          className="mt-2 rounded border px-3 py-2"
          onClick={() => setLimit(limit + 100)}
        >
          Load more coverage records
        </button>
      )}
    </details>
  );
}
