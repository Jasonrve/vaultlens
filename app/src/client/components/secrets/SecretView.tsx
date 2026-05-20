import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import Breadcrumb from '../common/Breadcrumb';
import Badge from '../common/Badge';

interface SecretMetadata {
  created_time?: string;
  current_version?: number;
  max_versions?: number;
  oldest_version?: number;
  updated_time?: string;
  custom_metadata?: Record<string, string> | null;
  versions?: Record<string, { created_time: string; deletion_time: string; destroyed: boolean }>;
}

const KNOWN_LINK_BRANDS: { pattern: RegExp; label: string; icon: string }[] = [
  {
    pattern: /argo/i,
    label: 'Argo CD',
    icon: 'https://raw.githubusercontent.com/argoproj/argo-cd/master/docs/assets/argo.png',
  },
  {
    pattern: /rancher/i,
    label: 'Rancher',
    icon: 'https://raw.githubusercontent.com/rancher/rancher/master/ui/public/assets/images/logos/rancher-logo-cow-blue.svg',
  },
  {
    pattern: /backstage/i,
    label: 'Backstage',
    icon: 'https://raw.githubusercontent.com/backstage/backstage/master/microsite/static/img/logo.svg',
  },
  {
    pattern: /roadie/i,
    label: 'Roadie',
    icon: 'https://roadie.io/static/roadie-vert-logo-5e13a30eabb5f8f0e06d4a5dbadd01f6.svg',
  },
];

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function getLinkBrand(value: string): (typeof KNOWN_LINK_BRANDS)[number] | null {
  for (const brand of KNOWN_LINK_BRANDS) {
    if (brand.pattern.test(value)) return brand;
  }
  return null;
}

