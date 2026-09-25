import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import * as api from '../../lib/api';
import JsonEditor from '../common/JsonEditor';
import ErrorMessage from '../common/ErrorMessage';
import Breadcrumb from '../common/Breadcrumb';
import SecretValueGenerator from './SecretValueGenerator';
import { decodeSecretImport, type SecretImportPayload } from '../../lib/crypto';
import { importConfig, type ConfigFormat, type ParsedConfig } from '../../lib/config-import';

interface KvRow {
  key: string;
  value: string;
}

export default function SecretEditor() {
  const { '*': splat = '' } = useParams();
  const navigate = useNavigate();
  const isImport = window.location.pathname === '/secrets/import';
  const isNew = isImport || window.location.pathname.startsWith('/secrets/create');
  const [importPayload, setImportPayload] = useState<SecretImportPayload | null>(null);
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
  const [metaRows, setMetaRows] = useState<KvRow[]>([]);
  const [showMeta, setShowMeta] = useState(false);
  const [isKvV2, setIsKvV2] = useState<boolean | null>(null);
  const [showConfigImport, setShowConfigImport] = useState(false);
  const [configImport, setConfigImport] = useState<ParsedConfig | null>(null);
  const [configInput, setConfigInput] = useState<{ content: string; filename: string; format?: ConfigFormat }>({ content: '', filename: '' });
  const [importingFile, setImportingFile] = useState(false);
  const [pastedConfig, setPastedConfig] = useState('');
  const [pasteFormat, setPasteFormat] = useState<ConfigFormat | 'auto'>('auto');
  const [includeParentPath, setIncludeParentPath] = useState(true);

  useEffect(() => {
    if (!isImport) return;
    try {
      const encoded = window.location.hash.replace(/^#(?:vaultlens-import=)?/, '');
      const payload = decodeSecretImport(encoded);
      setImportPayload(payload);
      setPath(payload.path);
      const kvRows = Object.entries(payload.data).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
      setRows(kvRows.length > 0 ? kvRows : [{ key: '', value: '' }]);
      setJson(JSON.stringify(payload.data, null, 2));
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid import link');
    }
  }, [isImport]);

  // Load existing secret values when editing
  useEffect(() => {
    if (!isNew && splat) {
      api.readSecretValues(splat)
        .then((secret) => {
          if (secret.version === 2) setIsKvV2(true);
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

      // Load existing metadata if available (KV v2 only)
      api.getSecretMetadata(splat)
        .then((result) => {
          setIsKvV2(true);
          const customMeta = (result.data as { custom_metadata?: Record<string, string> })
            ?.custom_metadata ?? {};
          const rows = Object.entries(customMeta).map(([key, value]) => ({ key, value }));
          if (rows.length > 0) {
            setMetaRows(rows);
            setShowMeta(true);
          }
        })
        .catch(() => {
          // Not KV v2 or no permission — metadata section stays hidden
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

  useEffect(() => {
    if (!configInput.content) return;
    try {
      setConfigImport(importConfig(configInput.content, configInput.filename, configInput.format, includeParentPath));
      setError(null);
    } catch (err) {
      setConfigImport(null);
      setError(err instanceof Error ? err.message : 'Could not update imported configuration');
    }
  }, [configInput, includeParentPath]);

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

  async function handleConfigFile(file: File) {
    setImportingFile(true);
    setError(null);
    try {
      const content = await file.text();
      setConfigInput({ content, filename: file.name });
      const result = importConfig(content, file.name, undefined, includeParentPath);
      setConfigImport(result);
    } catch (err) {
      setConfigImport(null);
      setError(err instanceof Error ? err.message : 'Could not import configuration file');
    } finally {
      setImportingFile(false);
    }
  }

  function handlePastedConfig() {
    setError(null);
    try {
      const format = pasteFormat === 'auto' ? undefined : pasteFormat;
      setConfigInput({ content: pastedConfig, filename: 'pasted.config', format });
      setConfigImport(importConfig(pastedConfig, 'pasted.config', format, includeParentPath));
    } catch (err) {
      setConfigImport(null);
      setError(err instanceof Error ? err.message : 'Could not import pasted configuration');
    }
  }

  function handleParentPathChange(enabled: boolean) {
    setIncludeParentPath(enabled);
  }

  async function applyConfigImport() {
    if (!configImport) return;
    setImportingFile(true);
    setError(null);
    try {
      const writePath = `${splat}${path}`;
      let existingData: Record<string, unknown> = {};
      try {
        const existing = await api.readSecretValues(writePath);
        existingData = existing.data ?? {};
      } catch (err) {
        if (!axios.isAxiosError(err) || err.response?.status !== 404) throw err;
      }
      const mergedData = { ...existingData, ...configImport.data };
      const importedRows = Object.entries(mergedData).map(([key, value]) => ({
        key,
        value: typeof value === 'string' ? value : JSON.stringify(value),
      }));
      setRows(importedRows);
      setJson(JSON.stringify(mergedData, null, 2));
      setShowConfigImport(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not merge imported configuration');
    } finally {
      setImportingFile(false);
    }
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

      if (Object.keys(data).length === 0) {
        setError('Add at least one key\u2013value pair before saving.');
        setSaving(false);
        return;
      }

      const writePath = isNew ? `${splat}${path}` : splat;
      await api.writeSecret(writePath, data);

      // Write custom metadata if any rows provided (KV v2 only; silently skip for v1)
      if (showMeta && metaRows.some((r) => r.key.trim())) {
        const customMeta: Record<string, string> = {};
        for (const row of metaRows) {
          if (row.key.trim()) customMeta[row.key.trim()] = row.value;
        }
        try {
          await api.updateSecretMetadata(writePath, customMeta);
        } catch {
          // KV v1 or insufficient permissions — metadata write is best-effort
        }
      }

      navigate(`/secrets/view/${writePath}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      {!isNew && (
        <div className="mb-4">
          <Breadcrumb
            items={[
              { label: 'Secrets Engines', path: '/secrets' },
              ...splat.split('/').filter(Boolean).map((seg, i, arr) => ({
                label: seg,
                path:
                  i < arr.length - 1
                    ? `/secrets/${arr.slice(0, i + 1).join('/')}/`
                    : undefined,
              })),
            ]}
            copyPath={splat || undefined}
          />
        </div>
      )}
      {isImport && importPayload && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Review this imported draft{importPayload.source ? ` from ${importPayload.source}` : ''} before saving. The link is a bearer secret until it is removed from your history.
        </div>
      )}
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-800">
          {isImport ? 'Import Secret Draft' : isNew ? 'Create Secret' : 'Edit Secret'}
        </h1>
        {isNew && !isImport && (
          <button
            type="button"
            onClick={() => setShowConfigImport(!showConfigImport)}
            aria-label={showConfigImport ? 'Close bulk import' : 'Open bulk import'}
            title={showConfigImport ? 'Close bulk import' : 'Bulk import'}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-gray-300 text-[#1563ff] hover:bg-blue-50 focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
          >
            <svg className={`h-4 w-4 ${showConfigImport ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L8 8m4-4 4 4M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
            </svg>
          </button>
        )}
      </div>

      {isNew && !isImport && showConfigImport && (
        <section className="mb-6 space-y-4 rounded-md border border-gray-200 bg-gray-50 p-4" aria-labelledby="config-import-heading">
          <div>
            <h2 id="config-import-heading" className="text-sm font-semibold text-gray-800">Bulk import secret values</h2>
            <p className="mt-1 text-xs text-gray-500">Paste a large configuration or upload a file. JSON, ENV, YAML, INI, TOML, and Properties values are parsed in your browser and flattened using <span className="font-mono">__</span>.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <label htmlFor="config-paste" className="block text-xs font-medium text-gray-700">Paste configuration text</label>
              <textarea
                id="config-paste"
                value={pastedConfig}
                onChange={(event) => setPastedConfig(event.target.value)}
                placeholder={'Paste JSON, YAML, ENV, INI, TOML, or Properties text here'}
                className="min-h-56 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-xs focus:border-[#1563ff] focus:outline-none"
              />
              <div className="flex items-center gap-2">
                <label htmlFor="paste-format" className="text-xs text-gray-600">Format</label>
                <select id="paste-format" value={pasteFormat} onChange={(event) => setPasteFormat(event.target.value as ConfigFormat)} className="rounded border border-gray-300 bg-white px-2 py-1 text-xs">
                  <option value="auto">Auto-detect</option>
                  <option value="json">JSON</option>
                  <option value="env">ENV</option>
                  <option value="yaml">YAML</option>
                  <option value="ini">INI</option>
                  <option value="toml">TOML</option>
                  <option value="properties">Properties</option>
                </select>
                <button type="button" disabled={!pastedConfig.trim() || importingFile} onClick={handlePastedConfig} className="rounded-md bg-[#1563ff] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1250d4] disabled:opacity-50">
                  Parse pasted text
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-600">
                <input type="checkbox" checked={includeParentPath} onChange={(event) => handleParentPathChange(event.target.checked)} />
                Include parent/header in keys
              </label>
            </div>
            <div className="space-y-2">
              <span className="block text-xs font-medium text-gray-700">Upload configuration file</span>
              <label className="flex min-h-56 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-gray-300 bg-white px-4 py-8 text-center hover:border-[#1563ff]">
                <span className="text-sm font-medium text-gray-700">Choose a file</span>
                <span className="mt-1 text-xs text-gray-500">The file stays in your browser until Save.</span>
                <input
                  type="file"
                  accept=".json,.env,.yaml,.yml,.ini,.cfg,.toml,.properties"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleConfigFile(file);
                  }}
                />
              </label>
            </div>
          </div>
          {importingFile && <p className="text-sm text-gray-500">Reading configuration…</p>}
          {configImport && (
            <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium text-gray-800">Detected {configImport.label}</span>
                <span className="text-gray-500">{configImport.keyCount} keys · {configImport.payloadSize.toLocaleString()} bytes</span>
              </div>
              <div className="max-h-64 overflow-auto rounded border border-gray-100">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500">
                    <tr><th className="px-3 py-2 font-medium">Key</th><th className="px-3 py-2 font-medium">Value</th></tr>
                  </thead>
                  <tbody>
                    {Object.entries(configImport.data).map(([key, value]) => (
                      <tr key={key} className="border-t border-gray-100">
                        <td className="break-all px-3 py-2 font-mono text-gray-700">{key}</td>
                        <td className="break-all px-3 py-2 text-gray-600">{value || <span className="text-gray-400">(empty)</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={() => { void applyConfigImport(); }} disabled={importingFile} className="rounded-md bg-[#1563ff] px-3 py-2 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50">
                Import into editor
              </button>
            </div>
          )}
        </section>
      )}

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
                      .filter((p) => !splat || p.startsWith(splat))
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
                  className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:outline-none"
                />
                <SecretValueGenerator onInsert={(value) => updateRow(i, 'value', value)} />
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

        {/* ── Custom Metadata (KV v2 only) ── */}
        {(isKvV2 !== false) && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
            <button
              type="button"
              onClick={() => {
                if (!showMeta) {
                  setShowMeta(true);
                  if (metaRows.length === 0) setMetaRows([{ key: '', value: '' }]);
                } else {
                  setShowMeta(false);
                }
              }}
              className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-[#1563ff]"
            >
              <svg
                className={`h-3.5 w-3.5 transition-transform ${showMeta ? 'rotate-90' : ''}`}
                fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              Custom Metadata
              <span className="ml-1 text-xs font-normal text-gray-400">(KV v2 only)</span>
            </button>

            {showMeta && (
              <div className="mt-3 space-y-2">
                {metaRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="key"
                      value={row.key}
                      onChange={(e) => {
                        const updated = [...metaRows];
                        updated[i] = { ...updated[i]!, key: e.target.value };
                        setMetaRows(updated);
                      }}
                      className="w-1/3 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:outline-none"
                    />
                    <input
                      type="text"
                      placeholder="value"
                      value={row.value}
                      onChange={(e) => {
                        const updated = [...metaRows];
                        updated[i] = { ...updated[i]!, value: e.target.value };
                        setMetaRows(updated);
                      }}
                      className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:outline-none"
                    />
                    <SecretValueGenerator onInsert={(value) => {
                      const updated = [...metaRows];
                      updated[i] = { ...updated[i]!, value };
                      setMetaRows(updated);
                    }} />
                    <button
                      type="button"
                      onClick={() => setMetaRows(metaRows.filter((_, j) => j !== i))}
                      className="text-red-400 hover:text-red-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setMetaRows([...metaRows, { key: '', value: '' }])}
                  className="text-sm text-[#1563ff] hover:text-[#1250d4]"
                >
                  + Add metadata row
                </button>
              </div>
            )}
          </div>
        )}

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


