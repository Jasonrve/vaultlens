import { useMemo, useState } from 'react';
import type { ActivityResponse, BackendCount, TopResponse } from '../../../shared/clientIntelligence';
import { BackendIcon, backendColor, backendLabel, fmt, Skeleton, useWidth } from './shared';

const H = 150;
const PAD = { l: 38, r: 6, t: 8, b: 22 };

const axis = (v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(Math.round(v)));

const niceMax = (v: number) => {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m <= 1.5 ? 1.5 : m <= 2 ? 2 : m <= 3 ? 3 : m <= 5 ? 5 : 10) * p;
};

function labelsFor(bucket: 'day' | 'hour', n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  const step = bucket === 'hour' ? 3_600_000 : 86_400_000;
  for (let i = n - 1; i >= 0; i--) out.push(new Date(now - i * step).toISOString().slice(0, bucket === 'hour' ? 13 : 10));
  return out;
}

export function ActivityChart({ data, loading, days, backend }: { data: ActivityResponse | null; loading: boolean; days: number; backend?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [wrapRef, W] = useWidth<HTMLDivElement>();
  const bucket = data?.bucket ?? 'day';
  const cov = data?.coverage;

  const model = useMemo(() => {
    const n = bucket === 'hour' ? 24 : Math.min(Math.max(days, 2), Math.max(7, Math.ceil(cov?.coveredDays ?? days) + 1));
    const byKey = new Map((data?.points ?? []).map((p) => [p.day, p]));
    const totals = new Map<string, number>();
    for (const p of data?.points ?? []) for (const [t, v] of Object.entries(p.byBackend)) totals.set(t, (totals.get(t) ?? 0) + v);
    const types = [...totals.keys()].sort((a, b) => (totals.get(b) ?? 0) - (totals.get(a) ?? 0));
    const since = cov?.collectionStartedAt?.slice(0, bucket === 'hour' ? 13 : 10);
    const cols = labelsFor(bucket, n).map((key) => ({ key, point: byKey.get(key), covered: !!since && key >= since }));
    const max = niceMax(Math.max(0, ...cols.map((c) => c.point?.total ?? 0)));
    return { cols, types, max, n, sig: `${bucket}|${backend ?? ''}|${days}|${data?.points.length ?? 0}|${cols.reduce((a, c) => a + (c.point?.total ?? 0), 0)}` };
  }, [data, bucket, days, backend, cov]);

  const plotW = W - PAD.l - PAD.r;
  const plotH = H - PAD.t - PAD.b;
  const colW = plotW / model.n;
  const y = (v: number) => PAD.t + plotH - (v / model.max) * plotH;
  const hovered = hover !== null ? model.cols[hover] : undefined;
  const tick = (key: string) => (bucket === 'hour' ? `${key.slice(11)}:00` : key.slice(5));
  const every = Math.max(1, Math.ceil(model.n / Math.max(3, Math.floor(plotW / 62))));

  return (
    <div className="ci-panel p-4" data-testid="activity-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="ci-h">Vault requests by client over time</h2>
        <span className="ci-muted text-[11px]">
          Audit-observed requests per UTC {bucket}{backend ? ` · ${backendLabel(backend)}` : ''}
        </span>
      </div>
      {cov && cov.auditAvailable && cov.partial && (
        <p className="ci-fade-in mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] text-amber-800" data-testid="coverage-warning">
          Partial coverage: audit collection started {cov.collectionStartedAt?.slice(0, 10)} ({cov.coveredDays < 1 ? 'under 1 day' : `${cov.coveredDays} days`} of {cov.requestedDays} observed). Hatched = not covered, not zero.
        </p>
      )}
      <div ref={wrapRef} className="relative mt-2">
        {loading && !data ? (
          <Skeleton className="block h-[150px] w-full" />
        ) : cov && !cov.auditAvailable ? (
          <div className="ci-muted flex h-[150px] items-center justify-center text-center text-sm" data-testid="no-audit">
            No audit data has been collected yet. Enable the VaultLens audit source to observe request activity.
          </div>
        ) : (
          <svg width={W} height={H} className="block" role="img" aria-label={`Requests per ${bucket}, stacked by authentication backend`} onMouseLeave={() => setHover(null)}>
            <defs>
              <pattern id="ci-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="var(--ci-hatch-bg)" />
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--ci-hatch-line)" strokeWidth="2" />
              </pattern>
            </defs>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(model.max * f)} y2={y(model.max * f)} stroke="var(--ci-border)" strokeDasharray={f === 0 ? undefined : '3 4'} />
                <text x={PAD.l - 8} y={y(model.max * f) + 3} textAnchor="end" fontSize="10" fill="var(--ci-muted)">{axis(model.max * f)}</text>
              </g>
            ))}
            <g key={model.sig}>
              {model.cols.map((c, i) => {
                const x = PAD.l + i * colW;
                let acc = 0;
                return (
                  <g key={c.key} className="ci-bar-col" onMouseEnter={() => setHover(i)} data-day={c.key}>
                    {!c.covered && <rect x={x + 0.5} y={PAD.t} width={Math.max(colW - 1, 1)} height={plotH} fill="url(#ci-hatch)" />}
                    <rect x={x} y={PAD.t} width={colW} height={plotH} fill={hover === i ? 'var(--ci-sel)' : 'transparent'} style={{ transition: 'fill 160ms ease' }} />
                    {c.point && model.types.map((t) => {
                      const v = c.point!.byBackend[t] ?? 0;
                      if (!v) return null;
                      const h = Math.max((v / model.max) * plotH, 1);
                      acc += h;
                      return <rect key={t} className="ci-bar" style={{ ['--i' as string]: i }} x={x + colW * 0.2} width={Math.max(colW * 0.6, 2)} y={PAD.t + plotH - acc} height={h} fill={backendColor(t)} opacity={hover === null || hover === i ? 1 : 0.5} rx="1.5" />;
                    })}
                  </g>
                );
              })}
            </g>
            {model.cols.map((c, i) => (i % every === 0 ? <text key={c.key} x={PAD.l + i * colW + colW / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--ci-muted)">{tick(c.key)}</text> : null))}
          </svg>
        )}
        {hovered && (
          <div className="ci-fade-in pointer-events-none absolute top-1 z-10 min-w-40 rounded-lg border border-[var(--ci-border-2)] bg-[var(--ci-tip-bg)] p-2.5 text-xs shadow-xl backdrop-blur" style={{ left: Math.min(Math.max(PAD.l + hover! * colW + colW / 2 - 80, 4), W - 172) }} data-testid="chart-tooltip">
            <div className="font-semibold">{hovered.key.replace('T', ' ')}{bucket === 'hour' ? ':00 UTC' : ''}</div>
            {!hovered.covered ? (
              <div className="ci-muted mt-1">Not covered by audit collection</div>
            ) : (
              <>
                <div className="mt-1">{fmt(hovered.point?.total ?? 0)} requests</div>
                {Object.entries(hovered.point?.byBackend ?? {}).map(([t, v]) => (
                  <div key={t} className="mt-0.5 flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: backendColor(t) }} />{backendLabel(t)}</span>
                    <span>{fmt(v)}</span>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
      {data && data.vaultMonthly.length > 0 && (
        <p className="ci-muted mt-1 text-[11px]" data-testid="vault-monthly">
          Vault client counts (deduplicated per month, not request volume):{' '}
          {data.vaultMonthly.slice(-4).map((m) => `${m.month}: ${fmt(m.clients)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

export function BackendDonut({ backends, loading, selected, onSelect }: { backends: BackendCount[]; loading: boolean; selected?: string; onSelect: (t?: string) => void }) {
  const total = backends.reduce((s, b) => s + b.count, 0);
  const r = 50;
  const C = 2 * Math.PI * r;
  const [hot, setHot] = useState<string | undefined>();
  let offset = 0;
  return (
    <div className="ci-panel p-4" data-testid="backend-distribution">
      <h2 className="ci-h">Clients by auth backend</h2>
      {loading && !backends.length ? (
        <div className="mt-3"><Skeleton className="block h-32 w-full" /></div>
      ) : total === 0 ? (
        <p className="ci-muted mt-6 text-sm">No clients to group yet.</p>
      ) : (
        <div className="mt-2 flex items-center gap-4">
          <svg viewBox="0 0 130 130" className="h-[132px] w-[132px] shrink-0 -rotate-90" role="img" aria-label="Clients by authentication backend">
            {backends.map((b, i) => {
              const len = (b.count / total) * C;
              const el = (
                <circle
                  key={b.type} className="ci-seg" cx="65" cy="65" r={r} fill="none" stroke={backendColor(b.type)}
                  style={{ ['--i' as string]: i, ['--C' as string]: C }}
                  strokeWidth={hot === b.type || selected === b.type ? 19 : 14}
                  strokeDasharray={`${Math.max(len - 2, 0)} ${C}`} strokeDashoffset={-offset}
                  opacity={selected && selected !== b.type ? 0.28 : 1}
                  onMouseEnter={() => setHot(b.type)} onMouseLeave={() => setHot(undefined)}
                  onClick={() => onSelect(selected === b.type ? undefined : b.type)}
                />
              );
              offset += len;
              return el;
            })}
            <g className="rotate-90" style={{ transformOrigin: '65px 65px' }}>
              <text x="65" y="65" textAnchor="middle" fontSize="23" fontWeight="700" fill="var(--ci-text)">{total.toLocaleString()}</text>
              <text x="65" y="80" textAnchor="middle" fontSize="10" fill="var(--ci-muted)">Clients</text>
            </g>
          </svg>
          <ul className="min-w-0 flex-1 text-xs">
            {backends.slice(0, 7).map((b) => (
              <li key={b.type}>
                <button
                  type="button" aria-pressed={selected === b.type} data-testid={`backend-${b.type}`}
                  className={`ci-legend-row flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left hover:bg-[var(--ci-hover)] ${selected === b.type ? 'bg-[var(--ci-hover)]' : ''}`}
                  onClick={() => onSelect(selected === b.type ? undefined : b.type)}
                  onMouseEnter={() => setHot(b.type)} onMouseLeave={() => setHot(undefined)}
                >
                  <BackendIcon type={b.type} className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{backendLabel(b.type)}</span>
                  <span className="font-medium tabular-nums">{b.count.toLocaleString()}</span>
                  <span className="ci-muted w-9 text-right tabular-nums">{Math.round((b.count / total) * 100)}%</span>
                </button>
              </li>
            ))}
            {backends.length > 7 && <li className="ci-muted px-1.5 pt-0.5 text-[11px]">+{backends.length - 7} more backends (use the filter)</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Heaviest callers plus request volume per auth method (bars are share of all audit-observed requests). */
export function TopUsers({ data, loading, onSelectBackend, onSearch, exportMenu }: { data: TopResponse | null; loading: boolean; onSelectBackend: (t: string) => void; onSearch: (s: string) => void; exportMenu: React.ReactNode }) {
  const max = Math.max(1, ...(data?.clients ?? []).map((c) => c.requests));
  return (
    <div className="ci-panel p-4" data-testid="top-users">
      <div className="flex items-center justify-between gap-2">
        <h2 className="ci-h">Top callers &amp; auth methods</h2>
        {exportMenu}
      </div>
      {loading || !data ? <Skeleton className="mt-3 h-32 w-full" /> : data.totalRequests === 0 ? (
        <p className="ci-muted mt-3 text-xs">No audit-observed requests in this window.</p>
      ) : (
        <div className="mt-2 grid gap-4 lg:grid-cols-2">
          <ul className="text-xs" aria-label="Top clients by requests">
            {data.clients.map((c) => (
              <li key={c.id}>
                <button type="button" className="ci-legend-row w-full rounded-md px-1.5 py-1 text-left hover:bg-[var(--ci-hover)]" title={`${c.displayName} � ${c.requests.toLocaleString()} requests, ${c.errors} errors`} onClick={() => onSearch(c.displayName)}>
                  <span className="flex items-center gap-2">
                    <BackendIcon type={c.backend} className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate"><span className="font-medium">{c.displayName}</span>{c.detail && c.detail !== c.displayName && <span className="ci-muted ml-1.5 text-[11px]">{c.detail}</span>}</span>
                    <span className="tabular-nums">{fmt(c.requests)}</span>
                    <span className="ci-muted w-9 text-right tabular-nums">{Math.round(c.share * 100)}%</span>
                  </span>
                  <span className="mt-0.5 block h-1 rounded bg-[var(--ci-inset)]"><span className="block h-1 rounded" style={{ width: `${(c.requests / max) * 100}%`, background: backendColor(c.backend) }} /></span>
                </button>
              </li>
            ))}
          </ul>
          <ul className="text-xs" aria-label="Requests by auth method">
            {data.backends.map((b) => (
              <li key={b.type}>
                <button type="button" className="ci-legend-row flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-[var(--ci-hover)]" onClick={() => onSelectBackend(b.type)}>
                  <BackendIcon type={b.type} className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{backendLabel(b.type)}</span>
                  <span className="ci-muted tabular-nums">{b.clients} clients</span>
                  <span className="tabular-nums">{fmt(b.requests)}</span>
                  <span className="ci-muted w-9 text-right tabular-nums">{Math.round(b.share * 100)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
