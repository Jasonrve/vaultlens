import type { ClientQuery, VaultClientIdentity } from '../../../shared/clientIntelligence';
import { BackendIcon, backendLabel, fmt, fmtTime, Skeleton } from './shared';

type SortKey = NonNullable<ClientQuery['sort']>;

function SortHead({ k, label, sort, dir, onSort }: { k: SortKey; label: string; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void }) {
  const active = sort === k;
  return (
    <th aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} data-testid={`sort-${k}`}>
        {label}
        <span className={`transition-opacity ${active ? 'text-[var(--ci-accent-2)]' : 'opacity-40'}`}>{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

interface Props {
  clients: VaultClientIdentity[];
  total: number;
  offset: number;
  limit: number;
  loading: boolean;
  error?: string;
  sort: SortKey;
  dir: 'asc' | 'desc';
  selectedId?: string;
  auditAvailable: boolean;
  onSort: (k: SortKey) => void;
  onPage: (offset: number) => void;
  onSelect: (c: VaultClientIdentity) => void;
}

export default function ClientTable(p: Props) {
  const from = p.total === 0 ? 0 : p.offset + 1;
  const to = Math.min(p.offset + p.limit, p.total);
  return (
    <div data-testid="client-table">
      <div className="overflow-x-auto px-2.5">
        <table className="ci-table min-w-[720px]">
          <thead>
            <tr>
              <SortHead k="client" label="Client" sort={p.sort} dir={p.dir} onSort={p.onSort} />
              <SortHead k="backend" label="Auth Backend" sort={p.sort} dir={p.dir} onSort={p.onSort} />
              <SortHead k="role" label="Role" sort={p.sort} dir={p.dir} onSort={p.onSort} />
              <th>Primary Identifier</th>
              <th>Source IPs</th>
              <SortHead k="requests" label="Requests" sort={p.sort} dir={p.dir} onSort={p.onSort} />
              <SortHead k="lastSeen" label="Last Seen" sort={p.sort} dir={p.dir} onSort={p.onSort} />
            </tr>
          </thead>
          <tbody>
            {p.loading && p.clients.length === 0 && Array.from({ length: 7 }, (_, i) => (
              <tr key={i} data-testid="row-skeleton"><td colSpan={7}><Skeleton className="h-6 w-full" /></td></tr>
            ))}
            {p.clients.map((c, i) => {
              const [l1, l2] = c.source.primaryIdentifier.split('\n');
              const ips = c.network.observedIps;
              const active = (c.activity.requests24h ?? 0) > 0;
              return (
                <tr
                  key={c.id} className="ci-row" style={{ ['--i' as string]: i }} tabIndex={0} aria-selected={p.selectedId === c.id} data-testid="client-row" data-client-id={c.id}
                  onClick={() => p.onSelect(c)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.onSelect(c); } }}
                >
                  <td className="max-w-[150px]">
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]' : 'bg-slate-600'}`} title={active ? 'Observed in the last 24 hours' : 'No request observed in the last 24 hours'} />
                      <span className="truncate font-medium" title={c.displayName}>{c.displayName}</span>
                    </span>
                  </td>
                  <td><span className="flex items-center gap-2 whitespace-nowrap"><BackendIcon type={c.auth.type} className="h-[18px] w-[18px]" />{backendLabel(c.auth.type)}</span></td>
                  <td className="max-w-[160px]">
                    {c.auth.role
                      ? <span className="ci-chip block truncate" title={c.auth.role}>{c.auth.role}</span>
                      : <span className="ci-muted" title="No role observed for this client">—</span>}
                  </td>
                  <td className="max-w-[170px] font-mono text-[11px] leading-snug">
                    <span className="block truncate" title={c.source.primaryIdentifier}>{l1}</span>
                    {l2 && <span className="ci-muted block truncate">{l2}</span>}
                  </td>
                  <td className="font-mono text-[11.5px]">
                    {ips.length === 0 ? <span className="ci-muted" title={p.auditAvailable ? 'No source IP observed in audit data' : 'No audit evidence'}>—</span> : (
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        {ips[0]}
                        {ips.length > 1 && <span className="ci-chip !py-0">+{ips.length - 1}</span>}
                      </span>
                    )}
                  </td>
                  <td className="tabular-nums" title={c.activity.requests === undefined ? 'No audit evidence' : 'Audit-observed requests in window'}>{fmt(c.activity.requests)}</td>
                  <td className="whitespace-nowrap">{fmtTime(c.activity.lastObservedAt)}</td>
                </tr>
              );
            })}
            {!p.loading && !p.error && p.clients.length === 0 && (
              <tr><td colSpan={7} className="ci-muted py-10 text-center" data-testid="empty-inventory">No clients match the current filters.</td></tr>
            )}
            {p.error && (
              <tr><td colSpan={7} className="py-10 text-center text-red-700" role="alert" data-testid="table-error">{p.error}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-[var(--ci-border)] px-4 py-2.5 text-xs">
        <span className="ci-muted" data-testid="range">{from}–{to} of {p.total.toLocaleString()}</span>
        <span className="flex gap-2">
          <button type="button" className="ci-btn !py-1" disabled={p.offset === 0} onClick={() => p.onPage(Math.max(0, p.offset - p.limit))}>Previous</button>
          <button type="button" className="ci-btn !py-1" disabled={to >= p.total} onClick={() => p.onPage(p.offset + p.limit)}>Next</button>
        </span>
      </div>
    </div>
  );
}
