import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as api from '../../lib/api';
import type { ClientDetailResponse, IdentityField, VaultClientIdentity } from '../../../shared/clientIntelligence';
import { BackendIcon, backendLabel, fmt, fmtAgo, fmtTime, Icon, Skeleton } from './shared';

type Tab = 'overview' | 'identity' | 'activity' | 'evidence';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'identity', label: 'Identity' },
  { id: 'activity', label: 'Activity' },
  { id: 'evidence', label: 'Evidence' },
];

// Fields a backend normally yields; shown as "Not available" when Vault did not supply them.
const EXPECTED: Record<string, [string, string][]> = {
  kubernetes: [['namespace', 'Namespace'], ['serviceAccount', 'Service account']],
  aws: [['account', 'AWS account'], ['arn', 'IAM principal']],
  github: [['username', 'GitHub user'], ['repository', 'Repository']],
  approle: [['role', 'Role']],
};
// Backends where an auth role is part of the model (so "no role" is worth stating).
const ROLE_BACKENDS = new Set(['kubernetes', 'approle', 'jwt', 'oidc', 'aws']);
// Long technical identifiers (and details that only repeat the role) live on the Identity tab, not the overview.
const TECHNICAL = new Set(['serviceAccountUid', 'uniqueId', 'roleId', 'serial', 'subjectKeyId', 'principalType', 'principalName']);

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" aria-label={`Copy ${label}`} title={`Copy ${label}`} className="ci-muted shrink-0 rounded p-0.5 transition-colors hover:text-[var(--ci-text)]"
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }).catch(() => undefined); }}>
      {done ? <span className="text-[10px] text-emerald-500">copied</span> : <Icon name="doc" className="h-3.5 w-3.5" />}
    </button>
  );
}

/** One label/value line. Values stay on a single line (ellipsis + tooltip) so nothing wraps mid-word. */
function Row({ label, value, mono = true, copy, via, children }: { label: string; value?: string; mono?: boolean; copy?: boolean; via?: string; children?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[124px_minmax(0,1fr)] items-center gap-x-3 border-b border-[var(--ci-row-line)] py-[7px] last:border-0">
      <dt className="ci-muted text-[11.5px]">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1.5 text-[12.5px]" data-testid="field-value">
        {children ?? (value
          ? <span className={`min-w-0 truncate ${mono ? 'font-mono text-[12px]' : ''}`} title={value}>{value}</span>
          : <span className="ci-muted italic">Not available</span>)}
        {value && via && <span className="ci-muted ml-auto shrink-0 pl-2 text-[10.5px]" title="Where this value came from">{via}</span>}
        {value && copy && <Copy value={value} label={label} />}
      </dd>
    </div>
  );
}

