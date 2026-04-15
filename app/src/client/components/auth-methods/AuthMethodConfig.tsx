import { useState, useEffect, useCallback } from 'react';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import JsonEditor from '../common/JsonEditor';
import {
  AwsConfigForm, toAwsFields,
  AzureConfigForm, toAzureFields,
  GcpConfigForm, toGcpFields,
  OktaConfigForm, toOktaFields,
  RadiusConfigForm, toRadiusFields,
} from './AuthConfigForms';

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

// ── Shared token parameters section (used by multiple auth types) ──────────

function TokenParamsSection({ fields, set, readOnly }: {
  fields: {
    token_ttl: string; token_max_ttl: string; token_explicit_max_ttl: string;
    token_no_default_policy: boolean; token_num_uses: string; token_period: string;
    token_policies: string[]; token_bound_cidrs: string[]; token_type: string;
  };
  set: <K extends string>(key: K, val: unknown) => void;
  readOnly: boolean;
}) {
  const tokenTypeOptions = ['', 'default', 'batch', 'service', 'default-service', 'default-batch'];
  return (
    <>
      <FieldRow label="Token Initial TTL" hint="Duration string, e.g. 1h or 30m. 0 = system default.">
        <TextField value={fields.token_ttl} onChange={(v) => set('token_ttl', v)} readOnly={readOnly} placeholder="e.g. 1h" />
      </FieldRow>
      <FieldRow label="Token Max TTL" hint="Maximum lifetime for generated tokens.">
        <TextField value={fields.token_max_ttl} onChange={(v) => set('token_max_ttl', v)} readOnly={readOnly} placeholder="e.g. 24h" />
      </FieldRow>
      <FieldRow label="Token Explicit Max TTL" hint="Hard cap on renewals; 0 = disabled.">
        <TextField value={fields.token_explicit_max_ttl} onChange={(v) => set('token_explicit_max_ttl', v)} readOnly={readOnly} placeholder="e.g. 0s" />
      </FieldRow>
      <FieldRow label="Token Period" hint="If set, tokens are periodic and have no max TTL.">
        <TextField value={fields.token_period} onChange={(v) => set('token_period', v)} readOnly={readOnly} placeholder="e.g. 0s" />
      </FieldRow>
      <FieldRow label="Do Not Attach 'default' Policy" hint="Prevent the default policy from being added to generated tokens.">
        <Toggle checked={fields.token_no_default_policy} onChange={(v) => set('token_no_default_policy', v)} readOnly={readOnly} />
      </FieldRow>
      <FieldRow label="Max Uses of Generated Tokens" hint="Maximum number of uses per token; 0 = unlimited.">
        <TextField value={fields.token_num_uses} onChange={(v) => set('token_num_uses', v)} readOnly={readOnly} placeholder="0" type="number" />
      </FieldRow>
      <FieldRow label="Token Type" hint="Type of token to generate.">
        {readOnly ? <ReadValue value={fields.token_type || 'default'} /> : (
          <select
            value={fields.token_type}
            onChange={(e) => set('token_type', e.target.value)}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none"
          >
            {tokenTypeOptions.map((o) => <option key={o} value={o}>{o || '(default)'}</option>)}
          </select>
        )}
      </FieldRow>
      <FieldRow label="Token Policies" hint="List of policies attached to generated tokens.">
        <ListField items={fields.token_policies} onChange={(v) => set('token_policies', v)} readOnly={readOnly} />
      </FieldRow>
      <FieldRow label="Token Bound CIDRs" hint="Source IP CIDRs that can use the generated tokens.">
        <ListField items={fields.token_bound_cidrs} onChange={(v) => set('token_bound_cidrs', v)} readOnly={readOnly} />
      </FieldRow>
    </>
  );
}

// ── GitHub config form ──────────────────────────────────────────────────────

interface GitHubFields {
  organization: string; organization_id: string; base_url: string;
  token_ttl: string; token_max_ttl: string; token_explicit_max_ttl: string;
  token_no_default_policy: boolean; token_num_uses: string; token_period: string;
  token_policies: string[]; token_bound_cidrs: string[]; token_type: string;
}

