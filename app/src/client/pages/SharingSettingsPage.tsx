import { useState, useEffect } from 'react';
import * as api from '../lib/api';
import type { SharingConfig } from '../lib/api';

export default function SharingSettingsPage() {
  const [config, setConfig] = useState<SharingConfig>({
    enableOneTime: true,
    enableOtp: true,
    enableAuthLogin: true,
    allowCustomViewCount: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSharingConfig()
      .then((cfg) => setConfig(cfg))
      .catch(() => setError('Failed to load sharing configuration'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateSharingConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save sharing configuration');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  const modes = [
    {
      key: 'enableOneTime' as const,
      label: 'One-time View',
      description: 'Allow users to share secrets via one-time view URLs. The secret can only be viewed once.',
    },
    {
      key: 'enableOtp' as const,
      label: 'OTP Protected',
      description: 'Allow users to share secrets protected with a one-time passcode. The recipient needs the URL and the OTP code.',
    },
    {
      key: 'enableAuthLogin' as const,
      label: 'Login Required',
      description: 'Allow users to share secrets that require VaultLens authentication to view. The recipient must log in.',
    },
  ];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Sharing Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure which secret sharing modes are available to users.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {saved && (
        <div className="rounded-md bg-green-50 border border-green-200 p-3">
          <p className="text-sm text-green-700">Settings saved successfully.</p>
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">Sharing Modes</h2>
        <p className="text-xs text-gray-500">
          Enable or disable sharing modes. At least one mode should be enabled for sharing to work.
        </p>

        <div className="space-y-3">
          {modes.map((mode) => (
            <label
              key={mode.key}
              className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                config[mode.key]
                  ? 'border-green-200 bg-green-50'
                  : 'border-gray-200 bg-gray-50'
              }`}
            >
              <input
                type="checkbox"
                checked={config[mode.key]}
                onChange={(e) => setConfig(prev => ({ ...prev, [mode.key]: e.target.checked }))}
                className="mt-0.5 rounded border-gray-300"
              />
              <div>
                <div className="text-sm font-medium text-gray-800">{mode.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{mode.description}</div>
              </div>
              <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                config[mode.key]
                  ? 'bg-green-100 text-green-700'
                  : 'bg-gray-200 text-gray-500'
              }`}>
                {config[mode.key] ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          ))}
        </div>

        {!config.enableOneTime && !config.enableOtp && !config.enableAuthLogin && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-xs text-amber-700">
              All sharing modes are disabled. Users will not be able to create new shared secrets.
            </p>
          </div>
        )}
      </div>

      {/* View count setting */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-800">View Count</h2>
        <p className="text-xs text-gray-500">
          Control whether users can customise how many times a shared secret can be viewed.
        </p>

        <label
          className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
            config.allowCustomViewCount
              ? 'border-green-200 bg-green-50'
              : 'border-gray-200 bg-gray-50'
          }`}
        >
          <input
            type="checkbox"
            checked={config.allowCustomViewCount}
            onChange={(e) => setConfig(prev => ({ ...prev, allowCustomViewCount: e.target.checked }))}
            className="mt-0.5 rounded border-gray-300"
          />
          <div>
            <div className="text-sm font-medium text-gray-800">Allow custom view count</div>
            <div className="text-xs text-gray-500 mt-0.5">
              When enabled, users can set a custom max view count (including unlimited) when creating a shared secret. When disabled, all shares default to 1 view.
            </div>
          </div>
          <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
            config.allowCustomViewCount
              ? 'bg-green-100 text-green-700'
              : 'bg-gray-200 text-gray-500'
          }`}>
            {config.allowCustomViewCount ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--brand-primary, #1563ff)' }}
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