const Section = ({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) => (
  <section>
    <div className="mb-1 flex items-baseline justify-between">
      <h3 className="ci-muted text-[10.5px] font-semibold uppercase tracking-[0.1em]">{title}</h3>
      {aside}
    </div>
    {children}
  </section>
);

function Spark({ history }: { history: { day: string; requests: number }[] }) {
  const max = Math.max(1, ...history.map((h) => h.requests));
  if (history.length === 0) return <p className="ci-muted text-xs">No audit-observed requests in this window.</p>;
  return (
    <svg viewBox={`0 0 ${history.length * 8} 40`} className="h-14 w-full" role="img" aria-label="Requests per day" preserveAspectRatio="none">
      {history.map((h, i) => (
        <rect key={h.day} className="ci-bar" style={{ ['--i' as string]: i }} x={i * 8 + 1} width="6" y={40 - (h.requests / max) * 38} height={Math.max((h.requests / max) * 38, 1)} fill="var(--ci-accent)" rx="1">
          <title>{`${h.day}: ${h.requests}`}</title>
        </rect>
      ))}
    </svg>
  );
}

const mountName = (path?: string) => (path ? path.replace(/^auth\//, '').replace(/\/$/, '') : undefined);

export default function ClientDrawer({ client, days, onClose }: { client: VaultClientIdentity; days: number; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [detail, setDetail] = useState<ClientDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [allEvents, setAllEvents] = useState(false);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const [ind, setInd] = useState({ left: 0, width: 0 });

  useEffect(() => {
    let live = true;
    setDetail(null); setError(null); setTab('overview'); setAllEvents(false);
    api.getClientDetail(client.id, days).then((d) => live && setDetail(d)).catch((e: unknown) => live && setError(e instanceof Error ? e.message : 'Failed to load client detail'));
    return () => { live = false; };
  }, [client.id, days]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useLayoutEffect(() => {
    const el = tabRefs.current[tab];
    if (el) setInd({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab, client.id]);

  const c = detail?.client ?? client;
  const fields = c.source.fields.filter((f) => f.key !== 'role');
  const byKey = new Map(c.source.fields.map((f) => [f.key, f]));
  const overviewFields = fields.filter((f) => !TECHNICAL.has(f.key)).slice(0, 4);
  const missing = (EXPECTED[c.auth.type] ?? []).filter(([k]) => !byKey.has(k) && !(k === 'role' && c.auth.role));
  const showRole = !!c.auth.role || ROLE_BACKENDS.has(c.auth.type);
  const mount = mountName(c.auth.mountPath);
  const ips = c.network.observedIps;
  const lines = c.source.primaryIdentifier.split('\n');
  const err = c.activity.observedErrors ?? 0;
  const exportClient = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), windowDays: days, client: c, coverage: detail?.coverage }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `vault-client-${c.displayName.replace(/[^\w.-]+/g, '_')}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="ci-panel ci-drawer flex flex-col" data-testid="client-drawer" aria-label={`Client ${c.displayName}`}>
      <header className="flex items-center gap-3 px-4 pb-3 pt-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ci-border-2)] bg-[var(--ci-panel-2)]"><BackendIcon type={c.auth.type} className="h-7 w-7" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[17px] font-semibold leading-tight" title={c.displayName}>{c.displayName}</h2>
          <p className="ci-muted truncate text-xs">{backendLabel(c.auth.type)}{mount && <> · <span className="font-mono">{mount}</span></>}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close detail panel" className="ci-btn !px-2 !py-1" data-testid="drawer-close">✕</button>
      </header>

      <div role="tablist" className="relative mx-4 flex gap-5 border-b border-[var(--ci-border)] text-[12.5px]">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} ref={(el) => { tabRefs.current[t.id] = el; }} onClick={() => setTab(t.id)}
            className={`whitespace-nowrap pb-2.5 pt-1 transition-colors ${tab === t.id ? 'font-medium text-[var(--ci-text)]' : 'ci-muted hover:text-[var(--ci-text)]'}`}>
            {t.label}
          </button>
        ))}
        <span className="ci-tab-ind" style={{ left: ind.left, width: ind.width }} />
      </div>

      <div className="ci-fade-in min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4" key={tab} role="tabpanel">
        {error && <p className="text-xs text-red-700" role="alert">{error}</p>}

        {tab === 'overview' && (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[28px] font-bold leading-none tabular-nums">{fmt(c.activity.requests)}</div>
                <div className="ci-muted mt-1 text-[11.5px]">requests · {days === 1 ? 'last 24 hours' : `last ${days} days`}</div>
              </div>
              <div className="ci-muted text-right text-[11.5px] leading-snug">
                <div>last seen <span className="text-[var(--ci-text)]" title={fmtTime(c.activity.lastObservedAt)}>{fmtAgo(c.activity.lastObservedAt)}</span></div>
                <div>{fmt(c.activity.requests24h)} in 24h</div>
              </div>
            </div>

            <Section title="Identity">
              <dl>
                {showRole && <Row label="Role" value={c.auth.role} />}
                {overviewFields.map((f) => <Row key={f.key} label={f.label} value={f.value} />)}
                {missing.map(([k, l]) => <Row key={k} label={l} />)}
                {overviewFields.length === 0 && missing.length === 0 && lines[0] && <Row label="Identifier" value={lines.join(' · ')} />}
              </dl>
            </Section>

            <Section title="Network" aside={ips.length > 4 ? <button type="button" className="text-[11px] text-[var(--ci-accent-2)] hover:underline" onClick={() => setTab('activity')}>all {ips.length} IPs</button> : undefined}>
              {ips.length === 0 ? <p className="ci-muted text-xs">No source IP observed in audit data.</p> : (
                <div className="flex flex-wrap gap-1.5 pt-1">{ips.slice(0, 4).map((ip) => <span key={ip} className="ci-chip">{ip}</span>)}{ips.length > 4 && <span className="ci-chip">+{ips.length - 4}</span>}</div>
              )}
            </Section>
          </>
        )}

        {tab === 'identity' && (
          <div className="space-y-5" data-testid="identity-fields">
            <Section title="Client">
              <dl>
                {lines.map((l, i) => <Row key={l} label={i === 0 ? 'Identifier' : ''} value={l} copy={i === 0} />)}
                <Row label="Role" value={c.auth.role} />
                <Row label="Alias" value={c.identity.aliasName} copy />
                <Row label="Entity ID" value={c.identity.entityId} copy />
                <Row label="Vault client ID" value={c.vaultClientId ?? (c.id.startsWith('anon:') ? undefined : c.id)} copy />
              </dl>
            </Section>
            <Section title="Mount">
              <dl>
                <Row label="Backend" mono={false}><BackendIcon type={c.auth.type} className="h-4 w-4" /><span>{backendLabel(c.auth.type)}</span></Row>
                <Row label="Path" value={c.auth.mountPath} copy />
                <Row label="Accessor" value={c.auth.mountAccessor} copy />
                <Row label="Vault namespace" value={c.vaultNamespace} />
                <Row label="Vault type" value={c.clientType} />
              </dl>
            </Section>
            {(fields.length > 0 || missing.length > 0) && (
              <Section title={`${backendLabel(c.auth.type)} details`}>
                <dl>
                  {fields.map((f: IdentityField) => <Row key={f.key} label={f.label} value={f.value} via={f.source} copy />)}
                  {missing.map(([k, l]) => <Row key={k} label={l} />)}
                </dl>
              </Section>
            )}
            {Object.keys(c.identity.metadata).length > 0 && (
              <details className="group">
                <summary className="ci-muted cursor-pointer select-none text-[10.5px] font-semibold uppercase tracking-[0.1em] hover:text-[var(--ci-text)]">Raw alias metadata ({Object.keys(c.identity.metadata).length})</summary>
                <dl className="mt-1">{Object.entries(c.identity.metadata).map(([k, v]) => <Row key={k} label={k} value={v} />)}</dl>
              </details>
            )}
          </div>
        )}

        {tab === 'activity' && (
          <>
            <Section title="Requests per day">
              <div className="pt-1">{detail ? <Spark history={detail.history} /> : <Skeleton className="block h-14 w-full" />}</div>
              {detail?.coverage.partial && <p className="mt-1.5 text-[11.5px] text-amber-700">Observed since {detail.coverage.collectionStartedAt?.slice(0, 10)} only ({detail.coverage.coveredDays} of {detail.coverage.requestedDays} days).</p>}
            </Section>
            <Section title="Summary">
              <dl>
                <Row label="Window" value={c.activity.requests === undefined ? undefined : fmt(c.activity.requests)} />
                <Row label="Last 24h" value={c.activity.requests24h === undefined ? undefined : fmt(c.activity.requests24h)} />
                <Row label="Last 7d" value={c.activity.requests7d === undefined ? undefined : fmt(c.activity.requests7d)} />
                <Row label="Errors" value={c.activity.requests ? `${err} (${((err / c.activity.requests) * 100).toFixed(1)}%)` : undefined} />
                <Row label="First seen" value={c.activity.firstObservedAt ? fmtTime(c.activity.firstObservedAt) : undefined} mono={false} />
                <Row label="Last seen" value={c.activity.lastObservedAt ? fmtTime(c.activity.lastObservedAt) : undefined} mono={false} />
              </dl>
            </Section>
            <Section title="Source IPs">
              {c.network.ips.length === 0 ? <p className="ci-muted text-xs">No source IP observed in audit data.</p> : (
                <table className="w-full text-[12px]" data-testid="ip-table">
                  <thead className="ci-muted"><tr><th className="py-1 text-left font-normal">IP</th><th className="text-right font-normal">Requests</th><th className="text-right font-normal">Last seen</th></tr></thead>
                  <tbody>{c.network.ips.map((i) => (
                    <tr key={i.ip} className="border-t border-[var(--ci-row-line)]"><td className="py-1.5 font-mono">{i.ip}</td><td className="text-right tabular-nums">{fmt(i.requests)}</td><td className="text-right">{fmtAgo(i.lastSeen)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Section>
          </>
        )}

        {tab === 'evidence' && (
          <>
            <Section title="Why this attribution">
              <ul className="space-y-1.5 pt-1 text-[12.5px] leading-snug" data-testid="attribution-evidence">
                {c.source.evidence.map((e) => <li key={e} className="flex gap-2"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--ci-accent-2)]" />{e}</li>)}
              </ul>
              <p className="ci-muted mt-2 text-[11.5px]">Data sources: {c.origins.join(', ')}</p>
            </Section>
            <Section title="Correlated audit events" aside={<Link to="/admin/audit-log" className="text-[11px] text-[var(--ci-accent-2)] hover:underline">Open Audit Logs →</Link>}>
              {!detail ? <Skeleton className="block h-16 w-full" /> : detail.evidence.length === 0 ? (
                <p className="ci-muted text-xs" data-testid="no-evidence">{detail.coverage.auditAvailable ? 'No retained audit events for this client.' : 'No audit evidence — audit collection is unavailable.'}</p>
              ) : (
                <ul data-testid="evidence-table">
                  {detail.evidence.slice(0, allEvents ? detail.evidence.length : 6).map((e) => (
                    <li key={e.requestId} className="border-b border-[var(--ci-row-line)] py-2 last:border-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={`min-w-0 truncate font-mono text-[12px] ${e.error ? 'text-red-700' : ''}`} title={`${e.operation} ${e.path}`}><b className="font-medium">{e.operation}</b> {e.path}</span>
                        <span className="ci-muted shrink-0 text-[11px]" title={fmtTime(e.time)}>{fmtAgo(e.time)}</span>
                      </div>
                      <div className="ci-muted mt-0.5 flex gap-3 font-mono text-[11px]"><span>{e.ip || '—'}</span><span title={e.requestId}>req {e.requestId.slice(0, 8)}</span></div>
                    </li>
                  ))}
                </ul>
              )}
              {detail && detail.evidence.length > 6 && (
                <button type="button" className="mt-1 text-[11.5px] text-[var(--ci-accent-2)] hover:underline" onClick={() => setAllEvents((v) => !v)} data-testid="toggle-events">
                  {allEvents ? 'Show fewer' : `Show all ${detail.evidence.length} events`}
                </button>
              )}
              <p className="ci-muted mt-2 text-[11.5px]">Limited to audit events still retained by the audit source.</p>
            </Section>
          </>
        )}
      </div>

      <footer className="flex gap-2 border-t border-[var(--ci-border)] p-3">
        <button type="button" className="ci-btn flex-1" onClick={() => setTab('evidence')} data-testid="inspect-evidence"><Icon name="search" className="h-3.5 w-3.5" />Audit evidence</button>
        <button type="button" className="ci-btn ci-btn-primary flex-1" onClick={exportClient} data-testid="export-client"><Icon name="download" className="h-3.5 w-3.5" />Export JSON</button>
      </footer>
    </aside>
  );
}
