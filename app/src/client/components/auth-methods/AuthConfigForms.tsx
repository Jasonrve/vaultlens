// Additional Auth Method Config Forms (AWS, Azure, GCP, Okta, JWT, RADIUS, Cert)
// These forms provide user-friendly interfaces for configuring auth methods with individual fields

import { useState, useEffect } from 'react';
import * as api from '../../lib/api';

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

// ── AWS Config Form ─────────────────────────────────────────────────────────

export interface AwsFields {
  access_key: string;
  secret_key: string;
  region: string;
  iam_endpoint: string;
  sts_endpoint: string;
}

export function toAwsFields(raw: Record<string, unknown>): AwsFields {
  return {
    access_key: String(raw['access_key'] ?? ''),
    secret_key: '',
    region: String(raw['region'] ?? 'us-west-2'),
    iam_endpoint: String(raw['iam_endpoint'] ?? ''),
    sts_endpoint: String(raw['sts_endpoint'] ?? ''),
  };
}

function fromAwsFields(f: AwsFields): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    region: f.region,
  };
  if (f.access_key) payload['access_key'] = f.access_key;
  if (f.secret_key) payload['secret_key'] = f.secret_key;
  if (f.iam_endpoint) payload['iam_endpoint'] = f.iam_endpoint;
  if (f.sts_endpoint) payload['sts_endpoint'] = f.sts_endpoint;
  return payload;
}

