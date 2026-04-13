import { useEffect, useState } from 'react';
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
    ]).then(([h, s, c, e, a, p, ent, grp]) => {
      if (h.status === 'fulfilled') setHealth(h.value as HealthData);
      if (s.status === 'fulfilled') setSeal(s.value as SealData);
      if (c.status === 'fulfilled') setCounters(c.value as CountersData);
      if (e.status === 'fulfilled') setEngines(e.value);
      if (a.status === 'fulfilled') setAuthMethods(a.value);
      if (p.status === 'fulfilled') setPolicies(p.value);
      if (ent.status === 'fulfilled') setEntities(ent.value);
      if (grp.status === 'fulfilled') setGroups(grp.value);
      setLoading(false);
    });
  }, []);

  if (loading) return <LoadingSpinner className="mt-12" />;

  const isHealthy = health?.initialized && !health?.sealed;
  const serverTime = health?.server_time_utc
    ? new Date(health.server_time_utc * 1000).toLocaleString()
    : '—';

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

    </div>
  );
}
