import { useState } from 'react';
import { importPythonAudit } from '../lib/api';

export default function AuditImportUpload({
  disabled,
  onImported,
}: {
  disabled: boolean;
  onImported: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function upload() {
    if (!file) return;
    if (file.size > 32 * 1024 * 1024) {
      setError(
        'Web import supports files up to 32 MiB. Use the CLI for larger snapshots.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await importPythonAudit(file);
      onImported(result.id);
    } catch {
      setError(
        'Import could not start. Check the file format, access and whether another audit is running.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="rounded border p-3 text-sm">
      <summary>Import Python SQLite snapshot</summary>
      <p className="my-2 text-xs text-gray-500">
        Schema 3, up to 32 MiB. The snapshot address must match this Vault
        connection. Import creates a separate saved snapshot for native
        analysis.
      </p>
      <input
        aria-label="Python SQLite snapshot"
        type="file"
        accept=".sqlite,.sqlite3,.db"
        disabled={disabled || busy}
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setError('');
        }}
      />
      <button
        className="ml-2 rounded border px-3 py-2 disabled:opacity-50"
        disabled={!file || disabled || busy}
        onClick={upload}
      >
        {busy ? 'Uploading…' : 'Import snapshot'}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-red-700">
          {error}
        </p>
      )}
    </details>
  );
}
