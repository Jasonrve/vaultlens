import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import axios from 'axios';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import Table from '../common/Table';
import { FiCheckCircle, FiAlertTriangle, FiXCircle, FiHelpCircle } from 'react-icons/fi';
import { VsoRequestDiagnostics, type VsoDiagnostics, type VsoErrorReason } from '../common/VsoRequestDiagnostics';

interface VsoErrorDetails {
  message: string;
  kubernetesHost?: string;
  identity?: { serviceAccount?: string; namespace?: string; iamRole?: string };
  reason?: VsoErrorReason;
  diagnostics?: VsoDiagnostics;
}

function errorDetails(error: unknown): VsoErrorDetails {
  if (axios.isAxiosError<{ error?: string; kubernetesHost?: string; identity?: VsoErrorDetails['identity']; reason?: VsoErrorReason; diagnostics?: VsoDiagnostics }>(error)) {
    const data = error.response?.data;
    if (error.response?.status === 401 || error.response?.status === 403) {
      const identity = data?.identity;
      const name = identity?.serviceAccount
        ? `ServiceAccount ${identity.namespace ? `${identity.namespace}/` : ''}${identity.serviceAccount}`
        : 'The current pod identity';
      const role = identity?.iamRole ? ` (IAM role ${identity.iamRole})` : '';
      return { message: `${name}${role} needs permission to query the downstream Kubernetes cluster.`, kubernetesHost: data?.kubernetesHost, identity, reason: data?.reason, diagnostics: data?.diagnostics };
    }
    return { message: data?.error || 'Unable to query the downstream Kubernetes cluster.', kubernetesHost: data?.kubernetesHost, reason: data?.reason, diagnostics: data?.diagnostics };
  }
  return { message: 'Unable to query the downstream Kubernetes cluster.' };
}

