import { useState, useEffect, useCallback } from 'react';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';

// ── Sub-components ──────────────────────────────────────────────────────────

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
  return <span className="text-sm text-gray-900 break-all">{String(value)}</span>;
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
        <button type="button" onClick={add} className="rounded bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200">
          Add
        </button>
      </div>
    </div>
  );
}

// ── TTL field with unit selector ────────────────────────────────────────────

type TtlUnit = 'seconds' | 'minutes' | 'hours' | 'days';
const UNIT_SECONDS: Record<TtlUnit, number> = { seconds: 1, minutes: 60, hours: 3600, days: 86400 };

function detectUnit(s: number): TtlUnit {
  if (s === 0) return 'seconds';
  if (s % 86400 === 0) return 'days';
  if (s % 3600 === 0) return 'hours';
  if (s % 60 === 0) return 'minutes';
  return 'seconds';
}

function TtlField({ seconds, onChange, readOnly }: { seconds: number; onChange: (s: number) => void; readOnly: boolean }) {
  const initUnit = detectUnit(seconds);
  const initVal = seconds === 0 ? 0 : seconds / UNIT_SECONDS[initUnit];
  const [val, setVal] = useState(initVal);
  const [unit, setUnit] = useState<TtlUnit>(initUnit);

  useEffect(() => {
    const u = detectUnit(seconds);
    setUnit(u);
    setVal(seconds === 0 ? 0 : seconds / UNIT_SECONDS[u]);
  }, [seconds]);

  if (readOnly) {
    return seconds === 0
      ? <span className="text-sm text-gray-400">System default</span>
      : <span className="text-sm text-gray-900">{val} {unit}</span>;
  }

  function handleVal(v: number) {
    setVal(v);
    onChange(v * UNIT_SECONDS[unit]);
  }
  function handleUnit(u: TtlUnit) {
    setUnit(u);
    onChange(val * UNIT_SECONDS[u]);
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={0}
        value={val}
        onChange={(e) => handleVal(Number(e.target.value))}
        className="w-20 rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
      />
      <select
        value={unit}
        onChange={(e) => handleUnit(e.target.value as TtlUnit)}
        className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
      >
        <option value="seconds">seconds</option>
        <option value="minutes">minutes</option>
        <option value="hours">hours</option>
        <option value="days">days</option>
      </select>
    </div>
  );
}

// ── Tune fields ─────────────────────────────────────────────────────────────

interface TuneFields {
  description: string;
  listing_visibility: string;
  default_lease_ttl: number;
  max_lease_ttl: number;
  token_type: string;
  audit_non_hmac_request_keys: string[];
  audit_non_hmac_response_keys: string[];
  passthrough_request_headers: string[];
  allowed_response_headers: string[];
  plugin_version: string;
}

function toTuneFields(raw: Record<string, unknown>): TuneFields {
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  return {
    description: String(raw['description'] ?? ''),
    listing_visibility: String(raw['listing_visibility'] ?? ''),
    default_lease_ttl: Number(raw['default_lease_ttl'] ?? 0),
    max_lease_ttl: Number(raw['max_lease_ttl'] ?? 0),
    token_type: String(raw['token_type'] ?? 'default-service'),
    audit_non_hmac_request_keys: arr(raw['audit_non_hmac_request_keys']),
    audit_non_hmac_response_keys: arr(raw['audit_non_hmac_response_keys']),
    passthrough_request_headers: arr(raw['passthrough_request_headers']),
    allowed_response_headers: arr(raw['allowed_response_headers']),
    plugin_version: String(raw['plugin_version'] ?? ''),
  };
}

function fromTuneFields(f: TuneFields): Record<string, unknown> {
  return {
    description: f.description,
    listing_visibility: f.listing_visibility,
    default_lease_ttl: f.default_lease_ttl,
    max_lease_ttl: f.max_lease_ttl,
    token_type: f.token_type,
    audit_non_hmac_request_keys: f.audit_non_hmac_request_keys,
    audit_non_hmac_response_keys: f.audit_non_hmac_response_keys,
    passthrough_request_headers: f.passthrough_request_headers,
    allowed_response_headers: f.allowed_response_headers,
    ...(f.plugin_version ? { plugin_version: f.plugin_version } : {}),
  };
}

// ── Public component ────────────────────────────────────────────────────────

