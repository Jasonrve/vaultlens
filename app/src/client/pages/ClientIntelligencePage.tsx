import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../lib/api';
import type {
  ActivityResponse, TopResponse, BackendsResponse, ClientListResponse, ClientQuery, ClientSummary, VaultClientIdentity,
} from '../../shared/clientIntelligence';
import { ActivityChart, BackendDonut, TopUsers } from '../components/client-intelligence/Charts';
import ClientTable from '../components/client-intelligence/ClientTable';
import ClientDrawer from '../components/client-intelligence/ClientDrawer';
import { backendLabel, fmt, fmtTime, Icon, prefersReducedMotion, RANGES, Skeleton, useCountUp } from '../components/client-intelligence/shared';
import '../components/client-intelligence/ci.css';

const PAGE_SIZE = 25;
const errMsg = (e: unknown, fallback: string) => {
  const r = (e as { response?: { status?: number; data?: { error?: string } } })?.response;
  if (r?.status === 403) return 'Insufficient permissions to view client data.';
  return r?.data?.error ?? (e instanceof Error ? e.message : fallback);
};
const SLIDE_MS = 1000; // detail panel slide duration (keep in sync with ci.css)

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function Kpi({ label, value, sub, loading, tone, icon, testId, delay }: { label: string; value: number | null | undefined; sub: string; loading: boolean; tone: string; icon: 'users' | 'pulse' | 'warn' | 'pin'; testId: string; delay: number }) {
  const shown = useCountUp(value);
  return (
    <div className="ci-panel ci-hover ci-rise flex items-center gap-3.5 px-4 py-3.5" style={{ ['--d' as string]: delay }} data-testid={testId}>
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border" style={{ background: `${tone}1a`, color: tone, borderColor: `${tone}40` }}><Icon name={icon} className="h-5 w-5" /></div>
      <div className="min-w-0">
        <div className="ci-muted text-xs">{label}</div>
        <div className="text-[28px] font-bold leading-tight tabular-nums" data-testid={`${testId}-value`}>{loading ? <Skeleton className="h-7 w-16" /> : fmt(shown)}</div>
        <div className="ci-muted text-[11px] leading-snug">{sub}</div>
      </div>
    </div>
  );
}

