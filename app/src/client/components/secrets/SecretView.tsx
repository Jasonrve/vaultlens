import { useEffect, useRef, useState } from 'react';
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

// ── Version diff utilities ────────────────────────────────
type DiffLine = { t: 'same' | 'add' | 'del'; v: string };

function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const result: DiffLine[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) { result.unshift({ t: 'same', v: a[i - 1] }); i--; j--; }
    else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) { result.unshift({ t: 'add', v: b[j - 1] }); j--; }
    else { result.unshift({ t: 'del', v: a[i - 1] }); i--; }
  }
  return result;
}

function secretToLines(data: Record<string, string>, masked = false): string[] {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return ['{}'];
  return [
    '{',
    ...entries.map(([k, v], i) => {
      const val = masked ? '••••••••' : v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      return `  "${k}": "${val}"${i < entries.length - 1 ? ',' : ''}`;
    }),
    '}',
  ];
}

export default function SecretView() {
  const { '*': splat = '' } = useParams();
  const navigate = useNavigate();
  const [fieldKeys, setFieldKeys] = useState<string[]>([]);
  const [version, setVersion] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [metadata, setMetadata] = useState<SecretMetadata | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(true);
  const [editingMetadata, setEditingMetadata] = useState(false);
  const [metadataRows, setMetadataRows] = useState<{ key: string; value: string }[]>([]);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [secretValues, setSecretValues] = useState<Record<string, string> | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'kv' | 'json'>('kv');
  const [jsonRevealed, setJsonRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Version viewing
  const [viewingSecretVersion, setViewingSecretVersion] = useState<number | null>(null);
  const [metadataRefreshKey, setMetadataRefreshKey] = useState(0);

  // Version diff
  const [showDiff, setShowDiff] = useState(false);
  const [diffVersionA, setDiffVersionA] = useState<number | null>(null);
  const [diffVersionB, setDiffVersionB] = useState<number | null>(null);
  const [diffValuesA, setDiffValuesA] = useState<Record<string, string> | null>(null);
  const [diffValuesB, setDiffValuesB] = useState<Record<string, string> | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);

  // Version restore
  const [restoringVersion, setRestoringVersion] = useState<number | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Tracks whether user has "show all" active — persisted across version switches
  const showAllRef = useRef(false);

  // Reset to latest version when navigating to a different secret
  useEffect(() => {
    setViewingSecretVersion(null);
    setRevealedKeys(new Set());
    showAllRef.current = false;
  }, [splat]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSecretValues(null);
    async function loadSecret() {
      try {
        const result = await api.readSecret(splat, viewingSecretVersion ?? undefined);
        const newKeys = result.keys ?? [];
        setFieldKeys(newKeys);
        setVersion(result.version);
        const isRestricted = result.restricted === true;
        setRestricted(isRestricted);

        // Check write capabilities for restricted mode partial update
        if (isRestricted && result.capabilities) {
          const caps = result.capabilities;
          setCanWrite(caps.includes('create') || caps.includes('update'));
        }

        // Eagerly load values when user has read permission
        if (!isRestricted) {
          try {
            const valResult = await api.readSecretValues(splat, viewingSecretVersion ?? undefined);
            const vals: Record<string, string> = {};
            for (const [k, v] of Object.entries(valResult.data)) {
              vals[k] = typeof v === 'string' ? v : JSON.stringify(v);
            }
            setSecretValues(vals);
            // Re-apply "show all" if it was active before the version switch
            if (showAllRef.current) {
              setRevealedKeys(new Set(newKeys));
            }
          } catch {
            // Values couldn't be loaded — degrade to keys-only view
          }
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    }
    void loadSecret();
  }, [splat, viewingSecretVersion]);

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
  }, [splat, version, metadataRefreshKey]);

  async function handleRestoreVersion(versionNum: number) {
    if (!confirm(`This will create a new version with the data from v${versionNum}. Continue?`)) return;
    setRestoringVersion(versionNum);
    setRestoreError(null);
    try {
      await api.restoreSecretVersion(splat, versionNum);
      setViewingSecretVersion(null);
      setMetadataRefreshKey((k) => k + 1);
    } catch (e) {
      setRestoreError(e instanceof Error ? e.message : 'Failed to restore version');
    } finally {
      setRestoringVersion(null);
    }
  }

  function openDiff(vA: number, vB: number) {
    setDiffVersionA(vA);
    setDiffVersionB(vB);
    setDiffValuesA(null);
    setDiffValuesB(null);
    setDiffError(null);
    setShowDiff(true);
    void doLoadDiff(vA, vB);
  }

  async function handleLoadDiff() {
    if (diffVersionA === null || diffVersionB === null) return;
    await doLoadDiff(diffVersionA, diffVersionB);
  }

  async function doLoadDiff(vA: number, vB: number) {
    setDiffLoading(true);
    setDiffError(null);
    setDiffValuesA(null);
    setDiffValuesB(null);
    try {
      if (restricted) {
        const [keysA, keysB] = await Promise.all([
          api.readSecret(splat, vA),
          api.readSecret(splat, vB),
        ]);
        setDiffValuesA(Object.fromEntries((keysA.keys ?? []).map((k) => [k, '••••••••'])));
        setDiffValuesB(Object.fromEntries((keysB.keys ?? []).map((k) => [k, '••••••••'])));
      } else {
        const [valsA, valsB] = await Promise.all([
          api.readSecretValues(splat, vA),
          api.readSecretValues(splat, vB),
        ]);
        const toStrMap = (d: Record<string, unknown>) =>
          Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
        setDiffValuesA(toStrMap(valsA.data));
        setDiffValuesB(toStrMap(valsB.data));
      }
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Failed to load versions for comparison');
    } finally {
      setDiffLoading(false);
    }
  }

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

  function toggleReveal(key: string) {
    setRevealedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function revealAll() {
    setRevealedKeys(new Set(fieldKeys));
    showAllRef.current = true;
  }

  function hideAll() {
    setRevealedKeys(new Set());
    showAllRef.current = false;
  }

  async function handleCopyJson() {
    if (!secretValues) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(secretValues, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not available
    }
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
        <Breadcrumb items={breadcrumbItems} copyPath={splat || undefined} />
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-gray-800">{segments[segments.length - 1]}</h1>
            {version != null && <Badge text={`v${version}`} variant="kv" />}
          </div>
        <div className="flex items-center gap-2">
          {/* Version selector for KV v2 with any version history */}
          {version === 2 && metadata?.versions && Object.keys(metadata.versions).length >= 1 && (
            <div className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1">
              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <label className="text-xs text-gray-500">Version</label>
              <select
                value={viewingSecretVersion ?? (metadata.current_version ?? '')}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setViewingSecretVersion(v === metadata?.current_version ? null : v);
                }}
                className="border-0 bg-transparent text-sm text-gray-700 focus:outline-none cursor-pointer"
              >
                {Object.keys(metadata.versions)
                  .map(Number)
                  .sort((a, b) => b - a)
                  .map((vNum) => {
                    const vInfo = metadata.versions![String(vNum)];
                    const isCurrent = vNum === metadata.current_version;
                    const label = `v${vNum}${isCurrent ? ' (current)' : vInfo?.destroyed ? ' (destroyed)' : vInfo?.deletion_time && vInfo.deletion_time !== '' ? ' (deleted)' : ''}`;
                    return <option key={vNum} value={vNum}>{label}</option>;
                  })}
              </select>
            </div>
          )}
          {restricted ? (
            canWrite && (
              <button
                onClick={() => navigate(`/secrets/merge/${splat}`)}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Partial Update
              </button>
            )
          ) : (
            <>
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
            </>
          )}
        </div>
        </div>
        {/* Version info subtitle — KV v2 only */}
        {version === 2 && metadata && (
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
            {metadata.current_version != null && (
              <span>Version <span className="font-medium text-gray-700">{metadata.current_version}</span></span>
            )}
            {metadata.created_time && (
              <><span className="text-gray-300">·</span><span>Created <span className="font-medium text-gray-700">{new Date(metadata.created_time).toLocaleString()}</span></span></>
            )}
            {metadata.updated_time && (
              <><span className="text-gray-300">·</span><span>Updated <span className="font-medium text-gray-700">{new Date(metadata.updated_time).toLocaleString()}</span></span></>
            )}
            {metadata.max_versions != null && metadata.max_versions > 0 && (
              <><span className="text-gray-300">·</span><span>Max versions <span className="font-medium text-gray-700">{metadata.max_versions}</span></span></>
            )}
          </div>
        )}
      </div>

      {/* Viewing historical version banner */}
      {viewingSecretVersion !== null && metadata?.current_version != null && viewingSecretVersion !== metadata.current_version && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-amber-800">
            <svg className="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Viewing <strong>v{viewingSecretVersion}</strong> — current version is <strong>v{metadata.current_version}</strong></span>
          </div>
          {!restricted && (
            <button
              onClick={() => { void handleRestoreVersion(viewingSecretVersion); }}
              disabled={restoringVersion === viewingSecretVersion}
              className="ml-4 rounded border border-amber-300 bg-white px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              {restoringVersion === viewingSecretVersion ? 'Restoring…' : 'Restore as new version'}
            </button>
          )}
        </div>
      )}

      {/* Restricted access banner */}
      {restricted && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-800">Restricted access</p>
            <p className="mt-0.5 text-sm text-amber-700">
              You do not have <strong>read</strong> permission on this secret. Your <strong>list</strong> permission allows you to see the field names (keys) but values cannot be revealed.
            </p>
          </div>
        </div>
      )}

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
          {/* View mode toggle */}
          <div className="flex items-center gap-1 rounded-md bg-gray-200 p-0.5">
            <button
              onClick={() => setViewMode('kv')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                viewMode === 'kv'
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Key / Value
            </button>
            {!restricted && (
              <button
                onClick={() => setViewMode('json')}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  viewMode === 'json'
                    ? 'bg-white text-gray-800 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                JSON
              </button>
            )}
          </div>
          {!restricted && viewMode === 'kv' && (
          <div className="flex items-center gap-2">
            {revealedKeys.size < fieldKeys.length ? (
              <button
                onClick={revealAll}
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
          )}
          {!restricted && viewMode === 'json' && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setJsonRevealed(!jsonRevealed)}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  {jsonRevealed ? (
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  ) : (
                    <>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </>
                  )}
                </svg>
                {jsonRevealed ? 'Mask values' : 'Reveal values'}
              </button>
              {jsonRevealed && (
                <button
                  onClick={() => { void handleCopyJson(); }}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-gray-500 hover:text-gray-800 hover:bg-gray-100"
                  title="Copy JSON"
                >
                  {copied ? (
                    <svg className="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                    </svg>
                  )}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              )}
            </div>
          )}
        </div>

        {viewMode === 'kv' ? (
        <div className="divide-y divide-gray-100">
          {fieldKeys.map((key) => {
            const isRevealed = !restricted && revealedKeys.has(key);
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
                {!restricted && (
                <button
                  onClick={() => toggleReveal(key)}
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
                )}
              </div>
            );
          })}
        </div>
        ) : (
          /* JSON View */
          <div className="p-4">
            <pre className="overflow-x-auto rounded-md bg-gray-900 p-4 text-sm leading-relaxed text-gray-100 font-mono">
              {jsonRevealed && secretValues
                ? JSON.stringify(secretValues, null, 2)
                : JSON.stringify(
                    Object.fromEntries(fieldKeys.map((k) => [k, '••••••••'])),
                    null,
                    2,
                  )}
            </pre>
          </div>
        )}
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
              {/* Custom Metadata */}
              {metadataLoading ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400">Loading…</div>
              ) : metadata ? (
                <>
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

      {/* Version History Section (KV v2 only) */}
      {version === 2 && (
        <div className="mt-6">
          <button
            onClick={() => setShowVersionHistory(!showVersionHistory)}
            className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            <svg
              className={`h-4 w-4 transform transition-transform ${showVersionHistory ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            Version History
            {metadata?.versions && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {Object.keys(metadata.versions).length}{' '}
                {Object.keys(metadata.versions).length === 1 ? 'version' : 'versions'}
              </span>
            )}
          </button>

          {showVersionHistory && (
            <div className="rounded-md border border-gray-200 bg-white">
              {metadataLoading ? (
                <div className="px-4 py-6 text-center text-sm text-gray-400">Loading…</div>
              ) : metadata?.versions && Object.keys(metadata.versions).length > 0 ? (
                <>
                  {restoreError && (
                    <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-sm text-red-600">{restoreError}</div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500">
                          <th className="px-4 py-2">Version</th>
                          <th className="px-4 py-2">Created</th>
                          <th className="px-4 py-2">Status</th>
                          <th className="px-4 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.keys(metadata.versions)
                          .map(Number)
                          .sort((a, b) => b - a)
                          .map((vNum) => {
                            const vInfo = metadata.versions![String(vNum)];
                            const isCurrent = vNum === metadata.current_version;
                            const isDestroyed = vInfo?.destroyed;
                            const isDeleted = !isDestroyed && vInfo?.deletion_time && vInfo.deletion_time !== '';
                            const isActive = !isDestroyed && !isDeleted;
                            return (
                              <tr key={vNum} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="px-4 py-2.5 font-mono font-medium text-gray-700">v{vNum}</td>
                                <td className="px-4 py-2.5 text-xs text-gray-500">
                                  {vInfo?.created_time ? new Date(vInfo.created_time).toLocaleString() : '—'}
                                </td>
                                <td className="px-4 py-2.5">
                                  {isCurrent ? (
                                    <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-green-200">Current</span>
                                  ) : isDestroyed ? (
                                    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600 ring-1 ring-red-200">Destroyed</span>
                                  ) : isDeleted ? (
                                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">Deleted</span>
                                  ) : (
                                    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">Active</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  <div className="flex items-center gap-2">
                                    {!isCurrent && isActive && !restricted && (
                                      <button
                                        onClick={() => { void handleRestoreVersion(vNum); }}
                                        disabled={restoringVersion === vNum}
                                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                                      >
                                        {restoringVersion === vNum ? 'Restoring…' : 'Restore as new'}
                                      </button>
                                    )}
                                    {!isDestroyed && (
                                      <button
                                        onClick={() => openDiff(vNum, metadata.current_version ?? vNum)}
                                        className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-600 hover:bg-blue-100"
                                      >
                                        Compare
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <div className="px-4 py-4 text-center text-sm text-gray-400">No version history available</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Version diff modal */}
      {showDiff && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={() => setShowDiff(false)} />
          <div className="relative z-10 flex w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl" style={{maxHeight: '85vh'}}>
          <div className="flex shrink-0 items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-3 rounded-t-lg">
            <h2 className="text-base font-semibold text-gray-800">Version Comparison</h2>
            <div className="flex items-center gap-3">
              {metadata?.versions && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">From</span>
                  <select
                    value={diffVersionA ?? ''}
                    onChange={(e) => setDiffVersionA(Number(e.target.value) || null)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select…</option>
                    {Object.keys(metadata.versions).map(Number).sort((a, b) => b - a).map((v) => (
                      <option key={v} value={v}>v{v}{v === metadata.current_version ? ' (current)' : ''}</option>
                    ))}
                  </select>
                  <span className="text-gray-400">→</span>
                  <span className="text-gray-500">To</span>
                  <select
                    value={diffVersionB ?? ''}
                    onChange={(e) => setDiffVersionB(Number(e.target.value) || null)}
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select…</option>
                    {Object.keys(metadata.versions).map(Number).sort((a, b) => b - a).map((v) => (
                      <option key={v} value={v}>v{v}{v === metadata.current_version ? ' (current)' : ''}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => { void handleLoadDiff(); }}
                    disabled={!diffVersionA || !diffVersionB || diffLoading}
                    className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    Compare
                  </button>
                </div>
              )}
              <button
                onClick={() => setShowDiff(false)}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Close"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-6 rounded-b-lg">
            {diffLoading ? (
              <LoadingSpinner className="mt-12" />
            ) : diffError ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{diffError}</div>
            ) : diffValuesA && diffValuesB ? (
              <div>
                <div className="mb-3 flex items-center gap-6 text-xs text-gray-500">
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-8 rounded border border-red-200 bg-red-100" />
                    <span>Removed (v{diffVersionA})</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="h-3 w-8 rounded border border-green-200 bg-green-100" />
                    <span>Added (v{diffVersionB})</span>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-md border border-gray-200 font-mono text-sm">
                  {diffLines(
                    secretToLines(diffValuesA, restricted),
                    secretToLines(diffValuesB, restricted),
                  ).map((line, idx) => (
                    <div
                      key={idx}
                      className={
                        line.t === 'add'
                          ? 'flex bg-green-50 text-green-900'
                          : line.t === 'del'
                            ? 'flex bg-red-50 text-red-900'
                            : 'flex bg-white text-gray-700'
                      }
                    >
                      <span
                        className={`w-8 shrink-0 select-none border-r py-1 text-center text-xs ${
                          line.t === 'add'
                            ? 'border-green-200 bg-green-100 text-green-600'
                            : line.t === 'del'
                              ? 'border-red-200 bg-red-100 text-red-600'
                              : 'border-gray-100 bg-gray-50 text-gray-400'
                        }`}
                      >
                        {line.t === 'add' ? '+' : line.t === 'del' ? '−' : ' '}
                      </span>
                      <span className="whitespace-pre px-4 py-1">{line.v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-12 text-center text-sm text-gray-400">
                Select two versions and click Compare to see the differences
              </p>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}
