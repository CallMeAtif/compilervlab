/**
 * React Flow wrapper laid out ONCE by elkjs (layered algorithm, async,
 * memoized by structural hash). Highlight props re-style nodes/edges but NEVER
 * re-run layout — emphasis only, per the PLAN.md layout-stability rule.
 *
 * What IS structural (re-runs ELK): the node/edge sets, their ids, labels,
 * kinds, resolved box sizes and the direction.
 * What is NOT (re-styles only): `currentNodeIds`, `currentEdgeIds`,
 * `visitedIds`, `hiddenIds`, `nodeClassName`, `edgeClassName`, `reactNode`.
 *
 * HEIGHT. The inner ReactFlow is `height: 100%`, which resolves against the
 * wrapper's COMPUTED height — a `min-h-*` utility leaves that `auto`, so the
 * percentage collapses and the graph renders 0px tall. The `height` prop is
 * therefore applied as an inline style and always definite; pass a number (px)
 * or any CSS length. Do not size an ElkGraph with an `h-*`/`min-h-*` class.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
import { clsx } from 'clsx';
import { fnv1a } from '../../lib/hash';
import { useTheme } from '../../lib/theme';

export interface ElkGraphSize {
  width: number;
  height: number;
}

export interface ElkGraphNode {
  id: string;
  label?: string;
  reactNode?: ReactNode;
  /** Free-form kind ("state", "accept", "block", …) exposed as a data-kind
   *  attribute so phase CSS can add shape signifiers (e.g. double rings). */
  kind?: string;
  /**
   * Declared box, in px. Give both to hold multi-line content (an LR item set,
   * a basic block of TAC, a degree badge): the declared box is what ELK reserves
   * AND what the rendered node fills, so edges route to the real outline.
   * Omit to keep the label-width estimate and the default 34px row height.
   */
  width?: number;
  height?: number;
}

export interface ElkGraphEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
}

export interface ElkGraphProps {
  nodes: ElkGraphNode[];
  edges: ElkGraphEdge[];
  /** Emphasis-only highlights (no layout impact). */
  currentNodeIds?: ReadonlySet<string> | readonly string[];
  currentEdgeIds?: ReadonlySet<string> | readonly string[];
  visitedIds?: ReadonlySet<string> | readonly string[];
  /**
   * Progressive reveal: node/edge ids the trace has not built yet. They keep
   * their laid-out position (so nothing moves when they appear) and are dimmed
   * via `.elk-node.is-hidden` / `.react-flow__edge.elk-edge-hidden`.
   */
  hiddenIds?: ReadonlySet<string> | readonly string[];
  /**
   * Per-element styling hooks — e.g. mark back edges, or a phase's own
   * "not derived yet" pattern. Excluded from the layout hash, so returning a
   * different class per step is free.
   */
  nodeClassName?: (node: ElkGraphNode) => string | undefined;
  edgeClassName?: (edge: ElkGraphEdge, id: string) => string | undefined;
  /**
   * Box for a node when it does not declare one. Must be deterministic: its
   * result is part of the layout hash.
   */
  measure?: (node: ElkGraphNode) => ElkGraphSize;
  direction?: 'RIGHT' | 'DOWN';
  /** Definite height for the canvas (see the note at the top). */
  height?: number | string;
  className?: string;
}

export function elkEdgeId(e: ElkGraphEdge): string {
  return e.id ?? `${e.source}->${e.target}`;
}

function toSet(v?: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  if (!v) return EMPTY_SET;
  return v instanceof Set ? v : new Set(v);
}
const EMPTY_SET: ReadonlySet<string> = new Set();

/**
 * Complement helper for progressive reveal: every node/edge id that appears in
 * NONE of the `revealed` sets. Lets a view that tracks what it has built so far
 * hand ElkGraph what it has NOT built, without each route re-deriving it.
 */
export function elkHiddenIds(
  nodes: readonly ElkGraphNode[],
  edges: readonly ElkGraphEdge[],
  ...revealed: ReadonlyArray<ReadonlySet<string> | readonly string[] | undefined>
): Set<string> {
  const shown = new Set<string>();
  for (const group of revealed) {
    if (!group) continue;
    for (const id of group) shown.add(id);
  }
  const hidden = new Set<string>();
  for (const n of nodes) if (!shown.has(n.id)) hidden.add(n.id);
  for (const e of edges) {
    const id = elkEdgeId(e);
    if (!shown.has(id)) hidden.add(id);
  }
  return hidden;
}

