import { useState } from 'react';
import { isAxiosError } from 'axios';
import { resumeSecurityAudit } from '../lib/api';

export default function AuditResumeButton({
  runId,
  disabled,
  controls,
  onResumed,
}: {
  runId: string;
  disabled: boolean;
  controls: { baselineYaml: string; exceptionsYaml: string };
  onResumed: (id: string) => void;
}) {
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function resume() {
    setBusy(true);
    setError('');
    try {
      const result = await resumeSecurityAudit(
        runId,
        hours * 3600000,
        controls,
      );
      onResumed(result.id);
    } catch (error) {
      setError(
        isAxiosError(error) && typeof error.response?.data?.error === 'string'
          ? error.response.data.error
          : 'Could not resume this checkpoint.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded border p-3 text-sm">
      <label>
        Maximum checkpoint age (hours)
        <input
          aria-label="Maximum checkpoint age in hours"
          type="number"
          min={1}
          max={168}
          className="mx-2 w-24 rounded border p-2"
          value={hours}
          disabled={disabled || busy}
          onChange={(event) => setHours(Number(event.target.value))}
        />
      </label>
      <button
        className="rounded border px-3 py-2 disabled:opacity-50"
        disabled={
          disabled ||
          busy ||
          !Number.isInteger(hours) ||
          hours < 1 ||
          hours > 168
        }
        onClick={resume}
      >
        {busy ? 'Starting…' : 'Resume collection'}
      </button>
      <p className="mt-2 text-xs text-gray-500">
        Creates a new run using saved collection settings, current audit rules
        and the controls selected above. Incomplete namespaces are collected
        again.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
