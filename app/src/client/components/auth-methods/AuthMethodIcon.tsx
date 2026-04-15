/**
 * SVG icons for each Vault auth method type.
 * Uses inline SVGs so there are no external image dependencies.
 */

interface Props {
  type: string;
  className?: string;
}

export default function AuthMethodIcon({ type, className = 'h-6 w-6' }: Props) {
  const normalised = type.toLowerCase();

  // ── AppRole ────────────────────────────────────────────────────────────────
  if (normalised === 'approle') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="8" height="8" rx="1.5" fill="#334155" stroke="none" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" fill="#334155" stroke="none" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" fill="#334155" stroke="none" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" fill="#334155" stroke="none" />
      </svg>
    );
  }

  // ── JWT ────────────────────────────────────────────────────────────────────
  if (normalised === 'jwt') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="9" fill="#FB015B" />
        <circle cx="12" cy="12" r="3" fill="white" />
        <line x1="12" y1="3" x2="12" y2="8" stroke="white" strokeWidth="2" />
        <line x1="12" y1="16" x2="12" y2="21" stroke="white" strokeWidth="2" />
        <line x1="3" y1="12" x2="8" y2="12" stroke="white" strokeWidth="2" />
        <line x1="16" y1="12" x2="21" y2="12" stroke="white" strokeWidth="2" />
      </svg>
    );
  }

  // ── OIDC ───────────────────────────────────────────────────────────────────
  if (normalised === 'oidc') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#F16522" />
        <path d="M8 12 C8 9 10 7 12 7 C14 7 16 9 16 12" stroke="white" strokeWidth="2" fill="none" strokeLinecap="round" />
        <circle cx="12" cy="15" r="3" fill="white" />
      </svg>
    );
  }

  // ── TLS Certificates ───────────────────────────────────────────────────────
  if (normalised === 'cert' || normalised === 'tls') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="4" width="18" height="16" rx="2" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="1.5" />
        <path d="M7 9h10M7 13h6" stroke="#475569" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="17" cy="15" r="3" fill="#3B82F6" />
        <path d="M16 15l.8.8L18.5 14" stroke="white" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  // ── Username / Password ────────────────────────────────────────────────────
  if (normalised === 'userpass') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="8" r="4" fill="#64748B" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" fill="#64748B" />
      </svg>
    );
  }

  // ── AliCloud ───────────────────────────────────────────────────────────────
  if (normalised === 'alicloud' || normalised === 'aliyun') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <path d="M12 3 C7.03 3 3 7.03 3 12 C3 16.97 7.03 21 12 21 C16.97 21 21 16.97 21 12 C21 7.03 16.97 3 12 3Z" fill="#FF6A00" />
        <path d="M8 12 Q9 8 12 8 Q15 8 16 12" stroke="white" strokeWidth="1.5" fill="none" />
        <path d="M8 12 Q9 16 12 16 Q15 16 16 12" stroke="white" strokeWidth="1.5" fill="none" />
      </svg>
    );
  }

  // ── AWS ────────────────────────────────────────────────────────────────────
  if (normalised === 'aws') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <path d="M6.5 15.5 C5 14.2 4 12.7 4 11 C4 8.2 6.5 6 9.5 6 C10.2 4.8 11.5 4 13 4 C15.2 4 17 5.8 17 8 C17 8.1 17 8.2 17 8.3 C19.2 8.8 21 10.7 21 13 C21 15.5 19 17.5 16.5 17.5" stroke="#FF9900" strokeWidth="1.5" fill="none" strokeLinejoin="round" />
        <path d="M9 17 l3 3 l3-3" stroke="#FF9900" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="12" y1="20" x2="12" y2="13" stroke="#FF9900" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  // ── Azure ──────────────────────────────────────────────────────────────────
  if (normalised === 'azure') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <path d="M10 4 L4 20 L10 16 L16 20 L22 8 Z" fill="#0089D6" />
        <path d="M10 4 L16 8 L10 16 Z" fill="#0072C6" />
        <path d="M4 20 L10 16 L10 4 Z" fill="#005BA1" />
      </svg>
    );
  }

  // ── Google Cloud ───────────────────────────────────────────────────────────
  if (normalised === 'gcp' || normalised === 'google' || normalised === 'googlecloud') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <path d="M12 5.5 L16.5 12 L14 12 L14 14 L10 14 L10 12 L7.5 12 Z" fill="#4285F4" />
        <path d="M5 14 C5 10.1 8.1 7 12 7" stroke="#EA4335" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M12 7 C15.9 7 19 10.1 19 14" stroke="#FBBC05" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M5 14 C5 17.9 8.1 21 12 21 C15.9 21 19 17.9 19 14" stroke="#34A853" strokeWidth="2" fill="none" />
      </svg>
    );
  }

  // ── GitHub ────────────────────────────────────────────────────────────────
  if (normalised === 'github') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
      </svg>
    );
  }

  // ── Kubernetes ────────────────────────────────────────────────────────────
  if (normalised === 'kubernetes' || normalised === 'k8s') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#326CE5" />
        <circle cx="12" cy="12" r="2.5" fill="white" />
        <line x1="12" y1="3.5" x2="12" y2="9" stroke="white" strokeWidth="1.5" />
        <line x1="12" y1="15" x2="12" y2="20.5" stroke="white" strokeWidth="1.5" />
        <line x1="3.5" y1="12" x2="9" y2="12" stroke="white" strokeWidth="1.5" />
        <line x1="15" y1="12" x2="20.5" y2="12" stroke="white" strokeWidth="1.5" />
        <line x1="6" y1="6" x2="9.75" y2="9.75" stroke="white" strokeWidth="1.5" />
        <line x1="14.25" y1="14.25" x2="18" y2="18" stroke="white" strokeWidth="1.5" />
        <line x1="18" y1="6" x2="14.25" y2="9.75" stroke="white" strokeWidth="1.5" />
        <line x1="9.75" y1="14.25" x2="6" y2="18" stroke="white" strokeWidth="1.5" />
      </svg>
    );
  }

  // ── LDAP ──────────────────────────────────────────────────────────────────
  if (normalised === 'ldap') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" fill="#E2E8F0" stroke="#94A3B8" strokeWidth="1.5" />
        <circle cx="12" cy="8.5" r="2.5" fill="#475569" />
        <path d="M7 17 C7 14 9 12 12 12 s5 2 5 5" fill="#475569" />
        <line x1="8" y1="8.5" x2="5" y2="8.5" stroke="#94A3B8" strokeWidth="1" />
        <line x1="16" y1="8.5" x2="19" y2="8.5" stroke="#94A3B8" strokeWidth="1" />
      </svg>
    );
  }

  // ── Okta ──────────────────────────────────────────────────────────────────
  if (normalised === 'okta') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="10" fill="#007DC1" />
        <circle cx="12" cy="12" r="5" fill="white" />
        <circle cx="12" cy="12" r="2" fill="#007DC1" />
      </svg>
    );
  }

  // ── RADIUS ────────────────────────────────────────────────────────────────
  if (normalised === 'radius') {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="3" fill="#64748B" />
        <circle cx="12" cy="12" r="6" stroke="#94A3B8" strokeWidth="1.5" fill="none" />
        <circle cx="12" cy="12" r="9.5" stroke="#CBD5E1" strokeWidth="1" fill="none" />
        <path d="M12 2.5 L12 4.5 M12 19.5 L12 21.5 M2.5 12 L4.5 12 M19.5 12 L21.5 12" stroke="#94A3B8" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }

  // ── Token (default / fallback) ─────────────────────────────────────────────
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M15 7a3 3 0 00-6 0M9 7H6.5a2.5 2.5 0 000 5H9m6-5h2.5a2.5 2.5 0 010 5H15m-6 0v5m6-5v5" strokeLinecap="round" />
    </svg>
  );
}
