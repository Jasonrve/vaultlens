import { useState, useEffect } from 'react';
import * as api from '../lib/api';
import type { AuthMethodsConfig } from '../lib/api';

export default function AuthMethodsSettingsPage() {
  const [config, setConfig] = useState<AuthMethodsConfig>({
    enableDevIntegrationGuides: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getAuthMethodsConfig()
      .then((cfg) => setConfig(cfg))
      .catch(() => setError('Failed to load auth methods configuration'))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateAuthMethodsConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError('Failed to save auth methods configuration');
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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Auth Methods Settings</h1>
        <p className="mt-1 text-sm text-gray-500">
          Configure behaviour for the Auth Methods section.
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
        <h2 className="text-sm font-semibold text-gray-800">Developer Integration Guides</h2>
        <p className="text-xs text-gray-500">
          Controls whether the Developer Guide tab is shown on auth method role detail pages.
        </p>

        <label
          className={`flex items-start gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
            config.enableDevIntegrationGuides
              ? 'border-green-200 bg-green-50'
              : 'border-gray-200 bg-gray-50'
          }`}
        >
          <input
            type="checkbox"
            checked={config.enableDevIntegrationGuides}
            onChange={(e) =>
              setConfig((prev) => ({ ...prev, enableDevIntegrationGuides: e.target.checked }))
            }
            className="mt-0.5 rounded border-gray-300"
          />
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-800">Show developer integration guides</div>
            <div className="text-xs text-gray-500 mt-0.5">
              When enabled, a &ldquo;Developer Guide&rdquo; tab is shown on role detail pages for auth methods,
              providing rendered markdown guides to help developers integrate. Admins can customise
              guides per auth type. Disabling this hides the tab for all users including admins.
            </div>
          </div>
          <span
            className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
              config.enableDevIntegrationGuides
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-200 text-gray-500'
            }`}
          >
            {config.enableDevIntegrationGuides ? 'Enabled' : 'Disabled'}
          </span>
        </label>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => { void handleSave(); }}
          disabled={saving}
          className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </div>
  );
}
