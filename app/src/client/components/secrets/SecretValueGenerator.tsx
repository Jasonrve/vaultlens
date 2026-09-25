import { useEffect, useRef, useState } from 'react';
import Modal from '../common/Modal';
import {
  DEFAULT_SECRET_OPTIONS,
  generateSecret,
  type SecretGenerationMode,
  type SecretGenerationOptions,
} from '../../lib/secretGenerator';

interface SecretValueGeneratorProps {
  onInsert: (value: string) => void;
}

const quickModes: Array<{ mode: SecretGenerationMode; label: string }> = [
  { mode: 'password', label: 'Password' },
  { mode: 'api-token', label: 'API token' },
  { mode: 'uuid', label: 'UUID' },
  { mode: 'hex', label: 'Hex secret' },
  { mode: 'base64', label: 'Base64 secret' },
];

export default function SecretValueGenerator({ onInsert }: SecretValueGeneratorProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [options, setOptions] = useState(DEFAULT_SECRET_OPTIONS);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  function update(partial: Partial<SecretGenerationOptions>) {
    setOptions((current) => ({ ...current, ...partial }));
  }

  function generate(mode = options.mode) {
    try {
      const next = generateSecret({ ...options, mode });
      setOptions((current) => ({ ...current, mode }));
      setValue(next);
      setError(null);
      if (!open) onInsert(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate a value');
    }
  }

  function insert() {
    if (value) onInsert(value);
    setOpen(false);
  }

  return (
    <>
      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setMenuOpen((current) => !current)}
          aria-label="Generate secret value"
          title="Generate secret value"
          className="rounded-md border border-gray-300 bg-white p-2 text-gray-500 hover:border-[#1563ff] hover:text-[#1563ff]"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m9-9H3m15.364-6.364L5.636 18.364m12.728 0L5.636 5.636" />
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-gray-200 bg-white p-1 shadow-lg">
            {quickModes.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => { setMenuOpen(false); generate(mode); }}
                className="block w-full rounded px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-100"
              >
                Quick {label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => { setMenuOpen(false); setOpen(true); setError(null); }}
              className="mt-1 block w-full border-t border-gray-100 px-3 py-2 text-left text-xs font-medium text-[#1563ff] hover:bg-gray-50"
            >
              More options…
            </button>
          </div>
        )}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="Generate secret value">
        <div className="space-y-4">
          <label className="block text-sm font-medium text-gray-700">
            Type
            <select value={options.mode} onChange={(e) => update({ mode: e.target.value as SecretGenerationMode })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              {quickModes.map(({ mode, label }) => <option key={mode} value={mode}>{label}</option>)}
              <option value="passphrase">Passphrase</option>
            </select>
          </label>
          {options.mode === 'passphrase' ? (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-sm text-gray-700">Words<input type="number" min="3" max="12" value={options.words} onChange={(e) => update({ words: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
              <label className="text-sm text-gray-700">Separator<input value={options.separator} onChange={(e) => update({ separator: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
            </div>
          ) : options.mode !== 'uuid' ? (
            <label className="block text-sm text-gray-700">Length<input type="number" min={options.mode === 'api-token' ? 16 : 4} max="512" value={options.length} onChange={(e) => update({ length: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          ) : null}
          {options.mode === 'password' && (
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
              {(['lowercase', 'uppercase', 'numbers', 'symbols'] as const).map((name) => <label key={name} className="flex items-center gap-2"><input type="checkbox" checked={options[name]} onChange={(e) => update({ [name]: e.target.checked })} />{name}</label>)}
            </div>
          )}
          {options.mode === 'base64' && <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={options.encoding === 'url'} onChange={(e) => update({ encoding: e.target.checked ? 'url' : 'standard' })} />URL-safe Base64</label>}
          <button type="button" onClick={() => generate()} className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4]">Generate</button>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {value && <div className="rounded-md border border-gray-200 bg-gray-50 p-3"><code className="block break-all text-sm text-gray-800">{value}</code></div>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700">Cancel</button><button type="button" onClick={insert} disabled={!value} className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">Use value</button></div>
        </div>
      </Modal>
    </>
  );
}
