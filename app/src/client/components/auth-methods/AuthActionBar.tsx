import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { getAuthActionConfig, getAuthActions, saveAuthActionConfig } from '../../lib/api';
import { useAuthStore } from '../../stores/authStore';
import type { AuthActionContext, AuthActionDefinition, AuthActionConfig, ResolvedAuthAction } from '../../types';
import { AUTH_ACTION_TOKENS } from '../../../shared/authActions';
import * as FiIcons from 'react-icons/fi';
import * as MdIcons from 'react-icons/md';
import * as FaIcons from 'react-icons/fa';
import type { IconType } from 'react-icons';
import { Icon as IconifyIcon } from '@iconify/react';

function isAdmin(policies: string[]): boolean {
  return policies.includes('root') || policies.includes('vaultlens-admin');
}

function Icon({ library, name }: { library: string; name: string }) {
  if (library === 'iconify') return <IconifyIcon icon={name.includes(':') ? name : `mdi:${name}`} aria-hidden="true" />;
  const normalizedName = name.replace(/^(?:md-|fa-)/, '');
  const legacy: Record<string, IconType> = library === 'material'
    ? { settings: MdIcons.MdSettings, 'external-link': MdIcons.MdOpenInNew, play: MdIcons.MdPlayArrow }
    : library === 'font-awesome'
      ? { settings: FaIcons.FaCog, 'external-link': FaIcons.FaExternalLinkAlt, play: FaIcons.FaPlay }
      : { settings: FiIcons.FiSettings, 'external-link': FiIcons.FiExternalLink, play: FiIcons.FiPlay };
  const catalog: Record<string, IconType> = library === 'material' ? MdIcons : library === 'font-awesome' ? FaIcons : FiIcons;
  const Component = legacy[normalizedName] ?? catalog[name] ?? catalog[normalizedName] ?? FiIcons.FiExternalLink;
  return <Component aria-hidden="true" />;
}

const PICKER_ICONS = [
  ...Object.keys(FiIcons).filter((name) => name.startsWith('Fi')).map((name) => ({ library: 'lucide' as const, name, label: `Lucide / ${name.slice(2)}` })),
  ...Object.keys(MdIcons).filter((name) => name.startsWith('Md')).map((name) => ({ library: 'material' as const, name, label: `Material / ${name.slice(2)}` })),
  ...Object.keys(FaIcons).filter((name) => name.startsWith('Fa')).map((name) => ({ library: 'font-awesome' as const, name, label: `Font Awesome / ${name.slice(2)}` })),
];

const ICONIFY_COLLECTIONS = [
  ['simple-icons', 'Simple Icons'], ['logos', 'Logos'], ['devicon', 'Devicon'], ['vscode-icons', 'VS Code Icons'],
  ['skill-icons', 'Skill Icons'], ['material-icon-theme', 'Material Icon Theme'], ['mdi', 'Material Design Icons'],
  ['material-symbols', 'Material Symbols'], ['tabler', 'Tabler'],
] as const;
const ICONIFY_PRESETS = ['home', 'settings', 'search', 'check', 'close', 'edit', 'delete', 'external-link', 'shield', 'key', 'cloud', 'database', 'lock', 'user', 'plus', 'arrow-right'];

function TokenInput({ value, onChange, placeholder, tokenValues }: { value: string; onChange: (value: string) => void; placeholder?: string; tokenValues: Record<string, string> }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  function insertToken(token: string) {
    const input = inputRef.current;
    if (!input) return;
    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    const inserted = `{{${token}}}`;
    onChange(value.slice(0, start) + inserted + value.slice(end));
    setOpen(false);
    window.requestAnimationFrame(() => { input.focus(); input.setSelectionRange(start + inserted.length, start + inserted.length); });
  }
  return (
    <div className="relative">
      <input ref={inputRef} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => { if (event.ctrlKey && event.code === 'Space') { event.preventDefault(); setOpen(true); } }} className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
      {open && <div className="absolute left-0 top-full z-10 mt-1 max-h-52 w-72 overflow-y-auto rounded border border-gray-300 bg-white p-1 shadow-lg">
        <div className="px-2 py-1 text-xs font-semibold text-gray-500">Insert token</div>
        {AUTH_ACTION_TOKENS.map((token) => <button key={token} type="button" onMouseDown={(event) => { event.preventDefault(); insertToken(token); }} className="block w-full rounded px-2 py-1 text-left hover:bg-blue-50"><span className="font-mono text-xs">{'{{'}{token}{'}}'}</span><span className="ml-2 text-xs text-gray-500">= {tokenValues[token] || '(not available)'}</span></button>)}
      </div>}
    </div>
  );
}

