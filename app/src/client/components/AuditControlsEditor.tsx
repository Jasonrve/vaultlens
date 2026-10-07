import { useState } from 'react';
import { getSecurityAuditBaseline } from '../lib/api';
type Documents = { baselineYaml: string; exceptionsYaml: string };
export default function AuditControlsEditor({
  value,
  onChange,
  runId,
  disabled,
}: {
  value: Documents;
  onChange: (value: Documents) => void;
  runId: string;
  disabled: boolean;
}) {
  const [error, setError] = useState('');
  async function useBaseline() {
    try {
      onChange({
        ...value,
        baselineYaml: await getSecurityAuditBaseline(runId),
      });
      setError('');
    } catch {
      setError(
        'Cannot create a baseline from this run. Select a finished analysis.',
      );
    }
  }
  async function importFile(file: File | undefined, key: keyof Documents) {
    if (!file) return;
    if (file.size > (key === 'baselineYaml' ? 1024 * 1024 : 256 * 1024)) {
      setError('File exceeds the allowed size');
      return;
    }
    try {
      onChange({ ...value, [key]: await file.text() });
      setError('');
    } catch {
      setError('Could not read file');
    }
  }
  return (
    <details className="rounded border p-3 text-sm">
      <summary>Baseline and exceptions for the next analysis</summary>
      <p className="my-3">
        Optional. Findings remain visible. Known baseline findings and active
        exceptions do not count toward the CI severity gate.
      </p>
      <button
        className="mb-3 rounded border px-3 py-2"
        disabled={disabled || !runId}
        onClick={useBaseline}
      >
        Use selected run as baseline
      </button>
      <div className="grid gap-3 lg:grid-cols-2">
        {(['baselineYaml', 'exceptionsYaml'] as const).map((key) => (
          <label key={key}>
            {key === 'baselineYaml'
              ? 'Baseline YAML or JSON'
              : 'Exceptions YAML'}
            <input
              aria-label={`Import ${key}`}
              type="file"
              accept=".yaml,.yml,.json"
              disabled={disabled}
              onChange={(event) => importFile(event.target.files?.[0], key)}
            />
            <textarea
              aria-label={
                key === 'baselineYaml'
                  ? 'Baseline document'
                  : 'Exceptions document'
              }
              rows={8}
              className="mt-2 w-full rounded border p-2 font-mono text-xs"
              disabled={disabled}
              value={value[key]}
              onChange={(event) =>
                onChange({ ...value, [key]: event.target.value })
              }
            />
          </label>
        ))}
      </div>
      <button
        className="mt-2 rounded border px-3 py-2"
        disabled={disabled}
        onClick={() => onChange({ baselineYaml: '', exceptionsYaml: '' })}
      >
        Clear controls
      </button>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </details>
  );
}
