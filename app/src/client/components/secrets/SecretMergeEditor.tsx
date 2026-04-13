import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import ErrorMessage from '../common/ErrorMessage';

interface FieldState {
  key: string;
  value: string;
  modified: boolean;
}

export default function SecretMergeEditor() {
  const { '*': splat = '' } = useParams();
  const navigate = useNavigate();
  const [fields, setFields] = useState<FieldState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .readSecret(splat)
      .then((result) => {
        const data = result.data as Record<string, unknown>;
        setFields(
          Object.keys(data).map((key) => ({
            key,
            value: '********',
            modified: false,
          })),
        );
        setLoaded(true);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load secret');
      });
  }, [splat]);

  function updateField(index: number, value: string) {
    const updated = [...fields];
    updated[index] = { ...updated[index], value, modified: true };
    setFields(updated);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const changedData: Record<string, unknown> = {};
      for (const field of fields) {
        if (field.modified) {
          changedData[field.key] = field.value;
        }
      }
      if (Object.keys(changedData).length === 0) {
        setError('No fields have been modified');
        setSaving(false);
        return;
      }
      await api.mergeSecret(splat, changedData);
      navigate(`/secrets/view/${splat}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded && !error) {
    return <div className="mt-12 text-center text-gray-400">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold text-gray-800">Partial Update</h1>
      <p className="mb-6 text-sm text-gray-500">
        Only modified fields will be sent to the server. Unchanged fields retain their current values.
      </p>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        {fields.map((field, i) => (
          <div key={field.key} className="flex items-center gap-3">
            <span className="w-1/3 font-mono text-sm font-medium text-gray-700">{field.key}</span>
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                value={field.value}
                onChange={(e) => updateField(i, e.target.value)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none ${
                  field.modified
                    ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
                    : 'border-gray-300'
                }`}
              />
              {field.modified && (
                <span className="text-xs font-medium text-[#1563ff]">modified</span>
              )}
            </div>
          </div>
        ))}

        {error && <ErrorMessage message={error} />}

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Merge Changes'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

