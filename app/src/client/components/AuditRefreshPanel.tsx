import { useState } from 'react';
import { isAxiosError } from 'axios';
import { refreshSecurityAudit } from '../lib/api';
const choices = {
  policies: 'Policies',
  identity: 'Identity entities and groups',
  identity_aliases: 'Identity aliases',
  auth_roles: 'Auth roles',
  mounts: 'Mounts',
};
export default function AuditRefreshPanel({
  runId,
  disabled,
  controls,
  onRefreshed,
}: {
  runId: string;
  disabled: boolean;
  controls: { baselineYaml: string; exceptionsYaml: string };
  onRefreshed: (id: string) => void;
}) {
  const [sources, setSources] = useState(['policies']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setBusy(true);
    setError('');
    try {
      const result = await refreshSecurityAudit(runId, sources, controls);
      onRefreshed(result.id);
    } catch (error) {
      setError(
        isAxiosError(error) && typeof error.response?.data?.error === 'string'
          ? error.response.data.error
          : 'Could not start refresh.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded border p-3 text-sm">
      <summary>Refresh selected sources</summary>
      <p className="my-2 text-xs text-gray-500">
        Creates a new result using the saved collection scope, saved checks and
        object exceptions. Unrefreshed data remains from the previous snapshot.
        Auth role discovery reads auth mounts; refreshing mounts also reads auth
        roles.
      </p>
      <div className="my-3 flex flex-wrap gap-3">
        {Object.entries(choices).map(([key, label]) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={sources.includes(key)}
              disabled={disabled || busy}
              onChange={(event) =>
                setSources((current) =>
                  event.target.checked
                    ? [...current, key]
                    : current.filter((value) => value !== key),
                )
              }
            />{' '}
            {label}
          </label>
        ))}
      </div>
      <button
        className="rounded border px-3 py-2 disabled:opacity-50"
        disabled={disabled || busy || !sources.length}
        onClick={refresh}
      >
        {busy ? 'Starting…' : 'Refresh snapshot'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </details>
  );
}
