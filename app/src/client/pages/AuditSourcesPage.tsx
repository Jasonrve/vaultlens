import AuditPagination from '../components/AuditPagination';
import { auditPollingInterval } from '../lib/requestBackoff';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import AuditSnapshotInfo from '../components/AuditSnapshotInfo';
import AuditRunDialog from '../components/AuditRunDialog';
import {
  analyzeAuditSnapshot,
  getAuditInventory,
  getAuditRetention,
  setAuditRetention,
  getSecurityAuditRun,
  getSecurityAuditRuns,
  updateAuditInventory,
} from '../lib/api';

const sources = {
  policies: { label: 'Policies', kinds: ['policy'] },
  identity: { label: 'Identity entities & groups', kinds: ['entity', 'group'] },
  identity_aliases: { label: 'Identity aliases', kinds: ['alias'] },
  auth_roles: {
    label: 'Auth mounts & roles · includes Token roles',
    kinds: ['auth-mount', 'role'],
  },
  mounts: {
    label: 'Secret mounts · PKI & Transit configuration',
    kinds: ['secret-mount', 'pki-role', 'pki-issuer', 'transit-key'],
  },
};
const field =
  'block w-full min-w-0 rounded-md border border-slate-200 bg-white p-2.5 text-sm';
const button =
  'rounded-md border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-40';
const primary =
  'rounded-md bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-40';
const date = (s?: string | null) =>
  s ? new Date(s).toLocaleString() : 'Never';
const short = (s: string) => s.slice(0, 8);
const patterns = (s: string) =>
  s
    .split('\n')
    .map((v) => v.trim())
    .filter(Boolean);