function toGitHubFields(raw: Record<string, unknown>): GitHubFields {
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  return {
    organization: String(raw['organization'] ?? ''),
    organization_id: String(raw['organization_id'] ?? ''),
    base_url: String(raw['base_url'] ?? ''),
    token_ttl: String(raw['token_ttl'] ?? ''),
    token_max_ttl: String(raw['token_max_ttl'] ?? ''),
    token_explicit_max_ttl: String(raw['token_explicit_max_ttl'] ?? ''),
    token_no_default_policy: Boolean(raw['token_no_default_policy']),
    token_num_uses: String(raw['token_num_uses'] ?? '0'),
    token_period: String(raw['token_period'] ?? ''),
    token_policies: arr(raw['token_policies']),
    token_bound_cidrs: arr(raw['token_bound_cidrs']),
    token_type: String(raw['token_type'] ?? ''),
  };
}

function GitHubConfigForm({
  method, readOnly, initial, onSaved, onError,
}: { method: string; readOnly: boolean; initial: GitHubFields; onSaved: () => void; onError: (msg: string) => void; }) {
  const [fields, setFields] = useState<GitHubFields>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setFields(initial), [initial]);
  function set(key: string, val: unknown) { setFields((f) => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { organization: fields.organization };
      if (fields.organization_id) payload['organization_id'] = fields.organization_id;
      if (fields.base_url) payload['base_url'] = fields.base_url;
      if (fields.token_ttl) payload['token_ttl'] = fields.token_ttl;
      if (fields.token_max_ttl) payload['token_max_ttl'] = fields.token_max_ttl;
      if (fields.token_explicit_max_ttl) payload['token_explicit_max_ttl'] = fields.token_explicit_max_ttl;
      payload['token_no_default_policy'] = fields.token_no_default_policy;
      if (fields.token_num_uses) payload['token_num_uses'] = parseInt(fields.token_num_uses, 10);
      if (fields.token_period) payload['token_period'] = fields.token_period;
      if (fields.token_policies.length) payload['token_policies'] = fields.token_policies;
      if (fields.token_bound_cidrs.length) payload['token_bound_cidrs'] = fields.token_bound_cidrs;
      if (fields.token_type) payload['token_type'] = fields.token_type;
      await api.updateAuthMethodConfig(method, payload);
      onSaved();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="Organization" hint="GitHub organization users must belong to (required).">
          <TextField value={fields.organization} onChange={(v) => set('organization', v)} readOnly={readOnly} placeholder="my-org" />
        </FieldRow>
        <FieldRow label="Organization ID" hint="Numeric ID of the GitHub organization. Protects against renames.">
          <TextField value={fields.organization_id} onChange={(v) => set('organization_id', v)} readOnly={readOnly} placeholder="(optional)" />
        </FieldRow>
        <FieldRow label="Base URL" hint="Base URL for GitHub Enterprise (leave blank for github.com).">
          <TextField value={fields.base_url} onChange={(v) => set('base_url', v)} readOnly={readOnly} placeholder="https://github.example.com/api/v3/" />
        </FieldRow>
        <TokenParamsSection fields={fields} set={set} readOnly={readOnly} />
      </div>
      {!readOnly && (
        <div className="mt-4">
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving || !fields.organization}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Kubernetes config form ──────────────────────────────────────────────────

interface KubernetesFields {
  kubernetes_host: string; kubernetes_ca_cert: string; token_reviewer_jwt: string;
  pem_keys: string[]; issuer: string; disable_iss_validation: boolean; disable_local_ca_jwt: boolean;
}

function toKubernetesFields(raw: Record<string, unknown>): KubernetesFields {
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  return {
    kubernetes_host: String(raw['kubernetes_host'] ?? ''),
    kubernetes_ca_cert: String(raw['kubernetes_ca_cert'] ?? ''),
    token_reviewer_jwt: '',
    pem_keys: arr(raw['pem_keys']),
    issuer: String(raw['issuer'] ?? ''),
    disable_iss_validation: Boolean(raw['disable_iss_validation']),
    disable_local_ca_jwt: Boolean(raw['disable_local_ca_jwt']),
  };
}

function KubernetesConfigForm({
  method, readOnly, initial, onSaved, onError,
}: { method: string; readOnly: boolean; initial: KubernetesFields; onSaved: () => void; onError: (msg: string) => void; }) {
  const [fields, setFields] = useState<KubernetesFields>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setFields(initial), [initial]);
  function set(key: string, val: unknown) { setFields((f) => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { kubernetes_host: fields.kubernetes_host };
      if (fields.kubernetes_ca_cert) payload['kubernetes_ca_cert'] = fields.kubernetes_ca_cert;
      if (fields.token_reviewer_jwt) payload['token_reviewer_jwt'] = fields.token_reviewer_jwt;
      if (fields.pem_keys.length) payload['pem_keys'] = fields.pem_keys;
      if (fields.issuer) payload['issuer'] = fields.issuer;
      payload['disable_iss_validation'] = fields.disable_iss_validation;
      payload['disable_local_ca_jwt'] = fields.disable_local_ca_jwt;
      await api.updateAuthMethodConfig(method, payload);
      onSaved();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="Kubernetes Host" hint="Host or HTTPS URL of the Kubernetes API server (required).">
          <TextField value={fields.kubernetes_host} onChange={(v) => set('kubernetes_host', v)} readOnly={readOnly} placeholder="https://192.168.99.100:8443" />
        </FieldRow>
        <FieldRow label="Kubernetes CA Cert" hint="PEM-encoded CA cert of the Kubernetes API server. Leave blank to use system root CAs.">
          <TextAreaField value={fields.kubernetes_ca_cert} onChange={(v) => set('kubernetes_ca_cert', v)} readOnly={readOnly} rows={5} />
        </FieldRow>
        <FieldRow label="Token Reviewer JWT" hint="Service account JWT used to access the TokenReview API. If blank, uses the pod's own JWT.">
          {readOnly
            ? <span className="text-sm text-gray-400">{fields.token_reviewer_jwt ? '(set)' : '(uses pod JWT)'}</span>
            : <TextAreaField value={fields.token_reviewer_jwt} onChange={(v) => set('token_reviewer_jwt', v)} readOnly={false} rows={3} />}
        </FieldRow>
        <FieldRow label="PEM Keys" hint="Optional list of PEM-formatted public keys or certificates used to verify JWTs.">
          <ListField items={fields.pem_keys} onChange={(v) => set('pem_keys', v)} readOnly={readOnly} />
        </FieldRow>
        <FieldRow label="Issuer" hint="Optional JWT issuer. If set, validates the 'iss' claim.">
          <TextField value={fields.issuer} onChange={(v) => set('issuer', v)} readOnly={readOnly} placeholder="(optional)" />
        </FieldRow>
        <FieldRow label="Disable ISS Validation" hint="Disables default validation of the 'iss' claim of service account JWTs.">
          <Toggle checked={fields.disable_iss_validation} onChange={(v) => set('disable_iss_validation', v)} readOnly={readOnly} />
        </FieldRow>
        <FieldRow label="Disable Local CA JWT" hint="Turns off using the locally-found CA for validating JWTs when other CA certs are supplied.">
          <Toggle checked={fields.disable_local_ca_jwt} onChange={(v) => set('disable_local_ca_jwt', v)} readOnly={readOnly} />
        </FieldRow>
      </div>
      {!readOnly && (
        <div className="mt-4">
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving || !fields.kubernetes_host}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── LDAP config form ────────────────────────────────────────────────────────

interface LdapFields {
  url: string; starttls: boolean; insecure_tls: boolean;
  tls_min_version: string; tls_max_version: string; certificate: string;
  binddn: string; bindpass: string; userdn: string; userattr: string;
  upndomain: string; groupfilter: string; groupdn: string; groupattr: string;
  username_as_alias: boolean; use_token_groups: boolean;
  token_ttl: string; token_max_ttl: string; token_explicit_max_ttl: string;
  token_no_default_policy: boolean; token_num_uses: string; token_period: string;
  token_policies: string[]; token_bound_cidrs: string[]; token_type: string;
}

function toLdapFields(raw: Record<string, unknown>): LdapFields {
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  return {
    url: String(raw['url'] ?? ''),
    starttls: Boolean(raw['starttls']),
    insecure_tls: Boolean(raw['insecure_tls']),
    tls_min_version: String(raw['tls_min_version'] ?? 'tls12'),
    tls_max_version: String(raw['tls_max_version'] ?? 'tls13'),
    certificate: String(raw['certificate'] ?? ''),
    binddn: String(raw['binddn'] ?? ''),
    bindpass: '',
    userdn: String(raw['userdn'] ?? ''),
    userattr: String(raw['userattr'] ?? 'cn'),
    upndomain: String(raw['upndomain'] ?? ''),
    groupfilter: String(raw['groupfilter'] ?? ''),
    groupdn: String(raw['groupdn'] ?? ''),
    groupattr: String(raw['groupattr'] ?? 'cn'),
    username_as_alias: Boolean(raw['username_as_alias']),
    use_token_groups: Boolean(raw['use_token_groups']),
    token_ttl: String(raw['token_ttl'] ?? ''),
    token_max_ttl: String(raw['token_max_ttl'] ?? ''),
    token_explicit_max_ttl: String(raw['token_explicit_max_ttl'] ?? ''),
    token_no_default_policy: Boolean(raw['token_no_default_policy']),
    token_num_uses: String(raw['token_num_uses'] ?? '0'),
    token_period: String(raw['token_period'] ?? ''),
    token_policies: arr(raw['token_policies']),
    token_bound_cidrs: arr(raw['token_bound_cidrs']),
    token_type: String(raw['token_type'] ?? ''),
  };
}

function LdapConfigForm({
  method, readOnly, initial, onSaved, onError,
}: { method: string; readOnly: boolean; initial: LdapFields; onSaved: () => void; onError: (msg: string) => void; }) {
  const [fields, setFields] = useState<LdapFields>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setFields(initial), [initial]);
  function set(key: string, val: unknown) { setFields((f) => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        url: fields.url,
        starttls: fields.starttls,
        insecure_tls: fields.insecure_tls,
        tls_min_version: fields.tls_min_version,
        tls_max_version: fields.tls_max_version,
        binddn: fields.binddn,
        userdn: fields.userdn,
        userattr: fields.userattr,
        groupfilter: fields.groupfilter,
        groupdn: fields.groupdn,
        groupattr: fields.groupattr,
        username_as_alias: fields.username_as_alias,
        use_token_groups: fields.use_token_groups,
      };
      if (fields.certificate) payload['certificate'] = fields.certificate;
      if (fields.bindpass) payload['bindpass'] = fields.bindpass;
      if (fields.upndomain) payload['upndomain'] = fields.upndomain;
      if (fields.token_ttl) payload['token_ttl'] = fields.token_ttl;
      if (fields.token_max_ttl) payload['token_max_ttl'] = fields.token_max_ttl;
      if (fields.token_explicit_max_ttl) payload['token_explicit_max_ttl'] = fields.token_explicit_max_ttl;
      payload['token_no_default_policy'] = fields.token_no_default_policy;
      if (fields.token_num_uses) payload['token_num_uses'] = parseInt(fields.token_num_uses, 10);
      if (fields.token_period) payload['token_period'] = fields.token_period;
      if (fields.token_policies.length) payload['token_policies'] = fields.token_policies;
      if (fields.token_bound_cidrs.length) payload['token_bound_cidrs'] = fields.token_bound_cidrs;
      if (fields.token_type) payload['token_type'] = fields.token_type;
      await api.updateAuthMethodConfig(method, payload);
      onSaved();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally { setSaving(false); }
  }

  const tlsVersions = ['tls10', 'tls11', 'tls12', 'tls13'];
  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="LDAP URL" hint="LDAP URL to connect to, e.g. ldap://ldap.example.com (required).">
          <TextField value={fields.url} onChange={(v) => set('url', v)} readOnly={readOnly} placeholder="ldap://ldap.example.com" />
        </FieldRow>
        <FieldRow label="STARTTLS" hint="Issue a StartTLS command after connecting.">
          <Toggle checked={fields.starttls} onChange={(v) => set('starttls', v)} readOnly={readOnly} />
        </FieldRow>
        <FieldRow label="Insecure TLS" hint="Skip LDAP server certificate verification (not recommended in production).">
          <Toggle checked={fields.insecure_tls} onChange={(v) => set('insecure_tls', v)} readOnly={readOnly} />
        </FieldRow>
        <FieldRow label="TLS Min Version">
          {readOnly ? <ReadValue value={fields.tls_min_version} /> : (
            <select value={fields.tls_min_version} onChange={(e) => set('tls_min_version', e.target.value)}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none">
              {tlsVersions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </FieldRow>
        <FieldRow label="TLS Max Version">
          {readOnly ? <ReadValue value={fields.tls_max_version} /> : (
            <select value={fields.tls_max_version} onChange={(e) => set('tls_max_version', e.target.value)}
              className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none">
              {tlsVersions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </FieldRow>
        <FieldRow label="Certificate" hint="CA certificate chain in PEM format to verify the LDAP server.">
          <TextAreaField value={fields.certificate} onChange={(v) => set('certificate', v)} readOnly={readOnly} rows={4} />
        </FieldRow>
        <FieldRow label="Bind DN" hint="Distinguished name of object to bind when performing user and group search.">
          <TextField value={fields.binddn} onChange={(v) => set('binddn', v)} readOnly={readOnly} placeholder="cn=vault,ou=Users,dc=example,dc=com" />
        </FieldRow>
        <FieldRow label="Bind Password" hint="Password for the bind DN. Leave blank to keep the current value.">
          {readOnly
            ? <span className="text-sm text-gray-400">{fields.bindpass ? '(set)' : '—'}</span>
            : <TextField value={fields.bindpass} onChange={(v) => set('bindpass', v)} readOnly={false} type="password" placeholder="Leave blank to keep existing" />}
        </FieldRow>
        <FieldRow label="User DN" hint="User dn is the base DN under which user lookup is performed.">
          <TextField value={fields.userdn} onChange={(v) => set('userdn', v)} readOnly={readOnly} placeholder="ou=Users,dc=example,dc=com" />
        </FieldRow>
        <FieldRow label="User Attribute" hint="Attribute on user object matching the username passed during login.">
          <TextField value={fields.userattr} onChange={(v) => set('userattr', v)} readOnly={readOnly} placeholder="cn" />
        </FieldRow>
        <FieldRow label="UPN Domain" hint="userPrincipalName domain for AD authentication.">
          <TextField value={fields.upndomain} onChange={(v) => set('upndomain', v)} readOnly={readOnly} placeholder="example.com" />
        </FieldRow>
        <FieldRow label="Group Filter" hint="Go template for the LDAP group search filter.">
          <TextField value={fields.groupfilter} onChange={(v) => set('groupfilter', v)} readOnly={readOnly} placeholder="(|(memberUid={{.Username}})(member={{.UserDN}}))" />
        </FieldRow>
        <FieldRow label="Group DN" hint="Base DN to perform group search.">
          <TextField value={fields.groupdn} onChange={(v) => set('groupdn', v)} readOnly={readOnly} placeholder="ou=Groups,dc=example,dc=com" />
        </FieldRow>
        <FieldRow label="Group Attribute" hint="LDAP attribute to follow on objects returned by GroupFilter for group names.">
          <TextField value={fields.groupattr} onChange={(v) => set('groupattr', v)} readOnly={readOnly} placeholder="cn" />
        </FieldRow>
        <FieldRow label="Username as Alias" hint="Force the auth role to use the authenticated user's username as the alias name.">
          <Toggle checked={fields.username_as_alias} onChange={(v) => set('username_as_alias', v)} readOnly={readOnly} />
        </FieldRow>
        <FieldRow label="Use Token Groups" hint="Use the Active Directory tokenGroups attribute for group membership (AD only).">
          <Toggle checked={fields.use_token_groups} onChange={(v) => set('use_token_groups', v)} readOnly={readOnly} />
        </FieldRow>
        <TokenParamsSection fields={fields} set={set} readOnly={readOnly} />
      </div>
      {!readOnly && (
        <div className="mt-4">
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving || !fields.url}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Config table display for all auth methods ──────────────────────────────

interface ConfigField {
  key: string;
  label: string;
  value: unknown;
  type?: 'string' | 'number' | 'boolean' | 'array' | 'object';
}

function ConfigValueCell({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-xs text-gray-400">—</span>;
  }
  if (typeof value === 'boolean') {
    return <span className={`text-xs font-medium ${value ? 'text-green-600' : 'text-gray-500'}`}>{value ? 'Yes' : 'No'}</span>;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    return <span className="text-xs text-gray-700 font-mono break-all">{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <div className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <span key={i} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 font-mono">
            {typeof item === 'string' ? item : JSON.stringify(item)}
          </span>
        ))}
      </div>
    );
  }
  if (typeof value === 'object') {
    return (
      <pre className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-32 font-mono">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <span className="text-xs text-gray-700">{String(value)}</span>;
}

function extractConfigFields(config: Record<string, unknown>): ConfigField[] {
  return Object.entries(config)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, value]) => ({
      key,
      label: key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      value,
      type: 
        Array.isArray(value) ? 'array' :
        typeof value === 'boolean' ? 'boolean' :
        typeof value === 'number' ? 'number' :
        typeof value === 'object' ? 'object' :
        'string',
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function ConfigTableForm({
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
  const fields = extractConfigFields(initial);

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
      {fields.length === 0 && readOnly && (
        <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          No configuration has been set for this auth method. Click <strong>Edit</strong> to configure.
        </div>
      )}

      {/* Table view for read-only mode */}
      {readOnly && fields.length > 0 && (
        <div className="rounded-md border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-gray-200">
              {fields.map((field) => (
                <tr key={field.key} className="hover:bg-gray-50 transition-colors">
                  <td className="bg-gray-50 px-4 py-3 font-medium text-gray-700 w-40 border-r border-gray-200">
                    {field.label}
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    <ConfigValueCell value={field.value} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* JSON editor for edit mode */}
      {!readOnly && (
        <div>
          <div className="mb-2 text-xs text-gray-500 font-medium">Edit configuration as JSON</div>
          <JsonEditor value={value} onChange={setValue} readOnly={false} />
        </div>
      )}

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
  const isGitHub = authType === 'github';
  const isKubernetes = authType === 'kubernetes';
  const isLdap = authType === 'ldap';
  const isAws = authType === 'aws';
  const isAzure = authType === 'azure';
  const isGcp = authType === 'gcp' || authType === 'googlecloud';
  const isOkta = authType === 'okta';
  const isRadius = authType === 'radius' || authType === 'radiusl';

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
          <OidcConfigForm method={method} readOnly={!editing} initial={toOidcFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : isGitHub ? (
          <GitHubConfigForm method={method} readOnly={!editing} initial={toGitHubFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : isKubernetes ? (
          <KubernetesConfigForm method={method} readOnly={!editing} initial={toKubernetesFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : isLdap ? (
          <LdapConfigForm method={method} readOnly={!editing} initial={toLdapFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : isAws ? (
          <AwsConfigForm method={method} readOnly={!editing} initial={toAwsFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : isAzure ? (
          <AzureConfigForm method={method} readOnly={!editing} initial={toAzureFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : isGcp ? (
          <GcpConfigForm method={method} readOnly={!editing} initial={toGcpFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : isOkta ? (
          <OktaConfigForm method={method} readOnly={!editing} initial={toOktaFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : isRadius ? (
          <RadiusConfigForm method={method} readOnly={!editing} initial={toRadiusFields(config)} onSaved={handleSaved} onError={setSaveError} />
        ) : (
          <ConfigTableForm method={method} readOnly={!editing} initial={config} onSaved={handleSaved} onError={setSaveError} />
        )
      )}
    </div>
  );
}
