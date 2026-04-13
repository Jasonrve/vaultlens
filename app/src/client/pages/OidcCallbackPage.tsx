import { useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';

/**
 * Rendered inside the OIDC popup window after the provider redirects back.
 * Reads code + state from the URL, then postMessages them back to the opener
 * (the main login window) via the same-origin postMessage pattern used by
 * the official HashiCorp Vault UI.
 *
 * Route: /oidc-callback/:mountPath  (e.g. /oidc-callback/oidc)
 */
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

    if (window.opener && window.opener !== window) {
      window.opener.postMessage(
        { source: 'oidc-callback', path, code: code ?? '', state: state ?? '' },
        window.location.origin
      );
    }

    // Close the popup after a short delay so the user sees the confirmation
    const t = setTimeout(() => window.close(), 800);
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
