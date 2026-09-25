import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as api from '../../lib/api';
import GraphWrapper from './GraphWrapper';
import GraphTableView from './GraphTableView';
import GraphExplorer from './GraphExplorer';

const nodeColors: Record<string, string> = {
  entity: '#60A5FA',
  group: '#f59e0b',
  policy: '#10b981',
  summary: '#64748b',
};

interface Props {
  refreshKey?: number;
  onDataLoaded?: (cachedAt: number | undefined, fromCache: boolean) => void;
}

interface SearchHit { kind: 'entity' | 'group'; id: string; label: string }

export default function IdentityGraph({ refreshKey = 0, onDataLoaded }: Props) {
  const [view, setView] = useState<'graph' | 'table'>('graph');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<SearchHit | null>(null);

  // Cheap summary — just entity/group counts, no per-item fan-out.
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useQuery({
    queryKey: ['identity-map', refreshKey],
    queryFn: () => api.getIdentityMap({ refresh: refreshKey > 0 }),
  });

  const term = search.trim();
  const { data: entityHits } = useQuery({
    queryKey: ['identity/entity-suggestions', term],
    queryFn: () => api.getEntitySuggestions({ search: term, limit: 10 }),
    enabled: term.length > 0,
  });
  const { data: groupHits } = useQuery({
    queryKey: ['identity/groups-summary', term],
    queryFn: () => api.getGroupsSummary({ search: term, limit: 10 }),
    enabled: term.length > 0,
  });

  const suggestions = useMemo((): SearchHit[] => {
    const entities: SearchHit[] = (entityHits ?? []).map((s) => ({
      kind: 'entity' as const,
      id: s.entityId,
      label: s.aliasName || s.entityName || s.entityId,
    }));
    const groups: SearchHit[] = (groupHits?.groups ?? []).map((g) => ({
      kind: 'group' as const,
      id: g.id,
      label: g.name || g.id,
    }));
    // Dedupe entities that showed up via multiple aliases
    const seen = new Set<string>();
    return [...entities, ...groups].filter((hit) => {
      const key = `${hit.kind}:${hit.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [entityHits, groupHits]);

  // The selected entity's/group's one-hop neighborhood — this is what actually renders.
  const {
    data: graphData,
    isLoading: selectedLoading,
    error: selectedError,
  } = useQuery({
    queryKey: ['identity-map', selected?.kind, selected?.id, refreshKey],
    queryFn: () =>
      selected?.kind === 'entity'
        ? api.getIdentityMap({ entityId: selected.id, refresh: refreshKey > 0 })
        : api.getIdentityMap({ groupId: selected!.id, refresh: refreshKey > 0 }),
    enabled: Boolean(selected),
  });

  const displayData = selected ? graphData : summary;

  useEffect(() => {
    if (displayData) onDataLoaded?.(displayData.cachedAt, displayData.fromCache ?? false);
  }, [displayData, onDataLoaded]);

  const errorMessage = selectedError
    ? (selectedError instanceof Error ? selectedError.message : 'An error occurred')
    : summaryError
      ? (summaryError instanceof Error ? summaryError.message : 'An error occurred')
      : null;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-700">Entities Groups Policies</h2>
        <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
          <button
            onClick={() => setView('graph')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              view === 'graph' ? 'bg-white text-[#1563ff] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Graph
          </button>
          <button
            onClick={() => setView('table')}
            className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
              view === 'table' ? 'bg-white text-[#1563ff] shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Table
          </button>
        </div>
      </div>

      <div className="relative mb-3">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelected(null);
          }}
          placeholder="Search entities or groups by name…"
          className="w-full max-w-md rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
        {search && !selected && suggestions.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-72 w-full max-w-md overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
            {suggestions.map((hit) => (
              <button
                key={`${hit.kind}:${hit.id}`}
                onClick={() => {
                  setSelected(hit);
                  setSearch(hit.label);
                }}
                className="flex w-full items-center gap-2 truncate px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                <span
                  className="inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: hit.kind === 'entity' ? nodeColors.entity : nodeColors.group }}
                />
                <span className="truncate">{hit.label}</span>
                <span className="ml-auto shrink-0 text-xs text-gray-400">{hit.kind}</span>
              </button>
            ))}
          </div>
        )}
        {search && !selected && suggestions.length === 0 && (
          <p className="mt-1 text-xs text-gray-400">No entities or groups match &ldquo;{search}&rdquo;</p>
        )}
      </div>

      {view === 'graph' && (
        <>
          <div className="mb-3 flex gap-4 text-xs text-gray-500">
            {Object.entries(nodeColors).map(([type, color]) => (
              <span key={type} className="flex items-center gap-1">
                <span className="inline-block h-3 w-3 rounded" style={{ background: color }} />
                {type}
              </span>
            ))}
          </div>
          <GraphExplorer
            data={displayData ?? null}
            nodeColors={nodeColors}
            loading={summaryLoading || (Boolean(selected) && selectedLoading)}
            error={errorMessage}
          />
        </>
      )}
      {view === 'table' && displayData && (
        <GraphTableView data={displayData} diagramType="identity" />
      )}
      {view === 'table' && !displayData && !summaryLoading && (
        <GraphWrapper loading={summaryLoading} error={errorMessage}>{null}</GraphWrapper>
      )}
    </div>
  );
}
