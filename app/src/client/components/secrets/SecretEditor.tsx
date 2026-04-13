import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import JsonEditor from '../common/JsonEditor';
import ErrorMessage from '../common/ErrorMessage';

interface KvRow {
  key: string;
  value: string;
}

export default function SecretEditor() {
  const { '*': splat = '' } = useParams();
  const navigate = useNavigate();
  const isNew = window.location.pathname.startsWith('/secrets/create');
  const [path, setPath] = useState(isNew ? '' : splat);
  const [mode, setMode] = useState<'kv' | 'json'>('kv');
  const [rows, setRows] = useState<KvRow[]>([{ key: '', value: '' }]);
  const [json, setJson] = useState('{\n  \n}');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPaths, setShowPaths] = useState(false);
  const [accessiblePaths, setAccessiblePaths] = useState<string[]>([]);
  const [loadingPaths, setLoadingPaths] = useState(false);
  const [pathSearch, setPathSearch] = useState('');

  // Load existing secret values when editing
  useEffect(() => {
    if (!isNew && splat) {
      api.readSecretValues(splat)
        .then((secret) => {
          const data = secret.data;
          if (data && typeof data === 'object' && Object.keys(data).length > 0) {
            const kvRows = Object.entries(data).map(([k, v]) => ({
              key: k,
              value: typeof v === 'string' ? v : JSON.stringify(v),
            }));
            setRows(kvRows);
            setJson(JSON.stringify(data, null, 2));
          }
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Failed to load secret values');
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (showPaths && accessiblePaths.length === 0) {
      setLoadingPaths(true);
      api.getAccessiblePaths()
        .then(setAccessiblePaths)
        .catch(() => {})
        .finally(() => setLoadingPaths(false));
    }
  }, [showPaths, accessiblePaths.length]);

  function addRow() {
    setRows([...rows, { key: '', value: '' }]);
  }

  function removeRow(index: number) {
    setRows(rows.filter((_, i) => i !== index));
  }

  function updateRow(index: number, field: 'key' | 'value', val: string) {
    const updated = [...rows];
    updated[index] = { ...updated[index], [field]: val };
    setRows(updated);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let data: Record<string, unknown>;
      if (mode === 'json') {
        data = JSON.parse(json) as Record<string, unknown>;
      } else {
        data = {};
        for (const row of rows) {
          if (row.key.trim()) {
            data[row.key.trim()] = row.value;
          }
        }
      }

      const writePath = isNew ? `${splat}${path}` : splat;
      await api.writeSecret(writePath, data);
      navigate(`/secrets/view/${writePath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-800">
        {isNew ? 'Create Secret' : 'Edit Secret'}
      </h1>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-6">
        {isNew && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              Path for this secret
            </label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500">{splat}</span>
              <input
                type="text"
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="my-secret"
                required
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
              />
            </div>
            {/* Path browser toggle */}
            <button
              type="button"
              onClick={() => setShowPaths(!showPaths)}
              className="mt-1.5 flex items-center gap-1 text-xs text-gray-500 hover:text-[#1563ff]"
              title="Browse accessible paths"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                {showPaths ? (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178zM15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                )}
              </svg>
              {showPaths ? 'Hide paths' : 'Browse accessible paths'}
            </button>
            {showPaths && (
              <div className="mt-2 rounded-md border border-gray-200 bg-gray-50">
                <div className="border-b border-gray-200 px-3 py-2">
                  <input
                    type="text"
                    placeholder="Filter paths…"
                    value={pathSearch}
                    onChange={(e) => setPathSearch(e.target.value)}
                    className="w-full rounded border border-gray-300 px-2 py-1 text-xs focus:border-[#1563ff] focus:outline-none"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {loadingPaths ? (
                    <div className="px-3 py-4 text-center text-xs text-gray-400">Loading paths…</div>
                  ) : accessiblePaths.length === 0 ? (
                    <div className="px-3 py-4 text-center text-xs text-gray-400">No accessible paths found</div>
                  ) : (
                    accessiblePaths
                      .filter((p) => !pathSearch || p.toLowerCase().includes(pathSearch.toLowerCase()))
                      .map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => {
                            // Set the path relative to the current engine prefix (splat)
                            const prefix = splat || '';
                            const relPath = p.startsWith(prefix) ? p.slice(prefix.length) : p;
                            setPath(relPath);
                            setShowPaths(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100"
                        >
                          <span className="font-mono">{p}</span>
                        </button>
                      ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMode('kv')}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === 'kv' ? 'bg-[#1563ff] text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            Key / Value
          </button>
          <button
            type="button"
            onClick={() => setMode('json')}
            className={`rounded-md px-3 py-1.5 text-sm ${mode === 'json' ? 'bg-[#1563ff] text-white' : 'bg-gray-100 text-gray-700'}`}
          >
            JSON
          </button>
        </div>

        {mode === 'kv' ? (
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="key"
                  value={row.key}
                  onChange={(e) => updateRow(i, 'key', e.target.value)}
                  className="w-1/3 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:outline-none"
                />
                <input
                  type="text"
                  placeholder="value"
                  value={row.value}
                  onChange={(e) => updateRow(i, 'value', e.target.value)}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  className="text-red-400 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addRow}
              className="text-sm text-[#1563ff] hover:text-[#1250d4]"
            >
              + Add row
            </button>
          </div>
        ) : (
          <JsonEditor value={json} onChange={setJson} />
        )}

        {error && <ErrorMessage message={error} />}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
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


