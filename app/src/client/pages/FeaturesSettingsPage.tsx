import { useState, useEffect } from 'react';
import * as api from '../lib/api';
import type { SharingConfig, PoliciesConfig, AuthMethodsConfig } from '../lib/api';

// ── Toggle row ────────────────────────────────────────────────────────────────

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <label className="flex cursor-pointer items-center gap-4 border-b border-gray-100 px-5 py-4 last:border-b-0 hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800">{label}</div>
        <div className="mt-0.5 text-xs text-gray-500 leading-relaxed">{description}</div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
          checked ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
        }`}>
          {checked ? 'Enabled' : 'Disabled'}
        </span>
        {/* Toggle switch */}
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          onClick={() => onChange(!checked)}
          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-[#1563ff] focus:ring-offset-1 ${
            checked ? 'bg-[#1563ff]' : 'bg-gray-300'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              checked ? 'translate-x-4' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
    </label>
  );
}

// ── Section swimlane ─────────────────────────────────────────────────────────

interface SectionProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  saving: boolean;
  dirty: boolean;
  error: string | null;
  saved: boolean;
  onSave: () => void;
  children: React.ReactNode;
}

function Section({ icon, title, description, saving, dirty, error, saved, onSave, children }: SectionProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      {/* Section header */}
      <div className="flex items-start justify-between gap-4 border-b border-gray-100 bg-gray-50 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white border border-gray-200 text-[#1563ff]">
            {icon}
          </div>
          <div>
            <div className="text-sm font-semibold text-gray-800">{title}</div>
            <div className="mt-0.5 text-xs text-gray-500">{description}</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={saving || !dirty}
          className="shrink-0 rounded-md bg-[#1563ff] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1250d4] disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className="border-b border-red-100 bg-red-50 px-5 py-2.5 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* Rows */}
      <div>{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FeaturesSettingsPage() {
  // Sharing
  const [sharing, setSharing] = useState<SharingConfig>({
    enableOneTime: true,
    enableOtp: true,
    enableAuthLogin: true,
    allowCustomViewCount: false,
  });
  const [sharingOrig, setSharingOrig] = useState<SharingConfig | null>(null);
  const [sharingSaving, setSharingSaving] = useState(false);
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [sharingSaved, setSharingSaved] = useState(false);

  // Policies
  const [policies, setPolicies] = useState<PoliciesConfig>({ allowIdentityPolicyFallback: false });
  const [policiesOrig, setPoliciesOrig] = useState<PoliciesConfig | null>(null);
  const [policiesSaving, setPoliciesSaving] = useState(false);
  const [policiesError, setPoliciesError] = useState<string | null>(null);
  const [policiesSaved, setPoliciesSaved] = useState(false);

  // Auth Methods
  const [authMethods, setAuthMethods] = useState<AuthMethodsConfig>({ enableDevIntegrationGuides: true });
  const [authMethodsOrig, setAuthMethodsOrig] = useState<AuthMethodsConfig | null>(null);
  const [authMethodsSaving, setAuthMethodsSaving] = useState(false);
  const [authMethodsError, setAuthMethodsError] = useState<string | null>(null);
  const [authMethodsSaved, setAuthMethodsSaved] = useState(false);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getSharingConfig(),
      api.getPoliciesConfig(),
      api.getAuthMethodsConfig(),
    ]).then(([s, p, a]) => {
      setSharing(s); setSharingOrig(s);
      setPolicies(p); setPoliciesOrig(p);
      setAuthMethods(a); setAuthMethodsOrig(a);
    }).catch(() => {
      setSharingError('Failed to load feature settings');
    }).finally(() => setLoading(false));
  }, []);

  const isSharingDirty = sharingOrig !== null && JSON.stringify(sharing) !== JSON.stringify(sharingOrig);
  const isPoliciesDirty = policiesOrig !== null && JSON.stringify(policies) !== JSON.stringify(policiesOrig);
  const isAuthMethodsDirty = authMethodsOrig !== null && JSON.stringify(authMethods) !== JSON.stringify(authMethodsOrig);

  async function saveSharing() {
    setSharingSaving(true); setSharingError(null); setSharingSaved(false);
    try {
      await api.updateSharingConfig(sharing);
      setSharingOrig({ ...sharing });
      setSharingSaved(true);
      setTimeout(() => setSharingSaved(false), 3000);
    } catch { setSharingError('Failed to save sharing settings'); }
    finally { setSharingSaving(false); }
  }

  async function savePolicies() {
    setPoliciesSaving(true); setPoliciesError(null); setPoliciesSaved(false);
    try {
      await api.updatePoliciesConfig(policies);
      setPoliciesOrig({ ...policies });
      setPoliciesSaved(true);
      setTimeout(() => setPoliciesSaved(false), 3000);
    } catch { setPoliciesError('Failed to save policies settings'); }
    finally { setPoliciesSaving(false); }
  }

  async function saveAuthMethods() {
    setAuthMethodsSaving(true); setAuthMethodsError(null); setAuthMethodsSaved(false);
    try {
      await api.updateAuthMethodsConfig(authMethods);
      setAuthMethodsOrig({ ...authMethods });
      setAuthMethodsSaved(true);
      setTimeout(() => setAuthMethodsSaved(false), 3000);
    } catch { setAuthMethodsError('Failed to save auth methods settings'); }
    finally { setAuthMethodsSaving(false); }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-[#1563ff]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Features</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enable or disable functionality across VaultLens. Each section can be saved independently.
        </p>
      </div>

      {/* ── Sharing ───────────────────────────────────────────────────────── */}
      <Section
        icon={
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
          </svg>
        }
        title="Secret Sharing"
        description="Controls which sharing modes users can use when creating shared secret links."
        saving={sharingSaving}
        dirty={isSharingDirty}
        error={sharingError}
        saved={sharingSaved}
        onSave={() => { void saveSharing(); }}
      >
        <ToggleRow
          label="One-time View"
          description="Allow users to share secrets via one-time view URLs. The secret is automatically deleted after the first view."
          checked={sharing.enableOneTime}
          onChange={(v) => setSharing(prev => ({ ...prev, enableOneTime: v }))}
        />
        <ToggleRow
          label="OTP Protected"
          description="Allow users to share secrets protected with a one-time passcode. The recipient needs both the URL and the OTP code."
          checked={sharing.enableOtp}
          onChange={(v) => setSharing(prev => ({ ...prev, enableOtp: v }))}
        />
        <ToggleRow
          label="Login Required"
          description="Allow users to share secrets that require VaultLens authentication to view. The recipient must be logged in."
          checked={sharing.enableAuthLogin}
          onChange={(v) => setSharing(prev => ({ ...prev, enableAuthLogin: v }))}
        />
        <ToggleRow
          label="Custom View Count"
          description="Allow users to set a custom maximum view count on shared secrets (e.g. view up to 5 times). When disabled, one-time is the only view-limit option."
          checked={sharing.allowCustomViewCount}
          onChange={(v) => setSharing(prev => ({ ...prev, allowCustomViewCount: v }))}
        />
        {!sharing.enableOneTime && !sharing.enableOtp && !sharing.enableAuthLogin && (
          <div className="mx-5 mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
            All sharing modes are disabled. Users will not be able to create new shared secrets.
          </div>
        )}
      </Section>

      {/* ── Policies ─────────────────────────────────────────────────────── */}
      <Section
        icon={
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
          </svg>
        }
        title="ACL Policies"
        description="Controls visibility and access behaviour in the Policies section."
        saving={policiesSaving}
        dirty={isPoliciesDirty}
        error={policiesError}
        saved={policiesSaved}
        onSave={() => { void savePolicies(); }}
      >
        <ToggleRow
          label="Identity policy fallback"
          description="When a user lacks permission to list all policies (403), show only the policies attached to their own token and identity instead. Users see a 'Restricted view' notice and can view (but not edit) their own policies."
          checked={policies.allowIdentityPolicyFallback}
          onChange={(v) => setPolicies(prev => ({ ...prev, allowIdentityPolicyFallback: v }))}
        />
      </Section>

      {/* ── Auth Methods ─────────────────────────────────────────────────── */}
      <Section
        icon={
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
        }
        title="Auth Methods"
        description="Controls features available in the Auth Methods section."
        saving={authMethodsSaving}
        dirty={isAuthMethodsDirty}
        error={authMethodsError}
        saved={authMethodsSaved}
        onSave={() => { void saveAuthMethods(); }}
      >
        <ToggleRow
          label="Developer integration guides"
          description="Show a 'Developer Guide' tab on role detail pages with rendered markdown guides to help developers integrate. Admins can customise guides per auth type. Disabling hides the tab for all users."
          checked={authMethods.enableDevIntegrationGuides}
          onChange={(v) => setAuthMethods(prev => ({ ...prev, enableDevIntegrationGuides: v }))}
        />
      </Section>
    </div>
  );
}
