import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type CSSProperties,
} from 'react';
import { flushSync } from 'react-dom';

const tabs = [
  ['scope', 'Scope'],
  ['limits', 'Request limits'],
  ['snapshot', 'Snapshot'],
] as const;
export default function AuditRunDialog({
  open,
  onClose,
  onStart,
  busy,
  disabled,
  error,
  connection,
  children,
  title = 'Collect and run audit',
  description = 'Collect a fresh snapshot and analyze it with your saved checks and exceptions.',
  submitLabel = 'Start collection',
}: {
  open: boolean;
  onClose: () => void;
  onStart: () => void;
  busy: boolean;
  disabled: boolean;
  error?: string;
  connection?: string;
  children: ReactNode;
  title?: string;
  description?: string;
  submitLabel?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState('scope');
  useEffect(() => {
    const dialog = ref.current;
    if (open && !dialog?.open) {
      setTab('scope');
      dialog?.showModal();
    }
    if (!open && dialog?.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby="audit-run-title"
      className="m-auto w-[calc(100%_-_2rem)] max-w-[720px] overflow-hidden rounded-xl border border-[#dce3ed] bg-white p-0 text-[#172235] shadow-xl backdrop:bg-slate-900/40"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        className="flex max-h-[85dvh] flex-col text-sm"
        onInvalid={(event) => {
          const field = event.target as HTMLInputElement;
          const section = field.closest<HTMLElement>(
            '[data-collection-section]',
          )?.dataset.collectionSection;
          if (section) flushSync(() => setTab(section));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled) onStart();
        }}
      >
        <header className="shrink-0 px-5 pb-0 pt-6 sm:px-6">
          <h2 id="audit-run-title" className="text-lg font-semibold">
            {title}
          </h2>
          <p className="mt-2 text-slate-500">{description}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-[#f5f7fb] px-3 py-2.5">
            <span className="text-slate-500">Vault connection</span>
            <span className="min-w-0 break-all font-mono text-xs">
              {connection || 'Current Vault connection'}
            </span>
          </div>
          <div
            role="tablist"
            aria-label="Collection settings"
            className="mt-3 flex gap-5 border-b border-[#dce3ed]"
            onKeyDown={(event) => {
              if (
                !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              )
                return;
              event.preventDefault();
              const index = tabs.findIndex(([key]) => key === tab);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? tabs.length - 1
                    : (index +
                        (event.key === 'ArrowRight' ? 1 : -1) +
                        tabs.length) %
                      tabs.length;
              setTab(tabs[next][0]);
              ref.current
                ?.querySelector<HTMLButtonElement>(
                  `#collection-tab-${tabs[next][0]}`,
                )
                ?.focus();
            }}
          >
            {tabs.map(([key, label]) => (
              <button
                key={key}
                id={`collection-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={tab === key}
                aria-controls={`collection-panel-${key}`}
                tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                className={`border-b-2 py-3 font-medium ${tab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-900'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-6 sm:px-6">
          <fieldset disabled={busy} className="grid min-w-0">
            {Children.map(children, (child) => {
              if (
                !isValidElement<{
                  'data-collection-section': string;
                  style?: CSSProperties;
                  'aria-hidden'?: boolean;
                  id?: string;
                  role?: string;
                  'aria-labelledby'?: string;
                }>(child)
              )
                return child;
              const section = child.props['data-collection-section'];
              return cloneElement(child, {
                // Overlap panels so the tallest sets the shared height.
                // Invisible panels retain their size without exposing controls.
                style: {
                  ...child.props.style,
                  gridArea: '1 / 1',
                  minWidth: 0,
                  visibility: tab === section ? 'visible' : 'hidden',
                },
                'aria-hidden': tab !== section,
                id: `collection-panel-${section}`,
                role: 'tabpanel',
                'aria-labelledby': `collection-tab-${section}`,
              });
            })}
          </fieldset>
        </div>
        {error && (
          <p role="alert" className="shrink-0 px-6 pb-4 text-red-700">
            {error}
          </p>
        )}
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-4 border-t border-[#dce3ed] bg-[#f5f7fb] px-5 py-4 sm:px-6">
          <span className="text-xs text-slate-500">
            No secret values collected
          </span>
          <div className="ml-auto flex gap-2.5">
            <button
              type="button"
              className="rounded-md border border-[#dce3ed] bg-white px-4 py-2.5 disabled:opacity-50"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md border border-blue-600 bg-blue-600 px-4 py-2.5 font-medium text-white disabled:opacity-50"
              disabled={disabled}
            >
              {busy ? 'Starting…' : submitLabel}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
