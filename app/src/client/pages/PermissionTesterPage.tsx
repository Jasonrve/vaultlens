import { useState, useCallback, useEffect } from 'react';
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
import type { GraphNode } from '../types';
import type { EntitySuggestion, PermissionTestResult } from '../lib/api';
import LoadingSpinner from '../components/common/LoadingSpinner';

// ─── Color helpers ────────────────────────────────────────────────────────────

function statusColor(status: unknown): string {
  if (status === 'success') return '#22c55e';
  if (status === 'failure') return '#ef4444';
  return '#94a3b8';
}

function statusBg(status: unknown): string {
  if (status === 'success') return '#22c55e';
  if (status === 'failure') return '#ef4444';
  return '#64748b';
}

// ─── Custom node components ──────────────────────────────────────────────────

function EntityNode({ data, id }: NodeProps) {
  return (
    <div
      className="flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-md ring-2 transition-all"
      style={{ background: statusBg(data.status), boxShadow: `0 0 0 2px ${statusColor(data.status)}40` }}
      data-nodeid={id}
    >
      <Handle type="source" position={Position.Right} style={{ background: '#9ca3af', border: 'none' }} />
      <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
      {String(data.label)}
    </div>
  );
}

function GroupNode({ data, id }: NodeProps) {
  return (
    <div
      className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white shadow transition-colors"
      style={{ background: data.status === 'success' ? '#f59e0b' : '#78716c' }}
      data-nodeid={id}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#9ca3af', border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#9ca3af', border: 'none' }} />
      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
      {String(data.label)}
    </div>
  );
}

function PolicyNode({ data, id }: NodeProps) {
  return (
    <div
      className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-white shadow transition-colors"
      style={{ background: statusBg(data.status) }}
      data-nodeid={id}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#9ca3af', border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#9ca3af', border: 'none' }} />
      <svg className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
      {String(data.label)}
    </div>
  );
}

function SecretPathNode({ data, id }: NodeProps) {
  return (
    <div
      className="flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-mono font-medium text-white shadow transition-colors"
      style={{ background: statusBg(data.status) }}
      data-nodeid={id}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#9ca3af', border: 'none' }} />
      <Handle type="source" position={Position.Right} style={{ background: '#9ca3af', border: 'none' }} />
      {String(data.label)}
    </div>
  );
}

function ResultNode({ data }: NodeProps) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white shadow-lg"
      style={{ background: statusBg(data.status) }}
    >
      <Handle type="target" position={Position.Left} style={{ background: '#9ca3af', border: 'none' }} />
      {String(data.label)}
    </div>
  );
}

