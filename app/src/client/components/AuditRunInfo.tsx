import { auditPollingInterval } from '../lib/requestBackoff';
import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSecurityAuditRun,
  getSecurityAuditRuns,
  reanalyzeSecurityAudit,
} from '../lib/api';

const display = (value: unknown): string =>
  value === undefined || value === null
    ? 'Unavailable'
    : Array.isArray(value)
      ? value.length
        ? value.join(', ')
        : 'All'
      : typeof value === 'boolean'
        ? value
          ? 'Yes'
          : 'No'
        : String(value);
function Fields({ values }: { values: [string, unknown][] }) {
  return (
    <dl className="grid gap-3 text-sm sm:grid-cols-2">
      {values.map(([label, value]) => (
        <div key={label}>
          <dt className="text-gray-500">{label}</dt>
          <dd className="break-words">{display(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
export default function AuditRunInfo({
  runId,
  onClose,
}: {
  runId: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const navigate = useNavigate(),
    client = useQueryClient();
  const runs = useQuery({
    queryKey: ['security-audit-runs'],
    queryFn: getSecurityAuditRuns,
    refetchInterval: (query) => auditPollingInterval(!!query.state.data?.some((run) => run.status === 'running')),
  });
  const reanalyze = useMutation({
    mutationFn: () =>
      reanalyzeSecurityAudit(runId, { baselineYaml: '', exceptionsYaml: '' }),
    onSuccess: (result) => {
      client.invalidateQueries({ queryKey: ['security-audit-runs'] });
      onClose();
      navigate(
        `/security-audit/findings?${new URLSearchParams({ run: result.id })}`,
      );
    },
  });
  const reanalyzeError = reanalyze.error as {
    response?: { data?: { error?: string } };
    message?: string;
  } | null;
  const running = runs.data?.some((run) => run.status === 'running');
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const query = useQuery({
    queryKey: ['security-audit-run', runId],
    queryFn: () => getSecurityAuditRun(runId),
    refetchInterval: (q) =>
      q.state.data?.run.status === 'running' ? auditPollingInterval(true) : false,
  });
  const detail = query.data,
    run = detail?.run,
    collection = detail?.snapshot?.collection;
  const policy = collection?.requestPolicy as
    | Record<string, unknown>
    | undefined;
  const issues = [
    ...(detail?.snapshot?.issues ?? []),
    ...(detail?.configuration?.issues ?? []),
  ];
  const duration = run?.finishedAt
    ? (new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime()) /
      1000
    : undefined;
  return (
    <dialog
      ref={ref}
      aria-labelledby="audit-run-info-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-y-0 left-auto right-0 m-0 h-full max-h-full w-full max-w-xl overflow-y-auto border-l bg-white p-6 text-gray-900 shadow-xl backdrop:bg-black/40"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="audit-run-info-title" className="text-lg font-semibold">
          Run info
        </h2>
        <button
          autoFocus
          onClick={onClose}
          className="rounded border px-3 py-2 text-sm"
        >
          Close
        </button>
      </div>
      <p className="my-3 break-all font-mono text-xs text-gray-500">{runId}</p>
      {query.isPending && <p>Loading run details…</p>}
      {query.error && (
        <p role="alert" className="text-sm text-red-700">
          Could not load this run.
        </p>
      )}
      {run && (
        <div className="space-y-6">
          <Fields
            values={[
              ['Vault', run.target],
              ['Status', run.status],
              ['Operation', run.operation],
              ['Snapshot ID', run.snapshotId],
              ['Started', new Date(run.startedAt).toLocaleString()],
              [
                'Finished',
                run.finishedAt
                  ? new Date(run.finishedAt).toLocaleString()
                  : 'Not finished',
              ],
              [
                'Run duration',
                duration === undefined
                  ? 'Not finished'
                  : `${duration.toFixed(2)} s`,
              ],
              ['Resources', run.resourceCount],
              ['Findings', run.findingCount],
              ['Coverage gaps', run.issueCount],
            ]}
          />
          {detail?.snapshot &&
            ['collected', 'completed', 'partial'].includes(run.status) && (
              <div className="rounded border p-3 text-sm">
                <button
                  className="rounded border px-3 py-2 disabled:opacity-50"
                  disabled={
                    reanalyze.isPending ||
                    !!running ||
                    runs.isPending ||
                    !!runs.error
                  }
                  onClick={() => reanalyze.mutate()}
                >
                  {reanalyze.isPending ? 'Starting…' : 'Reanalyze snapshot'}
                </button>
                <p className="mt-2 text-xs text-gray-500">
                  Creates a new run from this saved snapshot using current saved
                  checks and exceptions. Does not collect fresh Vault data;
                  collection timestamps remain unchanged.
                </p>
                {running && (
                  <p role="status" className="mt-2 text-xs">
                    Another audit is running. Wait for it to finish.
                  </p>
                )}
                {runs.error && (
                  <p role="alert" className="mt-2 text-red-700">
                    Could not check active runs. Try again once the run list is
                    available.
                  </p>
                )}
                {reanalyzeError && (
                  <p role="alert" className="mt-2 text-red-700">
                    {reanalyzeError.response?.data?.error ??
                      reanalyzeError.message}
                  </p>
                )}
              </div>
            )}
          {run.failureReason && (
            <p role="alert" className="text-sm text-red-700">
              {run.failureReason}
            </p>
          )}
          {run.progress && run.status === 'running' && (
            <p role="status" className="text-sm">
              {run.progress.phase} · {run.progress.resources} resources ·{' '}
              {run.progress.requests} requests
            </p>
          )}
          {detail?.snapshot?.sourceRunId && (
            <p className="text-sm">
              Source run:{' '}
              <Link
                onClick={onClose}
                className="break-all text-blue-700 underline"
                to={`/security-audit/runs?${new URLSearchParams({ run: detail.snapshot.sourceRunId })}`}
              >
                {detail.snapshot.sourceRunId}
              </Link>
            </p>
          )}
          {detail?.snapshot?.refresh && (
            <div>
              <h3 className="mb-3 font-medium">Selective refresh</h3>
              <Fields
                values={[
                  ['Refreshed sources', detail.snapshot.refresh.sources],
                  [
                    'Retained resources',
                    detail.snapshot.refresh.retainedResources,
                  ],
                  ['Retained data from', detail.snapshot.refresh.retainedFrom],
                ]}
              />
            </div>
          )}
          {collection ? (
            <>
              <div>
                <h3 className="mb-3 font-medium">
                  Collection scope and limits
                </h3>
                <Fields
                  values={[
                    [
                      'Namespace',
                      policy?.namespace === '' ? 'root' : policy?.namespace,
                    ],
                    ['Include child namespaces', policy?.recursiveNamespaces],
                    ['Namespace filters', policy?.namespaceFilters],
                    ['Policy filters', collection.scope?.policyFilters],
                    ['Auth mount filters', collection.scope?.authMountFilters],
                    ['Auth type filters', collection.scope?.authTypeFilters],
                    ['Skip Identity', collection.scope?.skipIdentity],
                    ['Workers', collection.workers],
                    ['Requests per second', policy?.requestsPerSecond],
                    ['Retries per request', policy?.retries],
                    ['Request timeout (ms)', policy?.timeoutMs],
                    ['Duration limit (ms)', policy?.maxDurationMs],
                    [
                      'Object limit',
                      policy?.maxObjects === 0
                        ? 'Unlimited'
                        : policy?.maxObjects,
                    ],
                    ['Omit full policy source', policy?.redactPolicySource],
                  ]}
                />
              </div>
              <div>
                <h3 className="mb-3 font-medium">Collection metrics</h3>
                <Fields
                  values={[
                    ['Requests', collection.metrics.requests],
                    ['Retries', collection.metrics.retries],
                    [
                      'Rate-limit wait (ms)',
                      Math.round(collection.metrics.rateWaitMs),
                    ],
                    [
                      'Retry wait (ms)',
                      Math.round(collection.metrics.retryWaitMs),
                    ],
                  ]}
                />
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">
              No collection parameters were recorded for this snapshot.
            </p>
          )}
          <div>
            <h3 className="mb-3 font-medium">Coverage and errors</h3>
            {issues.length ? (
              <ul className="space-y-2 text-sm">
                {issues.map((issue, index) => (
                  <li key={index} className="break-words text-amber-800">
                    {issue.namespace || 'root'} · {issue.path}: {issue.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-gray-500">
                {run.issueCount
                  ? 'Detailed coverage issues are unavailable.'
                  : run.status === 'completed'
                    ? 'No recorded coverage gaps.'
                    : 'No coverage issues recorded so far; this does not establish a complete collection.'}
              </p>
            )}
          </div>
          <details className="rounded border p-3 text-sm">
            <summary>Technical details</summary>
            {detail?.configuration && (
              <div className="mt-3 space-y-3">
                <Fields
                  values={[
                    ['Configuration revision', detail.configuration.revision],
                    ['Engine version', detail.configuration.engineVersion],
                  ]}
                />
                <h4 className="font-medium">Saved check configuration</h4>
                <pre className="whitespace-pre-wrap break-all text-xs">
                  {detail.configuration.configYaml}
                </pre>
              </div>
            )}
            <pre className="mt-3 whitespace-pre-wrap break-all text-xs">
              {JSON.stringify(
                {
                  run,
                  collection,
                  sourceRunId: detail?.snapshot?.sourceRunId,
                  refresh: detail?.snapshot?.refresh,
                },
                null,
                2,
              )}
            </pre>
          </details>
        </div>
      )}
    </dialog>
  );
}
