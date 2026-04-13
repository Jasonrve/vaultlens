import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { decryptSecret } from '../lib/crypto';
import { useBrandingStore } from '../stores/brandingStore';
import * as api from '../lib/api';

export default function ViewSharedSecretPage() {
  const { id } = useParams<{ id: string }>();
  const [decryptedSecret, setDecryptedSecret] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [metadata, setMetadata] = useState<{
    createdAt: string;
    expiresAt: string;
    oneTime: boolean;
  } | null>(null);
  const { branding, loadBranding } = useBrandingStore();
  // Guard against React StrictMode double-invoking effects in development.
  // Without this, the first invocation marks the one-time secret as retrieved
  // and the second invocation immediately gets a 404.
  const hasFetched = useRef(false);

  useEffect(() => {
    // Load branding for logo display on shared page
    loadBranding();
  }, [loadBranding]);

  useEffect(() => {
    if (hasFetched.current) return;
    hasFetched.current = true;

    async function fetchAndDecrypt() {
      if (!id) {
        setError('Invalid share link');
        setLoading(false);
        return;
      }

      // Extract the decryption key from the URL fragment (never sent to server)
      const key = window.location.hash.slice(1);
      if (!key) {
        setError('Missing decryption key. The share link may be incomplete.');
        setLoading(false);
        return;
      }

      try {
        // Fetch the encrypted payload from the server
        const result = await api.getSharedSecret(id);

        setMetadata({
          createdAt: result.createdAt,
          expiresAt: result.expiresAt,
          oneTime: result.oneTime,
        });

        // Decrypt client-side using the key from the URL fragment
        const plaintext = await decryptSecret(result.encrypted, key);
        setDecryptedSecret(plaintext);
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

  const handleCopy = async () => {
    if (!decryptedSecret) return;
    try {
      await navigator.clipboard.writeText(decryptedSecret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available (e.g. non-HTTPS context)
      setError('Unable to copy — clipboard access requires HTTPS.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-lg space-y-4">
        {/* Logo */}
        {branding.logo && (
          <div className="flex justify-center">
            <img src={branding.logo} alt="Logo" className="h-16 w-16 object-contain" />
          </div>
        )}

        {/* Header */}
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900">Shared Secret</h1>
          <p className="mt-1 text-sm text-gray-500">
            This secret was shared securely via VaultLens.
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
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-white p-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-gray-700">Decrypted Secret</h2>
                <button
                  onClick={handleCopy}
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
                  {metadata.oneTime && (
                    <div className="col-span-2">
                      <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                        One-time view — this secret cannot be retrieved again
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
