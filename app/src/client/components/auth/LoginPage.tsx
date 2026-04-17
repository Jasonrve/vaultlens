import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';

type AuthMethod = 'token' | 'oidc';

function VaultHexIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" fill="none">
      <path d="M16 3L28 10v12l-12 7L4 22V10L16 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15" />
      <path d="M16 9L22 12.5v7L16 23l-6-3.5v-7L16 9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function LoginPage() {
  const [method, setMethod] = useState<AuthMethod>('token');
  const [token, setToken] = useState('');
  const [mountPath, setMountPath] = useState('oidc');
  const [role, setRole] = useState('');
  const [oidcError, setOidcError] = useState('');
  const [oidcLoading, setOidcLoading] = useState(false);
  const [defaultOidcRole, setDefaultOidcRole] = useState<string>('');
  const [oidcAvailable, setOidcAvailable] = useState(false);

  const { login, loginWithToken, error, loading } = useAuthStore();
  const navigate = useNavigate();
  const popupRef = useRef<Window | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Clean up popup + message listener on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      popupRef.current?.close();
    };
  }, []);

  // On mount, check if OIDC is available and get default role.
  // Uses the public /auth/methods endpoint backed by the BFF system token.
  // Returns empty if system token not yet configured (first-time setup = token-only).
  useEffect(() => {
    async function initializeAuth() {
      const methods = await api.getLoginAuthMethods();
      const oidcMethod = methods.find((m) => m.type === 'oidc' || m.type === 'jwt');
      if (oidcMethod) {
        setOidcAvailable(true);
        setMethod('oidc');
        setMountPath(oidcMethod.path);
        setDefaultOidcRole(oidcMethod.defaultRole);
      }
    }
    void initializeAuth();
  }, []);

  async function handleTokenSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      await login(token);
      navigate('/');
    } catch {
      // error shown from store
    }
  }

  async function handleOidcLogin() {
    setOidcError('');
    setOidcLoading(true);

    try {
      const mount = mountPath.trim() || 'oidc';
      // Use default role if no role was entered
      const roleToUse = role.trim() || defaultOidcRole;
      const redirectUri = `${window.location.origin}/oidc-callback/${encodeURIComponent(mount)}`;

      // ── Open the popup SYNCHRONOUSLY before any await ──────────────────────
      // Browsers require window.open() to be called within a synchronous user
      // gesture handler. Any await before it breaks that context and the popup
      // either gets blocked or opens about:blank and stays there.
      const POPUP_WIDTH = 500;
      const POPUP_HEIGHT = 600;
      const left = Math.round(window.screen.width / 2 - POPUP_WIDTH / 2);
      const top = Math.round(window.screen.height / 2 - POPUP_HEIGHT / 2);

      const popup = window.open(
        '',
        'vaultOIDCWindow',
        `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},resizable,scrollbars=yes,top=${top},left=${left}`
      );

      if (!popup) {
        setOidcError(
          'Could not open the authentication popup. Please allow pop-ups for this site and try again.'
        );
        setOidcLoading(false);
        return;
      }

      popupRef.current = popup;

      // ── Now fetch the Vault auth URL asynchronously ─────────────────────────
      let authUrl: string;
      try {
        const result = await api.getOidcAuthUrl(mount, roleToUse, redirectUri);
        authUrl = result.authUrl;
      } catch (err) {
        popup.close();
        // Prefer the actual Vault error over the generic axios "Request failed" message
        const vaultMsg = (err as { response?: { data?: { error?: string; errors?: string[] } } })
          ?.response?.data;
        const message =
          vaultMsg?.error ||
          vaultMsg?.errors?.[0] ||
          (err instanceof Error ? err.message : 'Failed to fetch OIDC authorization URL.');
        setOidcError(message);
        setOidcLoading(false);
        return;
      }

      // Navigate the already-open popup to the provider
      popup.location.href = authUrl;

      // ── Watch for premature closure ─────────────────────────────────────────
      const closedInterval = setInterval(() => {
        if (popup.closed) {
          cleanup();
          setOidcError('The authentication window was closed before completing. Please try again.');
          setOidcLoading(false);
        }
      }, 500);

      // ── Receive postMessage from OidcCallbackPage (same-origin, trusted) ────
      async function handleMessage(event: MessageEvent) {
        if (
          event.origin !== window.location.origin ||
          !event.isTrusted ||
          (event.data as { source?: string })?.source !== 'oidc-callback'
        ) {
          return;
        }

        cleanup();

        const { path, code, state } = event.data as {
          path: string;
          code: string;
          state: string;
        };

        if (!path || !code || !state) {
          setOidcError('Missing authentication parameters in callback. Please try again.');
          setOidcLoading(false);
          return;
        }

        try {
          const result = await api.oidcCallback(path, code, state);
          loginWithToken('', result.tokenInfo);
          navigate('/');
        } catch (err) {
          setOidcError(
            err instanceof Error
              ? err.message
              : 'OIDC token exchange failed. Please try again.'
          );
          setOidcLoading(false);
        }
      }

      window.addEventListener('message', handleMessage);

      function cleanup() {
        clearInterval(closedInterval);
        window.removeEventListener('message', handleMessage);
        cleanupRef.current = null;
      }

      cleanupRef.current = cleanup;
    } catch (err) {
      setOidcError(
        err instanceof Error ? err.message : 'OIDC login failed. Please try again.'
      );
      setOidcLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f6f6]">
      <div className="w-full max-w-sm">
        {/* Vault branding */}
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-[#19191a] text-white">
            <VaultHexIcon className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-semibold text-gray-900">Sign in to Vault</h1>
          <p className="mt-1 text-sm text-gray-500">VaultLens UI</p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          {/* Method selector */}
          <div className="mb-5">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500">
              Method
            </label>
            <div className="flex rounded-md border border-gray-200 bg-gray-50 p-1">
              {oidcAvailable && (
                <button
                  type="button"
                  onClick={() => setMethod('oidc')}
                  className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                    method === 'oidc'
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  OIDC
                </button>
              )}
              <button
                type="button"
                onClick={() => { setMethod('token'); setOidcError(''); }}
                className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${
                  method === 'token'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Token
              </button>
            </div>
          </div>

          {/* ── Token form ── */}
          {method === 'token' && (
            <form onSubmit={(e) => { void handleTokenSubmit(e); }}>
              <div className="mb-5">
                <label
                  htmlFor="token"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500"
                >
                  Token
                </label>
                <input
                  id="token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="hvs.CAESIJ..."
                  required
                  autoComplete="off"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
                />
              </div>

              {error && (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !token}
                className="w-full rounded-md bg-[#19191a] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2d2d2e] disabled:opacity-40"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* ── OIDC form ── */}
          {method === 'oidc' && oidcAvailable && (
            <div>
              {/* Mount Path is kept as a hidden value — not displayed to user */}
              <input
                type="hidden"
                value={mountPath}
              />

              <div className="mb-5">
                <label
                  htmlFor="role"
                  className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-gray-500"
                >
                  Role{' '}
                  <span className="font-normal normal-case text-gray-400">(optional)</span>
                </label>
                <input
                  id="role"
                  type="text"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  placeholder={defaultOidcRole || 'default'}
                  autoComplete="off"
                  className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
                />
                <p className="mt-1 text-xs text-gray-400">
                  {defaultOidcRole
                    ? `Vault uses "${defaultOidcRole}" (default role) if left blank.`
                    : 'Vault uses the default role if left blank.'}
                </p>
              </div>

              {oidcError && (
                <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {oidcError}
                </div>
              )}

              <button
                type="button"
                onClick={() => { void handleOidcLogin(); }}
                disabled={oidcLoading}
                className="w-full rounded-md bg-[#1563ff] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#0f4fcc] disabled:opacity-40"
              >
                {oidcLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle
                        className="opacity-25"
                        cx="12" cy="12" r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    Waiting for provider…
                  </span>
                ) : (
                  'Sign in with OIDC Provider'
                )}
              </button>

              {oidcLoading && (
                <p className="mt-2 text-center text-xs text-gray-400">
                  Complete sign-in in the popup window.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}