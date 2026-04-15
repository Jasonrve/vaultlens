import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  ReactFlowProvider,
  useReactFlow,
  useViewport,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphData } from '../../types';

// ── Constants ─────────────────────────────────────────────────────────────────
const X_STEP = 220;
const Y_STEP = 55;
const NODE_W = 160;   // approx rendered node width
const NODE_H = 32;    // approx rendered node height
const GHOST_W = 130;  // ghost overlay width
const GHOST_H = 26;   // ghost overlay height
const MAX_GHOSTS_PER_SIDE = 3;

// ── Helper types ──────────────────────────────────────────────────────────────
type GhostSide = 'top' | 'bottom' | 'left' | 'right';

interface GhostInfo {
  id: string;
  label: string;
  color: string;
  side: GhostSide;
  posLeft: number;
  posTop: number;
}

// ── Helper functions ──────────────────────────────────────────────────────────

/**
 * Find where segment P1→P2 first crosses the viewport boundary [0,W]×[0,H].
 * P1 is assumed to be inside the viewport; P2 outside.
 */
function findBoundaryIntersection(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  W: number,
  H: number,
): { x: number; y: number; side: GhostSide } | null {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const candidates: Array<{ t: number; x: number; y: number; side: GhostSide }> = [];

  if (Math.abs(dy) > 0.01) {
    const tTop = (0 - y1) / dy;
    const xTop = x1 + tTop * dx;
    if (tTop > 0.01 && xTop >= 0 && xTop <= W) candidates.push({ t: tTop, x: xTop, y: 0, side: 'top' });

    const tBot = (H - y1) / dy;
    const xBot = x1 + tBot * dx;
    if (tBot > 0.01 && xBot >= 0 && xBot <= W) candidates.push({ t: tBot, x: xBot, y: H, side: 'bottom' });
  }
  if (Math.abs(dx) > 0.01) {
    const tLeft = (0 - x1) / dx;
    const yLeft = y1 + tLeft * dy;
    if (tLeft > 0.01 && yLeft >= 0 && yLeft <= H) candidates.push({ t: tLeft, x: 0, y: yLeft, side: 'left' });

    const tRight = (W - x1) / dx;
    const yRight = y1 + tRight * dy;
    if (tRight > 0.01 && yRight >= 0 && yRight <= H) candidates.push({ t: tRight, x: W, y: yRight, side: 'right' });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.t - b.t);
  return candidates[0];
}

/** Compute ghost overlay position (left/top px) clamped to the viewport interior. */
function ghostPos(
  side: GhostSide,
  ex: number,
  ey: number,
  W: number,
  H: number,
): { left: number; top: number } {
  const PAD = 6;
  switch (side) {
    case 'right':
      return { left: W - GHOST_W - PAD, top: Math.max(PAD, Math.min(ey - GHOST_H / 2, H - GHOST_H - PAD)) };
    case 'left':
      return { left: PAD, top: Math.max(PAD, Math.min(ey - GHOST_H / 2, H - GHOST_H - PAD)) };
    case 'top':
      return { left: Math.max(PAD, Math.min(ex - GHOST_W / 2, W - GHOST_W - PAD)), top: PAD };
    case 'bottom':
      return { left: Math.max(PAD, Math.min(ex - GHOST_W / 2, W - GHOST_W - PAD)), top: H - GHOST_H - PAD };
  }
}

/** Direction arrow glyph for a ghost side. */
const SIDE_ARROW: Record<GhostSide, string> = { top: '↑', bottom: '↓', left: '←', right: '→' };

/** Collect all subtree IDs rooted at nodeId that are currently visible. */
function collectSubtreeIds(
  nodeId: string,
  expandedIds: Set<string>,
  visibleNodeIds: Set<string>,
  childMap: Map<string, string[]>,
): string[] {
  const result: string[] = [nodeId];
  const recurse = (id: string) => {
    for (const childId of childMap.get(id) ?? []) {
      if (visibleNodeIds.has(childId)) {
        result.push(childId);
        if (expandedIds.has(childId)) recurse(childId);
      }
    }
  };
  recurse(nodeId);
  return result;
}