export default function AuthMethodTune({ method }: { method: string }) {
  const [tune, setTune] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<TuneFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFetchError(null);
    api.getAuthMethodTune(method)
      .then((data) => {
        setTune(data);
        setFields(toTuneFields(data));
      })
      .catch((err: unknown) => {
        const vaultMsg = (err as { response?: { data?: { error?: string } } })?.response?.data;
        setFetchError(vaultMsg?.error ?? (err instanceof Error ? err.message : 'Failed to load method options'));
      })
      .finally(() => setLoading(false));
  }, [method]);

  useEffect(() => { load(); }, [load]);

  function set<K extends keyof TuneFields>(key: K, val: TuneFields[K]) {
    setFields((f) => f ? { ...f, [key]: val } : f);
  }

  async function handleSave() {
    if (!fields) return;
    setSaving(true);
    try {
      await api.updateAuthMethodTune(method, fromTuneFields(fields));
      setSaveSuccess(true);
      setSaveError(null);
      setEditing(false);
      setTimeout(() => setSaveSuccess(false), 3000);
      load();
    } catch (err) {
      const vaultMsg = (err as { response?: { data?: { error?: string } } })?.response?.data;
      setSaveError(vaultMsg?.error ?? (err instanceof Error ? err.message : 'Save failed'));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setEditing(false);
    setSaveError(null);
    if (tune) setFields(toTuneFields(tune));
  }

  const ro = !editing;

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
            <>
              <button
                type="button"
                onClick={() => { void handleSave(); }}
                disabled={saving}
                className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#0f4fcc] disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            </>
          )}
        </div>
        {saveSuccess && <span className="text-sm font-medium text-green-600">Saved successfully</span>}
        {saveError && <span className="max-w-xl text-sm text-red-600">{saveError}</span>}
      </div>

      {loading && <LoadingSpinner className="mt-8" />}
      {fetchError && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{fetchError}</div>
      )}

      {!loading && !fetchError && fields && (
        <div className="divide-y divide-gray-100">
          <FieldRow label="Description">
            {ro
              ? <ReadValue value={fields.description} />
              : <textarea
                  value={fields.description}
                  onChange={(e) => set('description', e.target.value)}
                  rows={3}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
                />
            }
          </FieldRow>

          <FieldRow label="Use as preferred UI login method" hint="This mount will be included in the unauthenticated UI login endpoint.">
            {ro
              ? <ReadValue value={fields.listing_visibility === 'unauth'} />
              : <button
                  type="button"
                  role="switch"
                  aria-checked={fields.listing_visibility === 'unauth'}
                  onClick={() => set('listing_visibility', fields.listing_visibility === 'unauth' ? '' : 'unauth')}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full transition-colors ${
                    fields.listing_visibility === 'unauth' ? 'bg-[#1563ff]' : 'bg-gray-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    fields.listing_visibility === 'unauth' ? 'translate-x-4' : 'translate-x-0.5'
                  } mt-0.5`} />
                </button>
            }
          </FieldRow>

          <FieldRow label="Default Lease TTL" hint="Lease will expire after this duration.">
            <TtlField seconds={fields.default_lease_ttl} onChange={(v) => set('default_lease_ttl', v)} readOnly={ro} />
          </FieldRow>

          <FieldRow label="Max Lease TTL" hint="Lease will expire after this duration.">
            <TtlField seconds={fields.max_lease_ttl} onChange={(v) => set('max_lease_ttl', v)} readOnly={ro} />
          </FieldRow>

          <FieldRow label="Token type" hint="Type of token generated via this auth method.">
            {ro
              ? <ReadValue value={fields.token_type} />
              : <select
                  value={fields.token_type}
                  onChange={(e) => set('token_type', e.target.value)}
                  className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
                >
                  <option value="default-service">default service</option>
                  <option value="default-batch">default batch</option>
                  <option value="service">service</option>
                  <option value="batch">batch</option>
                </select>
            }
          </FieldRow>

          <FieldRow label="Request keys excluded from HMACing in audit" hint="Add one item per row.">
            <ListField items={fields.audit_non_hmac_request_keys} onChange={(v) => set('audit_non_hmac_request_keys', v)} readOnly={ro} />
          </FieldRow>

          <FieldRow label="Response keys excluded from HMACing in audit" hint="Add one item per row.">
            <ListField items={fields.audit_non_hmac_response_keys} onChange={(v) => set('audit_non_hmac_response_keys', v)} readOnly={ro} />
          </FieldRow>

          <FieldRow label="Allowed passthrough request headers" hint="Add one item per row.">
            <ListField items={fields.passthrough_request_headers} onChange={(v) => set('passthrough_request_headers', v)} readOnly={ro} />
          </FieldRow>

          <FieldRow label="Allowed response headers" hint="Add one item per row.">
            <ListField items={fields.allowed_response_headers} onChange={(v) => set('allowed_response_headers', v)} readOnly={ro} />
          </FieldRow>

          <FieldRow label="Plugin version" hint="Semantic version of the plugin to use, e.g. 'v1.0.0'.">
            {ro
              ? <ReadValue value={fields.plugin_version} />
              : <input
                  type="text"
                  value={fields.plugin_version}
                  onChange={(e) => set('plugin_version', e.target.value)}
                  placeholder="v1.0.0"
                  className="w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff]"
                />
            }
          </FieldRow>
        </div>
      )}
    </div>
  );
}
