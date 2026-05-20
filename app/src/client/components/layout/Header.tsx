import { useLocation, Link } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { useRef, useState, useEffect } from 'react';

const LABELS: Record<string, string> = {
  access: 'Access',
  'auth-methods': 'Auth Methods',
  entities: 'Entities',
  groups: 'Groups',
  policies: 'Policies',
  secrets: 'Secrets',
  visualizations: 'Visualizations',
  admin: 'Admin',
  branding: 'Branding',
  'permission-tester': 'Permission Tester',
  tools: 'Tools',
  share: 'Share Secret',
};

export default function Header() {
  const location = useLocation();
  const { tokenInfo, logout } = useAuthStore();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  function copyToken() {
    if (!tokenInfo?.id) return;
    void navigator.clipboard.writeText(tokenInfo.id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const rawSegments = location.pathname.split('/').filter(Boolean);

  // For secret edit/create/merge/view routes, strip the mode segment and
  // rewrite the links so breadcrumb segments navigate to the view (not edit).
  const SECRET_MODES = new Set(['edit', 'create', 'view', 'merge']);
  const isSecretMode =
    rawSegments[0] === 'secrets' &&
    rawSegments.length > 1 &&
    SECRET_MODES.has(rawSegments[1]);

  // segments used for display — strip the mode word (edit/create/merge/view)
  const segments = isSecretMode
    ? [rawSegments[0], ...rawSegments.slice(2)]
    : rawSegments;

  // Build the path for each breadcrumb item.
  // - "Secrets" (index 0) → /secrets
  // - Intermediate path segments (directories) → /secrets/<path>/ (SecretsList)
  // - Last segment in edit/create/merge → /secrets/view/<full-path> (exit edit mode)
  // - Last segment in view → non-clickable (handled by isLastButClickable below)
  function segmentPath(index: number): string {
    if (isSecretMode) {
      if (index === 0) return '/secrets';
      // Reconstruct using the original secret path segments (rawSegments[2..])
      const secretParts = rawSegments.slice(2, index + 2);
      const isLastSegment = index === segments.length - 1;
      if (isLastSegment) {
        // Last segment: link to view (only relevant for edit/create/merge — view keeps it non-clickable)
        return `/secrets/view/${secretParts.join('/')}`;
      }
      // Intermediate directory segments always go to the secrets list (no "view")
      return `/secrets/${secretParts.join('/')}/`;
    }
    return '/' + rawSegments.slice(0, index + 1).join('/');
  }

  const toLabel = (seg: string) =>
    LABELS[seg] ?? seg.charAt(0).toUpperCase() + seg.slice(1).replace(/-/g, ' ');

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-200 bg-white px-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1 text-sm">
        <Link to="/" className="font-medium text-gray-500 hover:text-[#1563ff]">Home</Link>
        {segments.map((seg, i) => {
          const path = segmentPath(i);
          const isLast = i === segments.length - 1;
          // In edit/create/merge mode, the last segment (secret name) should also
          // be a clickable link so clicking it exits edit mode and goes to view.
          const isLastButClickable = isLast && isSecretMode && rawSegments[1] !== 'view';
          return (
            <span key={i} className="flex items-center gap-1">
              <svg className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              {isLast && !isLastButClickable ? (
                <span className="font-medium text-gray-800">{toLabel(seg)}</span>
              ) : (
                <Link to={path} className={isLastButClickable ? 'font-medium text-gray-800 hover:text-[#1563ff]' : 'text-gray-500 hover:text-[#1563ff]'}>{toLabel(seg)}</Link>
              )}
            </span>
          );
        })}
      </nav>

      {/* Right */}
      <div className="flex items-center gap-3">
        {tokenInfo?.display_name && (
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-200 transition-colors"
            >
              <svg className="h-3.5 w-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
              {tokenInfo.display_name}
              <svg className={`h-3 w-3 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-lg border border-gray-200 bg-white shadow-lg py-2">
                {/* Token type */}
                {tokenInfo.type && (
                  <div className="px-3 pb-2 border-b border-gray-100 mb-2">
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Token Type</p>
                    <p className="text-sm text-gray-700 font-medium mt-0.5 capitalize">{tokenInfo.type}</p>
                  </div>
                )}

                {/* Policies */}
                {tokenInfo.policies && tokenInfo.policies.length > 0 && (
                  <div className="px-3 pb-2">
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1.5">Token Policies</p>
                    <div className="flex flex-wrap gap-1">
                      {tokenInfo.policies.map((p) => (
                        <span key={p} className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Identity policies */}
                {tokenInfo.identity_policies && tokenInfo.identity_policies.length > 0 && (
                  <div className="px-3 pb-2">
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-1.5">Identity Policies</p>
                    <div className="flex flex-wrap gap-1">
                      {tokenInfo.identity_policies.map((p) => (
                        <span key={p} className="inline-flex items-center rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                          {p}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Expiry */}
                {tokenInfo.expire_time && (
                  <div className="px-3 pb-2">
                    <p className="text-xs text-gray-400 uppercase tracking-wide font-medium">Expires</p>
                    <p className="text-xs text-gray-600 mt-0.5">{new Date(tokenInfo.expire_time).toLocaleString()}</p>
                  </div>
                )}

                {/* Copy token */}
                {tokenInfo.id && (
                  <div className="px-3 pt-2 border-t border-gray-100">
                    <button
                      onClick={copyToken}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      {copied ? (
                        <>
                          <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                          </svg>
                          <span className="text-green-600">Copied!</span>
                        </>
                      ) : (
                        <>
                          <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                          </svg>
                          Copy vault token
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        <button
          onClick={() => { void logout(); }}
          className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 transition-colors hover:border-gray-300 hover:text-gray-900"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}