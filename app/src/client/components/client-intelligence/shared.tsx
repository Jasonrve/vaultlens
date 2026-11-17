import { useEffect, useRef, useState } from 'react';
import type { Confidence } from '../../../shared/clientIntelligence';
import AuthMethodIcon from '../auth-methods/AuthMethodIcon';

export const BACKEND_META: Record<string, { label: string; color: string }> = {
  kubernetes: { label: 'Kubernetes', color: '#3b82f6' },
  aws: { label: 'AWS IAM', color: '#f59e0b' },
  github: { label: 'GitHub', color: '#94a3b8' },
  approle: { label: 'AppRole', color: '#14b8a6' },
  ldap: { label: 'LDAP', color: '#a78bfa' },
  userpass: { label: 'Userpass', color: '#818cf8' },
  oidc: { label: 'OIDC', color: '#f97316' },
  jwt: { label: 'JWT', color: '#ec4899' },
  cert: { label: 'TLS Cert', color: '#38bdf8' },
  token: { label: 'Token', color: '#eab308' },
  unknown: { label: 'Unknown', color: '#64748b' },
};
const FALLBACK = ['#22d3ee', '#84cc16', '#e879f9', '#fb7185', '#2dd4bf'];

export function backendLabel(type: string): string {
  return BACKEND_META[type]?.label ?? type;
}
export function backendColor(type: string): string {
  if (BACKEND_META[type]) return BACKEND_META[type].color;
  let h = 0;
  for (const c of type) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length]!;
}

export function BackendIcon({ type, className = 'h-5 w-5' }: { type: string; className?: string }) {
  if (type === 'unknown') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="1.6" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.1-1.5 2M12 17h.01" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === 'approle') {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        {[[3, 3], [13, 3], [3, 13], [13, 13]].map(([x, y]) => <rect key={`${x}${y}`} x={x} y={y} width="8" height="8" rx="1.5" fill="#2dd4bf" opacity={x === 13 && y === 13 ? 0.45 : 0.9} />)}
      </svg>
    );
  }
  return <span className="inline-flex text-[var(--ci-text-2)]"><AuthMethodIcon type={type} className={className} /></span>;
}

const CONF_LABEL: Record<Confidence, string> = { high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unattributed' };
export function ConfidenceBadge({ value }: { value: Confidence }) {
  return (
    <span className={`ci-pill ci-pill-${value}`} data-testid="confidence">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {CONF_LABEL[value]}
    </span>
  );
}

export function fmt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString();
}
export function fmtTime(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "5 min ago" style; the absolute time belongs in a tooltip. */
export function fmtAgo(iso?: string): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const RANGES = [
  { days: 1, label: 'Last 24 hours' },
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
];

export function Skeleton({ className = 'h-4 w-24' }: { className?: string }) {
  return <span className={`ci-skel inline-block ${className}`} aria-hidden />;
}

export const prefersReducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Eases a number toward its target; null stays null (unknown is never animated into a number). */
export function useCountUp(target: number | null | undefined, ms = 700): number | null {
  const [v, setV] = useState<number | null>(target ?? null);
  const from = useRef(0);
  useEffect(() => {
    if (target === null || target === undefined) { setV(null); return; }
    if (prefersReducedMotion()) { setV(target); from.current = target; return; }
    const start = window.performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min((t - start) / ms, 1);
      const e = 1 - (1 - p) ** 3;
      setV(Math.round(a + (target - a) * e));
      if (p < 1) raf = window.requestAnimationFrame(tick); else from.current = target;
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** Observed element width, so SVG charts render at true pixel size (crisp text, no stretching). */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => e && setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

type IconName = 'users' | 'pulse' | 'warn' | 'pin' | 'db' | 'doc' | 'download' | 'search' | 'filter' | 'bell';
const PATHS: Record<IconName, string> = {
  users: 'M16 19v-1a4 4 0 00-4-4H7a4 4 0 00-4 4v1M9.5 11a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM21 19v-1a4 4 0 00-3-3.87M16 4.13a3.5 3.5 0 010 6.74',
  pulse: 'M3 12h4l2.5-6 4 12 2.5-6H21',
  warn: 'M12 9v4m0 4h.01M10.3 3.9L2.4 17.5A2 2 0 004.1 20.5h15.8a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
  pin: 'M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  doc: 'M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5zM14 3v5h5M9 13h6M9 17h6',
  download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 20h14',
  search: 'M21 21l-4.3-4.3M17 11a6 6 0 11-12 0 6 6 0 0112 0z',
  filter: 'M3 5h18l-7 8v6l-4-2v-4L3 5z',
  bell: 'M18 8a6 6 0 10-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 20a2 2 0 01-3.4 0',
};
export function Icon({ name, className = 'h-4 w-4' }: { name: IconName; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  );
}
