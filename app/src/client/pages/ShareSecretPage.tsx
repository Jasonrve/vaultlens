import { useState } from 'react';
import { encryptSecret } from '../lib/crypto';
import * as api from '../lib/api';

const EXPIRATION_OPTIONS = [
  { label: '1 hour', value: 3600 },
  { label: '4 hours', value: 14400 },
  { label: '1 day', value: 86400 },
  { label: '3 days', value: 259200 },
  { label: '7 days', value: 604800 },
];

export default function ShareSecretPage() {
  const [secret, setSecret] = useState('');
  const [expiration, setExpiration] = useState(3600);
  const [oneTime, setOneTime] = useState(true);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    if (!secret.trim()) {
      setError('Please enter a secret to share');
      return;
    }

    setLoading(true);
    setError(null);
    setShareUrl(null);

    try {
      // Step 1: Encrypt the secret client-side (server never sees plaintext)
      const { encrypted, key } = await encryptSecret(secret);

      // Step 2: Store the encrypted payload on the server
      const result = await api.createSharedSecret(encrypted, expiration, oneTime);

      // Step 3: Construct the share URL with the decryption key in the fragment
      // The fragment (#) is never sent to the server
      const url = `${window.location.origin}/shared/${result.id}#${key}`;
      setShareUrl(url);
      setSecret('');
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

      {shareUrl ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-200 bg-green-50 p-5">
            <h2 className="text-sm font-semibold text-green-800 mb-2">Secret Created!</h2>
            <p className="text-sm text-green-700 mb-3">
              Share this link with the recipient. {oneTime ? 'It can only be viewed once.' : ''}
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
          <button
            onClick={() => setShareUrl(null)}
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

          {/* Options */}
          <div className="grid grid-cols-2 gap-4">
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
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={oneTime}
                  onChange={(e) => setOneTime(e.target.checked)}
                  className="rounded border-gray-300"
                />
                One-time view only
              </label>
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleShare}
            disabled={loading || !secret.trim()}
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