/** Sane default: tall enough for a labelled automaton, short enough to scroll past. */
const DEFAULT_HEIGHT = '22rem';

type ResolvedSize = ElkGraphSize & { declared: boolean };

/**
 * elkjs is ~1.5 MB minified — larger than the rest of the app put together —
 * and layout is already asynchronous, so the engine is imported on demand
 * instead of with this module. The first graph to lay out pays the fetch; the
 * instance is then shared by every graph in the session. Nothing about the
 * render changes: a graph shows nothing until its layout promise resolves,
 * exactly as before.
 */
let elkInstance: Promise<{ layout: (graph: ElkNode) => Promise<ElkNode> }> | null = null;

function getElk(): Promise<{ layout: (graph: ElkNode) => Promise<ElkNode> }> {
  elkInstance ??= import('elkjs/lib/elk.bundled.js').then((mod) => new mod.default());
  return elkInstance;
}

interface LabNodeData extends Record<string, unknown> {
  content: ReactNode;
  kind: string | undefined;
  isCurrent: boolean;
  isVisited: boolean;
  isHidden: boolean;
  /** The caller declared the box, so the node fills it (see .elk-node.is-sized). */
  isSized: boolean;
  extraClass: string | undefined;
  horizontal: boolean;
}

function LabNode({ data }: NodeProps<Node<LabNodeData>>) {
  return (
    <div
      data-kind={data.kind}
      data-hidden={data.isHidden ? 'true' : undefined}
      data-current={data.isCurrent ? 'true' : undefined}
      data-visited={data.isVisited ? 'true' : undefined}
      className={clsx(
        'elk-node',
        data.isSized && 'is-sized',
        data.isVisited && 'is-visited',
        data.isCurrent && 'is-current',
        data.isHidden && 'is-hidden',
        data.extraClass,
      )}
    >
      <Handle
        type="target"
        position={data.horizontal ? Position.Left : Position.Top}
        className="!pointer-events-none !size-1.5 !border-0 !bg-transparent"
      />
      {data.content}
      <Handle
        type="source"
        position={data.horizontal ? Position.Right : Position.Bottom}
        className="!pointer-events-none !size-1.5 !border-0 !bg-transparent"
      />
    </div>
  );
}

const nodeTypes = { lab: LabNode };

/** Estimate node box from its label (layout runs before DOM measurement). */
export function estimateNodeSize(n: ElkGraphNode): ElkGraphSize {
  const len = n.label?.length ?? 8;
  return { width: Math.max(56, Math.min(260, len * 7.5 + 28)), height: 34 };
}