export default function AuditSourcesPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [snapshotSize, setSnapshotSize] = useState(10);
  const [snapshotRequested, setSnapshotPage] = useState(1);
  const [historySize, setHistorySize] = useState(10);
  const [historyRequested, setHistoryPage] = useState(1);
  const [tab, setTab] = useState('Inventory');
  const [inspectSnapshot, setInspectSnapshot] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(Object.keys(sources));
  const [analyze, setAnalyze] = useState(false);
  const [scope, setScope] = useState({
    namespace: '',
    namespaceFilters: '',
    policyFilters: '',
    authMountFilters: '',
    authTypeFilters: '',
  });
  const [recursive, setRecursive] = useState(false);
  const [limits, setLimits] = useState({
    maxObjects: 0,
    requestsPerSecond: 10,
    workers: 10,
    retries: 3,
    retryBackoffMs: 500,
    timeoutMs: 30000,
    maxDurationMs: 7200000,
  });
  const [redact, setRedact] = useState(false);
  const [activeJob, setActiveJob] = useState('');
  const inventory = useQuery({
    queryKey: ['audit-inventory'],
    queryFn: getAuditInventory,
    refetchInterval: () => auditPollingInterval(false),
  });
  const retention = useQuery({
    queryKey: ['audit-retention'],
    queryFn: getAuditRetention,
  });
  const saveRetention = useMutation({
    mutationFn: setAuditRetention,
    onSuccess: (result) => {
      client.setQueryData(['audit-retention'], result);
      client.invalidateQueries({ queryKey: ['security-audit-runs'] });
      client.invalidateQueries({ queryKey: ['security-audit-run'] });
    },
  });
  const runs = useQuery({
    queryKey: ['security-audit-runs'],
    queryFn: getSecurityAuditRuns,
    refetchInterval: (query) =>
      auditPollingInterval(
        !!query.state.data?.some((run) => run.status === 'running'),
      ),
  });
  const running = runs.data?.find((r) => r.status === 'running');
  const jobId = running?.id || activeJob;
  const job = useQuery({
    queryKey: ['security-audit-run', jobId],
    queryFn: () => getSecurityAuditRun(jobId),
    enabled: !!jobId,
    refetchInterval: (q) =>
      q.state.data?.run.status === 'running'
        ? auditPollingInterval(true)
        : false,
  });
  useEffect(() => {
    if (job.data?.run.finishedAt) {
      client.invalidateQueries({ queryKey: ['audit-inventory'] });
      client.invalidateQueries({ queryKey: ['security-audit-runs'] });
    }
  }, [job.data?.run.finishedAt, client]);
  const invalidate = () => {
    client.invalidateQueries({ queryKey: ['audit-inventory'] });
    client.invalidateQueries({ queryKey: ['security-audit-runs'] });
  };
  const update = useMutation({
    mutationFn: () =>
      updateAuditInventory(
        {
          ...limits,
          namespace: scope.namespace,
          namespaceFilters: patterns(scope.namespaceFilters),
          policyFilters: patterns(scope.policyFilters),
          authMountFilters: patterns(scope.authMountFilters),
          authTypeFilters: patterns(scope.authTypeFilters),
          recursiveNamespaces: recursive,
          sources: selected,
          redactPolicySource: redact,
        },
        analyze,
      ),
    onSuccess: ({ id }) => {
      setActiveJob(id);
      setOpen(false);
      setTab('Update history');
      invalidate();
    },
  });
  const analysis = useMutation({
    mutationFn: analyzeAuditSnapshot,
    onSuccess: ({ id }) => {
      invalidate();
      navigate(`/security-audit/findings?run=${id}`);
    },
  });
  const busy = !!running || update.isPending || analysis.isPending;
  const unavailable =
    busy ||
    inventory.isPending ||
    !!inventory.error ||
    runs.isPending ||
    !!runs.error;
  const data = inventory.data;
  const saved = data?.snapshot;
  const startUpdate = () => {
    const policy = saved?.collection?.requestPolicy as
      | Record<string, unknown>
      | undefined;
    if (policy) {
      setScope({
        namespace: String(policy.namespace ?? ''),
        ...Object.fromEntries(
          [
            'namespaceFilters',
            'policyFilters',
            'authMountFilters',
            'authTypeFilters',
          ].map((key) => [
            key,
            Array.isArray(policy[key])
              ? (policy[key] as string[]).join('\n')
              : '',
          ]),
        ),
      } as typeof scope);
      setRecursive(policy.recursiveNamespaces === true);
      setRedact(policy.redactPolicySource === true);
      setLimits(
        (prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([key, value]) => [
              key,
              typeof policy[key] === 'number' ? policy[key] : value,
            ]),
          ) as typeof limits,
      );
    }
    update.reset();
    setOpen(true);
  };
  const failure = update.error || analysis.error;
  const error = failure
    ? isAxiosError(failure) && typeof failure.response?.data?.error === 'string'
      ? failure.response.data.error
      : 'Could not start the operation.'
    : '';
  const snapshotTotal = data?.snapshots.length ?? 0;
  const snapshotPage = Math.min(
    snapshotRequested,
    Math.max(1, Math.ceil(snapshotTotal / snapshotSize)),
  );
  const history = runs.data?.filter((r) => r.operation !== 'analyze') ?? [];
  const historyPage = Math.min(
    historyRequested,
    Math.max(1, Math.ceil(history.length / historySize)),
  );
  return (
    <section className="space-y-5">
      <h2 className="text-lg font-semibold">Sources</h2>
      {(inventory.error || runs.error) && (
        <p role="alert" className="text-red-700">
          Could not load inventory or jobs.{' '}
          <button className={button} onClick={invalidate}>
            Retry
          </button>
        </p>
      )}
      {inventory.isPending && <p>Loading inventory…</p>}
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-medium">Current Vault connection</h3>
            <p className="mt-1 break-all font-mono text-sm">
              {data?.target ?? 'Loading…'}
            </p>
          </div>
          <button
            className={button}
            onClick={() => setTab('Connection & storage')}
          >
            Connection & storage
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>Authentication: current session</span>
          <span>Storage: VaultLens server · SQLite</span>
          <span>
            Latest snapshot:{' '}
            {data?.current ? short(data.current.id) : 'Not collected'}
          </span>
        </div>
      </div>
      <nav aria-label="Source management" className="flex flex-wrap gap-2">
        {[
          'Inventory',
          'Snapshots',
          'Update history',
          'Connection & storage',
        ].map((name) => (
          <button
            key={name}
            aria-current={tab === name ? 'page' : undefined}
            className={`${button} ${tab === name ? 'border-blue-200 text-blue-700' : ''}`}
            onClick={() => setTab(name)}
          >
            {name}
          </button>
        ))}
      </nav>
      {job.data && (
        <div role="status" className="rounded-md bg-slate-50 p-3 text-sm">
          Job {short(job.data.run.id)} · {job.data.run.status}
          {job.data.run.status === 'running'
            ? ` · ${job.data.run.progress?.phase ?? 'Starting'} · ${job.data.run.resourceCount} objects`
            : ''}
          {job.data.run.failureReason && (
            <p className="mt-1 text-red-700">{job.data.run.failureReason}</p>
          )}{' '}
          <Link
            className="text-blue-700 underline"
            to={`/security-audit/runs?run=${job.data.run.id}`}
          >
            View job
          </Link>
        </div>
      )}
      {tab === 'Inventory' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-medium">Local inventory</h3>
              <p className="mt-1 text-xs text-slate-500">
                {data?.current?.resourceCount ?? 0} objects · last update{' '}
                {date(data?.current?.createdAt)}
              </p>
            </div>
            <button
              className={primary}
              disabled={unavailable || !selected.length}
              onClick={startUpdate}
            >
              Update inventory
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-500">
                <tr>
                  <th className="p-3">
                    <label>
                      <input
                        type="checkbox"
                        aria-label="Select all resource types"
                        className="mr-2 accent-blue-600"
                        checked={
                          selected.length === Object.keys(sources).length
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked ? Object.keys(sources) : [],
                          )
                        }
                      />
                      Resource type
                    </label>
                  </th>
                  <th className="p-3">Objects</th>
                  <th className="p-3">Last observed</th>
                  <th className="p-3">Retained from earlier reads</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(sources).map(([key, value]) => {
                  const resources =
                    saved?.resources.filter((r) =>
                      value.kinds.includes(r.kind),
                    ) ?? [];
                  const observed = resources
                    .map(
                      (r) =>
                        r.observedAt ||
                        r.retainedFromSnapshotAt ||
                        saved?.finishedAt ||
                        '',
                    )
                    .filter(Boolean)
                    .sort();
                  return (
                    <tr key={key} className="border-b border-slate-200">
                      <td className="p-3">
                        <label>
                          <input
                            type="checkbox"
                            className="mr-2 accent-blue-600"
                            checked={selected.includes(key)}
                            onChange={(e) =>
                              setSelected((prev) =>
                                e.target.checked
                                  ? [...prev, key]
                                  : prev.filter((x) => x !== key),
                              )
                            }
                          />
                          {value.label}
                        </label>
                      </td>
                      <td className="p-3">{resources.length}</td>
                      <td className="p-3 text-xs">
                        {observed.length ? (
                          <>
                            {date(observed[0])}
                            {observed[0] !== observed.at(-1) && (
                              <>
                                <br />
                                to {date(observed.at(-1))}
                              </>
                            )}
                          </>
                        ) : (
                          'Not observed'
                        )}
                      </td>
                      <td className="p-3">
                        {
                          resources.filter((r) => r.retainedFromSnapshotAt)
                            .length
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              {selected.length} resource types selected
            </p>
            <button
              className={button}
              disabled={unavailable || !data?.current}
              onClick={() => data?.current && analysis.mutate(data.current.id)}
            >
              Analyze latest snapshot
            </button>
          </div>
          <p className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
            Updates add new objects and refresh selected data. Other objects
            retain their original observation time. Existing snapshots and audit
            results never change.
          </p>
          {!!saved?.issues.length && (
            <details className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
              <summary>{saved.issues.length} collection coverage gaps</summary>
              <ul className="mt-2 space-y-1">
                {saved.issues.map((issue, i) => (
                  <li key={i} className="break-words">
                    {issue.namespace || 'root'} · {issue.path}: {issue.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {tab === 'Snapshots' && (
        <>
          <h3 className="font-medium">Saved snapshots</h3>
          {inspectSnapshot && (
            <AuditSnapshotInfo
              id={inspectSnapshot}
              onClose={() => setInspectSnapshot('')}
            />
          )}
          <p className="text-xs text-slate-500">
            Latest 100 snapshots. Deleting an analysis run does not delete its
            source snapshot.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  {['Snapshot', 'Created', 'Objects', 'State', ''].map((v) => (
                    <th key={v} className="p-3">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.snapshots
                  .slice(
                    (snapshotPage - 1) * snapshotSize,
                    snapshotPage * snapshotSize,
                  )
                  .map((s) => (
                    <tr key={s.id} className="border-b border-slate-200">
                      <td className="p-3 font-mono text-xs">
                        <button
                          className="text-blue-700 underline"
                          onClick={() => setInspectSnapshot(s.id)}
                        >
                          {short(s.id)}
                        </button>
                        {data.current?.id === s.id && (
                          <span className="ml-2 text-blue-700">Latest</span>
                        )}
                        <p className="font-sans text-slate-500">{s.origin}</p>
                      </td>
                      <td className="p-3 text-xs">{date(s.createdAt)}</td>
                      <td className="p-3">{s.resourceCount}</td>
                      <td className="p-3 text-xs">
                        {s.issueCount} gaps · {s.retainedCount} retained
                      </td>
                      <td className="p-3">
                        <button
                          className={button}
                          disabled={unavailable}
                          onClick={() => analysis.mutate(s.id)}
                        >
                          Analyze
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <AuditPagination
            page={snapshotPage}
            total={snapshotTotal}
            size={snapshotSize}
            onChange={setSnapshotPage}
            onSizeChange={setSnapshotSize}
          />
          {!data?.snapshots.length && (
            <p className="text-sm text-slate-500">No saved snapshots yet.</p>
          )}
        </>
      )}
      {tab === 'Update history' && (
        <>
          <h3 className="font-medium">Collection jobs</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  {['Started', 'Status', 'Objects', 'Changes', ''].map((v) => (
                    <th key={v} className="p-3">
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history
                  .slice(
                    (historyPage - 1) * historySize,
                    historyPage * historySize,
                  )
                  .map((r) => {
                    const s = data?.snapshots.find(
                      (s) => s.sourceJobId === r.id,
                    );
                    return (
                      <tr key={r.id} className="border-b border-slate-200">
                        <td className="p-3 text-xs">
                          {date(r.startedAt)}
                          <p className="text-slate-500">{r.operation}</p>
                        </td>
                        <td className="p-3">{r.status}</td>
                        <td className="p-3">{r.resourceCount}</td>
                        <td className="p-3 text-xs">
                          {s
                            ? `+${s.changes.added} added · ${s.changes.changed} changed · ${s.changes.absent} absent`
                            : '—'}
                        </td>
                        <td className="p-3">
                          <Link
                            className="text-blue-700 underline"
                            to={`/security-audit/runs?run=${r.id}`}
                          >
                            Info
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
          <AuditPagination
            page={historyPage}
            total={history.length}
            size={historySize}
            onChange={setHistoryPage}
            onSizeChange={setHistorySize}
          />
          <p className="text-xs text-slate-500">
            Collection runs on the backend. Closing the browser does not stop an
            active job. Server shutdown or token expiry can interrupt
            collection.
          </p>
        </>
      )}
      {tab === 'Connection & storage' && (
        <div className="space-y-5 text-sm">
          <div>
            <h3 className="font-medium">Local database</h3>
            <p className="mt-2 break-all font-mono text-xs">
              {data?.storagePath}
            </p>
            <p className="mt-2 text-slate-500">
              Inventory, snapshots and runs are stored on the VaultLens backend
              host, not in your browser.
            </p>
          </div>
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-medium">Authentication & background updates</h3>
            <p className="mt-2 text-slate-500">
              Manual jobs use your current Vault session. The server must remain
              running and the token must remain valid.
            </p>
            <p className="mt-2 text-slate-500">
              Scheduled updates are not configured. Unattended operation
              requires a dedicated server credential; browser tokens are not
              saved for future jobs.
            </p>
          </div>
          <div className="border-t border-slate-200 pt-4">
            <h3 className="font-medium">Retention</h3>
            <label className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                checked={retention.data?.enabled ?? false}
                disabled={!retention.data || saveRetention.isPending}
                onChange={(event) => saveRetention.mutate(event.target.checked)}
              />
              Auto-cleanup runs
            </label>
            <p className="mt-2 text-slate-500">
              Keep the latest 100 finished runs for this Vault connection,
              including failed, interrupted and collection-only runs. Older runs
              are deleted when enabled and after each run finishes. Running
              jobs, snapshots and current inventory are retained.
            </p>
            {(retention.error || saveRetention.error) && (
              <p role="alert" className="mt-2 text-red-700">
                Could not save or load cleanup settings. Try again.
              </p>
            )}
            {saveRetention.isSuccess && (
              <p role="status" className="mt-2 text-xs text-slate-500">
                {saveRetention.data.enabled
                  ? 'Auto-cleanup enabled.'
                  : 'Auto-cleanup disabled.'}{' '}
                {saveRetention.data.deleted} old runs deleted.
              </p>
            )}
          </div>
        </div>
      )}
      {error && !open && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      <AuditRunDialog
        open={open}
        onClose={() => setOpen(false)}
        onStart={() => update.mutate()}
        busy={update.isPending}
        disabled={unavailable || !selected.length}
        error={error}
        connection={data?.target}
        title="Update local inventory"
        description="Refresh selected configuration and save a new immutable snapshot."
        submitLabel={analyze ? 'Update & analyze' : 'Update inventory'}
      >
        <div data-collection-section="scope">
          <p className="mb-4 text-xs text-slate-500">
            {selected
              .map((key) => sources[key as keyof typeof sources].label)
              .join(' · ')}
          </p>
          <label className="block text-sm">
            Vault namespace
            <input
              className={`${field} mt-2`}
              value={scope.namespace}
              placeholder="Root namespace"
              onChange={(e) =>
                setScope({ ...scope, namespace: e.target.value })
              }
            />
          </label>
          <label className="mt-4 block text-sm">
            <input
              type="checkbox"
              className="mr-2 accent-blue-600"
              checked={recursive}
              onChange={(e) => setRecursive(e.target.checked)}
            />
            Include child namespaces
          </label>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {(
              [
                ['namespaceFilters', 'Namespaces'],
                ['policyFilters', 'Policies'],
                ['authMountFilters', 'Auth mounts'],
                ['authTypeFilters', 'Auth types'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="min-w-0 text-sm">
                {label}
                <textarea
                  aria-label={`${label} filter`}
                  className={`${field} mt-2`}
                  rows={2}
                  placeholder={
                    {
                      namespaceFilters: 'engineering/*\nroot',
                      policyFilters: 'team-*-read',
                      authMountFilters: 'approle*',
                      authTypeFilters: 'approle\nkubernetes',
                    }[key]
                  }
                  value={scope[key as keyof typeof scope]}
                  onChange={(e) =>
                    setScope({ ...scope, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">
            Glob patterns, one per line: * matches any sequence, ? one
            character, [abc] a character set. Not regex. Empty includes
            everything. Use root for the root namespace. Auth mount names omit
            the trailing slash. Filters limit this update; objects outside the
            scope remain in the inventory. Refreshing secret mounts also
            discovers auth roles.
          </p>
        </div>
        <div data-collection-section="limits">
          <div className="grid gap-5 sm:grid-cols-2">
            {Object.entries(limits).map(([key, value]) => (
              <label key={key} className="min-w-0 text-sm">
                {
                  {
                    maxObjects: 'Maximum objects (0 = unlimited)',
                    requestsPerSecond: 'Requests per second',
                    workers: 'Concurrent workers',
                    retries: 'Retries per request',
                    retryBackoffMs: 'Retry delay (ms)',
                    timeoutMs: 'Request timeout (ms)',
                    maxDurationMs: 'Collection duration limit (ms)',
                  }[key]
                }
                <input
                  className={`${field} mt-2`}
                  type="number"
                  required
                  min={
                    ['maxObjects', 'retries', 'retryBackoffMs'].includes(key)
                      ? 0
                      : 1
                  }
                  value={value}
                  onChange={(e) =>
                    setLimits({ ...limits, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>
        </div>
        <div data-collection-section="snapshot">
          <label className="block">
            <input
              className="mr-2 accent-blue-600"
              type="checkbox"
              checked={!redact}
              onChange={(e) => setRedact(!e.target.checked)}
            />
            Save full policy source
          </label>
          <p className="mt-2 text-xs text-slate-500">
            Required for complete offline policy analysis. No secret values or
            authentication tokens are stored.
          </p>
          <label className="mt-6 block">
            <input
              className="mr-2 accent-blue-600"
              type="checkbox"
              checked={analyze}
              onChange={(e) => setAnalyze(e.target.checked)}
            />
            Analyze after update
          </label>
          <p className="mt-2 text-xs text-slate-500">
            Uses the latest saved checks and object exceptions. Existing
            analysis results are unchanged.
          </p>
        </div>
      </AuditRunDialog>
    </section>
  );
}