// ── Custom node type ──────────────────────────────────────────────────────────
interface ExpandableNodeData {
  label: string;
  color: string;
  hasChildren: boolean;
  isExpanded: boolean;
  isHighlighted: boolean;
  [key: string]: unknown;
}

const ExpandableNode = memo(function ExpandableNode({
  data,
}: {
  data: ExpandableNodeData;
}) {
  const bg = data.color || '#6b7280';
  return (
    <div
      style={{
        background: bg,
        boxShadow: data.isHighlighted
          ? '0 0 0 3px #fbbf24, 0 0 12px rgba(251,191,36,0.5)'
          : '0 1px 3px rgba(0,0,0,0.18)',
      }}
      className="relative flex min-w-[100px] max-w-[160px] items-center rounded-md px-3 py-1.5 text-xs font-medium text-white select-none"
    >
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <span className="max-w-[110px] overflow-hidden text-ellipsis whitespace-nowrap">{data.label}</span>
      {data.hasChildren && (
        <span
          className="ml-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/25 text-[10px] font-bold leading-none text-white"
          title={data.isExpanded ? 'Collapse' : 'Expand'}
        >
          {data.isExpanded ? '−' : '+'}
        </span>
      )}
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
});

// Stable reference so React Flow does not re-register types on every render
const NODE_TYPES: NodeTypes = { expandable: ExpandableNode as unknown as NodeTypes['expandable'] };

// ── Layout algorithm ──────────────────────────────────────────────────────────
function computeLayout(
  rootIds: string[],
  expandedIds: Set<string>,
  childMap: Map<string, string[]>,
  visibleNodeIds: Set<string>,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Recursively place a node at (col, anchorY) then spread its children
  // symmetrically around anchorY so the parent NEVER changes position.
  function place(id: string, col: number, anchorY: number) {
    if (!visibleNodeIds.has(id)) return;
    positions.set(id, { x: col * X_STEP, y: anchorY });
    if (!expandedIds.has(id)) return;
    const children = (childMap.get(id) ?? []).filter((c) => visibleNodeIds.has(c));
    if (children.length === 0) return;
    // Centre children around the parent's anchorY so the parent stays in place.
    const startY = anchorY - ((children.length - 1) / 2) * Y_STEP;
    children.forEach((childId, i) => place(childId, col + 1, startY + i * Y_STEP));
  }

  // Root nodes are anchored at their natural index position — they never move.
  rootIds.filter((id) => visibleNodeIds.has(id)).forEach((id, i) => place(id, 0, i * Y_STEP));

  return positions;
}

// ── GraphCanvas (inner, must be inside ReactFlowProvider) ─────────────────────
interface GraphCanvasProps {
  data: GraphData;
  nodeColors: Record<string, string>;
  childMap: Map<string, string[]>;
  rootIds: string[];
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
  highlightedIds: Set<string>;
  fitViewTrigger: number;
  focusNodeId: string | null;
}

function GraphCanvas({
  data,
  nodeColors,
  childMap,
  rootIds,
  expandedIds,
  onToggle,
  highlightedIds,
  fitViewTrigger,
  focusNodeId,
}: GraphCanvasProps) {
  const { fitView, setViewport, getViewport } = useReactFlow();
  const { x: tx, y: ty, zoom } = useViewport();

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);
  const [containerH, setContainerH] = useState(600);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerW(entry.contentRect.width);
      setContainerH(entry.contentRect.height);
    });
    ro.observe(el);
    setContainerW(el.clientWidth);
    setContainerH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const visibleNodeIds = useMemo(() => {
    const visible = new Set<string>(rootIds);
    const expand = (id: string) => {
      if (!expandedIds.has(id)) return;
      for (const childId of childMap.get(id) ?? []) {
        visible.add(childId);
        expand(childId);
      }
    };
    for (const id of rootIds) expand(id);
    return visible;
  }, [rootIds, expandedIds, childMap]);

  const positions = useMemo(
    () => computeLayout(rootIds, expandedIds, childMap, visibleNodeIds),
    [rootIds, expandedIds, childMap, visibleNodeIds],
  );

  const nodeMap = useMemo(() => {
    const m = new Map<string, GraphData['nodes'][number]>();
    for (const n of data.nodes) m.set(n.id, n);
    return m;
  }, [data.nodes]);

  const nodes: Node[] = useMemo(
    () =>
      [...visibleNodeIds]
        .filter((id) => positions.has(id) && nodeMap.has(id))
        .map((id) => {
          const raw = nodeMap.get(id)!;
          const pos = positions.get(id)!;
          return {
            id,
            type: 'expandable',
            position: pos,
            data: {
              label: raw.data.label,
              color: nodeColors[raw.type] ?? '#6b7280',
              hasChildren: (childMap.get(id)?.length ?? 0) > 0,
              isExpanded: expandedIds.has(id),
              isHighlighted: highlightedIds.has(id),
            } satisfies ExpandableNodeData,
          };
        }),
    [visibleNodeIds, nodeMap, childMap, positions, expandedIds, highlightedIds, nodeColors],
  );

  const edges: Edge[] = useMemo(
    () =>
      data.edges
        .filter((e) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target))
        .map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          animated: false,
          style: { stroke: '#cbd5e1', strokeWidth: 1.5 },
        })),
    [data.edges, visibleNodeIds],
  );

  // ── Initial zoom animation ────────────────────────────────────────────────
  // On first load, show all nodes briefly, then slowly zoom to center subset.
  const animatedForDataKey = useRef('');

  useEffect(() => {
    // Only animate when we're showing root nodes only (nothing expanded)
    if (nodes.length === 0 || nodes.length !== rootIds.length) return;
    const key = `${data.nodes.length}-${data.edges.length}`;
    // Guard is checked but the ref is only written INSIDE the timeout, so that
    // React 18 Strict Mode cleanup → re-run does not permanently skip the animation.
    if (key === animatedForDataKey.current) return;

    // Wait for ReactFlow's initial fitView to settle, then zoom in to show ~10 nodes
    const t = setTimeout(() => {
      // Mark as animated (inside timeout so cleanup→re-run can still reschedule)
      animatedForDataKey.current = key;

      const cw = containerRef.current?.clientWidth ?? 800;
      const ch = containerRef.current?.clientHeight ?? 600;

      // Compute bounding box of all visible nodes so we can find the layout center
      const posArr = [...visibleNodeIds]
        .map((id) => positions.get(id))
        .filter(Boolean) as { x: number; y: number }[];
      if (posArr.length === 0) return;

      const centerX = posArr.reduce((s, p) => s + p.x, 0) / posArr.length;
      const centerY = posArr.reduce((s, p) => s + p.y, 0) / posArr.length;

      // Target: ~10 nodes visible vertically (each node is Y_STEP apart)
      const TARGET_VISIBLE = Math.min(10, nodes.length);
      // Zoom so that exactly TARGET_VISIBLE nodes span the visible container height
      const targetZoom = Math.min(ch / (TARGET_VISIBLE * Y_STEP), 3);

      // Pan so the layout center is at the screen center at the new zoom
      const newX = cw / 2 - centerX * targetZoom;
      const newY = ch / 2 - centerY * targetZoom;
      setViewport({ x: newX, y: newY, zoom: targetZoom }, { duration: 1000 });
    }, 800);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.length, rootIds.length]);

  // ── Off-screen node counts (reactive on viewport changes) ─────────────────
  const offScreen = useMemo(() => {
    if (!containerW || !containerH) return { above: 0, below: 0, left: 0, right: 0 };
    let above = 0, below = 0, left = 0, right = 0;
    for (const id of visibleNodeIds) {
      const pos = positions.get(id);
      if (!pos) continue;
      const sx = pos.x * zoom + tx;
      const sy = pos.y * zoom + ty;
      if (sy + NODE_H < 0) above++;
      else if (sy > containerH) below++;
      else if (sx + NODE_W < 0) left++;
      else if (sx > containerW) right++;
    }
    return { above, below, left, right };
  }, [visibleNodeIds, positions, zoom, tx, ty, containerW, containerH]);

  // ── Ghost node overlay computation ────────────────────────────────────────
  const ghosts = useMemo((): GhostInfo[] => {
    if (!containerW || !containerH) return [];
    const W = containerW;
    const H = containerH;
    const result: GhostInfo[] = [];
    const seenTargets = new Set<string>();
    const sideCounts: Partial<Record<GhostSide, number>> = {};

    for (const edge of data.edges) {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
      if (seenTargets.has(edge.target)) continue;

      const sPos = positions.get(edge.source);
      const tPos = positions.get(edge.target);
      if (!sPos || !tPos) continue;

      // Screen-space centre coordinates
      const sx = sPos.x * zoom + tx + NODE_W / 2;
      const sy = sPos.y * zoom + ty + NODE_H / 2;
      const tsx = tPos.x * zoom + tx + NODE_W / 2;
      const tsY = tPos.y * zoom + ty + NODE_H / 2;

      const srcOn = sx > 0 && sx < W && sy > 0 && sy < H;
      const tgtOn = tsx > 0 && tsx < W && tsY > 0 && tsY < H;
      if (!srcOn || tgtOn) continue;

      const hit = findBoundaryIntersection(sx, sy, tsx, tsY, W, H);
      if (!hit) continue;

      const sideCount = sideCounts[hit.side] ?? 0;
      if (sideCount >= MAX_GHOSTS_PER_SIDE) continue;
      sideCounts[hit.side] = sideCount + 1;
      seenTargets.add(edge.target);

      const n = nodeMap.get(edge.target);
      if (!n) continue;

      const { left, top } = ghostPos(hit.side, hit.x, hit.y, W, H);
      const rawLabel = n.data.label;
      result.push({
        id: edge.target,
        label: rawLabel.length > 18 ? rawLabel.slice(0, 16) + '…' : rawLabel,
        color: nodeColors[n.type] ?? '#6b7280',
        side: hit.side,
        posLeft: left,
        posTop: top,
      });
    }
    return result;
  }, [data.edges, visibleNodeIds, positions, zoom, tx, ty, containerW, containerH, nodeMap, nodeColors]);

  // ── Fit-view effect: search priority > expand-to-focus > default ──────────
  useEffect(() => {
    const t = setTimeout(() => {
      const visibleHighlights = [...highlightedIds].filter((id) => visibleNodeIds.has(id));
      if (visibleHighlights.length > 0) {
        fitView({ nodes: visibleHighlights.map((id) => ({ id })), duration: 500, padding: 0.35, maxZoom: 2 });
      } else if (focusNodeId && expandedIds.has(focusNodeId) && visibleNodeIds.has(focusNodeId)) {
        const subtree = collectSubtreeIds(focusNodeId, expandedIds, visibleNodeIds, childMap);
        fitView({ nodes: subtree.map((id) => ({ id })), duration: 450, padding: 0.25, maxZoom: 1.5 });
      } else {
        // Skip the default full-fit if the custom zoom-in animation has already run
        // (prevents React Query re-fetches from resetting the viewport after animation).
        if (!animatedForDataKey.current) {
          fitView({ duration: 350, padding: 0.12 });
        }
      }
    }, 60);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitViewTrigger]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const d = node.data as ExpandableNodeData;
      if (d.hasChildren) onToggle(node.id);
    },
    [onToggle],
  );

  const navigateToNode = useCallback(
    (id: string) => {
      const nodePos = positions.get(id);
      if (!nodePos) return;
      
      // Directly pan+zoom to the node's position instead of fitView,
      // which avoids React Flow moving the node visually.
      const cw = containerRef.current?.clientWidth ?? 800;
      const ch = containerRef.current?.clientHeight ?? 600;
      const targetZoom = 0.8;
      const cx = nodePos.x;
      const cy = nodePos.y;
      const newX = cw / 2 - cx * targetZoom;
      const newY = ch / 2 - cy * targetZoom;
      setViewport({ x: newX, y: newY, zoom: targetZoom }, { duration: 450 });
    },
    [positions, setViewport],
  );

  const navigateToDirection = useCallback(
    (dir: GhostSide) => {
      const W = containerW;
      const H = containerH;
      if (!W || !H) return;
      const targetIds: string[] = [];
      for (const id of visibleNodeIds) {
        const pos = positions.get(id);
        if (!pos) continue;
        const sx = pos.x * zoom + tx;
        const sy = pos.y * zoom + ty;
        if (dir === 'top' && sy + NODE_H < 0) targetIds.push(id);
        else if (dir === 'bottom' && sy > H) targetIds.push(id);
        else if (dir === 'left' && sx + NODE_W < 0) targetIds.push(id);
        else if (dir === 'right' && sx > W) targetIds.push(id);
      }
      if (targetIds.length > 0) {
        // Compute bounding box of target nodes and pan+zoom to them
        const posArray = targetIds.map(id => positions.get(id)).filter(Boolean) as Array<{ x: number; y: number }>;
        if (posArray.length === 0) return;
        const xs = posArray.map(p => p.x);
        const ys = posArray.map(p => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const targetZoom = 0.8;
        const cw = containerRef.current?.clientWidth ?? 800;
        const ch = containerRef.current?.clientHeight ?? 600;
        const newX = cw / 2 - centerX * targetZoom;
        const newY = ch / 2 - centerY * targetZoom;
        setViewport({ x: newX, y: newY, zoom: targetZoom }, { duration: 450 });
      }
    },
    [visibleNodeIds, positions, zoom, tx, ty, containerW, containerH, setViewport],
  );

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        nodesFocusable={false}
        fitViewOptions={{ padding: 0.15 }}
        proOptions={{ hideAttribution: true }}
        minZoom={0.04}
        maxZoom={3}
      >
        <Background color="#e5e7eb" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {/* Overlay layer — pointer-events off by default so ReactFlow interactions work */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" style={{ zIndex: 10 }}>

        {offScreen.above > 0 && (
          <button
            onClick={() => navigateToDirection('top')}
            className="pointer-events-auto absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-0.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            title="Click to navigate to nodes above"
          >
            ↑ {offScreen.above} above
          </button>
        )}
        {offScreen.below > 0 && (
          <button
            onClick={() => navigateToDirection('bottom')}
            className="pointer-events-auto absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-0.5 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            title="Click to navigate to nodes below"
          >
            ↓ {offScreen.below} below
          </button>
        )}
        {offScreen.left > 0 && (
          <button
            onClick={() => navigateToDirection('left')}
            className="pointer-events-auto absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            style={{ writingMode: 'vertical-rl' }}
            title="Click to navigate to nodes left"
          >
            ← {offScreen.left}
          </button>
        )}
        {offScreen.right > 0 && (
          <button
            onClick={() => navigateToDirection('right')}
            className="pointer-events-auto absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-2 py-1 text-xs font-medium text-white backdrop-blur-sm transition-colors hover:bg-black/75"
            style={{ writingMode: 'vertical-rl' }}
            title="Click to navigate to nodes right"
          >
            → {offScreen.right}
          </button>
        )}

        {ghosts.map((ghost) => (
          <button
            key={ghost.id}
            onClick={() => navigateToNode(ghost.id)}
            title={`Navigate to: ${ghost.label}`}
            style={{
              position: 'absolute',
              left: ghost.posLeft,
              top: ghost.posTop,
              width: GHOST_W,
              height: GHOST_H,
              backgroundColor: ghost.color,
              opacity: 0.82,
              border: '1.5px dashed rgba(255,255,255,0.65)',
              borderRadius: 6,
              padding: '0 8px',
              cursor: 'pointer',
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontWeight: 500,
              color: '#fff',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            }}
            className="transition-opacity hover:opacity-100"
          >
            <span>{SIDE_ARROW[ghost.side]}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{ghost.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Public component ──────────────────────────────────────────────────────────
interface GraphExplorerProps {
  data: GraphData | null;
  nodeColors: Record<string, string>;
  loading: boolean;
  error: string | null;
}

export default function GraphExplorer({
  data,
  nodeColors,
  loading,
  error,
}: GraphExplorerProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fitViewTrigger, setFitViewTrigger] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const { childMap, parentMap, rootIds } = useMemo(() => {
    if (!data) return { childMap: new Map(), parentMap: new Map(), rootIds: [] };

    const childMap = new Map<string, string[]>();
    const parentMap = new Map<string, string[]>();

    for (const edge of data.edges) {
      if (!childMap.has(edge.source)) childMap.set(edge.source, []);
      childMap.get(edge.source)!.push(edge.target);
      if (!parentMap.has(edge.target)) parentMap.set(edge.target, []);
      parentMap.get(edge.target)!.push(edge.source);
    }

    const rootIds = data.nodes
      .filter((n) => !parentMap.has(n.id) || parentMap.get(n.id)!.length === 0)
      .map((n) => n.id);

    return { childMap, parentMap, rootIds };
  }, [data]);

  useEffect(() => {
    setExpandedIds(new Set());
    setFocusNodeId(null);
    setSearch('');
  }, [data]);

  const toggleExpanded = useCallback(
    (id: string) => {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          const remove = (nodeId: string) => {
            next.delete(nodeId);
            for (const childId of childMap.get(nodeId) ?? []) remove(childId);
          };
          remove(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setFocusNodeId(id);
      // Don't trigger fitView when expanding — let the user expand in place.
      // fitViewTrigger is only used for search results and the initial load animation.
    },
    [childMap],
  );

  useEffect(() => {
    const term = search.trim().toLowerCase();
    if (!data || !term) {
      setFitViewTrigger((n) => n + 1);
      return;
    }

    const matches = data.nodes.filter((n) =>
      n.data.label.toLowerCase().includes(term),
    );
    if (matches.length === 0) return;

    setExpandedIds((prev) => {
      const next = new Set(prev);
      const addAncestors = (nodeId: string) => {
        for (const parentId of parentMap.get(nodeId) ?? []) {
          next.add(parentId);
          addAncestors(parentId);
        }
      };
      for (const match of matches) addAncestors(match.id);
      return next;
    });
    setFitViewTrigger((n) => n + 1);
  }, [search, data, parentMap]);

  const highlightedIds = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!data || !term) return new Set<string>();
    return new Set(
      data.nodes.filter((n) => n.data.label.toLowerCase().includes(term)).map((n) => n.id),
    );
  }, [data, search]);

  if (loading) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-md border border-gray-200 bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-md border border-gray-200 bg-white">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex h-[600px] items-center justify-center rounded-md border border-gray-200 bg-white">
        <p className="text-sm text-gray-400">No data available</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search nodes — auto-expands ancestors and centres view"
          className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm text-gray-700 shadow-sm focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-lg leading-none text-gray-400 hover:text-gray-600"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>

      <div className="h-[600px] rounded-md border border-gray-200 bg-white">
        <ReactFlowProvider>
          <GraphCanvas
            data={data}
            nodeColors={nodeColors}
            childMap={childMap}
            rootIds={rootIds}
            expandedIds={expandedIds}
            onToggle={toggleExpanded}
            highlightedIds={highlightedIds}
            fitViewTrigger={fitViewTrigger}
            focusNodeId={focusNodeId}
          />
        </ReactFlowProvider>
      </div>

      <div className="flex items-center gap-3 text-xs text-gray-400">
        <span>
          {rootIds.length} root node{rootIds.length !== 1 ? 's' : ''} · {expandedIds.size} expanded
          · {data.nodes.length} total
        </span>
        {highlightedIds.size > 0 && (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-600 ring-1 ring-amber-200">
            {highlightedIds.size} match{highlightedIds.size !== 1 ? 'es' : ''}
          </span>
        )}
        <span className="ml-auto italic">Click a node with [+] to expand it</span>
      </div>
    </div>
  );
}
