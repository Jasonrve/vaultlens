import { useState } from 'react';
import { downloadSecurityAudit } from '../lib/api';
export default function AuditExportButton({ runId }: { runId: string }) {
  const [redactPolicySource, setRedactPolicySource] = useState(false);
  const [format, setFormat] = useState('json');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function download() {
    setBusy(true);
    setError('');
    try {
      const blob = await downloadSecurityAudit(
        runId,
        format,
        redactPolicySource,
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-${runId}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError(
        'Could not export this run. The snapshot must be finished and accessible.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <label>
          Report format{' '}
          <select
            aria-label="Audit export format"
            className="ml-2 rounded border p-2"
            value={format}
            disabled={busy}
            onChange={(event) => setFormat(event.target.value)}
          >
            {['json', 'jsonl', 'yaml', 'csv', 'zip'].map((value) => (
              <option key={value} value={value}>
                {value.toUpperCase()}
                {value === 'csv'
                  ? ' · findings only'
                  : value === 'zip'
                    ? ' · complete report'
                    : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          className="rounded border px-3 py-2 disabled:opacity-50"
          disabled={busy}
          onClick={download}
        >
          {busy ? 'Exporting…' : 'Download report'}
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2">
        <input
          type="checkbox"
          checked={redactPolicySource}
          disabled={busy || format === 'csv'}
          onChange={(event) => setRedactPolicySource(event.target.checked)}
        />
        Omit full policy source from report
      </label>
      <p className="mt-1 text-xs text-gray-500">
        Matched ACL blocks remain in findings. The saved snapshot is unchanged.
        CSV contains findings only.
      </p>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