export function AwsConfigForm({
  method, readOnly, initial, onSaved, onError,
}: { method: string; readOnly: boolean; initial: AwsFields; onSaved: () => void; onError: (msg: string) => void; }) {
  const [fields, setFields] = useState<AwsFields>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setFields(initial), [initial]);
  function set(key: string, val: unknown) { setFields((f) => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateAuthMethodConfig(method, fromAwsFields(fields));
      onSaved();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="Access Key" hint="AWS access key ID (required).">
          <TextField value={fields.access_key} onChange={(v) => set('access_key', v)} readOnly={readOnly} placeholder="AKIA..." />
        </FieldRow>
        <FieldRow label="Secret Key" hint="AWS secret access key.">
          {readOnly ? <ReadValue value={fields.secret_key} /> :
            <input type="password" value={fields.secret_key} onChange={(e) => set('secret_key', e.target.value)} placeholder="(unchanged)" autoComplete="off" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]" />}
        </FieldRow>
        <FieldRow label="Region" hint="AWS region (default: us-west-2).">
          <TextField value={fields.region} onChange={(v) => set('region', v)} readOnly={readOnly} placeholder="us-west-2" />
        </FieldRow>
        <FieldRow label="IAM Endpoint" hint="Custom IAM endpoint (optional).">
          <TextField value={fields.iam_endpoint} onChange={(v) => set('iam_endpoint', v)} readOnly={readOnly} placeholder="(optional)" />
        </FieldRow>
        <FieldRow label="STS Endpoint" hint="Custom STS endpoint (optional).">
          <TextField value={fields.sts_endpoint} onChange={(v) => set('sts_endpoint', v)} readOnly={readOnly} placeholder="(optional)" />
        </FieldRow>
      </div>
      {!readOnly && (
        <div className="mt-4">
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving || !fields.access_key}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Azure Config Form ───────────────────────────────────────────────────────

export interface AzureFields {
  subscription_id: string;
  tenant_id: string;
  resource_group: string;
  client_id: string;
  environment: string;
  jwks_url: string;
  jwks_ca_pem: string;
}

export function toAzureFields(raw: Record<string, unknown>): AzureFields {
  return {
    subscription_id: String(raw['subscription_id'] ?? ''),
    tenant_id: String(raw['tenant_id'] ?? ''),
    resource_group: String(raw['resource_group'] ?? ''),
    client_id: String(raw['client_id'] ?? ''),
    environment: String(raw['environment'] ?? 'AzurePublicCloud'),
    jwks_url: String(raw['jwks_url'] ?? ''),
    jwks_ca_pem: String(raw['jwks_ca_pem'] ?? ''),
  };
}

function fromAzureFields(f: AzureFields): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (f.subscription_id) payload['subscription_id'] = f.subscription_id;
  if (f.tenant_id) payload['tenant_id'] = f.tenant_id;
  if (f.resource_group) payload['resource_group'] = f.resource_group;
  if (f.client_id) payload['client_id'] = f.client_id;
  payload['environment'] = f.environment;
  if (f.jwks_url) payload['jwks_url'] = f.jwks_url;
  if (f.jwks_ca_pem) payload['jwks_ca_pem'] = f.jwks_ca_pem;
  return payload;
}

export function AzureConfigForm({
  method, readOnly, initial, onSaved, onError,
}: { method: string; readOnly: boolean; initial: AzureFields; onSaved: () => void; onError: (msg: string) => void; }) {
  const [fields, setFields] = useState<AzureFields>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setFields(initial), [initial]);
  function set(key: string, val: unknown) { setFields((f) => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateAuthMethodConfig(method, fromAzureFields(fields));
      onSaved();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="Subscription ID" hint="Azure subscription ID.">
          <TextField value={fields.subscription_id} onChange={(v) => set('subscription_id', v)} readOnly={readOnly} placeholder="(required)" />
        </FieldRow>
        <FieldRow label="Tenant ID" hint="Azure tenant ID.">
          <TextField value={fields.tenant_id} onChange={(v) => set('tenant_id', v)} readOnly={readOnly} placeholder="(required)" />
        </FieldRow>
        <FieldRow label="Resource Group" hint="Azure resource groupname (optional).">
          <TextField value={fields.resource_group} onChange={(v) => set('resource_group', v)} readOnly={readOnly} placeholder="(optional)" />
        </FieldRow>
        <FieldRow label="Client ID" hint="Azure client ID for verification (optional).">
          <TextField value={fields.client_id} onChange={(v) => set('client_id', v)} readOnly={readOnly} placeholder="(optional)" />
        </FieldRow>
        <FieldRow label="Environment" hint="Azure environment (default: AzurePublicCloud).">
          {readOnly ? <ReadValue value={fields.environment} /> :
            <select value={fields.environment} onChange={(e) => set('environment', e.target.value)} className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]">
              <option>AzurePublicCloud</option>
              <option>AzureUSGovernmentCloud</option>
              <option>AzureChinaCloud</option>
              <option>AzureGermanCloud</option>
            </select>}
        </FieldRow>
        <FieldRow label="JWKS URL" hint="JWKS URL for token validation (optional).">
          <TextField value={fields.jwks_url} onChange={(v) => set('jwks_url', v)} readOnly={readOnly} placeholder="(optional)" />
        </FieldRow>
        <FieldRow label="JWKS CA PEM" hint="CA certificate for JWKS URL (optional).">
          <TextAreaField value={fields.jwks_ca_pem} onChange={(v) => set('jwks_ca_pem', v)} readOnly={readOnly} rows={3} />
        </FieldRow>
      </div>
      {!readOnly && (
        <div className="mt-4">
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── GCP Config Form ─────────────────────────────────────────────────────────

export interface GcpFields {
  credentials: string;
  project_id: string;
  service_account_email: string;
  custom_endpoint: string;
}

export function toGcpFields(raw: Record<string, unknown>): GcpFields {
  const creds = raw['credentials'];
  return {
    credentials: (creds && typeof creds === 'object') ? JSON.stringify(creds, null, 2) : String(creds ?? ''),
    project_id: String(raw['project_id'] ?? ''),
    service_account_email: String(raw['service_account_email'] ?? ''),
    custom_endpoint: String(raw['custom_endpoint'] ?? ''),
  };
}

function fromGcpFields(f: GcpFields): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (f.credentials) {
    try {
      payload['credentials'] = JSON.parse(f.credentials) as Record<string, unknown>;
    } catch {
      payload['credentials'] = f.credentials;
    }
  }
  if (f.project_id) payload['project_id'] = f.project_id;
  if (f.service_account_email) payload['service_account_email'] = f.service_account_email;
  if (f.custom_endpoint) payload['custom_endpoint'] = f.custom_endpoint;
  return payload;
}

export function GcpConfigForm({
  method, readOnly, initial, onSaved, onError,
}: { method: string; readOnly: boolean; initial: GcpFields; onSaved: () => void; onError: (msg: string) => void; }) {
  const [fields, setFields] = useState<GcpFields>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setFields(initial), [initial]);
  function set(key: string, val: unknown) { setFields((f) => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateAuthMethodConfig(method, fromGcpFields(fields));
      onSaved();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="Service Account Credentials" hint="GCP service account credentials JSON.">
          <TextAreaField value={fields.credentials} onChange={(v) => set('credentials', v)} readOnly={readOnly} rows={6} />
        </FieldRow>
        <FieldRow label="Project ID" hint="GCP project ID (optional).">
          <TextField value={fields.project_id} onChange={(v) => set('project_id', v)} readOnly={readOnly} placeholder="my-project-id" />
        </FieldRow>
        <FieldRow label="Service Account Email" hint="Service account email (optional, for validation).">
          <TextField value={fields.service_account_email} onChange={(v) => set('service_account_email', v)} readOnly={readOnly} placeholder="sa@project.iam.gserviceaccount.com" />
        </FieldRow>
        <FieldRow label="Custom Endpoint" hint="Custom GCP endpoint (optional).">
          <TextField value={fields.custom_endpoint} onChange={(v) => set('custom_endpoint', v)} readOnly={readOnly} placeholder="(optional)" />
        </FieldRow>
      </div>
      {!readOnly && (
        <div className="mt-4">
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Okta Config Form ────────────────────────────────────────────────────────

export interface OktaFields {
  org_name: string;
  api_token: string;
  base_url: string;
  token_ttl: string;
  token_max_ttl: string;
  token_policies: string[];
}

export function toOktaFields(raw: Record<string, unknown>): OktaFields {
  const arr = (v: unknown): string[] => Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  return {
    org_name: String(raw['org_name'] ?? ''),
    api_token: '',
    base_url: String(raw['base_url'] ?? ''),
    token_ttl: String(raw['token_ttl'] ?? ''),
    token_max_ttl: String(raw['token_max_ttl'] ?? ''),
    token_policies: arr(raw['token_policies']),
  };
}

function fromOktaFields(f: OktaFields): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    org_name: f.org_name,
  };
  if (f.api_token) payload['api_token'] = f.api_token;
  if (f.base_url) payload['base_url'] = f.base_url;
  if (f.token_ttl) payload['token_ttl'] = f.token_ttl;
  if (f.token_max_ttl) payload['token_max_ttl'] = f.token_max_ttl;
  if (f.token_policies.length) payload['token_policies'] = f.token_policies;
  return payload;
}

export function OktaConfigForm({
  method, readOnly, initial, onSaved, onError,
}: { method: string; readOnly: boolean; initial: OktaFields; onSaved: () => void; onError: (msg: string) => void; }) {
  const [fields, setFields] = useState<OktaFields>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setFields(initial), [initial]);
  function set(key: string, val: unknown) { setFields((f) => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateAuthMethodConfig(method, fromOktaFields(fields));
      onSaved();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="Organization Name" hint="Okta organization name (required).">
          <TextField value={fields.org_name} onChange={(v) => set('org_name', v)} readOnly={readOnly} placeholder="my-org" />
        </FieldRow>
        <FieldRow label="API Token" hint="Okta API token for Vault to authenticate.">
          {readOnly ? <ReadValue value={fields.api_token} /> :
            <input type="password" value={fields.api_token} onChange={(e) => set('api_token', e.target.value)} placeholder="(unchanged)" autoComplete="off" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]" />}
        </FieldRow>
        <FieldRow label="Base URL" hint="Okta base URL (optional).">
          <TextField value={fields.base_url} onChange={(v) => set('base_url', v)} readOnly={readOnly} placeholder="https://org.okta.com" />
        </FieldRow>
        <FieldRow label="Token TTL" hint="Token time-to-live (optional).">
          <TextField value={fields.token_ttl} onChange={(v) => set('token_ttl', v)} readOnly={readOnly} placeholder="1h" />
        </FieldRow>
        <FieldRow label="Token Max TTL" hint="Maximum token TTL (optional).">
          <TextField value={fields.token_max_ttl} onChange={(v) => set('token_max_ttl', v)} readOnly={readOnly} placeholder="24h" />
        </FieldRow>
      </div>
      {!readOnly && (
        <div className="mt-4">
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving || !fields.org_name}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── RADIUS Config Form ──────────────────────────────────────────────────────

export interface RadiusFields {
  servers: string;
  secret: string;
  unregistered_user_policies: string;
  token_ttl: string;
  token_max_ttl: string;
}

export function toRadiusFields(raw: Record<string, unknown>): RadiusFields {
  const srvs = raw['servers'];
  return {
    servers: Array.isArray(srvs) ? srvs.join('\n') : String(srvs ?? ''),
    secret: '', // Never expose secret
    unregistered_user_policies: String(raw['unregistered_user_policies'] ?? ''),
    token_ttl: String(raw['token_ttl'] ?? ''),
    token_max_ttl: String(raw['token_max_ttl'] ?? ''),
  };
}

function fromRadiusFields(f: RadiusFields): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    servers: f.servers.split('\n').filter((x) => x.trim()),
  };
  if (f.secret) payload['secret'] = f.secret;
  if (f.unregistered_user_policies) payload['unregistered_user_policies'] = f.unregistered_user_policies;
  if (f.token_ttl) payload['token_ttl'] = f.token_ttl;
  if (f.token_max_ttl) payload['token_max_ttl'] = f.token_max_ttl;
  return payload;
}

export function RadiusConfigForm({
  method, readOnly, initial, onSaved, onError,
}: { method: string; readOnly: boolean; initial: RadiusFields; onSaved: () => void; onError: (msg: string) => void; }) {
  const [fields, setFields] = useState<RadiusFields>(initial);
  const [saving, setSaving] = useState(false);
  useEffect(() => setFields(initial), [initial]);
  function set(key: string, val: unknown) { setFields((f) => ({ ...f, [key]: val })); }

  async function handleSave() {
    setSaving(true);
    try {
      await api.updateAuthMethodConfig(method, fromRadiusFields(fields));
      onSaved();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      onError(msg ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally { setSaving(false); }
  }

  return (
    <div>
      <div className="divide-y divide-gray-100">
        <FieldRow label="RADIUS Servers" hint="RADIUS server addresses (one per line).">
          <TextAreaField value={fields.servers} onChange={(v) => set('servers', v)} readOnly={readOnly} rows={3} />
        </FieldRow>
        <FieldRow label="Shared Secret" hint="RADIUS shared secret for authentication.">
          {readOnly ? <ReadValue value={fields.secret} /> :
            <input type="password" value={fields.secret} onChange={(e) => set('secret', e.target.value)} placeholder="(unchanged)" autoComplete="off" className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]" />}
        </FieldRow>
        <FieldRow label="Unregistered User Policies" hint="Comma-separated policies for unregistered users.">
          <TextField value={fields.unregistered_user_policies} onChange={(v) => set('unregistered_user_policies', v)} readOnly={readOnly} placeholder="default" />
        </FieldRow>
        <FieldRow label="Token TTL" hint="Token time-to-live (optional).">
          <TextField value={fields.token_ttl} onChange={(v) => set('token_ttl', v)} readOnly={readOnly} placeholder="1h" />
        </FieldRow>
        <FieldRow label="Token Max TTL" hint="Maximum token TTL (optional).">
          <TextField value={fields.token_max_ttl} onChange={(v) => set('token_max_ttl', v)} readOnly={readOnly} placeholder="24h" />
        </FieldRow>
      </div>
      {!readOnly && (
        <div className="mt-4">
          <button type="button" onClick={() => { void handleSave(); }} disabled={saving || !fields.servers}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
