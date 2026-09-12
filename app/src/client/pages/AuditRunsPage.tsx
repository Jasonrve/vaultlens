import AuditPagination, { AuditPageSize } from '../components/AuditPagination';
import { hasAuditResults } from '../components/AuditResultPicker';
import { auditPollingInterval } from '../lib/requestBackoff';
import AuditRunInfo from '../components/AuditRunInfo';
import AuditDiffPanel from '../components/AuditDiffPanel';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSecurityAuditRuns, deleteSecurityAuditRuns } from '../lib/api';

const rowActionClass =
  'inline-flex h-9 w-16 shrink-0 items-center justify-center rounded-md border border-slate-200 text-sm';

export default function AuditRunsPage() {
  const [params, setParams] = useSearchParams();
  const client = useQueryClient();
  const [notice, setNotice] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const runs = useQuery({
    queryKey: ['security-audit-runs'],
    queryFn: getSecurityAuditRuns,
    refetchInterval: (query) =>
      auditPollingInterval(
        !!query.state.data?.some((run) => run.status === 'running'),
      ),
  });
  const [requested, setPage] = useState(1),
    [size, setSize] = useState(10);
  const [selected, setSelected] = useState<string[]>([]);
  const [comparison, setComparison] = useState<{
    oldId: string;
    currentId: string;
  } | null>(null);
  const eligible =
    runs.data?.filter((run) => ['completed', 'partial'].includes(run.status)) ??
    [];
  const selectedRuns = eligible
    .filter((run) => selected.includes(run.id))
    .sort(
      (a, b) =>
        a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id),
    );
  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );
    setComparison(null);
  }
  const total = runs.data?.length ?? 0;
  const page = Math.min(requested, Math.max(1, Math.ceil(total / size)));
  const selectable = useMemo(
    () =>
      runs.data
        ?.filter((run) => run.status !== 'running')
        .map((run) => run.id) ?? [],
    [runs.data],
  );
  const selectAll = useRef<HTMLInputElement>(null);
  const allSelected =
    selectable.length > 0 && selectable.every((id) => selected.includes(id));
  useEffect(() => {
    if (selectAll.current)
      selectAll.current.indeterminate =
        !allSelected && selectable.some((id) => selected.includes(id));
  }, [allSelected, selectable, selected]);
  const remove = useMutation({
    mutationFn: deleteSecurityAuditRuns,
    onSuccess: (result, ids) => {
      setSelected([]);
      setComparison(null);
      if (info && ids.includes(info)) setInfo(null);
      if (ids.includes(params.get('run') ?? ''))
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            next.delete('run');
            return next;
          },
          { replace: true },
        );
      for (const id of ids)
        client.removeQueries({ queryKey: ['security-audit-run', id] });
      client.removeQueries({ queryKey: ['security-audit-diff'] });
      client.invalidateQueries({ queryKey: ['security-audit-runs'] });
      setNotice(
        `${result.deleted} runs deleted. Vault configuration is unchanged.`,
      );
    },
  });
  const deletionError = remove.error as {
    response?: { data?: { error?: string } };
    message?: string;
  } | null;
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Runs</h2>
        <Link
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white"
          to="/security-audit/findings?collect=1"
        >
          Run audit
        </Link>
      </div>
      <p className="text-sm text-gray-500">
        Open a saved run to review its findings, coverage and collection
        details.
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>
          {selected.length} selected · select exactly two analyzed runs to
          compare
        </span>
        <button
          className="rounded border px-3 py-2 disabled:opacity-40"
          disabled={
            selected.length !== 2 ||
            selectedRuns.length !== 2 ||
            remove.isPending
          }
          onClick={() =>
            setComparison({
              oldId: selectedRuns[0].id,
              currentId: selectedRuns[1].id,
            })
          }
        >
          Compare
        </button>
        <button
          className="rounded border border-red-300 px-3 py-2 text-red-700 disabled:opacity-40"
          disabled={
            !selected.length ||
            remove.isPending ||
            !!runs.data?.some((run) => run.status === 'running')
          }
          onClick={() => {
            if (
              window.confirm(
                `Delete ${selected.length} selected runs and their analysis results? This cannot be undone. Saved snapshots, the current inventory and Vault configuration will be kept.`,
              )
            )
              remove.mutate([...selected]);
          }}
        >
          {remove.isPending ? 'Deleting…' : 'Delete'}
        </button>
        {!!selected.length && (
          <button
            disabled={remove.isPending}
            className="rounded border px-3 py-2"
            onClick={() => {
              setSelected([]);
              setComparison(null);
            }}
          >
            Clear selection
          </button>
        )}
      </div>
      {notice && (
        <p role="status" className="text-sm text-blue-700">
          {notice}
        </p>
      )}
      {deletionError && (
        <p role="alert" className="text-sm text-red-700">
          {deletionError.response?.data?.error ?? deletionError.message}
        </p>
      )}
      {runs.data?.some((run) => run.status === 'running') && (
        <p className="text-sm text-gray-500">
          Deletion is available after the active audit finishes.
        </p>
      )}
      {comparison && (
        <>
          <p className="text-sm text-gray-500">
            Before:{' '}
            {eligible.find((run) => run.id === comparison.oldId)?.startedAt
              ? new Date(
                  eligible.find(
                    (run) => run.id === comparison.oldId,
                  )!.startedAt,
                ).toLocaleString()
              : comparison.oldId}{' '}
            → After:{' '}
            {eligible.find((run) => run.id === comparison.currentId)?.startedAt
              ? new Date(
                  eligible.find(
                    (run) => run.id === comparison.currentId,
                  )!.startedAt,
                ).toLocaleString()
              : comparison.currentId}
          </p>
          <AuditDiffPanel
            key={`${comparison.oldId}:${comparison.currentId}`}
            oldId={comparison.oldId}
            currentId={comparison.currentId}
          />
        </>
      )}
      {runs.isPending && <p>Loading runs…</p>}
      {runs.error && (
        <p role="alert">
          Could not refresh audit runs. Previously loaded results remain
          visible. If the server is rate-limiting requests, updates will resume
          after its cooldown.
        </p>
      )}
      {runs.data?.length === 0 && (
        <p>
          No runs yet.{' '}
          <Link
            className="text-blue-700 underline"
            to="/security-audit/findings?collect=1"
          >
            Start the first audit
          </Link>
          .
        </p>
      )}
      {!!runs.data?.length && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-gray-500">
              Most recent runs · up to 100 retained in this list
            </p>
            <AuditPageSize
              size={size}
              onChange={(value) => {
                setSize(value);
                setPage(1);
              }}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="p-3">
                    <label className="flex items-center gap-2">
                      <input
                        ref={selectAll}
                        type="checkbox"
                        aria-label="Select all listed runs"
                        checked={allSelected}
                        disabled={!selectable.length || remove.isPending}
                        onChange={(event) => {
                          setSelected(event.target.checked ? selectable : []);
                          setComparison(null);
                        }}
                      />
                      Select
                    </label>
                  </th>
                  <th className="p-3">Collected</th>
                  <th className="p-3">Vault</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Resources</th>
                  <th className="p-3">Findings</th>
                  <th className="p-3">Coverage gaps</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runs.data.slice((page - 1) * size, page * size).map((run) => (
                  <tr
                    key={run.id}
                    className={`border-t border-slate-200 ${selected.includes(run.id) ? 'bg-blue-50 hover:bg-blue-100' : 'bg-white hover:bg-slate-50'}`}
                    aria-selected={selected.includes(run.id)}
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Select run ${new Date(run.startedAt).toLocaleString()} · ${run.id.slice(0, 8)}`}
                        checked={selected.includes(run.id)}
                        disabled={run.status === 'running' || remove.isPending}
                        onChange={() => toggle(run.id)}
                      />
                    </td>
                    <td className="p-3">
                      <span>{new Date(run.startedAt).toLocaleString()}</span>
                      {params.get('run') === run.id && hasAuditResults(run) && (
                        <span className="mt-1 block text-xs text-blue-600">
                          Viewing
                        </span>
                      )}
                    </td>
                    <td className="p-3">{run.target}</td>
                    <td className="p-3">{run.status}</td>
                    <td className="p-3">{run.resourceCount}</td>
                    <td className="p-3">{run.findingCount}</td>
                    <td className="p-3">{run.issueCount}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label={`Info for run ${run.id.slice(0, 8)}`}
                          className={`${rowActionClass} text-slate-700 hover:bg-slate-50`}
                          onClick={() => setInfo(run.id)}
                        >
                          Info
                        </button>
                        {hasAuditResults(run) ? (
                          <Link
                            aria-label={`Show findings for run ${run.id.slice(0, 8)}`}
                            className={`${rowActionClass} text-blue-700 hover:border-blue-300 hover:bg-blue-50`}
                            to={`/security-audit/findings?${new URLSearchParams({ run: run.id })}`}
                          >
                            Show
                          </Link>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className={`${rowActionClass} cursor-not-allowed text-slate-400`}
                            title={
                              run.status === 'running'
                                ? 'Audit in progress'
                                : 'No analysis results'
                            }
                            aria-label={`Show findings unavailable: ${run.status === 'running' ? 'audit in progress' : 'not analyzed'}`}
                          >
                            Show
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <AuditPagination
            page={page}
            total={total}
            size={size}
            onChange={setPage}
          />
        </>
      )}
      {info && (
        <AuditRunInfo key={info} runId={info} onClose={() => setInfo(null)} />
      )}
    </section>
  );
}
