import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FiCheck, FiChevronDown } from 'react-icons/fi';
import type { AuditRun } from '../../shared/securityAudit';

export const hasAuditResults = (run: AuditRun) =>
  ['completed', 'partial'].includes(run.status);

function Status({ run }: { run: AuditRun }) {
  const color =
    run.status === 'completed'
      ? 'bg-green-50 text-green-700'
      : run.status === 'partial'
        ? 'bg-amber-50 text-amber-800'
        : 'bg-slate-100 text-slate-600';
  return (
    <span className={`rounded px-2 py-0.5 text-xs capitalize ${color}`}>
      {run.status}
    </span>
  );
}

export default function AuditResultPicker({
  runs,
  current,
  selectedId,
  loading,
  onSelect,
}: {
  runs: AuditRun[];
  current?: AuditRun;
  selectedId: string;
  loading: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const choices = runs.filter(hasAuditResults);
  const latest = choices[0]?.id;
  useEffect(() => {
    setOpen(false);
  }, [selectedId]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div className="space-y-3 text-sm">
      <div
        ref={container}
        className="rounded-lg border border-slate-200 bg-white"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            setOpen(false);
            trigger.current?.focus();
          }
        }}
      >
        <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0" aria-live="polite">
            <div className="mb-1 text-xs text-slate-500">
              Viewing audit result
            </div>
            {current ? (
              <>
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-base font-semibold">
                    {new Date(current.startedAt).toLocaleString()}
                  </span>
                  <Status run={current} />
                  {current.id === latest && (
                    <span className="text-xs text-blue-600">Latest</span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                  <span>Run {current.id.slice(0, 8)}</span>
                  <span>
                    {current.snapshotId
                      ? `Snapshot ${current.snapshotId.slice(0, 8)}`
                      : 'No saved snapshot'}
                  </span>
                </div>
              </>
            ) : (
              <span>
                {loading
                  ? 'Loading run…'
                  : selectedId
                    ? 'Selected run unavailable'
                    : 'No analyzed runs yet'}
              </span>
            )}
          </div>
          <button
            ref={trigger}
            type="button"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-blue-700 hover:border-blue-300 hover:bg-blue-50 disabled:opacity-50"
            aria-expanded={open}
            aria-controls="audit-result-choices"
            disabled={!choices.length}
            onClick={() => setOpen(!open)}
          >
            Change run <FiChevronDown aria-hidden="true" />
          </button>
        </div>
        {open && (
          <div
            id="audit-result-choices"
            className="border-t border-slate-200 p-2"
          >
            <div className="px-3 py-2 text-xs text-slate-500">
              Select an analyzed run
            </div>
            <div className="max-h-80 overflow-y-auto">
              {choices.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  aria-pressed={run.id === selectedId}
                  className={`flex w-full items-center justify-between gap-3 rounded-md p-3 text-left ${run.id === selectedId ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                  onClick={() => {
                    onSelect(run.id);
                    setOpen(false);
                    trigger.current?.focus();
                  }}
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2.5">
                      <span className="font-medium">
                        {new Date(run.startedAt).toLocaleString()}
                      </span>
                      <Status run={run} />
                      {run.id === latest && (
                        <span className="text-xs text-blue-600">Latest</span>
                      )}
                    </span>
                    <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>{run.findingCount} findings</span>
                      <span>{run.issueCount} coverage gaps</span>
                      <span>Run {run.id.slice(0, 8)}</span>
                    </span>
                  </span>
                  <span className="w-4 shrink-0 text-blue-600">
                    {run.id === selectedId && <FiCheck aria-hidden="true" />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-slate-500">
          {current?.status === 'running'
            ? 'Audit in progress'
            : 'Saved results · no live collection'}
        </span>
        <Link
          className="text-blue-700 hover:underline"
          to={`/security-audit/runs${selectedId ? `?${new URLSearchParams({ run: selectedId })}` : ''}`}
        >
          View run history →
        </Link>
      </div>
    </div>
  );
}