export function ElkGraph({
  nodes,
  edges,
  currentNodeIds,
  currentEdgeIds,
  visitedIds,
  hiddenIds,
  nodeClassName,
  edgeClassName,
  measure,
  direction = 'RIGHT',
  height = DEFAULT_HEIGHT,
  className,
}: ElkGraphProps) {
  const { theme } = useTheme();

  // Resolved boxes: declared > `measure` > label estimate. These ARE layout
  // inputs, so they are hashed with the topology below.
  const sizes = useMemo(() => {
    const out = new Map<string, ResolvedSize>();
    for (const n of nodes) {
      const declared = n.width !== undefined || n.height !== undefined || measure !== undefined;
      const fallback = measure?.(n) ?? estimateNodeSize(n);
      out.set(n.id, {
        width: n.width ?? fallback.width,
        height: n.height ?? fallback.height,
        declared,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, measure]);

  const sizeOf = (n: ElkGraphNode): ResolvedSize =>
    sizes.get(n.id) ?? { ...estimateNodeSize(n), declared: false };

  // Structural hash: layout re-runs ONLY when topology/labels/boxes change.
  const structuralHash = useMemo(
    () =>
      fnv1a(
        JSON.stringify([
          direction,
          nodes.map((n) => {
            const s = sizeOf(n);
            return [n.id, n.label ?? '', n.kind ?? '', s.width, s.height];
          }),
          edges.map((e) => [elkEdgeId(e), e.source, e.target, e.label ?? '']),
        ]),
      ),
    [nodes, edges, direction, sizes],
  );

  const [layout, setLayout] = useState<{
    hash: string;
    positions: ReadonlyMap<string, { x: number; y: number }>;
  } | null>(null);

  // Keep latest props in refs so the async layout reads current data without
  // being re-triggered by highlight-only changes.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;

  useEffect(() => {
    let cancelled = false;
    const graphNodes = nodesRef.current;
    const graphEdges = edgesRef.current;
    const graphSizes = sizesRef.current;
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        'elk.layered.spacing.nodeNodeBetweenLayers': '48',
        'elk.spacing.nodeNode': '24',
        'elk.edgeRouting': 'SPLINES',
      },
      children: graphNodes.map((n) => {
        const s = graphSizes.get(n.id) ?? estimateNodeSize(n);
        return { id: n.id, width: s.width, height: s.height };
      }),
      edges: graphEdges.map((e) => ({
        id: elkEdgeId(e),
        sources: [e.source],
        targets: [e.target],
      })),
    };
    getElk()
      .then((elk) => elk.layout(graph))
      .then((res) => {
        if (cancelled) return;
        const positions = new Map<string, { x: number; y: number }>();
        for (const child of res.children ?? []) {
          positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
        }
        setLayout({ hash: structuralHash, positions });
      })
      .catch(() => {
        /* layout failure: keep previous layout rather than crash the view */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralHash, direction]);

  const currentN = toSet(currentNodeIds);
  const currentE = toSet(currentEdgeIds);
  const visited = toSet(visitedIds);
  const hidden = toSet(hiddenIds);
  const horizontal = direction === 'RIGHT';

  const rfNodes = useMemo<Node<LabNodeData>[]>(() => {
    if (!layout || layout.hash !== structuralHash) return [];
    return nodes
      .filter((n) => layout.positions.has(n.id))
      .map((n) => {
        const size = sizeOf(n);
        return {
          id: n.id,
          type: 'lab' as const,
          position: layout.positions.get(n.id)!,
          data: {
            content: n.reactNode ?? n.label ?? n.id,
            kind: n.kind,
            isCurrent: currentN.has(n.id),
            isVisited: visited.has(n.id),
            isHidden: hidden.has(n.id),
            isSized: size.declared,
            extraClass: nodeClassName?.(n),
            horizontal,
          },
          draggable: false,
          connectable: false,
          width: size.width,
          height: size.height,
        };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    layout,
    structuralHash,
    nodes,
    sizes,
    currentNodeIds,
    visitedIds,
    hiddenIds,
    nodeClassName,
    horizontal,
  ]);

  const rfEdges = useMemo<Edge[]>(
    () =>
      layout && layout.hash === structuralHash
        ? edges.map((e) => {
            const id = elkEdgeId(e);
            return {
              id,
              source: e.source,
              target: e.target,
              label: e.label,
              type: 'default',
              className: clsx(
                currentE.has(id) && 'elk-edge-current',
                !currentE.has(id) && visited.has(id) && 'elk-edge-visited',
                hidden.has(id) && 'elk-edge-hidden',
                edgeClassName?.(e, id),
              ),
              labelStyle: { fill: 'var(--ink-muted)', fontSize: 11, fontFamily: 'var(--font-mono)' },
              labelBgStyle: { fill: 'var(--surface)', fillOpacity: 0.85 },
            };
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, structuralHash, edges, currentEdgeIds, visitedIds, hiddenIds, edgeClassName],
  );

  return (
    <div
      className={clsx(
        'relative overflow-hidden rounded-lg border border-line bg-surface',
        className,
      )}
      style={{ height }}
    >
      {(!layout || layout.hash !== structuralHash) && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-ink-faint">
          Laying out graph…
        </div>
      )}
      {layout && layout.hash === structuralHash && (
        <ReactFlow
        key={structuralHash /* remount → fitView re-applies on structure change */}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        colorMode={theme}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.25 }}
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        className="!bg-transparent"
        >
          <Background gap={20} size={1} color="var(--line)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      )}
    </div>
  );
}