function ActionEditor({ initialScope, initialKey, authType, tokenValues, onClose }: { initialScope: AuthActionConfig['scope']; initialKey: string; authType?: string; tokenValues: Record<string, string>; onClose: () => void }) {
  const [scope, setScope] = useState<AuthActionConfig['scope']>(initialScope);
  const [keyName, setKeyName] = useState(initialKey);
  const [config, setConfig] = useState<AuthActionConfig | null>(null);
  const [actions, setActions] = useState<AuthActionDefinition[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [iconSearch, setIconSearch] = useState('');
  const deferredIconSearch = useDeferredValue(iconSearch);
  const visiblePickerIcons = PICKER_ICONS.filter((icon) => icon.label.toLowerCase().includes(deferredIconSearch.toLowerCase())).slice(0, 120);

  useEffect(() => {
    getAuthActionConfig(scope, keyName).then((loaded) => {
      setConfig(loaded);
      setActions(loaded.actions);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load actions'));
  }, [scope, keyName]);

  async function save() {
    try {
      if (!config) return;
      setSaving(true);
      await saveAuthActionConfig({ ...config, actions });
      onClose();
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'Invalid JSON configuration');
      setSaving(false);
    }
  }

  const selected = actions[selectedIndex];
  function updateSelected(patch: Partial<AuthActionDefinition>) {
    setActions((current) => current.map((action, index) => index === selectedIndex ? { ...action, ...patch } : action));
  }
  function updateField(field: 'query' | 'form', name: string, fieldValue: string) {
    updateSelected({ [field]: { ...(selected?.[field] ?? {}), [name]: fieldValue } });
  }
  function addField(field: 'query' | 'form') {
    const name = field === 'query' ? 'parameter' : 'field';
    updateField(field, `${name}${Object.keys(selected?.[field] ?? {}).length + 1}`, '');
  }
  function removeField(field: 'query' | 'form', name: string) {
    if (!selected) return;
    const next = { ...selected[field] };
    delete next[name];
    updateSelected({ [field]: next });
  }

  function previewUrl(action: AuthActionDefinition): string {
    const replace = (value: string) => value.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token: string) => tokenValues[token] || match);
    try {
      const url = new URL(replace(action.url));
      for (const [name, fieldValue] of Object.entries(action.query)) url.searchParams.set(name, replace(fieldValue));
      return url.toString();
    } catch {
      return 'Enter a complete HTTP or HTTPS URL to see the preview.';
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Configure auth actions</h2>
          <button type="button" onClick={onClose} className="text-xl text-gray-400 hover:text-gray-700" aria-label="Close">×</button>
        </div>
        <div className="space-y-3 overflow-auto p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span>Scope:</span>
            <button type="button" onClick={() => { setScope('mount'); setKeyName(initialKey); }} className={scope === 'mount' ? 'rounded bg-blue-50 px-2 py-1 text-blue-700' : 'rounded px-2 py-1 hover:bg-gray-100'}>This mount</button>
            {authType && <button type="button" onClick={() => { setScope('auth-type'); setKeyName(authType.toLowerCase()); }} className={scope === 'auth-type' ? 'rounded bg-blue-50 px-2 py-1 text-blue-700' : 'rounded px-2 py-1 hover:bg-gray-100'}>All {authType} mounts</button>}
            <span>/ {keyName}. Use placeholders such as {'{{MOUNT_PATH}}'} and {'{{ROLE_NAME}}'}.</span>
          </div>
          <div className="flex gap-2">
            <div className="w-48 shrink-0 space-y-2">
              {actions.map((action, index) => <button key={action.id} type="button" onClick={() => setSelectedIndex(index)} className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${index === selectedIndex ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'}`}><Icon library={action.icon.library} name={action.icon.name} />{action.label || 'Untitled action'}</button>)}
              <button type="button" onClick={() => { setActions((current) => [...current, { id: window.crypto.randomUUID(), label: 'New action', method: 'GET', url: 'https://', query: {}, form: {}, screens: ['mount'], outcome: 'same-tab', responseMode: 'generic', icon: { library: 'lucide', name: 'external-link' }, iconOnly: false, enabled: true, order: actions.length }]); setSelectedIndex(actions.length); }} className="w-full rounded border border-dashed border-gray-300 px-2 py-2 text-sm text-gray-600 hover:bg-gray-50">+ Add action</button>
            </div>
            {selected && <div className="min-w-0 flex-1 space-y-3 rounded border border-gray-200 p-3">
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-gray-600">Button label<input value={selected.label} onChange={(event) => updateSelected({ label: event.target.value })} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /></label><label className="text-xs font-medium text-gray-600">Method<select value={selected.method} onChange={(event) => updateSelected({ method: event.target.value as 'GET' | 'POST' })} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"><option>GET</option><option>POST</option></select></label></div>
              <label className="block text-xs font-medium text-gray-600">URL <span className="font-normal text-gray-400">Ctrl+Space inserts tokens</span><TokenInput value={selected.url} onChange={(url) => updateSelected({ url })} tokenValues={tokenValues} placeholder="https://example.com/{{MOUNT_PATH}}" /></label>
              <div className="rounded border border-blue-100 bg-blue-50 p-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">Full URL preview</div><div className="mt-1 break-all font-mono text-xs text-blue-950">{previewUrl(selected)}</div></div>
              {(['query', 'form'] as const).map((field) => <div key={field}><div className="mb-1 flex items-center justify-between"><span className="text-xs font-medium text-gray-600">{field === 'query' ? 'Query parameters' : 'Form fields'}</span><button type="button" onClick={() => addField(field)} className="text-xs text-blue-600">+ Add</button></div>{Object.entries(selected[field]).map(([name, fieldValue]) => <div key={name} className="mb-1 flex gap-1"><input value={name} onChange={(event) => { const next = { ...selected[field] }; delete next[name]; next[event.target.value] = fieldValue; updateSelected({ [field]: next }); }} className="w-32 rounded border border-gray-300 px-2 py-1 text-xs" placeholder="Name" /><TokenInput value={fieldValue} onChange={(next) => updateField(field, name, next)} tokenValues={tokenValues} placeholder="Value or {{TOKEN}}" /><button type="button" onClick={() => removeField(field, name)} className="px-1 text-red-500" aria-label={`Remove ${name}`}>×</button></div>)}</div>)}
              <div><div className="mb-1 flex items-center justify-between text-xs font-medium text-gray-600"><span>Icon</span><span className="font-normal text-gray-400">{PICKER_ICONS.length} local icons plus Iconify collections</span></div><input value={iconSearch} onChange={(event) => setIconSearch(event.target.value)} placeholder="Search local icons or Iconify collections" className="mb-2 w-full rounded border border-gray-300 px-2 py-1.5 text-sm" /><div className="mb-2 grid grid-cols-2 gap-2"><select value={selected.icon.library === 'iconify' ? selected.icon.name.split(':')[0] : ''} onChange={(event) => { if (event.target.value) updateSelected({ icon: { library: 'iconify', name: `${event.target.value}:home` } }); }} className="rounded border border-gray-300 px-2 py-1.5 text-sm"><option value="">Iconify collection</option>{ICONIFY_COLLECTIONS.map(([prefix, label]) => <option key={prefix} value={prefix}>{label}</option>)}</select>{selected.icon.library === 'iconify' && <input value={selected.icon.name.split(':').slice(1).join(':')} onChange={(event) => updateSelected({ icon: { library: 'iconify', name: `${selected.icon.name.split(':')[0]}:${event.target.value}` } })} placeholder="Icon name, e.g. shield" className="rounded border border-gray-300 px-2 py-1.5 text-sm" />}</div>{selected.icon.library === 'iconify' && <div className="mb-2 flex flex-wrap gap-1">{ICONIFY_PRESETS.filter((name) => `${selected.icon.name.split(':')[0]}:${name}`.includes(deferredIconSearch.toLowerCase())).map((name) => <button key={name} type="button" title={`${selected.icon.name.split(':')[0]}:${name}`} onClick={() => updateSelected({ icon: { library: 'iconify', name: `${selected.icon.name.split(':')[0]}:${name}` } })} className="rounded border border-gray-200 p-2 text-lg hover:bg-gray-50"><Icon library="iconify" name={`${selected.icon.name.split(':')[0]}:${name}`} /></button>)}</div>}<div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6">{visiblePickerIcons.map((icon) => <button key={`${icon.library}:${icon.name}`} type="button" title={icon.label} onClick={() => updateSelected({ icon: { library: icon.library, name: icon.name } })} className={`flex items-center justify-center rounded border p-2 text-lg ${selected.icon.library === icon.library && selected.icon.name === icon.name ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50'}`}><Icon library={icon.library} name={icon.name} /></button>)}</div><p className="mt-1 text-xs text-gray-400">Showing {visiblePickerIcons.length} matching local icons at most. Selected: {selected.icon.library} / {selected.icon.name}. Iconify supports the full collection catalog by prefix:name.</p></div>
              <div className="grid grid-cols-2 gap-3"><label className="text-xs font-medium text-gray-600">Screens<select multiple value={selected.screens} onChange={(event) => updateSelected({ screens: Array.from(event.target.selectedOptions, (option) => option.value as 'list' | 'mount' | 'role') })} className="mt-1 h-20 w-full rounded border border-gray-300 px-2 py-1 text-xs"><option value="list">Auth method list</option><option value="mount">Mount detail</option><option value="role">Role detail</option></select></label><div className="space-y-2"><label className="block text-xs font-medium text-gray-600">After click<select value={selected.outcome} onChange={(event) => updateSelected({ outcome: event.target.value as AuthActionDefinition['outcome'] })} className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"><option value="same-tab">Current tab</option><option value="new-tab">New tab</option><option value="popup">Success popup</option></select></label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.iconOnly} onChange={(event) => updateSelected({ iconOnly: event.target.checked })} /> Icon only (label becomes tooltip)</label><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selected.enabled} onChange={(event) => updateSelected({ enabled: event.target.checked })} /> Enabled</label></div></div>
            </div>}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <p className="text-xs text-gray-500">Each action needs id, label, method, url, query, form, screens, outcome, responseMode, icon, enabled, and order.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded border border-gray-300 px-3 py-1.5 text-sm">Cancel</button>
          <button type="button" onClick={() => { void save(); }} disabled={saving || !config} className="rounded bg-[#1563ff] px-3 py-1.5 text-sm text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save actions'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AuthActionBar({ context }: { context: AuthActionContext }) {
  const { screen, mount, role, authType } = context;
  const { tokenInfo } = useAuthStore();
  const policies = [...(tokenInfo?.policies ?? []), ...(tokenInfo?.identity_policies ?? [])];
  const admin = isAdmin(policies);
  const [actions, setActions] = useState<ResolvedAuthAction[]>([]);
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!mount) return;
    getAuthActions({ screen, mount, role, authType }).then((data) => { setActions(data.actions); setTokenValues(data.tokens); }).catch(() => { setActions([]); setTokenValues({}); });
  }, [screen, mount, role, authType]);

  const visibleActions = actions.filter((action) => action.unresolvedTokens.length === 0);
  async function submitPopup(action: ResolvedAuthAction) {
    setMessage(null);
    try {
      const response = await window.fetch(action.resolvedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(action.resolvedForm),
        credentials: 'omit',
      });
      if (!response.ok) throw new Error(`Request failed (${response.status})`);
      const body = action.responseMode === 'body' ? (await response.text()).slice(0, 4000) : '';
      setMessage(body || `${action.label} completed successfully.`);
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : 'Request failed');
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {visibleActions.map((action) => {
          if (action.method === 'GET') {
            return <a key={action.id} href={action.resolvedUrl} target={action.outcome === 'new-tab' ? '_blank' : undefined} rel={action.outcome === 'new-tab' ? 'noopener noreferrer' : undefined} title={action.iconOnly ? action.label : undefined} aria-label={action.iconOnly ? action.label : undefined} className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-[#1563ff]"><Icon library={action.icon.library} name={action.icon.name} />{!action.iconOnly && action.label}</a>;
          }
          if (action.outcome === 'popup') return <button key={action.id} type="button" onClick={() => { void submitPopup(action); }} title={action.iconOnly ? action.label : undefined} aria-label={action.iconOnly ? action.label : undefined} className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-[#1563ff]"><Icon library={action.icon.library} name={action.icon.name} />{!action.iconOnly && action.label}</button>;
          return <form key={action.id} action={action.resolvedUrl} method="post" target={action.outcome === 'new-tab' ? '_blank' : undefined} className="inline-flex"><button type="submit" title={action.iconOnly ? action.label : undefined} aria-label={action.iconOnly ? action.label : undefined} className="inline-flex items-center gap-1.5 rounded border border-gray-200 bg-white px-2.5 py-1 text-xs font-medium text-gray-600 shadow-sm hover:bg-gray-50 hover:text-[#1563ff]"><Icon library={action.icon.library} name={action.icon.name} />{!action.iconOnly && action.label}</button>{Object.entries(action.resolvedForm).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}</form>;
        })}
        {admin && mount && <button type="button" onClick={() => setEditing(true)} title="Configure auth actions" aria-label="Configure auth actions" className="rounded border border-gray-200 bg-white p-1.5 text-gray-500 shadow-sm hover:bg-gray-50 hover:text-[#1563ff]"><Icon library="lucide" name="settings" /></button>}
      </div>
      {message && <div role="status" className="mt-2 max-w-md rounded border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-800">{message}</div>}
      {editing && mount && <ActionEditor initialScope="mount" initialKey={mount} authType={authType} tokenValues={tokenValues} onClose={() => { setEditing(false); void getAuthActions({ screen, mount, role, authType }).then((data) => { setActions(data.actions); setTokenValues(data.tokens); }); }} />}
    </>
  );
}
