import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

/**
 * Rendered inside the OIDC popup window after the provider redirects back.
 * Communicates code+state to the parent window via:
 *   1. localStorage (polled by parent — immune to COOP browsing-context isolation)
 *   2. window.opener.postMessage (fast path when opener is accessible)
 *
 * Route: /oidc-callback/:mountPath  (e.g. /oidc-callback/oidc)
 */
const OIDC_CALLBACK_KEY = 'vault-oidc-callback';

export default function OidcCallbackPage() {
  const { mountPath } = useParams<{ mountPath: string }>();
  const [searchParams] = useSearchParams();
  const didPost = useRef(false);

  useEffect(() => {
    if (didPost.current) return;
    didPost.current = true;

    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const path = mountPath ?? searchParams.get('path') ?? 'oidc';
    const payload = { source: 'oidc-callback', path, code: code ?? '', state: state ?? '' };

    console.log('[OIDC Popup] Callback page loaded. code present:', !!code, 'state present:', !!state, 'path:', path);
    console.log('[OIDC Popup] Full URL:', window.location.href);

    // Primary: write to localStorage — parent polls this every 500ms.
    // Works regardless of COOP policy or browsing-context isolation.
    try {
      localStorage.setItem(OIDC_CALLBACK_KEY, JSON.stringify(payload));
      console.log('[OIDC Popup] Wrote payload to localStorage key:', OIDC_CALLBACK_KEY);
      // Verify it was written
      const verify = localStorage.getItem(OIDC_CALLBACK_KEY);
      console.log('[OIDC Popup] Verification read:', verify ? 'OK (length=' + verify.length + ')' : 'FAILED - null');
    } catch (e) {
      console.error('[OIDC Popup] localStorage.setItem failed:', e);
    }

    // Secondary: postMessage — immediate delivery when opener is accessible
    console.log('[OIDC Popup] window.opener:', window.opener ? 'present' : 'null');
    if (window.opener && window.opener !== window) {
      try {
        window.opener.postMessage(payload, window.location.origin);
        console.log('[OIDC Popup] postMessage sent to opener');
      } catch (e) {
        console.warn('[OIDC Popup] postMessage failed:', e);
      }
    }

    // Close after a delay to show confirmation and give parent time to poll
    const t = setTimeout(() => window.close(), 2000);
    return () => clearTimeout(t);
  }, [mountPath, searchParams]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f6f6]">
      <div className="rounded-lg border border-gray-200 bg-white px-8 py-10 text-center shadow-sm">
        <div className="mb-3 flex justify-center">
          <svg className="h-10 w-10 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="text-base font-medium text-gray-900">Authentication successful</p>
        <p className="mt-1 text-sm text-gray-500">This window will close automatically.</p>
      </div>
    </div>
  );
}