function ExportMenu({ busy, onExport }: { busy: boolean; onExport: (f: 'csv' | 'json') => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="ci-btn" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)} data-testid="export-menu">
        <Icon name="download" className="h-3.5 w-3.5" />{busy ? 'Exporting…' : 'Export View'}
      </button>
      {open && (
        <div role="menu" className="ci-pop absolute right-0 z-20 mt-1.5 w-40 overflow-hidden rounded-lg border border-[var(--ci-border-2)] bg-[var(--ci-panel)] py-1 shadow-2xl">
          {(['csv', 'json'] as const).map((f) => (
            <button key={f} role="menuitem" type="button" className="block w-full px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--ci-hover)]" data-testid={`export-${f}`}
              onClick={() => { setOpen(false); onExport(f); }}>
              Export as {f.toUpperCase()}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClientIntelligencePage() {
  const [days, setDays] = useState(30);
  const [backend, setBackend] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [ip, setIp] = useState('');
  const [mount, setMount] = useState('');
  const [unidentified, setUnidentified] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sort, setSort] = useState<NonNullable<ClientQuery['sort']>>('requests');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<VaultClientIdentity | null>(null);
  const [panelOpen, setPanelOpen] = useState(false); // drives the slide; `selected` stays mounted until the slide-out ends
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [summary, setSummary] = useState<ClientSummary | null>(null);
  const [backends, setBackends] = useState<BackendsResponse | null>(null);
  const [activity, setActivity] = useState<ActivityResponse | null>(null);
  const [top, setTop] = useState<TopResponse | null>(null);
  const [list, setList] = useState<ClientListResponse | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);

  const dSearch = useDebounced(search);
  const dIp = useDebounced(ip);

  const query: Partial<ClientQuery> = {
    days, search: dSearch, backend, mount, ip: dIp, sort, dir, unidentified,
  };
  const filterKey = JSON.stringify(query);

  // Window-level data (not paginated).
  useEffect(() => {
    let live = true;
    setLoading(true);
    setSummaryError(null);
    Promise.all([api.getClientSummary(days), api.getClientBackends(days)])
      .then(([s, b]) => { if (live) { setSummary(s); setBackends(b); } })
      .catch((e: unknown) => live && setSummaryError(errMsg(e, 'Failed to load client summary')))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [days]);

  // Fresh collections (< 2 days) and the 24h window read better as hourly buckets.
  const hourly = days === 1 || (!!summary && summary.coverage.auditAvailable && summary.coverage.coveredDays < 2);
  useEffect(() => {
    if (!summary) return;
    let live = true;
    api.getClientActivity(days, backend, hourly ? 'hour' : 'day').then((a) => live && setActivity(a)).catch(() => live && setActivity(null));
    return () => { live = false; };
  }, [days, backend, hourly, summary]);

  useEffect(() => {
    if (!summary) return;
    let live = true;
    api.getClientTop(days).then((t) => live && setTop(t)).catch(() => live && setTop(null));
    return () => { live = false; };
  }, [days, summary]);

  useEffect(() => { setOffset(0); }, [filterKey]);

  useEffect(() => {
    let live = true;
    setListError(null);
    api.getClients({ ...query, offset, limit: PAGE_SIZE })
      .then((l) => live && setList(l))
      .catch((e: unknown) => live && setListError(errMsg(e, 'Failed to load clients')));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, offset]);

  useEffect(() => () => { if (unmountTimer.current) clearTimeout(unmountTimer.current); }, []);

  const select = (c: VaultClientIdentity) => {
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    setSelected(c);
    setPanelOpen(true);
  };
  const close = useCallback(() => {
    setPanelOpen(false);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    unmountTimer.current = setTimeout(() => setSelected(null), prefersReducedMotion() ? 0 : SLIDE_MS);
  }, []);

  const onSort = useCallback((k: NonNullable<ClientQuery['sort']>) => {
    if (k === sort) { setDir((d) => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSort(k);
    setDir(k === 'client' || k === 'backend' || k === 'role' ? 'asc' : 'desc');
  }, [sort]);

  const clear = () => { setSearch(''); setIp(''); setMount(''); setUnidentified(false); setBackend(undefined); };

  const doExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    setNotice(null);
    try {
      const { partial } = await api.downloadClientExport(query, format);
      setNotice(partial ? { kind: 'warn', text: 'Export completed with partial data: Vault client activity was unavailable, so only audit-observed clients are included.' } : { kind: 'ok', text: `Exported ${list?.total ?? 0} clients (${format.toUpperCase()}).` });
    } catch (e) {
      setNotice({ kind: 'err', text: `Export failed: ${errMsg(e, 'unknown error')}` });
    } finally {
      setExporting(false);
    }
  };

  const doTopExport = async (format: 'csv' | 'json') => {
    setExporting(true);
    setNotice(null);
    try { await api.downloadTopExport(days, format); } catch (e) { setNotice({ kind: 'err', text: `Export failed: ${errMsg(e, 'unknown error')}` }); } finally { setExporting(false); }
  };

  const range = RANGES.find((r) => r.days === days)!;
  const act = summary?.activity;
  const cov = summary?.coverage;
  const extraFilters = [mount, unidentified].filter(Boolean).length;
  const hasFilters = !!(search || ip || mount || unidentified || backend);

  return (
    <div className="ci-root -m-6 p-5" data-testid="client-intelligence-page">
      <div className="mx-auto max-w-[1760px] space-y-3.5">
        <div className="ci-rise flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--ci-accent-2)]">Client Intelligence</p>
            <h1 className="text-[26px] font-bold leading-tight">Client Intelligence</h1>
            <p className="ci-muted mt-0.5 text-[13px]">Identify which clients are calling Vault, where they come from, their IPs, and how often they call.</p>
          </div>
          <select className="ci-input" value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Time range" data-testid="range-select">
            {RANGES.map((r) => <option key={r.days} value={r.days}>{r.label}</option>)}
          </select>
        </div>

        {summaryError && <div className="ci-fade-in rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-800" role="alert" data-testid="summary-error">{summaryError}</div>}
        {act && !act.available && (
          <div className="ci-fade-in rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800" role="status" data-testid="activity-unavailable">
            <strong>Vault client activity unavailable</strong> ({act.reason}) — {act.message} Showing audit-observed clients only.
          </div>
        )}
        {cov?.dataGapAt && (
          <div className="ci-fade-in rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800" role="status" data-testid="audit-gap">
            <strong>Request counts may be incomplete.</strong> The audit buffer overflowed (last at {fmtTime(cov.dataGapAt)}), so some requests were overwritten before they were counted. Reduce audit volume or use a larger audit source for exact totals.
          </div>
        )}
        {act?.available && !act.exportAvailable && (
          <div className="ci-fade-in rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800" role="status">{act.message}</div>
        )}

        <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_minmax(300px,390px)_330px]">
          <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4 xl:col-span-2">
            <Kpi delay={1} testId="kpi-unique" tone="#60a5fa" icon="users" label="Unique Clients" loading={loading} value={summary?.uniqueClients}
              sub={act && !act.available ? 'Vault activity unavailable' : 'Vault-reported, deduplicated · month-aligned'} />
            <Kpi delay={2} testId="kpi-active" tone="#34d399" icon="pulse" label={`Active (${range.label.toLowerCase()})`} loading={loading} value={summary?.activeClients}
              sub={cov && !cov.auditAvailable ? 'No audit data collected' : 'Observed in audit within window'} />
            <Kpi delay={3} testId="kpi-unattributed" tone="#a78bfa" icon="warn" label="Unattributed" loading={loading} value={summary?.unattributed}
              sub="Could not be reliably identified" />
            <Kpi delay={4} testId="kpi-ips" tone="#f472b6" icon="pin" label="Unique Source IPs" loading={loading} value={summary?.uniqueIps}
              sub={cov?.auditAvailable ? `Audit-observed${cov.partial ? `, ${cov.coveredDays}d covered` : ''}` : 'No audit data collected'} />
          </div>

          <div className="ci-panel ci-rise p-4 xl:row-span-2" style={{ ['--d' as string]: 3 }} data-testid="data-sources">
            <h2 className="ci-h mb-3">Data Sources</h2>
            {[
              { icon: 'db' as const, title: 'Vault Client Activity API / Export', badge: loading ? '…' : act?.available ? 'Primary' : 'Unavailable', cls: act?.available ? 'ci-pill-high' : 'ci-pill-low',
                text: 'Source of truth for client identities, Vault client counts and basic metadata (not request volume).' },
              { icon: 'doc' as const, title: 'Audit Logs', badge: loading ? '…' : cov?.auditAvailable ? (cov.partial ? 'Partial' : 'Enrichment') : 'No data', cls: cov?.auditAvailable ? (cov.partial ? 'ci-pill-medium' : 'ci-pill-high') : 'ci-pill-unknown',
                text: `Source IPs and request counts. Retained ${summary?.retentionDays ?? '—'} days${cov?.collectionStartedAt ? `; collecting since ${cov.collectionStartedAt.slice(0, 10)}` : ''}.` },
            ].map((s) => (
              <div key={s.title} className="mb-2.5 flex gap-3 rounded-lg border border-[var(--ci-border)] bg-[var(--ci-inset)] p-3 transition-colors hover:border-[var(--ci-border-2)]">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--ci-border-2)] bg-[var(--ci-panel-2)] text-[var(--ci-accent-2)]"><Icon name={s.icon} className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold">{s.title}<span className={`ci-pill ${s.cls}`}>{s.badge}</span></div>
                  <p className="ci-muted mt-1 text-[11.5px] leading-snug">{s.text}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="ci-rise" style={{ ['--d' as string]: 4 }}><ActivityChart data={activity} loading={loading} days={days} backend={backend} /></div>
          <div className="ci-rise" style={{ ['--d' as string]: 5 }}><BackendDonut backends={backends?.backends ?? []} loading={loading} selected={backend} onSelect={setBackend} /></div>
        </div>

        <div className="ci-split" data-open={panelOpen} data-testid="split">
          <section className="ci-panel ci-rise" style={{ ['--d' as string]: 6 }}>
            <div className="flex flex-wrap items-start justify-between gap-2 px-4 pb-2 pt-3.5">
              <div>
                <h2 className="text-[16px] font-semibold">Observed Clients</h2>
                <p className="ci-muted text-[11.5px]">All clients that have called Vault, with their source, identity, and request activity.</p>
              </div>
              <ExportMenu busy={exporting} onExport={doExport} />
            </div>
            {notice && (
              <div role={notice.kind === 'err' ? 'alert' : 'status'} data-testid="export-notice"
                className={`ci-fade-in mx-4 mb-2 rounded-lg border p-2 text-xs ${notice.kind === 'err' ? 'border-red-500/30 bg-red-500/10 text-red-800' : notice.kind === 'warn' ? 'border-amber-500/30 bg-amber-500/10 text-amber-800' : 'border-emerald-500/30 bg-emerald-500/10 text-green-800'}`}>
                {notice.text}
              </div>
            )}
            <div className="space-y-2 px-4 pb-3" data-testid="filters">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[220px] flex-1">
                  <Icon name="search" className="ci-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                  <input className="ci-input w-full !pl-8" type="search" placeholder="Search clients, roles, IPs, ARNs, namespaces…" aria-label="Search clients" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="search" />
                </div>
                <select className="ci-input" aria-label="Auth backend" value={backend ?? ''} onChange={(e) => setBackend(e.target.value || undefined)} data-testid="filter-backend">
                  <option value="">All Auth Backends</option>
                  {(backends?.backends ?? []).map((b) => <option key={b.type} value={b.type}>{backendLabel(b.type)}</option>)}
                </select>
                <div className="relative">
                  <Icon name="filter" className="ci-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                  <input className="ci-input w-44 !pl-8" placeholder="IP filter (10.0.0.0/8)" aria-label="IP filter" value={ip} onChange={(e) => setIp(e.target.value)} data-testid="filter-ip" />
                </div>
                <button type="button" className="ci-btn" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} data-testid="filters-more">
                  More{extraFilters > 0 && <span className="rounded-full bg-[#6366f1] px-1.5 text-[10px] leading-4 text-white">{extraFilters}</span>}
                </button>
                {hasFilters && <button type="button" className="ci-fade-in text-xs text-[var(--ci-accent-2)] hover:underline" onClick={clear} data-testid="clear-filters">Clear</button>}
              </div>
              {moreOpen && (
                <div className="ci-fade-in flex flex-wrap items-center gap-2">
                  <select className="ci-input" aria-label="Auth mount" value={mount} onChange={(e) => setMount(e.target.value)} data-testid="filter-mount">
                    <option value="">All Mounts</option>
                    {(backends?.mounts ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-indigo-500" checked={unidentified} onChange={(e) => setUnidentified(e.target.checked)} data-testid="filter-unidentified" />Unidentified only</label>
                </div>
              )}
            </div>
            <ClientTable
              clients={list?.clients ?? []} total={list?.total ?? 0} offset={offset} limit={PAGE_SIZE}
              loading={!list && !listError} error={listError ?? undefined} sort={sort} dir={dir}
              selectedId={panelOpen ? selected?.id : undefined} auditAvailable={!!cov?.auditAvailable}
              onSort={onSort} onPage={setOffset} onSelect={select}
            />
          </section>

          <div className="ci-drawer-wrap" aria-hidden={!panelOpen} data-testid="drawer-wrap">
            {selected && <ClientDrawer client={selected} days={days} onClose={close} />}
          </div>
        </div>

        <TopUsers data={top} loading={loading} onSelectBackend={setBackend} onSearch={setSearch}
          exportMenu={<ExportMenu busy={exporting} onExport={doTopExport} />} />
      </div>
    </div>
  );
}
