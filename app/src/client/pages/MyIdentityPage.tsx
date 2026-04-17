import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import * as api from '../lib/api';
import type { GraphData } from '../types';
import type { EntitySuggestion } from '../lib/api';
import { useAuthStore } from '../stores/authStore';
import LoadingSpinner from '../components/common/LoadingSpinner';

// ─── Custom Node Types ────────────────────────────────────────────────────────

function MeNodeComp({ data }: NodeProps) {
  return (
    <div className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#19191a] px-3 py-2 text-xs font-semibold text-white shadow-md ring-2 ring-white/20 hover:ring-white/40 transition-all">
      <Handle type="source" position={Position.Right} style={{ background: '#9ca3af', border: 'none' }} />
      <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
      {String(data.label)}
    </div>
  );
}

function GroupNodeComp({ data }: NodeProps) {
  return (
    <div className="flex cursor-pointer items-center gap-1.5 rounded-md bg-amber-500 px-2.5 py-1.5 text-xs font-medium text-white shadow hover:bg-amber-600 transition-colors">
      <Handle type="target" position={Position.Left} style={{ background: '#9ca3af', border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#9ca3af', border: 'none' }} />
      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
      {String(data.label)}
    </div>
  );
}

function PolicyNodeComp({ data }: NodeProps) {
  return (
    <div className="flex cursor-pointer items-center gap-1.5 rounded-md bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-white shadow hover:bg-emerald-600 transition-colors">
      <Handle type="target" position={Position.Left} style={{ background: '#9ca3af', border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#9ca3af', border: 'none' }} />
      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
      {String(data.label)}
    </div>
  );
}

function PathNodeComp({ data }: NodeProps) {
  return (
    <div className="flex cursor-pointer items-center gap-1.5 rounded-md bg-[#1563ff] px-2.5 py-1.5 text-xs font-medium text-white shadow hover:bg-[#1250d4] transition-colors max-w-[200px]">
      <Handle type="target" position={Position.Left} style={{ background: '#9ca3af', border: 'none' }} />
      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
      </svg>
      <span className="truncate">{String(data.label)}</span>
    </div>
  );
}

const nodeTypes = {
  me: MeNodeComp,
  group: GroupNodeComp,
  policy: PolicyNodeComp,
  secretPath: PathNodeComp,
};

// ─── Capability Badge ─────────────────────────────────────────────────────────

function capColor(cap: string): string {
  if (cap === 'deny') return 'bg-red-100 text-red-700';
  if (cap === 'sudo') return 'bg-orange-100 text-orange-700';
  if (cap === 'read' || cap === 'list') return 'bg-green-100 text-green-700';
  if (cap === 'delete') return 'bg-red-50 text-red-600';
  return 'bg-blue-100 text-blue-700';
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function Legend() {
  const items = [
    { color: 'bg-[#19191a]', label: 'Identity' },
    { color: 'bg-amber-500', label: 'Group' },
    { color: 'bg-emerald-500', label: 'Policy' },
    { color: 'bg-[#1563ff]', label: 'Secret Path' },
  ];
  return (
    <div className="flex items-center gap-4">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-xs text-gray-500">
          <span className={`inline-block h-2.5 w-2.5 rounded ${item.color}`} />
          {item.label}
        </span>
      ))}
      <span className="ml-2 text-xs text-gray-400">Click any node for details</span>
    </div>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

interface SelectedNodeData {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

function DetailPanel({
  node,
  isCurrentUser,
  onClose,
}: {
  node: SelectedNodeData;
  isCurrentUser: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { tokenInfo } = useAuthStore();
  const d = node.data;

  const formatTtl = (seconds: unknown) => {
    if (!seconds || typeof seconds !== 'number') return 'N/A';
    if (seconds === 0) return '∞ (never)';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const formatExpiry = (expiry: unknown) => {
    if (!expiry || expiry === 'null') return 'Never';
    try {
      return new Date(expiry as string).toLocaleString();
    } catch {
      return String(expiry);
    }
  };

  const secretsLink = (path: string) => {
    const cleaned = path
      .replace(/\/data\//, '/')
      .replace(/\/\*$/, '')
      .replace(/\/\+$/, '')
      .replace(/\/$/, '');
    return `/secrets/${cleaned}`;
  };

  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex flex-col gap-0.5 py-2 border-b border-gray-100 last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      <span className="text-sm text-gray-800 break-all">{value}</span>
    </div>
  );

  return (
    <div className="flex w-72 flex-col rounded-lg border border-gray-200 bg-white shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <span className="text-sm font-semibold text-gray-800 capitalize">{node.type === 'secretPath' ? 'Secret Path' : node.type}</span>
        <button onClick={onClose} className="rounded p-0.5 text-gray-400 hover:text-gray-600">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col overflow-y-auto px-4 py-2 max-h-[500px]">
        {node.type === 'me' && (
          <>
            <Row label="Name" value={String(d.displayName ?? d.label ?? 'Me')} />
            {isCurrentUser && tokenInfo && (
              <>
                <Row label="Token Type" value={String((d.tokenMeta as Record<string, unknown> | null)?.type ?? tokenInfo.type ?? '—')} />
                <Row
                  label="TTL"
                  value={formatTtl((d.tokenMeta as Record<string, unknown> | null)?.ttl ?? tokenInfo.ttl)}
                />
                <Row
                  label="Expires"
                  value={formatExpiry(
                    (d.tokenMeta as Record<string, unknown> | null)?.expire_time ?? tokenInfo.expire_time
                  )}
                />
              </>
            )}
            {d.entityId && <Row label="Entity ID" value={<span className="font-mono text-xs">{String(d.entityId)}</span>} />}
            {Array.isArray(d.policies) && d.policies.length > 0 && (
              <Row
                label="Policies"
                value={
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(d.policies as string[]).map((p) => (
                      <span key={p} className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-mono text-emerald-700 ring-1 ring-emerald-200">
                        {p}
                      </span>
                    ))}
                  </div>
                }
              />
            )}
            {Array.isArray(d.groupIds) && (
              <Row label="Groups" value={`${(d.groupIds as string[]).length} group(s)`} />
            )}
            {isCurrentUser && (
              <p className="mt-3 text-[10px] text-gray-400">Raw token is not displayed for security.</p>
            )}
          </>
        )}

        {node.type === 'group' && (
          <>
            <Row label="Group Name" value={String(d.groupName ?? d.label)} />
            <Row label="Group ID" value={<span className="font-mono text-xs">{String(d.groupId)}</span>} />
            {Array.isArray(d.policies) && d.policies.length > 0 && (
              <Row
                label="Policies"
                value={
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(d.policies as string[]).map((p) => (
                      <span key={p} className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-mono text-emerald-700 ring-1 ring-emerald-200">
                        {p}
                      </span>
                    ))}
                  </div>
                }
              />
            )}
            <button
              onClick={() => navigate('/access/groups')}
              className="mt-4 flex items-center justify-center gap-1.5 rounded-md bg-amber-500 px-3 py-2 text-xs font-medium text-white hover:bg-amber-600"
            >
              View Group Relationships
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </>
        )}

        {node.type === 'policy' && (
          <>
            <Row label="Policy Name" value={<span className="font-mono">{String(d.label)}</span>} />
            <button
              onClick={() => navigate(`/policies/${encodeURIComponent(String(d.label))}`)}
              className="mt-4 flex items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-600"
            >
              View Policy
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </>
        )}

        {node.type === 'secretPath' && (
          <>
            <Row label="Path" value={<span className="font-mono text-xs">{String(d.path ?? d.label)}</span>} />
            {Array.isArray(d.capabilities) && d.capabilities.length > 0 && (
              <Row
                label="Capabilities"
                value={
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {(d.capabilities as string[]).map((cap) => (
                      <span key={cap} className={`rounded px-1.5 py-0.5 text-xs font-medium ${capColor(cap)}`}>
                        {cap}
                      </span>
                    ))}
                  </div>
                }
              />
            )}
            <button
              onClick={() => navigate(secretsLink(String(d.path ?? d.label)))}
              className="mt-4 flex items-center justify-center gap-1.5 rounded-md bg-[#1563ff] px-3 py-2 text-xs font-medium text-white hover:bg-[#1250d4]"
            >
              Browse Secrets
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Entity Search Combobox ───────────────────────────────────────────────────

function EntitySearchBox({
  onSelect,
}: {
  onSelect: (suggestion: EntitySuggestion) => void;
}) {
  const [input, setInput] = useState('');
  const [suggestions, setSuggestions] = useState<EntitySuggestion[]>([]);
  const [allSuggestions, setAllSuggestions] = useState<EntitySuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Load all suggestions once on mount
  useEffect(() => {
    api
      .getEntitySuggestions()
      .then((s) => {
        setAllSuggestions(s);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Filter as user types
  useEffect(() => {
    const q = input.trim().toLowerCase();
    if (!q) {
      setSuggestions(allSuggestions.slice(0, 8));
    } else {
      setSuggestions(
        allSuggestions
          .filter(
            (s) =>
              s.aliasName.toLowerCase().includes(q) ||
              s.entityName.toLowerCase().includes(q)
          )
          .slice(0, 10)
      );
    }
    setActiveIdx(-1);
  }, [input, allSuggestions]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as HTMLElement)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && suggestions[activeIdx]) {
        pick(suggestions[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const pick = (s: EntitySuggestion) => {
    setInput(s.aliasName);
    setOpen(false);
    onSelect(s);
  };

  const mountTypeColor = (t: string) => {
    if (t === 'userpass') return 'bg-blue-100 text-blue-700';
    if (t === 'ldap' || t === 'oidc') return 'bg-purple-100 text-purple-700';
    if (t === 'approle') return 'bg-orange-100 text-orange-700';
    return 'bg-gray-100 text-gray-500';
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={loading ? 'Loading aliases…' : 'Search by alias…'}
            disabled={loading}
            className="h-8 w-64 rounded-md border border-gray-300 bg-white pl-3 pr-8 text-sm text-gray-900 placeholder-gray-400 focus:border-[#1563ff] focus:outline-none focus:ring-1 focus:ring-[#1563ff] disabled:opacity-50"
          />
          {input && (
            <button
              type="button"
              onClick={() => { setInput(''); setOpen(true); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {open && suggestions.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-64 w-64 overflow-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg">
          {suggestions.map((s, i) => (
            <li
              key={`${s.entityId}-${s.aliasName}`}
              onMouseDown={() => pick(s)}
              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 ${
                i === activeIdx ? 'bg-blue-50' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="truncate font-medium text-gray-900">{s.aliasName}</div>
                {s.aliasName !== s.entityName && (
                  <div className="truncate text-xs text-gray-400">{s.entityName}</div>
                )}
              </div>
              {s.mountType && (
                <span className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${mountTypeColor(s.mountType)}`}>
                  {s.mountType}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {open && input.trim() && suggestions.length === 0 && !loading && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-400 shadow-lg">
          No matching aliases
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MyIdentityPage() {
  const { tokenInfo } = useAuthStore();
  const [searchParams] = useSearchParams();
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLabel, setActiveLabel] = useState<string | undefined>(undefined);
  const [selectedNode, setSelectedNode] = useState<SelectedNodeData | null>(null);

  const loadGraph = useCallback((options?: { entityId?: string; entityName?: string }) => {
    setLoading(true);
    setError(null);
    setSelectedNode(null);
    api
      .getUserIdentityMap(options)
      .then(setGraphData)
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Failed to load';
        setError((e as { response?: { data?: { error?: string } } }).response?.data?.error ?? msg);
      })
      .finally(() => setLoading(false));
  }, []);

  // Load current user on mount, or specific entity if URL param is set
  useEffect(() => {
    const entityId = searchParams.get('entityId');
    if (entityId) {
      setActiveLabel(entityId);
      loadGraph({ entityId });
    } else {
      loadGraph(undefined);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSuggestionSelect = (suggestion: EntitySuggestion) => {
    setActiveLabel(suggestion.aliasName);
    loadGraph({ entityId: suggestion.entityId });
  };

  const handleResetToMe = () => {
    setActiveLabel(undefined);
    loadGraph(undefined);
  };

  const isCurrentUser = activeLabel === undefined;

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNode({
      id: node.id,
      type: node.type ?? 'unknown',
      data: (node.data ?? {}) as Record<string, unknown>,
    });
  }, []);

  const rfNodes: Node[] = (graphData?.nodes ?? []).map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: n.data,
    style: { border: 'none', background: 'transparent', padding: 0, boxShadow: 'none' },
  }));

  const rfEdges: Edge[] = (graphData?.edges ?? []).map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    style: { stroke: '#d1d5db', strokeWidth: 1.5 },
    animated: false,
  }));

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Identity Chain</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {isCurrentUser
              ? `Viewing: ${tokenInfo?.display_name ?? 'current user'}`
              : `Viewing: ${activeLabel}`}
          </p>
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <EntitySearchBox onSelect={handleSuggestionSelect} />
          {!isCurrentUser && (
            <button
              type="button"
              onClick={handleResetToMe}
              className="h-8 rounded-md border border-gray-300 px-3 text-sm text-gray-600 hover:border-gray-400 hover:text-gray-900"
            >
              ↺ Me
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      {!loading && graphData && <Legend />}

      {/* Graph + detail panel */}
      <div className="flex flex-1 gap-4" style={{ minHeight: 560 }}>
        {/* Graph */}
        <div className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white overflow-hidden">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <LoadingSpinner />
            </div>
          )}
          {!loading && error && (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            </div>
          )}
          {!loading && !error && graphData && (
            <ReactFlowProvider>
              <ReactFlow
                nodes={rfNodes}
                edges={rfEdges}
                nodeTypes={nodeTypes}
                onNodeClick={onNodeClick}
                fitView
                fitViewOptions={{ padding: 0.3 }}
                minZoom={0.2}
                maxZoom={2}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#e5e7eb" gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            </ReactFlowProvider>
          )}
          {!loading && !error && (!graphData || graphData.nodes.length === 0) && (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">
              No identity data found
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <div className="shrink-0">
            <DetailPanel
              node={selectedNode}
              isCurrentUser={isCurrentUser}
              onClose={() => setSelectedNode(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
