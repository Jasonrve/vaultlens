import { useQuery } from '@tanstack/react-query';
import { getSavedAuditSnapshot } from '../lib/api';

export default function AuditSnapshotInfo({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  const query = useQuery({
    queryKey: ['audit-snapshot', id],
    queryFn: () => getSavedAuditSnapshot(id),
  });
  const saved = query.data;
  const options = saved?.snapshot.collection?.requestPolicy as
    | Record<string, unknown>
    | undefined;
  const text = (value: unknown) =>
    Array.isArray(value)
      ? value.join(', ') || 'All'
      : String(value ?? 'Unavailable');
  return (
    <section
      className="rounded-lg border border-slate-200 p-4 text-sm"
      aria-label="Snapshot details"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-medium">Snapshot {id.slice(0, 8)}</h3>
        <button className="text-blue-700" onClick={onClose}>
          Close details
        </button>
      </div>
      {query.isPending && <p className="mt-3">Loading snapshot…</p>}
      {query.error && (
        <p role="alert" className="mt-3 text-red-700">
          Could not load snapshot details.
        </p>
      )}
      {saved && (
        <>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              [
                'Collection started',
                new Date(saved.snapshot.startedAt).toLocaleString(),
              ],
              [
                'Collection finished',
                new Date(saved.snapshot.finishedAt).toLocaleString(),
              ],
              ['Parent snapshot', saved.info.parentId ?? 'Initial collection'],
              [
                'Namespaces',
                saved.snapshot.namespaces?.map((v) => v || 'root'),
              ],
              ['Sources refreshed', options?.sources],
              ['Policy filters', options?.policyFilters],
              ['Auth mount filters', options?.authMountFilters],
              ['Auth type filters', options?.authTypeFilters],
              ['Namespace filters', options?.namespaceFilters],
              ['Retained objects', saved.info.retainedCount],
            ].map(([name, value]) => (
              <div key={String(name)}>
                <dt className="text-xs text-slate-500">{String(name)}</dt>
                <dd className="mt-1 break-all">{text(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-slate-500">
            This is an immutable set of API observations, not an atomic Vault
            storage backup. Retained objects keep their earlier read times.
          </p>
          {!saved.snapshot.policiesComplete && (
            <p className="mt-3 text-xs text-amber-800">
              Policy coverage is incomplete for this update. Absence-based
              policy checks are limited.
            </p>
          )}
        </>
      )}
    </section>
  );
}
