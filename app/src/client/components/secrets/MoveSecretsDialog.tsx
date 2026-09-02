import { useState } from 'react';
import * as api from '../../lib/api';
import Modal from '../common/Modal';

interface MoveSecretsDialogProps {
  source: string;
  isFolder: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function MoveSecretsDialog({ source, isFolder, onClose, onSuccess }: MoveSecretsDialogProps) {
  const [destination, setDestination] = useState('');
  const [conflict, setConflict] = useState<'fail' | 'skip' | 'overwrite'>('fail');
  const [conflicts, setConflicts] = useState<api.MoveItemResult[]>([]);
  const [result, setResult] = useState<api.MoveSecretsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(selectedConflict = conflict) {
    const target = destination.trim();
    if (!target) {
      setError('Enter a destination path');
      return;
    }
    if (target.replace(/\/+$/, '') === source.replace(/\/+$/, '')) {
      setError('Destination cannot be the source');
      return;
    }
    if (isFolder && !target.endsWith('/')) {
      setError('Folder moves need a destination ending with /');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const moveResult = await api.moveSecrets(source, target, selectedConflict);
      if (moveResult.conflicts?.length && selectedConflict === 'fail') {
        setConflicts(moveResult.conflicts);
        return;
      }
      setResult(moveResult);
      if (moveResult.moved) onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Move failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Move secrets">
      {result ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-700">Moved {result.moved ?? 0} secret{result.moved === 1 ? '' : 's'}.</p>
          {!!result.skipped?.length && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p>{result.skipped.length} secret{result.skipped.length === 1 ? '' : 's'} skipped.</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {result.skipped.map((item) => (
                  <li key={`${item.source}:${item.destination}`}>
                    {item.source}: {item.reason ?? 'Move failed'}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Close</button>
          </div>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }} className="space-y-4">
          <p className="text-sm text-gray-600">
            {isFolder ? 'Move every secret under this folder.' : 'Move this secret to a new path.'}
          </p>
          <div>
            <label htmlFor="move-destination" className="mb-1 block text-sm font-medium text-gray-700">Destination path</label>
            <input
              id="move-destination"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder={isFolder ? 'kv/new-folder/' : 'kv/new-path'}
              autoFocus
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1563ff] focus:ring-1 focus:ring-[#1563ff] focus:outline-none"
            />
            <p className="mt-1 text-xs text-gray-500">{isFolder ? 'End with / to preserve the folder structure.' : 'End with / to place the secret in a folder, or enter an exact new path.'}</p>
          </div>
          {!!conflicts.length && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              <p className="font-medium">Destination already exists for {conflicts.length} secret{conflicts.length === 1 ? '' : 's'}.</p>
              <p className="mt-1">Choose whether to leave conflicts in place or replace them.</p>
              <div className="mt-3 flex gap-2">
                <button type="button" disabled={loading} onClick={() => { setConflict('skip'); void submit('skip'); }} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">Skip conflicts</button>
                <button type="button" disabled={loading} onClick={() => { setConflict('overwrite'); void submit('overwrite'); }} className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700">Overwrite conflicts</button>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={loading} className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50">{loading ? 'Moving…' : 'Move'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
