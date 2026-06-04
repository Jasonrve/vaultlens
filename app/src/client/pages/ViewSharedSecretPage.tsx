import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { decryptSecret } from '../lib/crypto';
import { useBrandingStore } from '../stores/brandingStore';
import { useAuthStore } from '../stores/authStore';
import * as api from '../lib/api';
import type { ShareMode } from '../lib/api';

export default function ViewSharedSecretPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [decryptedSecret, setDecryptedSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [metadata, setMetadata] = useState<{
    createdAt: string;
    expiresAt: string;
    oneTime?: boolean;
    shareMode: ShareMode;
    maxViews?: number;
    viewCount?: number;
  } | null>(null);
  const { branding, loadBranding } = useBrandingStore();
  const { isAuthenticated } = useAuthStore();
  const hasFetched = useRef(false);
  const hasAutoUnlocked = useRef(false);

  // Unlock state
  const [needsOtp, setNeedsOtp] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  useEffect(() => {
    loadBranding();
  }, [loadBranding]);

  // Initial fetch: get secret metadata (or payload for one-time mode)
  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    async function fetchAndDecrypt() {
      if (!id) {
        setError('Invalid share link');
        setLoading(false);
        return;
      }

      const key = window.location.hash.slice(1);
      if (!key) {
        setError('Missing decryption key. The share link may be incomplete.');
        setLoading(false);
        return;
      }

      try {
        const result = await api.getSharedSecret(id);
        const shareMode: ShareMode = result.shareMode || 'one-time';

        setMetadata({
          createdAt: result.createdAt,
          expiresAt: result.expiresAt,
          oneTime: result.oneTime,
          shareMode,
          maxViews: result.maxViews,
          viewCount: result.viewCount,
        });

        if (shareMode === 'one-time' && result.encrypted) {
          const plaintext = await decryptSecret(result.encrypted, key);
          setDecryptedSecret(plaintext);
        } else if (shareMode === 'otp') {
          setNeedsOtp(true);
        } else if (shareMode === 'auth-login') {
          setNeedsAuth(true);
        }
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'response' in err) {
          const response = (err as { response?: { status?: number; data?: { error?: string } } }).response;
          if (response?.status === 404) {
            setError('This secret has expired, already been viewed, or does not exist.');
          } else {
            setError(response?.data?.error || 'Failed to retrieve the secret.');
          }
        } else {
          setError('Failed to decrypt the secret. The link may be corrupted.');
        }
      } finally {
        setLoading(false);
      }
    }

    fetchAndDecrypt();
  }, [id]);

  // Auto-unlock with session cookie when user is already authenticated
  useEffect(() => {
    if (!needsAuth || !isAuthenticated || hasAutoUnlocked.current || !id) return;
    hasAutoUnlocked.current = true;

    const key = window.location.hash.slice(1);
    if (!key) return;

    setUnlocking(true);
    api.unlockSharedSecret(id, {})
      .then(async (result) => {
        const plaintext = await decryptSecret(result.encrypted, key);
        setDecryptedSecret(plaintext);
        setNeedsAuth(false);
        setMetadata(prev => prev ? { ...prev, oneTime: result.oneTime, maxViews: result.maxViews, viewCount: result.viewCount } : prev);
      })
      .catch((err: unknown) => {
        hasAutoUnlocked.current = false; // allow retry
        if (err && typeof err === 'object' && 'response' in err) {
          const response = (err as { response?: { status?: number; data?: { error?: string } } }).response;
          setUnlockError(response?.data?.error || 'Failed to authenticate.');
        } else {
          setUnlockError('Failed to authenticate.');
        }
      })
      .finally(() => setUnlocking(false));
  }, [needsAuth, isAuthenticated, id]);

  const handleUnlockOtp = async () => {
    if (!id || !otpInput.trim()) return;

    const key = window.location.hash.slice(1);
    if (!key) {
      setUnlockError('Missing decryption key.');
      return;
    }

    setUnlocking(true);
    setUnlockError(null);

    try {
      const result = await api.unlockSharedSecret(id, { otpCode: otpInput });
      const plaintext = await decryptSecret(result.encrypted, key);
      setDecryptedSecret(plaintext);
      setNeedsOtp(false);
      setMetadata(prev => prev ? { ...prev, oneTime: result.oneTime, maxViews: result.maxViews, viewCount: result.viewCount } : prev);
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const response = (err as { response?: { status?: number; data?: { error?: string } } }).response;
        setUnlockError(response?.data?.error || 'Failed to unlock the secret.');
      } else {
        setUnlockError('Failed to unlock the secret.');
      }
    } finally {
      setUnlocking(false);
    }
  };

  const handleLoginRedirect = () => {
    // Store the full URL (including hash/key) in router state for LoginPage to restore
    const returnTo = window.location.href;
    navigate('/login', { state: { returnTo } });
  };

  const handleCopy = async () => {
    if (!decryptedSecret) return;
    try {
      await navigator.clipboard.writeText(decryptedSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Unable to copy — clipboard access requires HTTPS.');
    }
  };

  // Determine logo to show: use branding logo or fallback hex icon
  const logoElement = branding.logo
    ? <img src={branding.logo} alt={branding.appName || 'VaultLens'} className="h-16 w-16 object-contain" />
    : (
      <svg className="h-14 w-14" viewBox="0 0 32 32" fill="none" style={{ color: branding.primaryColor || '#1563ff' }}>
        <path d="M16 3L28 10v12l-12 7L4 22V10L16 3z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" fill="currentColor" fillOpacity="0.15" />
        <path d="M16 9L22 12.5v7L16 23l-6-3.5v-7L16 9z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    );

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg space-y-4">
        {/* Logo — always centered and prominent */}
        <div className="flex flex-col items-center gap-2 pb-2">
          {logoElement}
          <span className="text-[15px] font-semibold tracking-tight text-gray-800">
            {branding.appName || 'VaultLens'}
          </span>
        </div>

        {/* Header */}
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900">Shared Secret</h1>
          <p className="mt-1 text-sm text-gray-500">
            This secret was shared securely via {branding.appName || 'VaultLens'}.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          </div>
        ) : error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-center">
            <svg className="mx-auto h-10 w-10 text-red-400 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
            <p className="text-sm font-medium text-red-800">{error}</p>
          </div>
        ) : needsOtp ? (
          /* OTP Unlock Form */
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-sm font-semibold text-amber-800 mb-2">OTP Required</h2>
              <p className="text-sm text-amber-700 mb-3">
                This secret is protected with a one-time passcode. Enter the code provided by the sender.
              </p>
              {unlockError && (
                <div className="rounded-md bg-red-50 border border-red-200 p-2 mb-3">
                  <p className="text-xs text-red-700">{unlockError}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={otpInput}
                  onChange={(e) => setOtpInput(e.target.value)}
                  className="flex-1 rounded border border-amber-300 bg-white px-3 py-2 text-sm font-mono focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                  placeholder="Enter OTP code..."
                  onKeyDown={(e) => { if (e.key === 'Enter') void handleUnlockOtp(); }}
                  autoFocus
                />
                <button
                  onClick={() => void handleUnlockOtp()}
                  disabled={unlocking || !otpInput.trim()}
                  className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {unlocking ? 'Verifying…' : 'Unlock'}
                </button>
              </div>
            </div>
          </div>
        ) : needsAuth ? (
          /* Auth-login: show login prompt or auto-unlocking indicator */
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 text-center">
              <svg className="mx-auto h-10 w-10 text-blue-400 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
              </svg>
              <h2 className="text-sm font-semibold text-blue-800 mb-1">Login Required</h2>
              <p className="text-sm text-blue-700 mb-4">
                You must be logged in to view this secret.
              </p>

              {unlockError && (
                <div className="rounded-md bg-red-50 border border-red-200 p-2 mb-3 text-left">
                  <p className="text-xs text-red-700">{unlockError}</p>
                </div>
              )}

              {unlocking ? (
                <div className="flex justify-center items-center gap-2 text-sm text-blue-600">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-600" />
                  Verifying your session…
                </div>
              ) : isAuthenticated ? (
                <div className="text-sm text-blue-600">Session found. Unlocking…</div>
              ) : (
                <button
                  onClick={handleLoginRedirect}
                  className="rounded px-5 py-2 text-sm font-medium text-white"
                  style={{ backgroundColor: branding.primaryColor || '#1563ff' }}
                >
                  Login to View Secret
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-700">Decrypted Secret</h2>
                <button
                  onClick={() => void handleCopy()}
                  className="rounded border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <pre className="whitespace-pre-wrap break-all rounded bg-gray-50 border border-gray-200 p-3 text-sm font-mono text-gray-800">
                {decryptedSecret}
              </pre>
            </div>

            {metadata && (
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="grid grid-cols-2 gap-3 text-xs text-gray-500">
                  <div>
                    <span className="font-medium text-gray-600">Created:</span>{' '}
                    {new Date(metadata.createdAt).toLocaleString()}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Expires:</span>{' '}
                    {new Date(metadata.expiresAt).toLocaleString()}
                  </div>
                  <div>
                    <span className="font-medium text-gray-600">Mode:</span>{' '}
                    <span className="capitalize">{metadata.shareMode.replace('-', ' ')}</span>
                  </div>
                  {metadata.oneTime && (
                    <div className="col-span-2">
                      <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        {metadata.maxViews === 1
                          ? 'One-time view — this secret cannot be retrieved again'
                          : metadata.maxViews && metadata.maxViews > 0
                            ? `View ${metadata.viewCount ?? 0} of ${metadata.maxViews} — ${metadata.maxViews - (metadata.viewCount ?? 0)} remaining`
                            : 'One-time view — this secret cannot be retrieved again'}
                      </span>
                    </div>
                  )}
                  {!metadata.oneTime && metadata.maxViews !== undefined && metadata.maxViews > 0 && (
                    <div className="col-span-2">
                      <span className="inline-flex items-center rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                        View {metadata.viewCount ?? 0} of {metadata.maxViews} — {metadata.maxViews - (metadata.viewCount ?? 0)} remaining
                      </span>
                    </div>
                  )}
                  {metadata.maxViews === 0 && (
                    <div className="col-span-2">
                      <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        Unlimited views until expiry
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
              <p className="text-xs text-blue-700">
                <strong>Security:</strong> This secret was decrypted entirely in your browser.
                The server only stored the encrypted payload and never had access to the plaintext.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
