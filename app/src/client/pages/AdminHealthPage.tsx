import { useState, useEffect, useCallback } from 'react';
import * as api from '../lib/api';
import type { AdminHealth } from '../lib/api';

function formatBytes(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function sourceBadge(source: string) {
  const styles: Record<string, string> = {
    kubernetes: 'bg-blue-100 text-blue-700',
    approle: 'bg-green-100 text-green-700',
    static: 'bg-amber-100 text-amber-700',
    none: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[source] ?? 'bg-gray-100 text-gray-600'}`}>
      {source}
    </span>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
      }`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      {label}
    </span>
  );
}

function Card({ title, children, accent }: { title: string; children: React.ReactNode; accent?: 'ok' | 'bad' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      <div
        className={`flex items-center justify-between border-b px-5 py-3 text-sm font-semibold text-gray-800 ${
          accent === 'bad' ? 'border-red-100 bg-red-50/60' : 'border-gray-100 bg-gray-50'
        }`}
      >
        {title}
        {accent && <span className={`h-2 w-2 rounded-full ${accent === 'bad' ? 'bg-red-500' : 'bg-green-500'}`} />}
      </div>
      <div className="px-5 py-4 space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-gray-500">{label}</span>
      <span className="text-right font-medium text-gray-800 break-words">{value}</span>
    </div>
  );
}

const ACRONYMS = new Set(['Tls', 'Cors', 'Ms']);

// "vaultSkipTlsVerify" -> "Vault Skip TLS Verify"
function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .split(' ')
    .map((word) => (ACRONYMS.has(word) ? word.toUpperCase() : word))
    .join(' ');
}

function formatConfigValue(value: unknown): React.ReactNode {
  if (value === '' || value === null || value === undefined) return <span className="text-gray-400">—</span>;
  // Thousands separators help for large values (timeouts in ms) but just look odd on
  // small ones like port numbers, so only apply above a threshold no port reaches.
  if (typeof value === 'number') return value >= 10000 ? value.toLocaleString() : String(value);
  return String(value);
}

