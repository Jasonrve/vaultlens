import { useState, useEffect } from 'react';
import * as api from '../../lib/api';
import type { ChangelogEntry } from '../../lib/api';

const STORAGE_KEY = 'vaultlens_last_seen_version';

/**
 * Strips a prerelease suffix so "0.7.0-prerelease2" → "0.7.0".
 * Used when looking up the matching CHANGELOG entry for the running build.
 */
function baseVersion(version: string): string {
  return version.replace(/-.*$/, '');
}

/** Returns the major.minor portion of a semver string for comparison. */
function majorMinor(version: string): string {
  return baseVersion(version).split('.').slice(0, 2).join('.');
}

/**
 * Finds the best matching key in a changelog for the given app version.
 * Tries exact match first, then base version (strips prerelease suffix).
 */
export function findChangelogKey(
  version: string,
  changelog: Record<string, ChangelogEntry>,
): string | undefined {
  if (version in changelog) return version;
  const base = baseVersion(version);
  return base in changelog ? base : undefined;
}

/** True if a is a newer major/minor than b. */
export function isNewerVersion(a: string, b: string): boolean {
  const [aMaj = 0, aMin = 0] = majorMinor(a).split('.').map(Number);
  const [bMaj = 0, bMin = 0] = majorMinor(b).split('.').map(Number);
  return aMaj > bMaj || (aMaj === bMaj && aMin > bMin);
}

/** Mark the current version as seen in localStorage. */
export function markCurrentVersionSeen(): void {
  localStorage.setItem(STORAGE_KEY, __APP_VERSION__);
}

/** True when the current version hasn't been acknowledged. */
export function hasUnseenRelease(): boolean {
  const seen = localStorage.getItem(STORAGE_KEY);
  if (!seen) return true;
  return isNewerVersion(__APP_VERSION__, seen);
}

interface Props {
  onClose: () => void;
}

const SECTION_COLORS: Record<string, string> = {
  New: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  Improved: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  Fixed: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
};

function EntryList({ items }: { items: { title: string; description: string }[] }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  return (
    <ul className="space-y-2">
      {items.map((item, i) => (
        <li key={i}>
          <button
            onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
            className="flex w-full items-start gap-2 text-left"
          >
            <svg
              className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform ${expandedIdx === i ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            <span className="text-sm font-medium text-gray-800">{item.title}</span>
          </button>
          {expandedIdx === i && (
            <p className="ml-6 mt-1 text-sm leading-relaxed text-gray-600">{item.description}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function VersionSection({ version, entry, defaultOpen }: { version: string; entry: ChangelogEntry; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const sectionKeys = (['New', 'Improved', 'Fixed'] as const).filter(
    (k) => (entry.sections[k]?.length ?? 0) > 0
  );

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-5 py-3 text-left hover:bg-gray-50"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">v{version}</span>
          <span className="text-xs text-gray-400">{entry.date}</span>
        </div>
        <svg
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && (
        <div className="px-5 pb-4 space-y-4">
          {sectionKeys.map((sectionKey) => {
            const items = entry.sections[sectionKey] ?? [];
            return (
              <div key={sectionKey}>
                <span className={`mb-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${SECTION_COLORS[sectionKey] ?? 'bg-gray-100 text-gray-600'}`}>
                  {sectionKey}
                </span>
                <EntryList items={items} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function WhatsNewModal({ onClose }: Props) {
  const [changelog, setChangelog] = useState<Record<string, ChangelogEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    api.getChangelog()
      .then(setChangelog)
      .catch(() => setChangelog({}))
      .finally(() => setLoading(false));
  }, []);

  function dismiss() {
    markCurrentVersionSeen();
    onClose();
  }

  const currentVersion = __APP_VERSION__;

  // Sort versions descending
  const sortedVersions = changelog
    ? Object.keys(changelog).sort((a, b) => {
        const [aMaj = 0, aMin = 0, aPatch = 0] = a.replace(/-.*$/, '').split('.').map(Number);
        const [bMaj = 0, bMin = 0, bPatch = 0] = b.replace(/-.*$/, '').split('.').map(Number);
        return bMaj - aMaj || bMin - aMin || bPatch - aPatch;
      })
    : [];

  // Match prerelease builds (e.g. "0.7.0-pre1") to their base changelog key ("0.7.0")
  const currentEntryKey = changelog ? findChangelogKey(currentVersion, changelog) : undefined;
  const currentEntry = currentEntryKey ? changelog![currentEntryKey] : undefined;
  const olderVersions = sortedVersions.filter((v) => v !== currentEntryKey);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/50" onClick={dismiss} />
      <div className="relative z-10 flex w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg">✨</span>
              <h2 className="text-base font-semibold text-gray-900">
                What&apos;s New in v{currentEntryKey ?? currentVersion}
              </h2>
            </div>
            {currentEntry?.date && (
              <p className="mt-0.5 text-xs text-gray-400">Released {currentEntry.date}</p>
            )}
          </div>
          <button onClick={dismiss} className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-[#1563ff]" />
            </div>
          ) : !currentEntry ? (
            <p className="px-5 py-8 text-center text-sm text-gray-400">No release notes for this version yet.</p>
          ) : (
            <>
              {/* Highlights */}
              {currentEntry.highlights.length > 0 && (
                <div className="border-b border-gray-100 px-5 py-4">
                  <ul className="space-y-1.5">
                    {currentEntry.highlights.map((h, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="mt-0.5 text-[#1563ff]">•</span>
                        {h}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Sections */}
              {(['New', 'Improved', 'Fixed'] as const).map((sectionKey) => {
                const items = currentEntry.sections[sectionKey] ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={sectionKey} className="border-b border-gray-100 px-5 py-4">
                    <span className={`mb-3 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${SECTION_COLORS[sectionKey] ?? 'bg-gray-100 text-gray-600'}`}>
                      {sectionKey}
                    </span>
                    <EntryList items={items} />
                  </div>
                );
              })}

              {/* Older versions toggle */}
              {olderVersions.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowAll((s) => !s)}
                    className="flex w-full items-center justify-between px-5 py-3 text-sm text-gray-500 hover:bg-gray-50"
                  >
                    <span>{showAll ? 'Hide' : 'Show'} previous versions</span>
                    <svg
                      className={`h-4 w-4 transition-transform ${showAll ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                    </svg>
                  </button>
                  {showAll && olderVersions.map((v) => (
                    <VersionSection key={v} version={v} entry={changelog![v]} defaultOpen={false} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-end border-t border-gray-100 px-5 py-3">
          <button
            onClick={dismiss}
            className="rounded-md bg-[#1563ff] px-4 py-2 text-sm font-medium text-white hover:bg-[#1250d4]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
