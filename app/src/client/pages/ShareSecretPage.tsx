import { useState, useEffect } from 'react';
import { encryptSecret } from '../lib/crypto';
import * as api from '../lib/api';
import type { ShareMode, SharingConfig } from '../lib/api';

const EXPIRATION_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '4 hours', value: 14400 },
  { label: '1 day', value: 86400 },
  { label: '3 days', value: 259200 },
  { label: '7 days', value: 604800 },
];

const SHARE_MODES: { value: ShareMode; label: string; description: string }[] = [
  { value: 'one-time', label: 'One-time View', description: 'Secret can be viewed once via URL. No additional verification required.' },
  { value: 'otp', label: 'OTP Protected', description: 'Recipient needs a one-time passcode (shared separately) to view the secret.' },
  { value: 'auth-login', label: 'Login Required', description: 'Recipient must log in to VaultLens to view the secret.' },
];

export default function ShareSecretPage() {
  const [secret, setSecret] = useState('');
  const [expiration, setExpiration] = useState(3600);
  const [shareMode, setShareMode] = useState<ShareMode>('one-time');
  const [otpCode, setOtpCode] = useState('');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedOtp, setCopiedOtp] = useState(false);
  const [sharingConfig, setSharingConfig] = useState<SharingConfig | null>(null);
  const [createdOtp, setCreatedOtp] = useState<string | null>(null);
  const [maxViews, setMaxViews] = useState(1);

  useEffect(() => {
    api.getSharingConfig().then(setSharingConfig).catch(() => {
      // Default all enabled if config fetch fails
      setSharingConfig({ enableOneTime: true, enableOtp: true, enableAuthLogin: true });
    });
  }, []);

  // Auto-select first enabled mode
  useEffect(() => {
    if (!sharingConfig) return;
    const enabledModes = SHARE_MODES.filter(m => {
      if (m.value === 'one-time') return sharingConfig.enableOneTime;
      if (m.value === 'otp') return sharingConfig.enableOtp;
      if (m.value === 'auth-login') return sharingConfig.enableAuthLogin;
      return false;
    });
    if (enabledModes.length > 0 && !enabledModes.find(m => m.value === shareMode)) {
      setShareMode(enabledModes[0]!.value);
    }
  }, [sharingConfig, shareMode]);

  const handleShare = async () => {
    if (!secret.trim()) {
      setError('Please enter a secret to share');
      return;
    }

    if (shareMode === 'otp' && (!otpCode.trim() || otpCode.length < 4)) {
      setError('Please enter an OTP code (at least 4 characters)');
      return;
    }

    setLoading(true);
    setError(null);
    setShareUrl(null);
    setCreatedOtp(null);

    try {
      const { encrypted, key } = await encryptSecret(secret);

      const result = await api.createSharedSecret(
        encrypted,
        expiration,
        shareMode === 'one-time',
        shareMode,
        shareMode === 'otp' ? otpCode : undefined,
        sharingConfig?.allowCustomViewCount ? maxViews : undefined,
      );

      const url = `${window.location.origin}/shared/${result.id}#${key}`;
      setShareUrl(url);
      if (shareMode === 'otp') {
        setCreatedOtp(otpCode);
      }
      setSecret('');
      setOtpCode('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create shared secret';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Clipboard not available. Please copy the URL manually.');
    }
  };

  const handleCopyOtp = async () => {
    if (!createdOtp) return;
    try {
      await navigator.clipboard.writeText(createdOtp);
      setCopiedOtp(true);
      setTimeout(() => setCopiedOtp(false), 2000);
    } catch {
      setError('Clipboard not available.');
    }
  };

  const isModeEnabled = (mode: ShareMode) => {
    if (!sharingConfig) return false;
    if (mode === 'one-time') return sharingConfig.enableOneTime;
    if (mode === 'otp') return sharingConfig.enableOtp;
    if (mode === 'auth-login') return sharingConfig.enableAuthLogin;
    return false;
  };

  const noModesEnabled = sharingConfig && !sharingConfig.enableOneTime && !sharingConfig.enableOtp && !sharingConfig.enableAuthLogin;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Share a Secret</h1>
        <p className="mt-1 text-sm text-gray-500">
          Share secrets securely. The secret is encrypted in your browser before being stored.
          The server never sees the plaintext.
        </p>
      </div>

      {/* Security info */}
      <div className="rounded-md bg-blue-50 border border-blue-200 p-3">
        <div className="flex items-start gap-2">
          <svg className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
          </svg>
          <div className="text-sm text-blue-800">
            <strong>End-to-end encrypted.</strong> Your secret is encrypted with OpenPGP in your browser.
            The decryption key is only in the share link (URL fragment) and never sent to the server.
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {noModesEnabled && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
          <p className="text-sm text-amber-700">
            All sharing modes are currently disabled by your administrator.
          </p>
        </div>
      )}

      {shareUrl ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-200 bg-green-50 p-5">
            <h2 className="text-sm font-semibold text-green-800 mb-2">Secret Created!</h2>
            <p className="text-sm text-green-700 mb-3">
              Share this link with the recipient.
              {shareMode === 'one-time' && ' It can only be viewed once.'}
              {shareMode === 'otp' && ' The recipient will need the OTP code to view it.'}
              {shareMode === 'auth-login' && ' The recipient must log in to VaultLens to view it.'}
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={shareUrl}
                className="flex-1 rounded border border-green-300 bg-white px-3 py-2 text-sm font-mono text-gray-800"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={handleCopy}
                className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
              >
                {copied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {createdOtp && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-sm font-semibold text-amber-800 mb-2">OTP Code</h2>
              <p className="text-sm text-amber-700 mb-3">
                Share this OTP code with the recipient via a <strong>separate channel</strong> (e.g. SMS, phone call, in-person).
                Do not include it in the same message as the link.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={createdOtp}
                  className="flex-1 rounded border border-amber-300 bg-white px-3 py-2 text-sm font-mono text-gray-800"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={handleCopyOtp}
                  className="rounded bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                >
                  {copiedOtp ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          <button
            onClick={() => { setShareUrl(null); setCreatedOtp(null); }}
            className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Share Another Secret
          </button>
        </div>
      ) : (
        <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
          {/* Secret input */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Secret</label>
            <textarea
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              rows={5}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
              placeholder="Enter the secret you want to share..."
            />
          </div>

          {/* Share mode selection */}
          {sharingConfig && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sharing Mode</label>
              <div className="space-y-2">
                {SHARE_MODES.map((mode) => {
                  const enabled = isModeEnabled(mode.value);
                  return (
                    <label
                      key={mode.value}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                        !enabled ? 'opacity-40 cursor-not-allowed border-gray-200 bg-gray-50' :
                        shareMode === mode.value
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="shareMode"
                        value={mode.value}
                        checked={shareMode === mode.value}
                        onChange={() => setShareMode(mode.value)}
                        disabled={!enabled}
                        className="mt-0.5"
                      />
                      <div>
                        <div className="text-sm font-medium text-gray-800">{mode.label}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{mode.description}</div>
                        {!enabled && (
                          <div className="text-xs text-amber-600 mt-0.5">Disabled by administrator</div>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* OTP Code input */}
          {shareMode === 'otp' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                OTP Code
              </label>
              <input
                type="text"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                placeholder="Enter a passcode to protect this secret (min 4 characters)..."
                minLength={4}
                maxLength={64}
              />
              <p className="mt-1 text-xs text-gray-500">
                Share this code with the recipient via a separate channel (e.g. SMS, phone call).
              </p>
            </div>
          )}

          {/* Options */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expires after
            </label>
            <select
              value={expiration}
              onChange={(e) => setExpiration(Number(e.target.value))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              {EXPIRATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* View count */}
          {sharingConfig?.allowCustomViewCount && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Max views
              </label>
              <input
                type="number"
                min={0}
                value={maxViews}
                onChange={(e) => setMaxViews(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                {maxViews === 0
                  ? 'Unlimited views (secret can be viewed any number of times until expiry).'
                  : `Secret can be viewed ${maxViews} time${maxViews !== 1 ? 's' : ''} before being deleted.`}
              </p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleShare}
            disabled={loading || !secret.trim() || noModesEnabled || false}
            className="w-full rounded px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            style={{ backgroundColor: 'var(--brand-primary, #1563ff)' }}
          >
            {loading ? 'Encrypting & Saving…' : 'Encrypt & Create Share Link'}
          </button>
        </div>
      )}
    </div>
  );
}