function formatAge(createdAt?: string): string {
  if (!createdAt) return '—';
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return createdAt;
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function highlightYamlValue(value: string, keyPrefix: string): ReactNode[] {
  const parts = value.split(/("(?:\\.|[^"])*"|'[^']*'|#[^\n]*|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?\b)/g);
  return parts.map((part, index) => {
    if (/^#/.test(part)) return <span key={`${keyPrefix}-comment-${index}`} className="text-slate-500">{part}</span>;
    if (/^(true|false)$/.test(part)) return <span key={`${keyPrefix}-bool-${index}`} className="text-amber-300">{part}</span>;
    if (part === 'null') return <span key={`${keyPrefix}-null-${index}`} className="text-rose-300">{part}</span>;
    if (/^-?\d+(?:\.\d+)?$/.test(part)) return <span key={`${keyPrefix}-number-${index}`} className="text-violet-300">{part}</span>;
    if (/^(".*"|'.*')$/.test(part)) return <span key={`${keyPrefix}-string-${index}`} className="text-emerald-300">{part}</span>;
    if (part.trim()) return <span key={`${keyPrefix}-text-${index}`} className="text-slate-200">{part}</span>;
    return part;
  });
}

function highlightYamlLine(line: string, lineIndex: number): ReactNode[] {
  const match = line.match(/^(\s*)(-\s+)?([^:#\n]+?)(:\s*)(.*)$/);
  if (!match) return highlightYamlValue(line, `line-${lineIndex}`);
  const [, indentation, listMarker, key, separator, value] = match;
  return [
    indentation,
    listMarker && <span key={`marker-${lineIndex}`} className="text-slate-500">{listMarker}</span>,
    <span key={`key-${lineIndex}`} className="text-cyan-300">{key}</span>,
    <span key={`separator-${lineIndex}`} className="text-slate-500">{separator}</span>,
    ...highlightYamlValue(value, `line-${lineIndex}`),
  ];
}

const KIND_ORDER = ['VaultStaticSecret', 'VaultDynamicSecret', 'VaultAuth', 'VaultConnection'];

function resourceOrder(row: api.VsoResourceRow): number {
  const index = KIND_ORDER.indexOf(row.kind);
  return index === -1 ? KIND_ORDER.length : index;
}

const HEALTH_ORDER: Record<api.VsoHealth, number> = { error: 0, warning: 1, unknown: 2, healthy: 3 };

const HEALTH_META: Record<api.VsoHealth, { label: string; icon: typeof FiCheckCircle; className: string }> = {
  error: { label: 'Error', icon: FiXCircle, className: 'text-red-600' },
  warning: { label: 'Warning', icon: FiAlertTriangle, className: 'text-amber-500' },
  healthy: { label: 'Healthy', icon: FiCheckCircle, className: 'text-emerald-600' },
  unknown: { label: 'Unknown', icon: FiHelpCircle, className: 'text-gray-400' },
};

function conditionSummary(row: api.VsoResourceRow): string | undefined {
  const ready = row.conditions?.find((c) => c.type === 'Ready' || c.type === 'Synced');
  if (!ready) return undefined;
  return [ready.reason, ready.message].filter(Boolean).join(': ') || `${ready.type}: ${ready.status}`;
}

function HealthCell({ row }: { row: api.VsoResourceRow }) {
  const meta = HEALTH_META[row.health];
  const Icon = meta.icon;
  const tooltip = conditionSummary(row) ?? meta.label;
  return (
    <div title={tooltip}>
      <div className={`flex items-center gap-1.5 text-xs font-medium ${meta.className}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {meta.label}
      </div>
      {row.issues && row.issues.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {row.issues.slice(0, 2).map((issue, i) => (
            <li key={i} className={`text-[11px] leading-tight ${issue.severity === 'error' ? 'text-red-600' : 'text-amber-600'}`}>
              {issue.message}
            </li>
          ))}
          {row.issues.length > 2 && (
            <li className="text-[11px] leading-tight text-gray-400">+{row.issues.length - 2} more — see details</li>
          )}
        </ul>
      )}
    </div>
  );
}

function findRow(resources: api.VsoResourceRow[], kind: string, name: string, namespace?: string): api.VsoResourceRow | undefined {
  return resources.find((r) => r.kind === kind && r.name === name && (r.namespace ?? '') === (namespace ?? ''));
}

function RelatedCell({ row, resources, onOpen }: { row: api.VsoResourceRow; resources: api.VsoResourceRow[]; onOpen: (row: api.VsoResourceRow) => void }) {
  const chips: ReactNode[] = [];

  if (row.vaultConnectionRef) {
    const target = findRow(resources, 'VaultConnection', row.vaultConnectionRef.name, row.vaultConnectionRef.namespace);
    chips.push(
      <RelatedChip key="conn" label={`Connection: ${row.vaultConnectionRef.name}`} found={!!target} onClick={target ? () => onOpen(target) : undefined} />,
    );
  }
  if (row.role) {
    const roleMissing = row.issues?.some((i) => i.message.startsWith('Vault role'));
    chips.push(<RelatedChip key="role" label={`Role: ${row.role}`} found={!roleMissing} />);
  }
  if (row.serviceAccount) {
    const saMissing = row.issues?.some((i) => i.message.startsWith('ServiceAccount'));
    chips.push(<RelatedChip key="sa" label={`SA: ${row.serviceAccount}`} found={!saMissing} />);
  }
  if (row.vaultAuthRef) {
    const target = findRow(resources, 'VaultAuth', row.vaultAuthRef.name, row.vaultAuthRef.namespace) ??
      findRow(resources, 'VaultAuthGlobal', row.vaultAuthRef.name, row.vaultAuthRef.namespace);
    chips.push(
      <RelatedChip key="auth" label={`Auth: ${row.vaultAuthRef.name}`} found={!!target} onClick={target ? () => onOpen(target) : undefined} />,
    );
  }
  if (row.destinationSecret) {
    const missing = row.issues?.some((i) => i.message.startsWith('Destination Secret'));
    chips.push(<RelatedChip key="dest" label={`Secret: ${row.destinationSecret.name}`} found={!missing} />);
  }

  if (chips.length === 0) return <span className="text-gray-300">—</span>;
  return <div className="flex flex-wrap gap-1">{chips}</div>;
}

function RelatedChip({ label, found, onClick }: { label: string; found: boolean; onClick?: () => void }) {
  const base = 'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium';
  const color = found ? 'bg-gray-100 text-gray-600 ring-1 ring-gray-200' : 'bg-red-50 text-red-700 ring-1 ring-red-200';
  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`${base} ${color} hover:ring-2 hover:ring-[#1563ff]/30`}
      >
        {label}
      </button>
    );
  }
  return <span className={`${base} ${color}`}>{!found && '⚠ '}{label}</span>;
}

const HEALTH_FILTERS: Array<{ key: 'all' | api.VsoHealth; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'error', label: 'Errors' },
  { key: 'warning', label: 'Warnings' },
  { key: 'healthy', label: 'Healthy' },
  { key: 'unknown', label: 'Unknown' },
];

export default function VsoResourcesTab({ method, role }: { method: string; role?: string }) {
  const [resources, setResources] = useState<api.VsoResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<VsoErrorDetails | null>(null);
  const [selected, setSelected] = useState<api.VsoResourceRow | null>(null);
  const [yaml, setYaml] = useState<string | null>(null);
  const [fullYaml, setFullYaml] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [resourceSearch, setResourceSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<'all' | api.VsoHealth>('all');
  const [showManagedFields, setShowManagedFields] = useState(false);
  const [drawerVisible, setDrawerVisible] = useState(false);

  const loadResources = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorInfo(null);
    try {
      const result = await api.listVsoResources(method, role);
      setResources(result.resources);
    } catch (requestError) {
      const details = errorDetails(requestError);
      setError(details.message);
      setErrorInfo(details);
    } finally {
      setLoading(false);
    }
  }, [method, role]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  async function openResource(row: api.VsoResourceRow) {
    setSelected(row);
    setDrawerVisible(false);
    setYaml(null);
    setFullYaml(null);
    setDetailError(null);
    setCopied(false);
    setShowManagedFields(false);
    setDetailLoading(true);
    window.requestAnimationFrame(() => setDrawerVisible(true));
    try {
      const result = await api.getVsoResource(method, row);
      setYaml(result.yaml);
      setFullYaml(result.fullYaml);
    } catch (requestError) {
      setDetailError(errorDetails(requestError).message);
    } finally {
      setDetailLoading(false);
    }
  }

  const closeDrawer = useCallback(() => {
    setDrawerVisible(false);
    window.setTimeout(() => setSelected(null), 220);
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeDrawer, selected]);

  const healthCounts = useMemo(() => {
    const counts: Record<api.VsoHealth, number> = { error: 0, warning: 0, healthy: 0, unknown: 0 };
    for (const row of resources) counts[row.health]++;
    return counts;
  }, [resources]);

  const orderedResources = [...resources].sort((left, right) => (
    HEALTH_ORDER[left.health] - HEALTH_ORDER[right.health] ||
    resourceOrder(left) - resourceOrder(right) ||
    left.kind.localeCompare(right.kind) ||
    (left.namespace || '').localeCompare(right.namespace || '') ||
    left.name.localeCompare(right.name)
  ));
  const normalizedSearch = resourceSearch.trim().toLowerCase();
  const visibleResources = orderedResources
    .filter((row) => healthFilter === 'all' || row.health === healthFilter)
    .filter((row) => !normalizedSearch || [row.kind, row.namespace, row.name, row.status]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(normalizedSearch)));
  const displayedYaml = showManagedFields ? fullYaml : yaml;
  const displayedYamlLines = displayedYaml?.split('\n').map((line, index) => ({ line, index })) ?? [];

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Vault Secrets Operator resources</h2>
          <p className="mt-1 text-xs text-gray-500">
            {role
              ? <>Resources whose chain traces back to role <span className="font-medium text-gray-700">{role}</span>. Select a row to inspect its YAML.</>
              : 'Read-only resources across all namespaces. Select a row to inspect its YAML.'}
          </p>
        </div>
        {!loading && !error && (
          <button type="button" onClick={() => void loadResources()} className="text-xs font-medium text-[#1563ff] hover:underline">
            Refresh
          </button>
        )}
      </div>

      {loading && <LoadingSpinner className="py-12" />}
      {error && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <h3 className="font-semibold">VSO resources are not available</h3>
          <p className="mt-1">{error}</p>
          <p className="mt-3">VaultLens uses the Kubernetes URL configured on this Vault auth mount:</p>
          <code className="mt-1 block overflow-x-auto rounded bg-amber-100 px-3 py-2 text-xs">{errorInfo?.kubernetesHost || 'No Kubernetes URL is configured on this auth mount.'}</code>
          <VsoRequestDiagnostics reason={errorInfo?.reason} diagnostics={errorInfo?.diagnostics} />
          <p className="mt-4 font-medium">The VaultLens workload identity needs read access to the VSO API resources in the downstream cluster.</p>
          <p className="mt-1 text-xs">Current identity: {errorInfo?.identity?.serviceAccount ? `ServiceAccount ${errorInfo.identity.namespace ? `${errorInfo.identity.namespace}/` : ''}${errorInfo.identity.serviceAccount}` : 'the pod ServiceAccount'}{errorInfo?.identity?.iamRole ? ` (IAM role ${errorInfo.identity.iamRole})` : ''}</p>
          <pre className="mt-3 overflow-x-auto rounded bg-slate-900 p-3 text-xs leading-5 text-slate-100">{`apiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRole\nmetadata:\n  name: vaultlens-vso-reader\nrules:\n  - apiGroups: ["secrets.hashicorp.com"]\n    resources:\n      - vaultstaticsecrets\n      - vaultauths\n      - vaultauthglobals\n      - vaultconnections\n      - vaultdynamicsecrets\n      - vaultpkisecrets\n      - secrettransformations\n      - csisecrets\n    verbs: ["get", "list"]\n  - apiGroups: [""]\n    resources:\n      - serviceaccounts\n    verbs: ["get", "list"]\n---\napiVersion: rbac.authorization.k8s.io/v1\nkind: ClusterRoleBinding\nmetadata:\n  name: vaultlens-vso-reader\nroleRef:\n  apiGroup: rbac.authorization.k8s.io\n  kind: ClusterRole\n  name: vaultlens-vso-reader\nsubjects:\n  - kind: ServiceAccount\n    name: ${errorInfo?.identity?.serviceAccount || 'vaultlens'}\n    namespace: ${errorInfo?.identity?.namespace || 'default'}`}</pre>
          <p className="mt-2 text-xs text-amber-800">The <code>serviceaccounts</code> rule is only needed for the optional relationship check below — the tab still works with just the <code>secrets.hashicorp.com</code> rules.</p>
          <button type="button" onClick={() => void loadResources()} className="mt-3 font-medium underline">Check again</button>
        </div>
      )}
      {!loading && !error && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {HEALTH_FILTERS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setHealthFilter(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  healthFilter === key
                    ? 'bg-[#1563ff] text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}{key !== 'all' && ` (${healthCounts[key]})`}
              </button>
            ))}
          </div>
          <div className="mb-3">
            <input
              type="search"
              value={resourceSearch}
              onChange={(event) => setResourceSearch(event.target.value)}
              placeholder="Search VSO resources"
              aria-label="Search VSO resources"
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#1563ff] focus:ring-2 focus:ring-[#1563ff]/20"
            />
            {(resourceSearch || healthFilter !== 'all') && <p className="mt-2 text-xs text-gray-500">{visibleResources.length} matching resources</p>}
          </div>
          <Table
            data={visibleResources}
            onRowClick={(row) => void openResource(row)}
            emptyMessage={resourceSearch || healthFilter !== 'all' ? 'No matching Vault Secrets Operator resources' : 'No Vault Secrets Operator resources found'}
            columns={[
              { header: 'Kind', accessor: 'kind' },
              { header: 'Namespace', render: (row) => row.namespace || 'Cluster-wide' },
              { header: 'Name', accessor: 'name', className: 'font-medium text-gray-900' },
              { header: 'Age', render: (row) => formatAge(row.createdAt) },
              { header: 'Health', render: (row) => <HealthCell row={row} /> },
              { header: 'Related', render: (row) => <RelatedCell row={row} resources={resources} onOpen={(target) => void openResource(target)} /> },
            ]}
          />
        </>
      )}

      {selected && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${selected.kind} ${selected.name} YAML`}>
          <button type="button" aria-label="Close YAML viewer" onClick={closeDrawer} className={`absolute inset-0 h-full w-full bg-slate-950/30 transition-opacity duration-200 ${drawerVisible ? 'opacity-100' : 'opacity-0'}`} />
          <aside className={`absolute right-0 top-0 flex h-full w-full max-w-3xl flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-200 ease-out ${drawerVisible ? 'translate-x-0' : 'translate-x-full'}`}>
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <div>
                <h2 className="font-semibold text-gray-900">{selected.kind}/{selected.name}</h2>
                <p className="text-xs text-gray-500">{selected.namespace || 'Cluster-wide'}</p>
              </div>
              <div className="flex items-center gap-3">
                {displayedYaml && (
                  <button
                    type="button"
                    onClick={() => { void navigator.clipboard.writeText(displayedYaml).then(() => setCopied(true)); }}
                    className="text-sm font-medium text-[#1563ff] hover:underline"
                  >
                    {copied ? 'Copied' : 'Copy YAML'}
                  </button>
                )}
                <button type="button" onClick={closeDrawer} className="text-sm font-medium text-gray-600 hover:text-gray-900">Close</button>
              </div>
            </div>
            {detailLoading && <LoadingSpinner className="flex-1" />}
            {detailError && <p className="m-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">{detailError}</p>}
            {!detailLoading && !detailError && ((selected.conditions && selected.conditions.length > 0) || (selected.issues && selected.issues.length > 0)) && (
              <div className="border-b border-gray-200 px-6 py-4 text-xs">
                {selected.issues && selected.issues.length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {selected.issues.map((issue, i) => (
                      <li key={i} className={`flex items-start gap-1.5 ${issue.severity === 'error' ? 'text-red-700' : 'text-amber-700'}`}>
                        {issue.severity === 'error' ? <FiXCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <FiAlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                )}
                {selected.conditions && selected.conditions.length > 0 && (
                  <ul className="space-y-1 text-gray-600">
                    {selected.conditions.map((condition, i) => (
                      <li key={i}>
                        <span className={condition.status === 'True' ? 'text-emerald-700' : condition.status === 'False' ? 'text-red-700' : 'text-amber-700'}>
                          {condition.type}: {condition.status}
                        </span>
                        {condition.reason && <span className="text-gray-400"> ({condition.reason})</span>}
                        {condition.message && <div className="ml-0 text-gray-500">{condition.message}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {yaml && !detailLoading && !detailError && (
              <label className="flex items-center gap-2 border-b border-gray-200 px-6 py-3 text-xs text-gray-600">
                <input
                  type="checkbox"
                  checked={showManagedFields}
                  onChange={(event) => setShowManagedFields(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-[#1563ff] focus:ring-[#1563ff]"
                />
                Show Kubernetes managed fields
              </label>
            )}
            {displayedYaml && !detailLoading && !detailError && (
              <div className="flex-1 overflow-auto bg-slate-950 p-4 font-mono text-sm leading-6">
                {displayedYamlLines.length > 0 ? displayedYamlLines.map(({ line, index }) => (
                  <div key={index} className="flex min-w-max">
                    <span className="mr-4 w-10 select-none text-right text-slate-600">{index + 1}</span>
                    <code className="whitespace-pre text-slate-200">{highlightYamlLine(line, index)}</code>
                  </div>
                )) : <p className="p-2 text-slate-400">No YAML available</p>}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
