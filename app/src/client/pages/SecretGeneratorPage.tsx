import { useEffect, useState } from 'react';
import {
  DEFAULT_SECRET_OPTIONS,
  generateSecret,
  type SecretGenerationMode,
  type SecretGenerationOptions,
} from '../lib/secretGenerator';

const OPTIONS_KEY = 'vaultlens_secret_generator_options_v1';
const modes: Array<{ value: SecretGenerationMode; label: string }> = [
  { value: 'password', label: 'Random password' },
  { value: 'passphrase', label: 'Passphrase' },
  { value: 'api-token', label: 'API token' },
  { value: 'uuid', label: 'UUID v4' },
  { value: 'hex', label: 'Hex secret' },
  { value: 'base64', label: 'Base64 secret' },
];

function loadOptions(): SecretGenerationOptions {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? 'null');
    if (stored && typeof stored === 'object') return { ...DEFAULT_SECRET_OPTIONS, ...stored } as SecretGenerationOptions;
  } catch {
    // Ignore invalid browser storage and use defaults.
  }
  return DEFAULT_SECRET_OPTIONS;
}

export default function SecretGeneratorPage() {
  const [options, setOptions] = useState<SecretGenerationOptions>(loadOptions);
  const [value, setValue] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
  }, [options]);

  function update(partial: Partial<SecretGenerationOptions>) {
    setOptions((current) => ({ ...current, ...partial }));
  }

  function generate() {
    try {
      setValue(generateSecret(options));
      setRevealed(true);
      setCopied(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate a value');
    }
  }

  async function copyValue() {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-[#1563ff]">Tools</p>
        <h1 className="text-2xl font-bold text-gray-800">Secret Generator</h1>
        <p className="mt-1 text-sm text-gray-500">Generate a secret value locally in your browser.</p>
      </div>

      <section className="space-y-5 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-medium text-gray-700">
          Generator type
          <select value={options.mode} onChange={(e) => update({ mode: e.target.value as SecretGenerationMode })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
            {modes.map((mode) => <option key={mode.value} value={mode.value}>{mode.label}</option>)}
          </select>
        </label>

        {options.mode === 'password' && (
          <>
            <label className="block text-sm text-gray-700">Length<input type="number" min="4" max="512" value={options.length} onChange={(e) => update({ length: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{(['lowercase', 'uppercase', 'numbers', 'symbols'] as const).map((key) => <label key={key} className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={options[key]} onChange={(e) => update({ [key]: e.target.checked })} />{key}</label>)}</div>
            <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={options.excludeAmbiguous} onChange={(e) => update({ excludeAmbiguous: e.target.checked })} />Exclude ambiguous characters</label>
            <label className="block text-sm text-gray-700">Additional characters<input value={options.customCharacters} onChange={(e) => update({ customCharacters: e.target.value })} placeholder="Optional custom alphabet" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>
          </>
        )}

        {options.mode === 'passphrase' && <div className="grid grid-cols-2 gap-3"><label className="text-sm text-gray-700">Words<input type="number" min="3" max="12" value={options.words} onChange={(e) => update({ words: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label><label className="text-sm text-gray-700">Separator<input value={options.separator} onChange={(e) => update({ separator: e.target.value })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label><label className="col-span-2 flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={options.capitalize} onChange={(e) => update({ capitalize: e.target.checked })} />Capitalize words</label></div>}

        {['api-token', 'hex', 'base64'].includes(options.mode) && <div className="grid grid-cols-2 gap-3"><label className="text-sm text-gray-700">Length<input type="number" min={options.mode === 'api-token' ? 16 : 4} max="512" value={options.length} onChange={(e) => update({ length: Number(e.target.value) })} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2" /></label>{options.mode === 'base64' && <label className="flex items-center gap-2 self-end pb-2 text-sm text-gray-700"><input type="checkbox" checked={options.encoding === 'url'} onChange={(e) => update({ encoding: e.target.checked ? 'url' : 'standard' })} />URL-safe</label>}</div>}

        <button type="button" onClick={generate} className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4]">Generate value</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {value && <div className="border-t border-gray-100 pt-4"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-semibold text-gray-800">Value</span><div className="flex gap-3"><button type="button" onClick={() => setRevealed((current) => !current)} className="text-sm text-gray-600">{revealed ? 'Hide' : 'Show'}</button><button type="button" onClick={() => { void copyValue(); }} className="text-sm text-[#1563ff]">{copied ? 'Copied' : 'Copy'}</button></div></div><output className="block min-h-16 break-all rounded-md bg-gray-50 p-4 font-mono text-sm text-gray-800">{revealed ? value : '••••••••••••••••'}</output></div>}
      </section>
    </div>
  );
}
