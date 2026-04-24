import { useEffect, useState, useCallback } from 'react';
import * as api from '../lib/api';
import LoadingSpinner from '../components/common/LoadingSpinner';

interface HealthData {
  initialized?: boolean;
  sealed?: boolean;
  standby?: boolean;
  server_time_utc?: number;
  version?: string;
  cluster_name?: string;
  cluster_id?: string;
  [key: string]: unknown;
}

interface SealData {
  type?: string;
  sealed?: boolean;
  t?: number;
  n?: number;
  progress?: number;
  storage_type?: string;
  [key: string]: unknown;
}

interface CountersData {
  tokens: { counters?: { service_tokens?: { total?: number }; batch_tokens?: { total?: number } } } & Record<string, unknown>;
  entities: { counters?: { entities?: { total?: number } } } & Record<string, unknown>;
  requests: Record<string, unknown>;
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-800">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
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

export default function AnalyticsPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [seal, setSeal] = useState<SealData | null>(null);
  const [counters, setCounters] = useState<CountersData | null>(null);
  const [engines, setEngines] = useState<Awaited<ReturnType<typeof api.getEngines>> | null>(null);
  const [authMethods, setAuthMethods] = useState<Awaited<ReturnType<typeof api.getAuthMethods>> | null>(null);
  const [policies, setPolicies] = useState<string[] | null>(null);
  const [entities, setEntities] = useState<string[] | null>(null);
  const [groups, setGroups] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Audit socket state
  const [auditSource, setAuditSource] = useState<api.AuditSourceInfo | null>(null);
  const [auditDevices, setAuditDevices] = useState<api.AuditDevice[] | null>(null);
  const [auditActionLoading, setAuditActionLoading] = useState(false);
  const [auditActionMsg, setAuditActionMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refreshAudit = useCallback(() => {
    Promise.allSettled([api.getAuditSource(), api.getAuditDevices()]).then(([src, dev]) => {
      if (src.status === 'fulfilled') setAuditSource(src.value);
      if (dev.status === 'fulfilled') setAuditDevices(dev.value);
    });
  }, []);

  useEffect(() => {
    Promise.allSettled([
      api.getVaultHealth(),
      api.getVaultSealStatus(),
      api.getVaultInternalCounters(),
      api.getEngines(),
      api.getAuthMethods(),
      api.getPolicies(),
      api.getEntities(),
      api.getGroups(),
      api.getAuditSource(),
      api.getAuditDevices(),
    ]).then(([h, s, c, e, a, p, ent, grp, src, dev]) => {
      if (h.status === 'fulfilled') setHealth(h.value as HealthData);
      if (s.status === 'fulfilled') setSeal(s.value as SealData);
      if (c.status === 'fulfilled') setCounters(c.value as CountersData);
      if (e.status === 'fulfilled') setEngines(e.value);
      if (a.status === 'fulfilled') setAuthMethods(a.value);
      if (p.status === 'fulfilled') setPolicies(p.value);
      if (ent.status === 'fulfilled') setEntities(ent.value);
      if (grp.status === 'fulfilled') setGroups(grp.value);
      if (src.status === 'fulfilled') setAuditSource(src.value);
      if (dev.status === 'fulfilled') setAuditDevices(dev.value);
      setLoading(false);
    });
  }, []);

  if (loading) return <LoadingSpinner className="mt-12" />;

  const isHealthy = health?.initialized && !health?.sealed;
  const serverTime = health?.server_time_utc
    ? new Date(health.server_time_utc * 1000).toLocaleString()
    : '—';

  const socketRegistered = auditDevices?.some((d) => d.type === 'socket') ?? false;

  async function handleRegisterSocket() {
    setAuditActionLoading(true);
    setAuditActionMsg(null);
    try {
      const result = await api.registerAuditSocket();
      setAuditActionMsg({ type: 'success', text: result.message });
      refreshAudit();
    } catch (e: unknown) {
      setAuditActionMsg({ type: 'error', text: e instanceof Error ? e.message : 'Registration failed.' });
    } finally {
      setAuditActionLoading(false);
    }
  }

  async function handleDeregisterSocket() {
    setAuditActionLoading(true);
    setAuditActionMsg(null);
    try {
      const result = await api.deregisterAuditSocket();
      setAuditActionMsg({ type: 'success', text: result.message });
      refreshAudit();
    } catch (e: unknown) {
      setAuditActionMsg({ type: 'error', text: e instanceof Error ? e.message : 'Deregistration failed.' });
    } finally {
      setAuditActionLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Vault Analytics</h1>
        <p className="mt-1 text-sm text-gray-500">
          Cluster health, seal status, and resource counts
        </p>
      </div>

      {/* ---- Health & Status ---- */}
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">
          Cluster Status
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">Health</p>
            <div className="mt-2">
              {health ? (
                <StatusBadge ok={!!isHealthy} label={isHealthy ? 'Healthy' : 'Degraded'} />
              ) : (
                <span className="text-sm text-gray-400">Unavailable</span>
              )}
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <p className="text-xs font-medium tracking-wide text-gray-500 uppercase">Seal Status</p>
            <div className="mt-2">
              {seal ? (
                <StatusBadge ok={!seal.sealed} label={seal.sealed ? 'Sealed' : 'Unsealed'} />
              ) : (
                <span className="text-sm text-gray-400">Unavailable</span>
              )}
            </div>
          </div>
          <StatCard label="Version" value={health?.version ?? '—'} />
          <StatCard label="Cluster" value={health?.cluster_name ?? '—'} />
          <StatCard
            label="Storage"
            value={seal?.storage_type ?? '—'}
            sub={seal?.type ? `Seal: ${seal.type}` : undefined}
          />
          <StatCard label="Server Time" value={serverTime} />
          {seal?.t != null && seal?.n != null && (
            <StatCard
              label="Key Shares"
              value={`${seal.t} / ${seal.n}`}
              sub="Threshold / Total"
            />
          )}
        </div>
      </section>

      {/* ---- Resource Counts ---- */}
      <section>
        <h2 className="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">
          Resource Counts
        </h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard
            label="Secrets Engines"
            value={engines?.length ?? '—'}
          />
          <StatCard
            label="Auth Methods"
            value={authMethods?.length ?? '—'}
          />
          <StatCard
            label="ACL Policies"
            value={policies?.length ?? '—'}
          />
          <StatCard
            label="Entities"
            value={entities?.length ?? '—'}
          />
          <StatCard
            label="Groups"
            value={groups?.length ?? '—'}
          />
        </div>
      </section>

      {/* ---- Internal Counters ---- */}
      {counters && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">
            Internal Counters
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {counters.tokens?.counters && (
              <>
                <StatCard
                  label="Service Tokens"
                  value={(counters.tokens.counters as Record<string, Record<string, number>>)?.service_tokens?.total ?? '—'}
                />
                <StatCard
                  label="Batch Tokens"
                  value={(counters.tokens.counters as Record<string, Record<string, number>>)?.batch_tokens?.total ?? 0}
                />
              </>
            )}
            {counters.entities?.counters && (
              <StatCard
                label="Identity Entities (Counter)"
                value={(counters.entities.counters as Record<string, Record<string, number>>)?.entities?.total ?? '—'}
              />
            )}
          </div>
        </section>
      )}

      {/* ---- Audit Logging ---- */}
      {auditSource && (
        <section>
          <h2 className="mb-3 text-sm font-semibold tracking-wide text-gray-500 uppercase">
            Audit Logging
          </h2>
          <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
            {/* Source & registration status */}
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <p className="text-xs font-medium tracking-wide text-gray-500 uppercase mb-1">Source</p>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
                  ${auditSource.source === 'socket' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                  <span className={`inline-block h-1.5 w-1.5 rounded-full
                    ${auditSource.source === 'socket' ? 'bg-blue-500' : 'bg-gray-400'}`} />
                  {auditSource.source === 'socket' ? 'Socket (real-time)' : 'File'}
                </span>
              </div>
              {auditSource.source === 'socket' && (
                <>
                  <div>
                    <p className="text-xs font-medium tracking-wide text-gray-500 uppercase mb-1">Server</p>
                    <StatusBadge ok={auditSource.socket.listening} label={auditSource.socket.listening ? `Listening :${auditSource.socket.port}` : 'Not listening'} />
                  </div>
                  <div>
                    <p className="text-xs font-medium tracking-wide text-gray-500 uppercase mb-1">Vault Registration</p>
                    <StatusBadge ok={socketRegistered} label={socketRegistered ? 'Registered' : 'Not registered'} />
                  </div>
                </>
              )}
            </div>

            {/* Socket stats */}
            {auditSource.source === 'socket' && auditSource.socket.listening && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 pt-2 border-t border-gray-100">
                <div>
                  <p className="text-xs text-gray-500">Connected Clients</p>
                  <p className="text-lg font-semibold text-gray-800">{auditSource.socket.connectedClients}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Events Received</p>
                  <p className="text-lg font-semibold text-gray-800">{auditSource.socket.totalEventsReceived.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Buffer Size</p>
                  <p className="text-lg font-semibold text-gray-800">{auditSource.socket.bufferSize.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Last Event</p>
                  <p className="text-sm font-medium text-gray-700">
                    {auditSource.socket.lastEventAt
                      ? new Date(auditSource.socket.lastEventAt).toLocaleTimeString()
                      : '—'}
                  </p>
                </div>
              </div>
            )}

            {/* Action feedback */}
            {auditActionMsg && (
              <div className={`rounded-md px-3 py-2 text-sm ${
                auditActionMsg.type === 'success'
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {auditActionMsg.text}
              </div>
            )}

            {/* Register / Deregister buttons (socket mode only) */}
            {auditSource.source === 'socket' && (
              <div className="flex gap-3 pt-1">
                {!socketRegistered ? (
                  <button
                    onClick={handleRegisterSocket}
                    disabled={auditActionLoading}
                    className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {auditActionLoading ? 'Registering…' : 'Register Socket with Vault'}
                  </button>
                ) : (
                  <button
                    onClick={handleDeregisterSocket}
                    disabled={auditActionLoading}
                    className="rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {auditActionLoading ? 'Deregistering…' : 'Deregister Socket'}
                  </button>
                )}
                <button
                  onClick={() => { setAuditActionMsg(null); refreshAudit(); }}
                  disabled={auditActionLoading}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Refresh
                </button>
              </div>
            )}
          </div>
        </section>
      )}

    </div>
  );
}
