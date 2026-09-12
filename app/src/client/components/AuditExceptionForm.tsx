import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createAuditObjectException } from '../lib/api';
import type { AuditFinding } from '../../shared/securityAudit';
export default function AuditExceptionForm({
  runId,
  index,
  finding,
}: {
  runId: string;
  index: number;
  finding: AuditFinding;
}) {
  const [open, setOpen] = useState(false),
    [owner, setOwner] = useState(''),
    [reason, setReason] = useState(''),
    [expires, setExpires] = useState('');
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      createAuditObjectException({
        runId,
        findingIndex: index,
        owner,
        reason,
        expires,
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ['audit-object-exceptions'] }),
  });
  const error = save.error as {
    response?: { data?: { error?: string } };
    message?: string;
  } | null;
  if (save.isSuccess)
    return (
      <p
        role="status"
        className="rounded border border-blue-200 bg-blue-50 p-3"
      >
        Exception saved for future analyses. Reanalyze this snapshot to apply
        it; this historical result is unchanged.
      </p>
    );
  return (
    <div className="space-y-3">
      <button
        className="rounded border px-3 py-2"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Exclude this object
      </button>
      {open && (
        <form
          className="space-y-3 rounded border p-4"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <p className="break-all text-xs">
            Exact scope: {finding.ruleId} · {finding.namespace || 'root'} ·{' '}
            {finding.path}
          </p>
          <label className="block">
            Owner
            <input
              required
              maxLength={200}
              className="mt-1 block w-full rounded border p-2 placeholder:text-slate-400"
              placeholder="Platform team"
              value={owner}
              onChange={(event) => setOwner(event.target.value)}
            />
          </label>
          <label className="block">
            Reason
            <textarea
              required
              maxLength={2000}
              className="mt-1 block w-full rounded border p-2 placeholder:text-slate-400"
              placeholder="Why this exception is needed and how the risk is controlled"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <label className="block">
            Expires
            <input
              type="date"
              required
              className="mt-1 block rounded border p-2"
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="text-red-700">
              {error.response?.data?.error ?? error.message}
            </p>
          )}
          <button
            disabled={save.isPending}
            className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save exception'}
          </button>
        </form>
      )}
    </div>
  );
}