export default function SecretView() {
  const { '*': splat = '' } = useParams();
  const navigate = useNavigate();
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<SecretMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataRows, setMetadataRows] = useState<{ key: string; value: string }[]>([]);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string> | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [loadingValues, setLoadingValues] = useState(false);

  useEffect(() => {
    api
      .readSecret(splat)
      .then((result) => {
        setFieldKeys(result.keys ?? []);
        setVersion(result.version);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'An error occurred'))
      .finally(() => setLoading(false));
  }, [splat]);

  useEffect(() => {
    if (version === 2 || version === null) {
      setMetadataLoading(true);
      api
        .getSecretMetadata(splat)
        .then((result) => {
          const md = result.data as SecretMetadata;
          setMetadata(md);
        })
        .catch(() => {
          // Metadata not available (KV v1 or insufficient permissions)
        })
        .finally(() => setMetadataLoading(false));
    }
  }, [splat, version]);

  async function handleDelete() {
    if (!confirm('Delete this secret?')) return;
    try {
      await api.deleteSecret(splat);
      const parentPath = splat.split('/').slice(0, -1).join('/');
      navigate(`/secrets/${parentPath ? parentPath + '/' : ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    }
  }

  async function ensureValuesLoaded() {
    if (secretValues !== null) return secretValues;
    setLoadingValues(true);
    try {
      const result = await api.readSecretValues(splat);
      const vals: Record<string, string> = {};
      for (const [k, v] of Object.entries(result.data)) {
        vals[k] = typeof v === 'string' ? v : JSON.stringify(v);
      }
      setSecretValues(vals);
      return vals;
    } catch {
      return null;
    } finally {
      setLoadingValues(false);
    }
  }

  async function toggleReveal(key: string) {
    const vals = await ensureValuesLoaded();
    if (!vals) return;
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function revealAll() {
    const vals = await ensureValuesLoaded();
    if (!vals) return;
    setRevealedKeys(new Set(fieldKeys));
  }

  function hideAll() {
    setRevealedKeys(new Set());
  }

  function startEditMetadata() {
    const existing = metadata?.custom_metadata ?? {};
    const rows = Object.entries(existing).map(([key, value]) => ({ key, value }));
    if (rows.length === 0) rows.push({ key: '', value: '' });
    setMetadataRows(rows);
    setEditingMetadata(true);
    setMetadataError(null);
  }

  function cancelEditMetadata() {
    setEditingMetadata(false);
    setMetadataError(null);
  }

  async function saveMetadata() {
    setSavingMetadata(true);
    setMetadataError(null);
    try {
      const customMeta: Record<string, string> = {};
      for (const row of metadataRows) {
        if (row.key.trim()) {
          customMeta[row.key.trim()] = row.value;
        }
      }
      await api.updateSecretMetadata(splat, customMeta);
      // Refresh metadata
      const result = await api.getSecretMetadata(splat);
      setMetadata(result.data as SecretMetadata);
      setEditingMetadata(false);
    } catch (e: unknown) {
      setMetadataError(e instanceof Error ? e.message : 'Failed to save metadata');
    } finally {
      setSavingMetadata(false);
    }
  }

  const segments = splat.split('/').filter(Boolean);
  const breadcrumbItems = [
    { label: 'Secrets Engines', path: '/secrets' },
    ...segments.map((seg, i) => ({
      label: seg,
      path:
        i < segments.length - 1
          ? `/secrets/${segments.slice(0, i + 1).join('/')}/`
          : undefined,
    })),
  ];

  if (loading) return <LoadingSpinner className="mt-12" />;
  if (error) return <ErrorMessage message={error} />;
  if (!fieldKeys.length && !loading) return <ErrorMessage message="No data found" />;

  const customMetadata = metadata?.custom_metadata;
  const hasCustomMetadata = customMetadata && Object.keys(customMetadata).length > 0;

  // Extract links from custom metadata for display
  const metadataLinks: { key: string; url: string; brand: (typeof KNOWN_LINK_BRANDS)[number] | null }[] = [];
  if (customMetadata) {
    for (const [key, value] of Object.entries(customMetadata)) {
      if (isUrl(value)) {
        metadataLinks.push({ key, url: value, brand: getLinkBrand(key) || getLinkBrand(value) });
      }
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Breadcrumb items={breadcrumbItems} />
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-gray-800">{segments[segments.length - 1]}</h1>
          {version != null && <Badge text={`v${version}`} variant="kv" />}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate(`/secrets/edit/${splat}`)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            onClick={() => { void handleDelete(); }}
            className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Links from metadata - shown prominently at top */}
      {metadataLinks.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          {metadataLinks.map(({ key, url, brand }) => (
            <a
              key={key}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-blue-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:shadow"
            >
              {brand ? (
                <img
                  src={brand.icon}
                  alt={brand.label}
                  className="h-5 w-5 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <svg className="h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.686-5.656l4.5-4.5a4.5 4.5 0 116.364 6.364l-1.757 1.757" />
                </svg>
              )}
              <span className="font-medium">{brand?.label || key}</span>
              <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
              </svg>
            </a>
          ))}
        </div>
      )}

      {/* Secret Fields */}
      <div className="rounded-md border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
          <span className="text-sm font-semibold text-gray-600">Secret Fields</span>
          <div className="flex items-center gap-2">
            {loadingValues && (
              <span className="text-xs text-gray-400">Loading…</span>
            )}
            {revealedKeys.size < fieldKeys.length ? (
              <button
                onClick={() => { void revealAll(); }}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                title="Reveal all values"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Show all
              </button>
            ) : (
              <button
                onClick={hideAll}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                title="Hide all values"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                </svg>
                Hide all
              </button>
            )}
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {fieldKeys.map((key) => {
            const isRevealed = revealedKeys.has(key);
            const displayValue = isRevealed && secretValues ? secretValues[key] ?? '' : null;
            return (
              <div key={key} className="flex items-center px-4 py-3 gap-3">
                <span className="font-mono text-sm font-medium text-gray-700 min-w-0 shrink-0">{key}</span>
                <span className="flex-1 font-mono text-sm text-gray-500 break-all min-w-0">
                  {isRevealed ? (
                    displayValue !== null ? displayValue : <span className="text-gray-400 italic">—</span>
                  ) : (
                    <span className="text-gray-400 select-none tracking-widest">••••••••</span>
                  )}
                </span>
                <button
                  onClick={() => { void toggleReveal(key); }}
                  className="shrink-0 rounded p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                  title={isRevealed ? 'Hide value' : 'Show value'}
                >
                  {isRevealed ? (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Metadata Section */}
      {version === 2 && (
        <div className="mt-6">
          <button
            onClick={() => setShowMetadata(!showMetadata)}
            className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            <svg
              className={`h-4 w-4 transform transition-transform ${showMetadata ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            Metadata
            {hasCustomMetadata && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {Object.keys(customMetadata).length} custom {Object.keys(customMetadata).length === 1 ? 'field' : 'fields'}
              </span>
            )}
          </button>

          {showMetadata && (
            <div className="rounded-md border border-gray-200 bg-white">
              {/* System Metadata */}
              {metadataLoading ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400">Loading metadata…</div>
              ) : metadata ? (
                <>
                  <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-600">
                    Version Info
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2 px-4 py-3 text-sm">
                    {metadata.current_version != null && (
                      <div>
                        <span className="text-gray-500">Current Version:</span>{' '}
                        <span className="font-medium text-gray-700">{metadata.current_version}</span>
                      </div>
                    )}
                    {metadata.created_time && (
                      <div>
                        <span className="text-gray-500">Created:</span>{' '}
                        <span className="font-medium text-gray-700">
                          {new Date(metadata.created_time).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {metadata.updated_time && (
                      <div>
                        <span className="text-gray-500">Updated:</span>{' '}
                        <span className="font-medium text-gray-700">
                          {new Date(metadata.updated_time).toLocaleString()}
                        </span>
                      </div>
                    )}
                    {metadata.max_versions != null && (
                      <div>
                        <span className="text-gray-500">Max Versions:</span>{' '}
                        <span className="font-medium text-gray-700">{metadata.max_versions}</span>
                      </div>
                    )}
                  </div>

                  {/* Custom Metadata */}
                  <div className="border-t border-gray-200">
                    <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-2">
                      <span className="text-sm font-semibold text-gray-600">Custom Metadata</span>
                      {!editingMetadata && (
                        <button
                          onClick={startEditMetadata}
                          className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100"
                        >
                          Edit
                        </button>
                      )}
                    </div>

                    {editingMetadata ? (
                      <div className="p-4 space-y-3">
                        {metadataRows.map((row, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input
                              type="text"
                              placeholder="key"
                              value={row.key}
                              onChange={(e) => {
                                const updated = [...metadataRows];
                                updated[i] = { ...updated[i], key: e.target.value };
                                setMetadataRows(updated);
                              }}
                              className="w-1/3 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                            />
                            <input
                              type="text"
                              placeholder="value"
                              value={row.value}
                              onChange={(e) => {
                                const updated = [...metadataRows];
                                updated[i] = { ...updated[i], value: e.target.value };
                                setMetadataRows(updated);
                              }}
                              className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
                            />
                            <button
                              onClick={() => setMetadataRows(metadataRows.filter((_, idx) => idx !== i))}
                              className="text-red-400 hover:text-red-600 text-sm"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => setMetadataRows([...metadataRows, { key: '', value: '' }])}
                          className="text-sm text-blue-600 hover:text-blue-700"
                        >
                          + Add field
                        </button>
                        {metadataError && (
                          <p className="text-sm text-red-600">{metadataError}</p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => { void saveMetadata(); }}
                            disabled={savingMetadata}
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            {savingMetadata ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEditMetadata}
                            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : hasCustomMetadata ? (
                      <div className="divide-y divide-gray-100">
                        {Object.entries(customMetadata).map(([key, value]) => (
                          <div key={key} className="flex items-center px-4 py-2.5">
                            <span className="font-mono text-sm font-medium text-gray-600 w-1/3">{key}</span>
                            <span className="flex-1 text-sm text-gray-700">
                              {isUrl(value) ? (
                                <a
                                  href={value}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700 hover:underline"
                                >
                                  {(() => {
                                    const brand = getLinkBrand(key) || getLinkBrand(value);
                                    return brand ? (
                                      <img
                                        src={brand.icon}
                                        alt={brand.label}
                                        className="h-4 w-4 object-contain"
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                                      />
                                    ) : null;
                                  })()}
                                  {value}
                                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-15m0 0H8.25m11.25 0v11.25" />
                                  </svg>
                                </a>
                              ) : (
                                value
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="px-4 py-4 text-sm text-gray-400 text-center">
                        No custom metadata. Click Edit to add key-value metadata to this secret.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="px-4 py-4 text-sm text-gray-400 text-center">
                  Unable to load metadata
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