const nodeTypes = {
  entity: EntityNode,
  group: GroupNode,
  policy: PolicyNode,
  secretPath: SecretPathNode,
  result: ResultNode,
};

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({ node, onClose }: { node: GraphNode | null; onClose: () => void }) {
  if (!node) return null;

  return (
    <div className="w-80 border-l border-gray-200 bg-white p-4 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-800">Node Details</h3>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Type</p>
          <p className="text-sm text-gray-700 capitalize">{node.type}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Label</p>
          <p className="text-sm font-mono text-gray-700">{node.data.label}</p>
        </div>

        {node.data.status != null ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</p>
            <span
              className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium text-white"
              style={{ background: statusBg(node.data.status) }}
            >
              {String(node.data.status)}
            </span>
          </div>
        ) : null}

        {Array.isArray(node.data.capabilities) ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Capabilities</p>
            <div className="mt-1 space-y-1">
              {(node.data.capabilities as string[]).map((cap, i) => (
                <span
                  key={i}
                  className="mr-1 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-700"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {Array.isArray(node.data.policies) ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Policies</p>
            <div className="mt-1 space-y-1">
              {(node.data.policies as string[]).map((p, i) => (
                <span
                  key={i}
                  className="mr-1 inline-block rounded bg-emerald-50 px-2 py-0.5 text-xs font-mono text-emerald-700"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {node.data.operation != null ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Operation</p>
            <p className="text-sm font-mono text-gray-700">{String(node.data.operation)}</p>
          </div>
        ) : null}

        {node.data.path != null ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Path</p>
            <p className="text-sm font-mono text-gray-700">{String(node.data.path)}</p>
          </div>
        ) : null}

        {node.data.testedOperation != null ? (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Tested Operation</p>
            <p className="text-sm font-mono text-gray-700">{String(node.data.testedOperation)}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function PermissionGraph({
  result,
  rawNodes,
}: {
  result: PermissionTestResult;
  rawNodes: GraphNode[];
}) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);

  const nodes: Node[] = rawNodes.map((n) => ({
    id: n.id,
    type: n.type,
    position: n.position,
    data: { ...n.data },
  }));

  const edges: Edge[] = result.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
    style: { stroke: '#94a3b8' },
  }));

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const raw = rawNodes.find((n) => n.id === node.id) || null;
      setSelectedNode(raw);
    },
    [rawNodes],
  );

  return (
    <div className="flex rounded-md border border-gray-200 bg-white" style={{ height: 500 }}>
      <div className="flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#e5e7eb" gap={20} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {selectedNode && (
        <DetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
      )}
    </div>
  );
}

export default function PermissionTesterPage() {
  const [entityId, setEntityId] = useState('');
  const [path, setPath] = useState('');
  const [operation, setOperation] = useState('read');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PermissionTestResult | null>(null);
  const [suggestions, setSuggestions] = useState<EntitySuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(true);

  useEffect(() => {
    api
      .getEntitySuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setLoadingSuggestions(false));
  }, []);

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!path.trim()) {
      setError('Please enter a path to test');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.testEntityPermissions(
        path.trim(),
        operation,
        entityId || undefined,
      );
      setResult(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Permission test failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Permission Tester</h1>
        <p className="mt-1 text-sm text-gray-500">
          Simulate and validate permissions without executing real operations.
          Uses Vault&apos;s capabilities endpoints to test access.
        </p>
      </div>

      {/* Test Form */}
      <form onSubmit={handleTest} className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {/* Entity selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entity</label>
            {loadingSuggestions ? (
              <div className="flex h-9 items-center text-sm text-gray-400">Loading…</div>
            ) : (
              <select
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Current User (self)</option>
                {suggestions.map((s) => (
                  <option key={s.entityId} value={s.entityId}>
                    {s.aliasName} ({s.entityName})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Path */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Path</label>
            <input
              type="text"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="e.g. kv/data/product/service/nprd/secret"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
            />
          </div>

          {/* Operation */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Operation</label>
            <select
              value={operation}
              onChange={(e) => setOperation(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="read">Read</option>
              <option value="create">Create</option>
              <option value="update">Update</option>
              <option value="delete">Delete</option>
              <option value="list">List</option>
            </select>
          </div>

          {/* Submit */}
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading || !path.trim()}
              className="w-full rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--brand-primary, #1563ff)' }}
            >
              {loading ? 'Testing…' : 'Test Permission'}
            </button>
          </div>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Loading */}
      {loading && <LoadingSpinner className="mt-8" />}

      {/* Result */}
      {result && !loading && (
        <div className="space-y-4">
          {/* Summary banner */}
          <div
            className={`rounded-lg border p-4 ${
              result.allowed
                ? 'border-green-200 bg-green-50'
                : 'border-red-200 bg-red-50'
            }`}
          >
            <div className="flex items-center gap-3">
              {result.allowed ? (
                <svg className="h-6 w-6 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <div>
                <h3 className={`text-sm font-semibold ${result.allowed ? 'text-green-800' : 'text-red-800'}`}>
                  {result.allowed ? 'Permission Granted' : 'Permission Denied'}
                </h3>
                <p className={`text-xs ${result.allowed ? 'text-green-600' : 'text-red-600'}`}>
                  <span className="font-mono">{result.operation}</span> on{' '}
                  <span className="font-mono">{result.path}</span>
                  {' — '}Capabilities: [{result.capabilities.join(', ')}]
                </p>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded" style={{ background: '#22c55e' }} />
              Grants access
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded" style={{ background: '#ef4444' }} />
              Denied / Failure
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-3 w-3 rounded" style={{ background: '#64748b' }} />
              No match
            </span>
            <span className="text-gray-400 ml-2">Click a node for details →</span>
          </div>

          {/* Graph visualization */}
          <ReactFlowProvider>
            <PermissionGraph result={result} rawNodes={result.nodes} />
          </ReactFlowProvider>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && !error && (
        <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50">
          <p className="text-sm text-gray-400">
            Enter a path and operation to test permissions
          </p>
        </div>
      )}
    </div>
  );
}
