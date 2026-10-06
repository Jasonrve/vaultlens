import type { PkiSummary } from '../../../shared/pki';

const statuses = [
  ['valid', 'Valid'], ['warning', 'Warning'], ['critical', 'Critical'],
  ['expired', 'Expired'], ['revoked', 'Revoked'],
] as const;
const buckets = [
  ['critical', '≤ 7 days'], ['warning', '8–30 days'],
  ['near', '31–90 days'], ['later', '> 90 days'],
] as const;
const statusHints: Record<string, string> = { valid: '> 30 days', warning: '8–30 days', critical: '≤ 7 days' };
const distribution = ['valid', 'warning', 'critical', 'expired', 'revoked'] as const;

export default function CertificateOverview({ summary, busy }: { summary: PkiSummary | null; busy: boolean }) {
  const value = (key: keyof PkiSummary) => summary ? summary[key].toLocaleString() : '—';
  const total = summary ? distribution.reduce((sum, key) => sum + summary[key], 0) : 0;
  const maximum = summary ? Math.max(1, ...buckets.map(([key]) => summary[key])) : 1;
  return <div className="pki-overview" aria-busy={busy}>
    <section className="pki-overview-panel" aria-label="Certificate overview">
      <div className="pki-overview-heading">
        <h2>Certificate overview</h2>
        <span className="pki-overview-scope">Applied search · {summary ? total.toLocaleString() : '—'} results</span>
      </div>
      <div className="pki-overview-columns">
        <section aria-label="Certificate status overview">
          <h3>Status distribution</h3>
          <div className="pki-status-stack" role="img" aria-label={summary ? statuses.map(([key, label]) => `${label}: ${value(key)}`).join(', ') : 'Status distribution unavailable'}>
            {summary && distribution.filter(key => summary[key] > 0).map(key =>
              <span key={key} className={`pki-tone-${key}`} style={{ flex: summary[key] }} />)}
          </div>
          <dl className="pki-status-legend">
            {statuses.map(([key, label]) => <div key={key}>
              <dt><span className={`pki-status-dot pki-tone-${key}`} aria-hidden="true" />{label}{statusHints[key] && <span className="pki-status-hint">({statusHints[key]})</span>}</dt>
              <dd>{value(key)}</dd>
            </div>)}
          </dl>
        </section>
        <section aria-label="Upcoming expirations">
          <h3>Upcoming expirations</h3>
          <dl className="pki-expiry-bars">
            {buckets.map(([key, label]) => <div key={key}>
              <dt>{label}</dt>
              <div className="pki-expiry-track" aria-hidden="true"><span className={`pki-tone-${key === 'near' || key === 'later' ? 'valid' : key}`} style={{ width: `${summary ? summary[key] / maximum * 100 : 0}%` }} /></div>
              <dd>{value(key)}</dd>
            </div>)}
          </dl>
        </section>
      </div>
    </section>
    {!!summary?.revocationUnknown && <p className="pki-muted">Revocation is unknown for {summary.revocationUnknown.toLocaleString()} certificates; their status is based on expiry only.</p>}
  </div>;
}
