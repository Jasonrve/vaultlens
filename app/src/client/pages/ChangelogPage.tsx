import { useState, useEffect } from 'react';
import * as api from '../lib/api';
import type { ChangelogEntry } from '../lib/api';
import { findChangelogKey } from '../components/common/WhatsNewModal';
import LoadingSpinner from '../components/common/LoadingSpinner';

const SECTION_COLORS: Record<string, string> = {
  New: 'bg-green-50 text-green-700 ring-1 ring-green-200',
  Improved: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  Fixed: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
};

function EntryRow({ title, description }: { title: string; description: string }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 py-1 text-left"
      >
        <svg
          className={`mt-0.5 h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
        <span className="text-sm font-medium text-gray-800">{title}</span>
      </button>
      {open && (
        <p className="ml-6 mt-0.5 pb-1 text-sm leading-relaxed text-gray-600">{description}</p>
      )}
    </li>
  );
}

function VersionCard({ version, entry, isCurrent }: { version: string; entry: ChangelogEntry; isCurrent: boolean }) {
  const sectionKeys = (['New', 'Improved', 'Fixed'] as const).filter(
    (k) => (entry.sections[k]?.length ?? 0) > 0,
  );
  const totalItems = sectionKeys.reduce((n, k) => n + (entry.sections[k]?.length ?? 0), 0);

  return (
    <div className={`rounded-xl border bg-white shadow-sm ${isCurrent ? 'border-[#1563ff]/30' : 'border-gray-200'}`}>
      {/* Version header */}
      <div className={`flex items-start justify-between rounded-t-xl px-5 py-4 ${isCurrent ? 'bg-[#1563ff]/5' : 'bg-gray-50'}`}>
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-gray-900">v{version}</h2>
            {isCurrent && (
              <span className="rounded-full bg-[#1563ff] px-2 py-0.5 text-[11px] font-semibold text-white">
                Current
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-400">
            Released {entry.date} &middot; {totalItems} change{totalItems !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Highlights */}
      {entry.highlights.length > 0 && (
        <div className="border-b border-gray-100 px-5 py-3">
          <ul className="space-y-1">
            {entry.highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-0.5 shrink-0 text-[#1563ff]">•</span>
                {h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Sections */}
      {sectionKeys.length > 0 && (
        <div className="divide-y divide-gray-100 px-5 py-3 space-y-4">
          {sectionKeys.map((sectionKey) => {
            const items = entry.sections[sectionKey] ?? [];
            return (
              <div key={sectionKey} className="pt-3 first:pt-0">
                <span className={`mb-2 inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${SECTION_COLORS[sectionKey] ?? 'bg-gray-100 text-gray-600'}`}>
                  {sectionKey}
                </span>
                <ul className="space-y-0.5">
                  {items.map((item, i) => (
                    <EntryRow key={i} title={item.title} description={item.description} />
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function ChangelogPage() {
  const [changelog, setChangelog] = useState<Record<string, ChangelogEntry> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    api.getChangelog()
      .then(setChangelog)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  const currentVersion = __APP_VERSION__;

  const sortedVersions = changelog
    ? Object.keys(changelog).sort((a, b) => {
        const [aMaj = 0, aMin = 0, aPatch = 0] = a.replace(/-.*$/, '').split('.').map(Number);
        const [bMaj = 0, bMin = 0, bPatch = 0] = b.replace(/-.*$/, '').split('.').map(Number);
        return bMaj - aMaj || bMin - aMin || bPatch - aPatch;
      })
    : [];

  const currentEntryKey = changelog ? findChangelogKey(currentVersion, changelog) : undefined;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Release Notes</h1>
        <p className="mt-1 text-sm text-gray-500">
          Full history of changes across all VaultLens versions. Running <span className="font-mono font-medium text-gray-700">v{currentVersion}</span>.
        </p>
      </div>

      {loading && <LoadingSpinner className="mt-12" />}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load release notes.
        </div>
      )}

      {!loading && !error && sortedVersions.length === 0 && (
        <p className="text-center text-sm text-gray-400 py-12">No release notes available.</p>
      )}

      {!loading && !error && sortedVersions.map((v) => (
        <VersionCard
          key={v}
          version={v}
          entry={changelog![v]}
          isCurrent={v === currentEntryKey}
        />
      ))}
    </div>
  );
}
