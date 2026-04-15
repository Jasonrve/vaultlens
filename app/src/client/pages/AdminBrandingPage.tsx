import { useState, useRef, useEffect } from 'react';
import { useBrandingStore, type BrandingConfig } from '../stores/brandingStore';

function ColorInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (val: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium text-gray-700 w-36">{label}</label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-14 cursor-pointer rounded border border-gray-300"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-28 rounded border border-gray-300 px-2 py-1.5 text-sm font-mono"
        pattern="^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$"
      />
    </div>
  );
}

function PreviewPanel({ config }: { config: BrandingConfig }) {
  return (
    <div className="rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-700">Live Preview</h3>
      </div>
      <div className="flex h-64">
        {/* Sidebar preview */}
        <div
          className="w-44 flex flex-col"
          style={{ backgroundColor: config.secondaryColor }}
        >
          <div className="flex items-center gap-2 border-b border-white/10 px-3 py-3">
            {config.logo ? (
              <img src={config.logo} alt="Logo" className="h-5 w-5 object-contain" />
            ) : (
              <svg className="h-5 w-5" viewBox="0 0 32 32" fill="none">
                <path
                  d="M16 3L28 10v12l-12 7L4 22V10L16 3z"
                  stroke={config.primaryColor}
                  strokeWidth="2"
                  strokeLinejoin="round"
                  fill={config.primaryColor}
                  fillOpacity="0.15"
                />
                <path
                  d="M16 9L22 12.5v7L16 23l-6-3.5v-7L16 9z"
                  stroke={config.primaryColor}
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            )}
            <span className="text-xs font-semibold text-white">VaultLens</span>
          </div>
          <div className="flex-1 px-2 py-2 space-y-1">
            <div
              className="rounded px-2 py-1 text-[11px] text-white/90"
              style={{ backgroundColor: `${config.primaryColor}30` }}
            >
              Dashboard
            </div>
            <div className="rounded px-2 py-1 text-[11px] text-gray-400">
              Secrets
            </div>
            <div className="rounded px-2 py-1 text-[11px] text-gray-400">
              Policies
            </div>
          </div>
        </div>
        {/* Content preview */}
        <div className="flex-1" style={{ backgroundColor: config.backgroundColor }}>
          <div className="bg-white border-b border-gray-200 px-4 py-2.5 text-xs text-gray-600">
            Header
          </div>
          <div className="p-4 space-y-2">
            <div className="h-3 w-32 rounded bg-gray-300" />
            <div className="h-3 w-48 rounded bg-gray-200" />
            <button
              className="mt-2 rounded px-3 py-1 text-[11px] text-white"
              style={{ backgroundColor: config.primaryColor }}
            >
              Primary Action
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminBrandingPage() {
  const { branding, loading, error, updateBranding, uploadLogo, removeLogo, loadBranding } =
    useBrandingStore();

  const [draft, setDraft] = useState<BrandingConfig>({ ...branding });
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft({ ...branding });
  }, [branding]);

  useEffect(() => {
    loadBranding();
  }, [loadBranding]);

  const handleSave = async () => {
    try {
      await updateBranding({
        primaryColor: draft.primaryColor,
        secondaryColor: draft.secondaryColor,
        backgroundColor: draft.backgroundColor,
        appName: draft.appName,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // Error handled in store
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await uploadLogo(file);
    } catch {
      // Error handled in store
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveLogo = async () => {
    try {
      await removeLogo();
      setDraft((prev: BrandingConfig) => ({ ...prev, logo: '' }));
    } catch {
      // Error handled in store
    }
  };

  const handleReset = () => {
    setDraft({
      logo: branding.logo,
      primaryColor: '#1563ff',
      secondaryColor: '#19191a',
      backgroundColor: '#f6f6f6',
      appName: 'VaultLens',
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Branding</h1>
        <p className="mt-1 text-sm text-gray-500">
          Customize the look and feel of your VaultLens instance.
        </p>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Settings */}
        <div className="space-y-6">
          {/* Logo */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Logo</h2>
            <div className="flex items-center gap-4">
              {draft.logo ? (
                <div className="relative">
                  <img
                    src={draft.logo}
                    alt="Current logo"
                    className="h-12 w-12 rounded border border-gray-200 object-contain"
                  />
                  <button
                    onClick={handleRemoveLogo}
                    className="absolute -top-1.5 -right-1.5 rounded-full bg-red-500 p-0.5 text-white hover:bg-red-600"
                    title="Remove logo"
                  >
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded border border-dashed border-gray-300 bg-gray-50">
                  <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25v10.5a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
              )}
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={handleLogoUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  Upload Logo
                </button>
                <p className="mt-1 text-xs text-gray-400">PNG, JPEG, SVG, or WebP. Max 2MB.</p>
              </div>
            </div>
          </div>

          {/* Colors */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">App Name</h2>
            <div className="flex flex-col gap-1">
              <input
                type="text"
                value={draft.appName}
                maxLength={50}
                onChange={(e) => setDraft((p: BrandingConfig) => ({ ...p, appName: e.target.value }))}
                className="rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
                placeholder="VaultLens"
              />
              <p className="text-xs text-gray-400">{draft.appName.length}/50 characters</p>
            </div>
          </div>

          {/* Color Scheme */}
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-800 mb-4">Color Scheme</h2>
            <div className="space-y-4">
              <ColorInput
                label="Primary Color"
                value={draft.primaryColor}
                onChange={(val) => setDraft((p: BrandingConfig) => ({ ...p, primaryColor: val }))}
              />
              <ColorInput
                label="Secondary Color"
                value={draft.secondaryColor}
                onChange={(val) => setDraft((p: BrandingConfig) => ({ ...p, secondaryColor: val }))}
              />
              <ColorInput
                label="Background Color"
                value={draft.backgroundColor}
                onChange={(val) => setDraft((p: BrandingConfig) => ({ ...p, backgroundColor: val }))}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={loading}
              className="rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-primary, #1563ff)' }}
            >
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
            <button
              onClick={handleReset}
              className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
            >
              Reset to Defaults
            </button>
            {saved && (
              <span className="text-sm text-green-600 font-medium">✓ Saved</span>
            )}
          </div>
        </div>

        {/* Preview */}
        <PreviewPanel config={draft} />
      </div>
    </div>
  );
}
