import { useState, useEffect, type FormEvent } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../../lib/api';
import ErrorMessage from '../common/ErrorMessage';

interface FieldState {
  key: string;
  value: string;
  modified: boolean;
  showMask: boolean;
  isNew?: boolean;
  removed?: boolean;
}

export default function SecretMergeEditor() {
  const { '*': splat = '' } = useParams();
  const navigate = useNavigate();
  const [fields, setFields] = useState<FieldState[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .readSecret(splat)
      .then((result) => {
        const keys = result.keys ?? [];
        setFields(
          keys.map((key) => ({
            key,
            value: '',
            modified: false,
            showMask: true,
          })),
        );
        setLoaded(true);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to load secret');
      });
  }, [splat]);

  function updateField(index: number, value: string) {
    setFields((currentFields) => currentFields.map((field, fieldIndex) => (
      fieldIndex === index ? { ...field, value, modified: true, showMask: false } : field
    )));
  }

  function focusField(index: number) {
    setFields((currentFields) => currentFields.map((field, fieldIndex) => (
      fieldIndex === index ? { ...field, showMask: false } : field
    )));
  }

  function blurField(index: number) {
    setFields((currentFields) => currentFields.map((field, fieldIndex) => (
      fieldIndex === index && field.value === ''
        ? { ...field, showMask: true, modified: false }
        : fieldIndex === index
          ? { ...field, showMask: false, modified: true }
        : field
    )));
  }

  function addField() {
    setFields((f) => [...f, { key: '', value: '', modified: true, showMask: false, isNew: true }]);
  }

  function setKey(index: number, key: string) {
    setFields((f) => f.map((field, i) => (i === index ? { ...field, key } : field)));
  }

  // New rows are dropped outright; existing keys are marked and removed on save
  function removeField(index: number) {
    setFields((f) => f.flatMap((field, i) => (
      i !== index ? [field] : field.isNew ? [] : [{ ...field, removed: !field.removed, value: '', modified: false, showMask: true }]
    )));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const changedData: Record<string, unknown> = {};
      const removeKeys = fields.filter((f) => f.removed).map((f) => f.key);
      const live = fields.filter((f) => !f.removed);
      const newKeys = live.filter((f) => f.isNew).map((f) => f.key.trim());
      if (newKeys.some((k) => !k)) {
        setError('New fields need a key');
        setSaving(false);
        return;
      }
      const all = [...live.filter((f) => !f.isNew).map((f) => f.key), ...newKeys];
      if (new Set(all).size !== all.length) {
        setError('Duplicate keys');
        setSaving(false);
        return;
      }
      for (const field of live) {
        if (field.modified && (field.value !== '' || field.isNew)) {
          changedData[field.key.trim()] = field.value;
        }
      }
      if (Object.keys(changedData).length === 0 && removeKeys.length === 0) {
        setError('No fields have been modified');
        setSaving(false);
        return;
      }
      await api.mergeSecret(splat, changedData, removeKeys);
      navigate(`/secrets/view/${splat}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  }

  if (!loaded && !error) {
    return <div className="mt-12 text-center text-gray-400">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-2 text-2xl font-bold text-gray-800">Partial Update</h1>
      <p className="mb-6 text-sm text-gray-500">
        Only modified, added and removed fields are sent to the server. Unchanged fields retain their current values.
      </p>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        {fields.map((field, i) => (
          <div key={field.key} className="flex items-center gap-3">
            {field.isNew ? (
              <input
                type="text"
                aria-label="New key"
                placeholder="key"
                value={field.key}
                onChange={(e) => setKey(i, e.target.value)}
                className="w-1/3 rounded-md border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none"
              />
            ) : (
              <span className={`w-1/3 font-mono text-sm font-medium text-gray-700 ${field.removed ? 'line-through opacity-50' : ''}`}>{field.key}</span>
            )}
            <div className="flex flex-1 items-center gap-2">
              <input
                type="text"
                disabled={field.removed}
                value={field.value}
                placeholder={field.showMask ? '********' : undefined}
                onFocus={() => focusField(i)}
                onBlur={() => blurField(i)}
                onChange={(e) => updateField(i, e.target.value)}
                className={`flex-1 rounded-md border px-3 py-2 text-sm focus:outline-none ${
                  field.modified
                    ? 'border-blue-400 bg-white ring-1 ring-blue-300'
                    : 'border-gray-300'
                }`}
              />
              {field.modified && (
                <span className="text-xs font-medium text-[#1563ff]">{field.isNew ? 'new' : 'modified'}</span>
              )}
              {field.removed && <span className="text-xs font-medium text-red-600">will be removed</span>}
              <button
                type="button"
                onClick={() => removeField(i)}
                aria-label={field.removed ? `Undo remove ${field.key}` : `Remove ${field.key || 'new field'}`}
                className="rounded p-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-red-600"
              >
                {field.removed ? 'Undo' : '✕'}
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={addField}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          + Add field
        </button>

        {error && <ErrorMessage message={error} />}

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Merge Changes'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

