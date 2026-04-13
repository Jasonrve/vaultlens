import { useState, useEffect, useCallback } from 'react';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import JsonEditor from '../common/JsonEditor';

// ── Shared sub-components ───────────────────────────────────────────────────

function FieldRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[220px_1fr] gap-4 border-b border-gray-100 py-4 last:border-0">
      <div>
        <div className="text-sm font-medium text-gray-700">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-gray-400 leading-snug">{hint}</div>}
      </div>
      <div className="flex items-start">{children}</div>
    </div>
  );
}

function ReadValue({ value }: { value: string | boolean | null | undefined }) {
  if (value === null || value === undefined || value === '') return <span className="text-sm text-gray-400">—</span>;
  if (typeof value === 'boolean') return <span className="text-sm text-gray-900">{value ? 'Yes' : 'No'}</span>;
  return <span className="text-sm text-gray-900 font-mono break-all">{String(value)}</span>;
}

function TextField({
  value, onChange, readOnly, placeholder, type = 'text',
}: {
  value: string; onChange: (v: string) => void; readOnly: boolean; placeholder?: string; type?: string;
}) {
  if (readOnly) return <ReadValue value={value} />;
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      autoComplete="off"
      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
    />
  );
}

function TextAreaField({ value, onChange, readOnly, rows = 4 }: {
  value: string; onChange: (v: string) => void; readOnly: boolean; rows?: number;
}) {
  if (readOnly) return <ReadValue value={value} />;
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 font-mono text-xs focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
    />
  );
}

function Toggle({ checked, onChange, readOnly }: { checked: boolean; onChange: (v: boolean) => void; readOnly: boolean }) {
  if (readOnly) return <ReadValue value={checked} />;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-[#1563ff]' : 'bg-gray-200'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        } mt-0.5`}
      />
    </button>
  );
}

function ListField({ items, onChange, readOnly }: {
  items: string[]; onChange: (items: string[]) => void; readOnly: boolean;
}) {
  const [newItem, setNewItem] = useState('');
  if (readOnly) {
    return items.length === 0
      ? <span className="text-sm text-gray-400">—</span>
      : (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <span key={i} className="rounded bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700">{item}</span>
          ))}
        </div>
      );
  }
  function remove(i: number) { onChange(items.filter((_, idx) => idx !== i)); }
  function add() {
    if (!newItem.trim()) return;
    onChange([...items, newItem.trim()]);
    setNewItem('');
  }
  return (
    <div className="w-full space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={item}
            onChange={(e) => { const n = [...items]; n[i] = e.target.value; onChange(n); }}
            className="flex-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
          />
          <button type="button" onClick={() => remove(i)} className="text-gray-400 hover:text-red-500 p-0.5">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder="Add item…"
          className="flex-1 rounded-md border border-dashed border-gray-300 px-2.5 py-1.5 text-sm placeholder-gray-400 focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
        />
        <button
          type="button"
          onClick={add}
          className="rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"
        >
          Add
        </button>
      </div>
    </div>
  );
}

// ── OIDC / JWT typed config ─────────────────────────────────────────────────

interface OidcConfigFields {
  bound_issuer: string;
  default_role: string;
  jwks_ca_pem: string;
  jwks_url: string;
  jwt_supported_algs: string[];
  jwt_validation_pubkeys: string[];
  namespace_in_state: boolean;
  oidc_client_id: string;
  oidc_client_secret: string;
  oidc_discovery_ca_pem: string;
  oidc_discovery_url: string;
  oidc_response_mode: string;
  oidc_response_types: string[];
  provider_config: string; // JSON string
}

function toOidcFields(raw: Record<string, unknown>): OidcConfigFields {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  const providerCfg = raw['provider_config'];
  return {
    bound_issuer: String(raw['bound_issuer'] ?? ''),
    default_role: String(raw['default_role'] ?? ''),
    jwks_ca_pem: String(raw['jwks_ca_pem'] ?? ''),
    jwks_url: String(raw['jwks_url'] ?? ''),
    jwt_supported_algs: arr(raw['jwt_supported_algs']),
    jwt_validation_pubkeys: arr(raw['jwt_validation_pubkeys']),
    namespace_in_state: Boolean(raw['namespace_in_state'] ?? true),
    oidc_client_id: String(raw['oidc_client_id'] ?? ''),
    oidc_client_secret: '',
    oidc_discovery_ca_pem: String(raw['oidc_discovery_ca_pem'] ?? ''),
    oidc_discovery_url: String(raw['oidc_discovery_url'] ?? ''),
    oidc_response_mode: String(raw['oidc_response_mode'] ?? ''),
    oidc_response_types: arr(raw['oidc_response_types']),
    provider_config:
      providerCfg && typeof providerCfg === 'object'
        ? JSON.stringify(providerCfg, null, 2)
        : '{}',
  };
}

