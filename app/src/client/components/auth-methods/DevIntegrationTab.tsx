import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as api from '../../lib/api';
import LoadingSpinner from '../common/LoadingSpinner';
import ErrorMessage from '../common/ErrorMessage';
import MarkdownEditorWithIntellisense from './MarkdownEditorWithIntellisense';

interface Props {
  method: string;
  role: string;
}

// Custom markdown components for better styling
interface MarkdownProps extends React.PropsWithChildren {
  className?: string;
}

const markdownComponents = {
  h1: (props: MarkdownProps) => <h1 className="mb-4 mt-6 text-2xl font-bold text-gray-900" {...props} />,
  h2: (props: MarkdownProps) => <h2 className="mb-3 mt-5 text-xl font-bold text-gray-800" {...props} />,
  h3: (props: MarkdownProps) => <h3 className="mb-2 mt-4 text-lg font-semibold text-gray-800" {...props} />,
  h4: (props: MarkdownProps) => <h4 className="mb-2 mt-3 text-base font-semibold text-gray-700" {...props} />,
  p: (props: MarkdownProps) => <p className="mb-3 text-gray-700 leading-relaxed" {...props} />,
  ul: (props: MarkdownProps) => <ul className="mb-3 ml-4 list-inside list-disc space-y-1 text-gray-700" {...props} />,
  ol: (props: MarkdownProps) => <ol className="mb-3 ml-4 list-inside list-decimal space-y-1 text-gray-700" {...props} />,
  li: (props: MarkdownProps) => <li className="ml-2" {...props} />,
  code: (props: MarkdownProps & { inline?: boolean }) =>
    props.inline ? (
      <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-sm text-red-600" {...props} />
    ) : (
      <code {...props} />
    ),
  pre: (props: MarkdownProps) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-900 p-4 text-gray-100" {...props} />
  ),
  table: (props: MarkdownProps) => (
    <div className="mb-4 overflow-x-auto rounded border border-gray-200">
      <table className="w-full text-sm" {...props} />
    </div> 
  ),
  thead: (props: MarkdownProps) => <thead className="bg-gray-50" {...props} />,
  th: (props: MarkdownProps) => (
    <th className="border border-gray-200 px-4 py-2 text-left font-semibold text-gray-700" {...props} />
  ),
  td: (props: MarkdownProps) => <td className="border border-gray-200 px-4 py-2 text-gray-600" {...props} />,
  blockquote: (props: MarkdownProps) => (
    <blockquote className="mb-3 border-l-4 border-blue-500 bg-blue-50 py-2 pl-4 italic text-gray-700" {...props} />
  ),
};

export default function DevIntegrationTab({ method, role }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [authType, setAuthType] = useState('');
  const [isCustomized, setIsCustomized] = useState(false);
  const [canCustomize, setCanCustomize] = useState(false);

  const [rawTemplate, setRawTemplate] = useState('');
  const [templateVars, setTemplateVars] = useState<Record<string, string>>({});

  const [editing, setEditing] = useState(false);
  const [draftContent, setDraftContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    api
      .getDevTemplate(method, role)
      .then((data) => {
        setContent(data.content);
        setRawTemplate(data.rawTemplate);
        setAuthType(data.authType);
        setIsCustomized(data.isCustomized);
        setCanCustomize(data.canCustomize);
        setTemplateVars(data.templateVars ?? {});
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load integration guide'))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, [method, role]); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit() {
    setDraftContent(rawTemplate);
    setEditing(true);
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.updateDevTemplate(method, draftContent);
      setEditing(false);
      load();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset() {
    if (!window.confirm('Reset this template to the built-in default? Your customisation will be lost.')) return;
    setResetting(true);
    setSaveError(null);
    try {
      await api.deleteDevTemplate(method);
      setEditing(false);
      load();
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : 'Failed to reset template');
    } finally {
      setResetting(false);
    }
  }

  if (loading) return <LoadingSpinner className="mt-8" />;
  if (error) return <ErrorMessage message={error} />;

  // ── Edit mode ──────────────────────────────────────────────────────────────
  if (editing) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <span className="text-sm font-semibold text-gray-700">Editing integration guide</span>
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
              Markdown
            </span>
            <span className="ml-1 text-xs text-gray-400">
              Applies to all <code className="text-xs">{authType}</code> mounts
            </span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setEditing(false)}
              className="rounded border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={() => { void handleSave(); }}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {saveError && (
          <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {saveError}
          </div>
        )}

        <MarkdownEditorWithIntellisense
          value={draftContent}
          onChange={setDraftContent}
          templateVars={templateVars}
        />
      </div>
    );
  }

  // ── View mode ──────────────────────────────────────────────────────────────
  
  // If no custom content exists, show different UI for admins vs non-admins
  if (!isCustomized) {
    if (!canCustomize) {
      // Non-admin users see nothing if there's no custom guide
      return null;
    }
    
    // Admin sees empty state with explanation
    return (
      <div>
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-4">
          <h3 className="mb-2 font-semibold text-amber-900">📝 Developer Guide</h3>
          <p className="mb-3 text-sm text-amber-800">
            This guide is empty. Add content to help developers integrate with this auth method and role. 
            Once you add content, regular users will be able to see this guide with all the template variables 
            automatically filled in with the actual values.
          </p>
          <button
            onClick={() => startEdit()}
            className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
          >
            Create Guide
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isCustomized && (
            <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Custom guide
            </span>
          )}
        </div>
        {canCustomize && (
          <div className="flex gap-2">
            {isCustomized && (
              <button
                onClick={() => { void handleReset(); }}
                disabled={resetting}
                className="rounded border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                {resetting ? 'Resetting…' : 'Reset to Default'}
              </button>
            )}
            <button
              onClick={startEdit}
              className="rounded border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
            >
              Edit Guide
            </button>
          </div>
        )}
      </div>

      {/* Rendered markdown */}
      <div className="rounded-md border border-gray-200 bg-white px-6 py-4">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