export default function AdminHealthPage() {
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [rotation, setRotation] = useState<{ schedulerRunning: boolean; lastCheck: string | null; nextCheck: string | null } | null>(null);
  const [vaultHealth, setVaultHealth] = useState<Record<string, unknown> | null>(null);
  const [vaultSeal, setVaultSeal] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      api.getAdminHealth(),
      api.getRotationStatus(),
      api.getVaultHealth(),
      api.getVaultSealStatus(),
    ])
      .then(([h, r, vh, vs]) => {
        setHealth(h);
        setRotation(r);
        setVaultHealth(vh);
        setVaultSeal(vs);
        setLastRefreshed(new Date());
      })
      .catch(() => setError('Failed to load health data'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !health) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#1563ff]" />
      </div>
    );
  }

  if (error || !health) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error ?? 'No health data available'}
        </div>
      </div>
    );
  }

  const { app, resources, config, vaultAuthIdentity, awsIdentity, backgroundJobs } = health;

  const sealed = vaultHealth?.['sealed'] as boolean | undefined;
  const initialized = vaultHealth?.['initialized'] as boolean | undefined;
  const schedulerRunning = rotation?.schedulerRunning;
  const auditSocketOk = !backgroundJobs.auditSocket.enabled || backgroundJobs.auditSocket.listening;

  const issues: string[] = [];
  if (sealed === true) issues.push('Vault is sealed');
  if (initialized === false) issues.push('Vault is not initialized');
  if (vaultAuthIdentity.tokenError) issues.push('Vault auth token could not be verified');
  if (schedulerRunning === false) issues.push('Rotation scheduler is stopped');
  if (!auditSocketOk) issues.push('Audit socket is enabled but not listening');
  const isHealthy = issues.length === 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Health</h1>
          <p className="mt-1 text-sm text-gray-500">
            Runtime status, current Vault authentication identity, and configuration for this VaultLens instance.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          {lastRefreshed && (
            <span className="text-[11px] text-gray-400">Updated {lastRefreshed.toLocaleTimeString()}</span>
          )}
        </div>
      </div>

      <div
        className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
          isHealthy ? 'border-green-200 bg-green-50 text-green-800' : 'border-red-200 bg-red-50 text-red-800'
        }`}
      >
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isHealthy ? 'bg-green-500' : 'bg-red-500'}`} />
        {isHealthy ? (
          <span className="font-medium">All systems operational</span>
        ) : (
          <span>
            <span className="font-medium">Attention needed:</span> {issues.join('; ')}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card title="Application">
          <Row label="Version" value={app.version} />
          <Row label="Environment" value={app.nodeEnv} />
          <Row label="Uptime" value={formatUptime(app.uptimeSeconds)} />
          <Row label="PID" value={app.pid} />
          <Row label="Node.js" value={app.nodeVersion} />
        </Card>

        <Card title="Resources">
          <Row label="Memory (RSS)" value={formatBytes(resources.memory.rss)} />
          <Row label="Heap used / total" value={`${formatBytes(resources.memory.heapUsed)} / ${formatBytes(resources.memory.heapTotal)}`} />
          <Row label="Load average (1/5/15m)" value={resources.loadAvg.map((v) => v.toFixed(2)).join(' / ')} />
          <Row label="CPU cores" value={resources.cpuCount} />
          <Row label="System memory free" value={formatBytes(resources.freeMemBytes)} />
          <Row label="System memory total" value={formatBytes(resources.totalMemBytes)} />
        </Card>

        <Card title="Vault Auth Identity" accent={vaultAuthIdentity.tokenError ? 'bad' : 'ok'}>
          <Row label="Source" value={sourceBadge(vaultAuthIdentity.source)} />
          {vaultAuthIdentity.kubernetesAuthRole && (
            <Row label="K8s role / mount" value={`${vaultAuthIdentity.kubernetesAuthRole} @ ${vaultAuthIdentity.kubernetesAuthMount}`} />
          )}
          {vaultAuthIdentity.token && (
            <>
              <Row label="Display name" value={vaultAuthIdentity.token.displayName} />
              <Row label="Entity ID" value={vaultAuthIdentity.token.entityId || '—'} />
              <Row label="Policies" value={vaultAuthIdentity.token.policies.join(', ') || '—'} />
              <Row label="TTL" value={vaultAuthIdentity.token.ttl > 0 ? `${vaultAuthIdentity.token.ttl}s` : 'non-expiring'} />
            </>
          )}
          {vaultAuthIdentity.tokenError && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Could not verify token: {vaultAuthIdentity.tokenError}
            </div>
          )}
        </Card>

        {awsIdentity && (
          <Card title="AWS Identity">
            <Row label="Region" value={awsIdentity.region} />
            {awsIdentity.callerIdentity ? (
              <>
                <Row label="IAM ARN" value={awsIdentity.callerIdentity.arn} />
                <Row label="Account" value={awsIdentity.callerIdentity.accountId} />
              </>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Could not resolve caller identity via AWS STS.
              </div>
            )}
            {awsIdentity.manuallyConfiguredRole && (
              <Row label="Configured role name (K8S_IAM_ROLE_NAME)" value={awsIdentity.manuallyConfiguredRole} />
            )}
          </Card>
        )}

        <Card title="Vault Server Status" accent={sealed === true || initialized === false ? 'bad' : sealed === false && initialized === true ? 'ok' : undefined}>
          <Row label="Sealed" value={typeof sealed === 'boolean' ? <StatusBadge ok={!sealed} label={sealed ? 'Sealed' : 'Unsealed'} /> : '—'} />
          <Row label="Initialized" value={typeof initialized === 'boolean' ? <StatusBadge ok={initialized} label={initialized ? 'Yes' : 'No'} /> : '—'} />
          <Row label="Standby" value={String(vaultHealth?.['standby'] ?? '—')} />
          <Row label="Version" value={String(vaultHealth?.['version'] ?? '—')} />
          <Row label="Cluster" value={String(vaultHealth?.['cluster_name'] ?? '—')} />
          {vaultSeal && (
            <Row label="Seal type / threshold" value={`${String(vaultSeal['type'] ?? '—')} (${String(vaultSeal['t'] ?? '?')}/${String(vaultSeal['n'] ?? '?')})`} />
          )}
        </Card>

        <Card title="Background Jobs" accent={schedulerRunning === false || !auditSocketOk ? 'bad' : 'ok'}>
          <Row label="Rotation scheduler" value={<StatusBadge ok={!!schedulerRunning} label={schedulerRunning ? 'Running' : 'Stopped'} />} />
          {rotation?.nextCheck && <Row label="Next rotation check" value={formatTime(rotation.nextCheck)} />}
          <Row
            label="Audit socket"
            value={
              backgroundJobs.auditSocket.enabled
                ? <StatusBadge ok={backgroundJobs.auditSocket.listening} label={backgroundJobs.auditSocket.listening ? 'Listening' : 'Enabled, not listening'} />
                : <span className="text-gray-400">Disabled</span>
            }
          />
          {backgroundJobs.auditSocket.enabled && (
            <Row label="Connected clients / events received" value={`${backgroundJobs.auditSocket.connectedClients} / ${backgroundJobs.auditSocket.totalEventsReceived}`} />
          )}
          {backgroundJobs.auditSocket.lastEventAt && (
            <Row label="Last audit event" value={formatTime(backgroundJobs.auditSocket.lastEventAt)} />
          )}
          <Row label="Graph cache entries" value={backgroundJobs.graphCacheSize} />
        </Card>
      </div>

      <Card title="Configuration">
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {Object.entries(config)
            .filter(([, v]) => v !== undefined)
            .map(([key, value]) => (
              <div key={key} className="min-w-0">
                <div className="text-xs text-gray-500">{humanizeKey(key)}</div>
                <div className="break-words font-medium text-gray-800">{formatConfigValue(value)}</div>
              </div>
            ))}
        </div>
      </Card>
    </div>
  );
}
