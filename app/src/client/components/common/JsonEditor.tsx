import { useState } from 'react';

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
}

export default function JsonEditor({ value, onChange, readOnly = false }: JsonEditorProps) {
  const [error, setError] = useState<string | null>(null);

  function handleChange(newValue: string) {
    onChange(newValue);
    try {
      JSON.parse(newValue);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    }
  }

  function prettyPrint() {
    try {
      const parsed = JSON.parse(value);
      onChange(JSON.stringify(parsed, null, 2));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700">JSON</span>
        {!readOnly && (
          <button
            type="button"
            onClick={prettyPrint}
            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            Format
          </button>
        )}
      </div>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        readOnly={readOnly}
        rows={12}
        className={`w-full rounded-md border p-3 font-mono text-sm ${
          error ? 'border-red-300' : 'border-gray-300'
        } ${readOnly ? 'bg-gray-50' : 'bg-white'} focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none`}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
