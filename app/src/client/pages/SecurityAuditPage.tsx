import { isAxiosError } from 'axios';
import { auditPollingInterval } from '../lib/requestBackoff';
import AuditFindings from '../components/AuditFindings';
import AuditResumeButton from '../components/AuditResumeButton';
import AuditImportDetails from '../components/AuditImportDetails';
import AuditRunDialog from '../components/AuditRunDialog';
import { Link, useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import AuditResultPicker, {
  hasAuditResults,
} from '../components/AuditResultPicker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getSecurityAuditRuns,
  getSecurityAuditRun,
  startSecurityAudit,
} from '../lib/api';
const collectionInput =
  'min-h-[42px] w-full min-w-0 rounded-md border border-[#dce3ed] bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500';
export default function SecurityAuditPage() {
  const [recoveredRun, setRecoveredRun] = useState<{
    missing: string;
    latest: string;
  } | null>(null);
  const [recursiveNamespaces, setRecursiveNamespaces] = useState(false);
  const [namespace, setNamespace] = useState('');
  const [scopeText, setScopeText] = useState({
    namespaceFilters: '',
    policyFilters: '',
    authMountFilters: '',
    authTypeFilters: '',
  });
  const [redactPolicySource, setRedactPolicySource] = useState(false);
  const [skipIdentity, setSkipIdentity] = useState(false);
  const patterns = (text: string) =>
    text
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
  const controlDocuments = { baselineYaml: '', exceptionsYaml: '' };
  const [collectionOptions, setCollectionOptions] = useState({
    workers: 10,
    requestsPerSecond: 10,
    retries: 3,
    retryBackoffMs: 500,
    timeoutMs: 30000,
    maxDurationMs: 7200000,
    maxObjects: 0,
  });
  const [params, setParams] = useSearchParams();
  const collecting = params.get('collect') === '1';
  const closeCollection = () =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('collect');
        return next;
      },
      { replace: true },
    );
  const selected = params.get('run') ?? '';
  const setSelected = (run: string) => setParams({ run });
  const queryClient = useQueryClient();
  const runs = useQuery({
    queryKey: ['security-audit-runs'],
    queryFn: getSecurityAuditRuns,
    refetchInterval: (query) =>
      auditPollingInterval(
        !!query.state.data?.some((run) => run.status === 'running'),
      ),
  });
  const latestId = runs.data?.find(hasAuditResults)?.id;
  useEffect(() => {
    if (!selected && latestId)
      setParams(
        (current) => {
          if (current.get('run')) return current;
          const next = new URLSearchParams(current);
          next.set('run', latestId);
          return next;
        },
        { replace: true },
      );
  }, [selected, latestId, setParams]);
  const id = selected || latestId || '';
  const detail = useQuery({
    queryKey: ['security-audit-run', id],
    queryFn: () => getSecurityAuditRun(id),
    enabled: !!id,
    retry: (attempt, error) =>
      !isAxiosError(error) ||
      ![401, 403, 404, 429].includes(error.response?.status ?? 0)
        ? attempt < 1
        : false,
    refetchInterval: (q) =>
      q.state.data?.run.status === 'running'
        ? auditPollingInterval(true)
        : false,
  });
  const start = useMutation({
    mutationFn: () =>
      startSecurityAudit(
        {
          ...collectionOptions,
          namespace,
          namespaceFilters: patterns(scopeText.namespaceFilters),
          policyFilters: patterns(scopeText.policyFilters),
          authMountFilters: patterns(scopeText.authMountFilters),
          authTypeFilters: patterns(scopeText.authTypeFilters),
          skipIdentity,
          redactPolicySource,
          recursiveNamespaces,
        },
        controlDocuments,
      ),
    onSuccess: (result) => {
      setSelected(result.id);
      queryClient.invalidateQueries({ queryKey: ['security-audit-runs'] });
    },
  });
  const running = runs.data?.some((r) => r.status === 'running');
  const issues = [
    ...(detail.data?.snapshot?.issues ?? []),
    ...(detail.data?.configuration?.issues ?? []),
  ];
  const runMissing =
    isAxiosError(detail.error) && detail.error.response?.status === 404;
  const { refetch: refreshRuns } = runs;
  useEffect(() => {
    if (!runMissing) return;
    let cancelled = false;
    // Refresh the list before recovering from a deleted or stale run link.
    void refreshRuns().then((result) => {
      const latest = !result.isError
        ? result.data?.find((run) => run.id !== id && hasAuditResults(run))
        : undefined;
      if (cancelled || !latest) return;
      setRecoveredRun({ missing: id, latest: latest.id });
      setParams(
        (current) => {
          if (current.get('run') !== id) return current;
          const next = new URLSearchParams(current);
          next.set('run', latest.id);
          return next;
        },
        { replace: true },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [runMissing, id, refreshRuns, setParams]);
  const error =
    runs.error || (!runMissing ? detail.error : null) || start.error;
  const errorStatus = isAxiosError(error) ? error.response?.status : undefined;
  const errorMessage =
    errorStatus === 403
      ? 'Audit access requires root or vaultlens-admin.'
      : errorStatus === 401
        ? 'Your session is no longer valid. Sign in again.'
        : errorStatus === 429
          ? 'Too many requests. Please wait before trying again.'
          : errorStatus && errorStatus >= 500
            ? 'The audit service is temporarily unavailable. Try again shortly.'
            : error?.message;
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Findings</h2>
          <p className="mt-2 text-sm text-gray-500">
            Collect a configuration snapshot and review policy assignments and
            authentication risks.
          </p>
        </div>
        <button
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={
            !!running || start.isPending || runs.isPending || !!runs.error
          }
          onClick={() => {
            start.reset();
            setParams((current) => {
              const next = new URLSearchParams(current);
              next.set('collect', '1');
              return next;
            });
          }}
        >
          {running
            ? 'Audit running…'
            : start.isPending
              ? 'Starting…'
              : 'Run audit'}
        </button>
      </div>
      <AuditRunDialog
        connection={runs.data?.[0]?.target}
        open={collecting}
        onClose={closeCollection}
        onStart={() => start.mutate()}
        busy={start.isPending}
        disabled={
          !!running || start.isPending || runs.isPending || !!runs.error
        }
        error={
          start.error?.message ||
          runs.error?.message ||
          (running
            ? 'Another audit is running. Wait for it to finish.'
            : undefined)
        }
      >
        <section data-collection-section="scope">
          <label className="flex flex-col gap-2">
            Vault namespace
            <input
              aria-label="Vault namespace"
              className={collectionInput}
              placeholder="Root namespace"
              value={namespace}
              onChange={(event) => setNamespace(event.target.value)}
            />
            <span className="text-xs text-slate-500">
              Leave empty to use the root namespace.
            </span>
          </label>
          <label className="mt-4 flex items-center gap-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 accent-blue-600"
              checked={recursiveNamespaces}
              onChange={(event) => setRecursiveNamespaces(event.target.checked)}
            />
            Include child namespaces
          </label>
          <div className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="font-medium">Filters</h3>
            <p className="mb-4 mt-1 text-xs text-slate-500">
              Glob patterns, one per line: * matches any sequence, ? one
              character, [abc] a character set. Not regex. Empty fields include
              everything.
            </p>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {(
                [
                  [
                    'namespaceFilters',
                    'Namespaces',
                    'e.g. engineering/*\nroot',
                  ],
                  ['policyFilters', 'Policies', 'e.g. lab-atlas-*'],
                  ['authMountFilters', 'Auth mounts', 'e.g. lab-approle-*'],
                  ['authTypeFilters', 'Auth types', 'e.g. approle\nkubernetes'],
                ] as const
              ).map(([key, label, placeholder]) => (
                <label key={key} className="flex min-w-0 flex-col gap-2">
                  {label}
                  <textarea
                    aria-label={label + ' filter'}
                    rows={2}
                    placeholder={placeholder}
                    className={collectionInput + ' resize-y'}
                    value={scopeText[key]}
                    onChange={(event) =>
                      setScopeText((current) => ({
                        ...current,
                        [key]: event.target.value,
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Use “root” for the root namespace. Auth mount patterns omit the
              trailing slash.
            </p>
          </div>
        </section>
        <section data-collection-section="limits">
          <p className="mb-5 text-slate-500">
            Control the load on Vault and how long collection can run.
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {(
              [
                ['workers', 'Concurrent workers', 1, 32, 1, 1, ''],
                [
                  'requestsPerSecond',
                  'Request rate',
                  0.1,
                  1000,
                  0.1,
                  1,
                  'req/s',
                ],
                [
                  'timeoutMs',
                  'Request timeout',
                  0.001,
                  86400,
                  'any',
                  1000,
                  'sec',
                ],
                [
                  'maxDurationMs',
                  'Collection time limit',
                  1 / 60000,
                  1440,
                  'any',
                  60000,
                  'min',
                ],
                ['retries', 'Retries per request', 0, 10, 1, 1, ''],
                [
                  'retryBackoffMs',
                  'Initial retry delay',
                  0,
                  10000,
                  100,
                  1,
                  'ms',
                ],
                ['maxObjects', 'Maximum objects', 0, 10000000, 1, 1, ''],
              ] as const
            ).map(([key, label, min, max, step, scale, unit]) => (
              <label
                key={key}
                className={`flex min-w-0 flex-col gap-2 ${key === 'maxObjects' ? 'mt-1 border-t border-slate-200 pt-5 sm:col-span-2' : ''}`}
              >
                {label}
                <span className="flex items-center rounded-md border border-[#dce3ed] bg-white focus-within:ring-2 focus-within:ring-blue-500">
                  <input
                    required
                    type="number"
                    aria-label={label}
                    min={min}
                    max={max}
                    step={step}
                    className="min-h-[42px] w-full min-w-0 rounded-md bg-transparent px-3 py-2.5 outline-none"
                    value={collectionOptions[key] / scale}
                    onChange={(event) =>
                      setCollectionOptions((current) => ({
                        ...current,
                        [key]:
                          scale === 1
                            ? Number(event.target.value)
                            : Math.round(Number(event.target.value) * scale),
                      }))
                    }
                  />
                  {unit && (
                    <span className="whitespace-nowrap pr-3 text-slate-500">
                      {unit}
                    </span>
                  )}
                </span>
                {key === 'maxObjects' && (
                  <span className="text-xs text-slate-500">
                    0 means unlimited. A collection stopped at this limit is
                    marked incomplete.
                  </span>
                )}
              </label>
            ))}
          </div>
        </section>
        <section data-collection-section="snapshot">
          <label className="flex items-start gap-3 border-b border-slate-200 pb-5">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
              checked={!skipIdentity}
              onChange={(event) => setSkipIdentity(!event.target.checked)}
            />
            <span className="flex flex-col gap-2">
              <span>Include Identity</span>
              <span className="text-xs text-slate-500">
                Collect entities, groups and aliases to analyze policy
                assignments.
              </span>
              {skipIdentity && (
                <span className="text-xs text-amber-700">
                  Identity checks will have incomplete coverage.
                </span>
              )}
            </span>
          </label>
          <label className="mt-5 flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 shrink-0 accent-blue-600"
              checked={!redactPolicySource}
              onChange={(event) => setRedactPolicySource(!event.target.checked)}
            />
            <span className="flex flex-col gap-2">
              <span>Save full policy source</span>
              <span className="text-xs text-slate-500">
                Keep policy definitions for later analysis with updated checks.
              </span>
              {redactPolicySource && (
                <span className="text-xs text-amber-700">
                  Initial analysis still runs. Matched blocks are retained, but
                  later analysis will have coverage gaps.
                </span>
              )}
            </span>
          </label>
          <p className="mt-6 border-t border-slate-200 pt-5 text-xs text-slate-500">
            Missing permissions and unavailable data are reported as coverage
            gaps.
          </p>
        </section>
      </AuditRunDialog>
      {error && (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-3 text-red-800"
        >
          {errorMessage}
        </p>
      )}
      {recoveredRun?.latest === id && (
        <p
          role="status"
          className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950"
        >
          The requested run <code>{recoveredRun.missing}</code> is no longer
          available. Showing the latest available audit result instead.
        </p>
      )}
      {!id && runs.isSuccess && !latestId && (
        <p
          role="status"
          className="rounded-lg border border-slate-200 p-4 text-sm text-slate-600"
        >
          No analyzed runs are available yet. Use Run audit to collect data and
          create your first result.
        </p>
      )}
      {runMissing && (
        <section
          role="status"
          className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          <h3 className="font-medium">This audit run is no longer available</h3>
          <p>
            Run <code className="break-all">{id}</code> was not found for this
            Vault connection. It may have been deleted or the link may refer to
            another connection. This is not an authorization error.
          </p>
          <div className="flex flex-wrap gap-3">
            {latestId && latestId !== id && (
              <button
                type="button"
                className="rounded-md bg-blue-600 px-3 py-2 text-white"
                onClick={() => setSelected(latestId)}
              >
                Open latest result
              </button>
            )}
            <Link
              className="rounded-md border border-amber-300 bg-white px-3 py-2"
              to="/security-audit/runs"
            >
              View available runs
            </Link>
          </div>
        </section>
      )}
      <div className="space-y-4">
        <AuditResultPicker
          runs={runs.data ?? []}
          current={
            runMissing
              ? undefined
              : (detail.data?.run ?? runs.data?.find((run) => run.id === id))
          }
          selectedId={id}
          loading={runs.isPending || (!!id && detail.isPending)}
          onSelect={setSelected}
        />
        <section className="min-w-0 space-y-4">
          {detail.data && !runMissing && (
            <>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['Resources', detail.data.run.resourceCount],
                  ['Findings', detail.data.run.findingCount],
                  ['Coverage gaps', detail.data.run.issueCount],
                ].map(([label, count]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-gray-200 bg-white p-4"
                  >
                    <div className="text-xs text-gray-500">{label}</div>
                    <div className="mt-1 text-2xl font-semibold">{count}</div>
                  </div>
                ))}
              </div>
              {['failed', 'interrupted'].includes(detail.data.run.status) && (
                <p role="alert" className="text-red-700">
                  {detail.data.run.failureReason ||
                    'This run did not finish and has no valid completed snapshot.'}
                </p>
              )}
              {detail.data.snapshot?.checkpoint &&
                ['failed', 'interrupted'].includes(detail.data.run.status) && (
                  <p className="text-sm">
                    Checkpoint retained from{' '}
                    {detail.data.snapshot.checkpoint.savedAt}:{' '}
                    {detail.data.snapshot.resources.length} resources.
                    Collection did not finish.
                  </p>
                )}
              {detail.data.snapshot?.checkpoint &&
                ['failed', 'interrupted'].includes(detail.data.run.status) && (
                  <AuditResumeButton
                    key={`resume:${id}`}
                    runId={id}
                    disabled={!!running}
                    controls={controlDocuments}
                    onResumed={(id) => {
                      setSelected(id);
                      queryClient.invalidateQueries({
                        queryKey: ['security-audit-runs'],
                      });
                    }}
                  />
                )}
              {detail.data.run.status === 'running' && (
                <p className="text-sm text-gray-600">
                  {detail.data.run.progress
                    ? `${detail.data.run.progress.phase} · namespace ${detail.data.run.progress.namespace || 'root'} · ${detail.data.run.progress.resources} resources · ${detail.data.run.progress.requests} requests`
                    : 'Audit is running in the background. You can leave this page.'}
                </p>
              )}
              {!!issues.length && (
                <details
                  className="rounded-lg border border-amber-300 bg-amber-50 p-4"
                  open
                >
                  <summary className="font-medium text-amber-900">
                    Incomplete coverage — unavailable data is not a passing
                    check
                  </summary>
                  <ul className="mt-2 space-y-1 text-sm">
                    {issues.map((issue, i) => (
                      <li key={i}>
                        <code>{issue.path}</code>: {issue.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {detail.data.snapshot?.analysisPerformed !== false && (
                <AuditFindings key={id} detail={detail.data} />
              )}
              {detail.data.snapshot && (
                <AuditImportDetails
                  key={`import:${id}`}
                  snapshot={detail.data.snapshot}
                />
              )}

              {detail.data.snapshot?.analysisPerformed === false && (
                <p className="rounded border p-3 text-sm">
                  Configuration collected. Audit rules have not been run for
                  this snapshot. Analyze this saved snapshot to evaluate it.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