function fromOidcFields(f: OidcConfigFields): Record<string, unknown> {
  let parsedProvider: Record<string, unknown> = {};
  try { parsedProvider = JSON.parse(f.provider_config) as Record<string, unknown>; } catch { /* ignore */ }
  const payload: Record<string, unknown> = {
    bound_issuer: f.bound_issuer,
    default_role: f.default_role,
    jwks_ca_pem: f.jwks_ca_pem,
    jwks_url: f.jwks_url,
    jwt_supported_algs: f.jwt_supported_algs,
    jwt_validation_pubkeys: f.jwt_validation_pubkeys,
    namespace_in_state: f.namespace_in_state,
    oidc_client_id: f.oidc_client_id,
    oidc_discovery_ca_pem: f.oidc_discovery_ca_pem,
    oidc_discovery_url: f.oidc_discovery_url,
    oidc_response_mode: f.oidc_response_mode,
    oidc_response_types: f.oidc_response_types,
    provider_config: parsedProvider,
  };
  // Only send oidc_client_secret if the user typed something
  if (f.oidc_client_secret) payload['oidc_client_secret'] = f.oidc_client_secret;
  return payload;
}

function OidcConfigForm({
  method,
  readOnly,
  initial,
  onSaved,
  onError,
}: {
  method: string;
  readOnly: boolean;
  initial: OidcConfigFields;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [fields, setFields] = useState<OidcConfigFields>(initial);
  const [saving, setSaving] = useState(false);

  useEffect(() => setFields(initial), [initial]);

  function set<K extends keyof OidcConfigFields>(key: K, val: OidcConfigFields[K]) {
    setFields((f) => ({ ...f, [key]: val }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateAuthMethodConfig(method, fromOidcFields(fields));
      onSaved();
    } catch (err) {
      const vaultMsg = (err as { response?: { data?: { error?: string } } })?.response?.data;
      onError(vaultMsg?.error ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="Bound issuer" hint="Value to match the 'iss' claim in a JWT. Optional.">
          <TextField value={fields.bound_issuer} onChange={(v) => set('bound_issuer', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="Default role" hint="Default role to use if none is provided during login.">
          <TextField value={fields.default_role} onChange={(v) => set('default_role', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="OIDC discovery URL" hint="OIDC Discovery URL, without any well-known component (base path).">
          <TextField value={fields.oidc_discovery_url} onChange={(v) => set('oidc_discovery_url', v)} readOnly={readOnly} placeholder="https://login.microsoftonline.com/.../v2.0" />
        </FieldRow>

        <FieldRow label="OIDC client ID" hint="The OAuth Client ID configured with your OIDC provider.">
          <TextField value={fields.oidc_client_id} onChange={(v) => set('oidc_client_id', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="OIDC client secret" hint="Client secret; leave blank to keep the current value.">
          {readOnly
            ? <span className="text-sm text-gray-400">••••••••••••</span>
            : <TextField value={fields.oidc_client_secret} onChange={(v) => set('oidc_client_secret', v)} readOnly={false} type="password" placeholder="Leave blank to keep existing" />
          }
        </FieldRow>

        <FieldRow label="OIDC response mode" hint="Allowed values: 'query' and 'form_post'.">
          <TextField value={fields.oidc_response_mode} onChange={(v) => set('oidc_response_mode', v)} readOnly={readOnly} placeholder="query" />
        </FieldRow>

        <FieldRow label="OIDC response types" hint="Add one item per row.">
          <ListField items={fields.oidc_response_types} onChange={(v) => set('oidc_response_types', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="Namespace in OIDC state" hint="Pass namespace in the OIDC state parameter instead of as a query parameter.">
          <Toggle checked={fields.namespace_in_state} onChange={(v) => set('namespace_in_state', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="JWKS URL" hint="JWKS URL to authenticate signatures. Cannot be used with oidc_discovery_url.">
          <TextField value={fields.jwks_url} onChange={(v) => set('jwks_url', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="JWT supported algs" hint="Add one item per row.">
          <ListField items={fields.jwt_supported_algs} onChange={(v) => set('jwt_supported_algs', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="JWT validation pubkeys" hint="Add one item per row.">
          <ListField items={fields.jwt_validation_pubkeys} onChange={(v) => set('jwt_validation_pubkeys', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="JWKS CA PEM" hint="CA certificate chain in PEM format for the JWKS URL.">
          <TextAreaField value={fields.jwks_ca_pem} onChange={(v) => set('jwks_ca_pem', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="OIDC discovery CA PEM" hint="CA certificate chain in PEM format for the OIDC Discovery URL.">
          <TextAreaField value={fields.oidc_discovery_ca_pem} onChange={(v) => set('oidc_discovery_ca_pem', v)} readOnly={readOnly} />
        </FieldRow>

        <FieldRow label="Provider config" hint="Provider-specific configuration. Optional.">
          {readOnly
            ? <pre className="w-full text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-40">{fields.provider_config}</pre>
            : <div className="w-full"><JsonEditor value={fields.provider_config} onChange={(v) => set('provider_config', v)} /></div>
          }
        </FieldRow>
      </div>

      {!readOnly && (
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={saving}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Generic config (non-OIDC/JWT types) ────────────────────────────────────

function GenericConfigForm({
  method,
  readOnly,
  initial,
  onSaved,
  onError,
}: {
  method: string;
  readOnly: boolean;
  initial: Record<string, unknown>;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [value, setValue] = useState(JSON.stringify(initial, null, 2));
  const [saving, setSaving] = useState(false);

  useEffect(() => setValue(JSON.stringify(initial, null, 2)), [initial]);

  async function handleSave() {
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(value) as Record<string, unknown>; }
    catch { onError('Invalid JSON'); return; }
    setSaving(true);
    try {
      await api.updateAuthMethodConfig(method, parsed);
      onSaved();
    } catch (err) {
      const vaultMsg = (err as { response?: { data?: { error?: string } } })?.response?.data;
      onError(vaultMsg?.error ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {Object.keys(initial).length === 0 && readOnly && (
        <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          No configuration has been set for this auth method. Click <strong>Edit</strong> to configure.
        </div>
      )}
      <JsonEditor value={value} onChange={setValue} readOnly={readOnly} />
      {!readOnly && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={saving}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Public component ────────────────────────────────────────────────────────

interface Props {
  method: string;
  authType: string;
}

export default function AuthMethodConfig({ method, authType }: Props) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFetchError(null);
    api.getAuthMethodConfig(method)
      .then(setConfig)
      .catch((err: unknown) => {
        const vaultMsg = (err as { response?: { data?: { error?: string } } })?.response?.data;
        setFetchError(vaultMsg?.error ?? (err instanceof Error ? err.message : 'Failed to load config'));
      })
      .finally(() => setLoading(false));
  }, [method]);

  useEffect(() => { load(); }, [load]);

  function handleSaved() {
    setSaveSuccess(true);
    setSaveError(null);
    setEditing(false);
    setTimeout(() => setSaveSuccess(false), 3000);
    load();
  }

  const isOidcType = authType === 'oidc' || authType === 'jwt';

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {!editing && (
            <button
              type="button"
              onClick={() => { setSaveError(null); setSaveSuccess(false); setEditing(true); }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Edit
            </button>
          )}
          {editing && (
            <button
              type="button"
              onClick={() => { setEditing(false); setSaveError(null); load(); }}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
        </div>
        {saveSuccess && (
          <span className="text-sm font-medium text-green-600">Saved successfully</span>
        )}
        {saveError && (
          <span className="max-w-xl text-sm text-red-600">{saveError}</span>
        )}
      </div>

      {loading && <LoadingSpinner className="mt-8" />}
      {fetchError && (
        fetchError.toLowerCase().includes('unsupported path') ? (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
            No configuration endpoint is available for this auth method type.
          </div>
        ) : (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fetchError}
          </div>
        )
      )}

      {!loading && !fetchError && config !== null && (
        isOidcType ? (
          <OidcConfigForm
            method={method}
            readOnly={!editing}
            initial={toOidcFields(config)}
            onSaved={handleSaved}
            onError={setSaveError}
          />
        ) : (
          <GenericConfigForm
            method={method}
            readOnly={!editing}
            initial={config}
            onSaved={handleSaved}
            onError={setSaveError}
          />
        )
      )}
    </div>
  );
}
