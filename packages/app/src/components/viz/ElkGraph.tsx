/**
 * React Flow wrapper laid out ONCE by elkjs (layered algorithm, async,
 * memoized by structural hash). Highlight props re-style nodes/edges but NEVER
 * re-run layout — emphasis only, per the PLAN.md layout-stability rule.
 *
 * What IS structural (re-runs ELK): the node/edge sets, their ids, labels,
 * kinds, resolved box sizes (nodes AND edge labels) and the direction.
 * What is NOT (re-styles only): `currentNodeIds`, `currentEdgeIds`,
 * `visitedIds`, `hiddenIds`, `nodeClassName`, `edgeClassName`, `reactNode`.
 *
 * HEIGHT. The inner ReactFlow is `height: 100%`, which resolves against the
 * wrapper's COMPUTED height — a `min-h-*` utility leaves that `auto`, so the
 * percentage collapses and the graph renders 0px tall. The `height` prop is
 * therefore applied as an inline style and always definite; pass a number (px)
 * or any CSS length. Do not size an ElkGraph with an `h-*`/`min-h-*` class.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ReactFlow,
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  Position,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ElkEdgeSection, ElkNode, ElkPoint } from 'elkjs/lib/elk.bundled.js';
import { clsx } from 'clsx';
import { useFullscreen } from '../../lib/useFullscreen';
import { FullscreenChrome } from './FullscreenChrome';
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
  /**
   * Short text drawn on the edge. ELK reserves a box for it, so it is a LAYOUT
   * input: it is hashed, and anything longer than `EDGE_LABEL_MAX_CHARS` is
   * clipped to that (the untruncated string stays reachable through `title`).
   */
  label?: string;
  /** Full text behind the clipped label, shown as the chip's native tooltip. */
  title?: string;
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
  /**
   * Draw an arrowhead at each edge's target. True for anything whose edges mean
   * "goes to": automata transitions, GOTO edges, CFG flow, AST/parse links.
   * Set FALSE for a genuinely undirected graph — the interference graph, where
   * "a interferes with b" is symmetric and an arrow would assert a direction
   * the data does not have.
   */
  directed?: boolean;
  direction?: 'RIGHT' | 'DOWN';
  /** Definite height for the canvas (see the note at the top). */
  height?: number | string;
  /**
   * Rendered as a bar along the bottom ONLY in fullscreen. Fullscreen hides the
   * trace panel, so pass the phase's step controls here to keep the diagram
   * steppable while it fills the screen.
   */
  controls?: ReactNode;
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

/*
 * EDGE LABELS.
 *
 * The label is a real box in the layout, not an afterthought painted at the
 * midpoint of whatever curve React Flow drew. ELK's layered algorithm turns a
 * centred edge label into a LABEL DUMMY NODE, so a labelled edge is routed
 * through a layer that is as wide as the widest label in it — which is the only
 * way a ten-way fan-out with `a, e, f, i, n +3` on every branch can be read at
 * all. Before this, ELK was told nothing, reserved nothing, and React Flow put
 * each label at its path midpoint: on the combined scanner DFA that midpoint
 * was INSIDE the target state's box, so both the label and the state name were
 * illegible.
 *
 * Two consequences worth knowing:
 *  • label text and box are LAYOUT INPUTS, so they belong to the structural
 *    hash — a graph whose labels change is a graph that must be laid out again;
 *  • the chip is rendered at ELK's own label coordinates through
 *    `<EdgeLabelRenderer>`, never as React Flow's `label` prop, or it would be
 *    drawn twice and one of the two would be in the wrong place.
 */

/** Measured: the app's mono stack is 6.6px per character at 11px, exactly. */
const EDGE_LABEL_CHAR_W = 6.6;
/** `padding: 1px 6px` + the chip's two hairlines. */
const EDGE_LABEL_PAD_X = 14;
/** 11px × 1.3 line box + vertical padding + hairlines. */
const EDGE_LABEL_HEIGHT = 19;

/**
 * Hard ceiling on a drawn edge label. A transition label is a hint, not a
 * table: past this the chip is wider than the states it sits between and the
 * layer reserved for it dwarfs the automaton. Callers with a domain-aware
 * summary (lex condenses character sets to ranges and a `+N` count) should
 * arrive already under it; this is the floor guarantee for everyone else.
 */
export const EDGE_LABEL_MAX_CHARS = 24;

/** Deterministic — it feeds the layout hash. */
export function clipEdgeLabel(text: string): string {
  const chars = [...text];
  return chars.length <= EDGE_LABEL_MAX_CHARS
    ? text
    : `${chars.slice(0, EDGE_LABEL_MAX_CHARS - 1).join('')}…`;
}

/** Box ELK must reserve for a drawn label. Deterministic, like `estimateNodeSize`. */
export function estimateEdgeLabelSize(text: string): ElkGraphSize {
  return {
    width: Math.ceil([...text].length * EDGE_LABEL_CHAR_W) + EDGE_LABEL_PAD_X,
    height: EDGE_LABEL_HEIGHT,
  };
}

/**
 * ELK's own route for one edge, as an SVG path.
 *
 * The edge has to be DRAWN where ELK routed it, not as React Flow's default
 * handle-to-handle bezier, and the reason is the labels. ELK places a label on
 * the route it computed; React Flow's bezier is a different curve entirely —
 * on the LR(0) GOTO graph the two diverged by a third of the canvas and every
 * label ended up floating in blank space, attributable to no edge at all. Two
 * things come free with it: routes bend AROUND node boxes instead of through
 * them, and a self-loop is a real loop instead of a degenerate zero-length
 * bezier between one node's two handles.
 *
 * `elk.edgeRouting: SPLINES` returns a control polygon: the start point, then
 * groups of three (two off-curve controls and the on-curve point they land on).
 * A trailing pair or single point — ELK emits them for very short routes —
 * degrades to a quadratic or a straight segment.
 */
function elkRoutePath(section: ElkEdgeSection): string {
  const pts: ElkPoint[] = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
  const at = (p: ElkPoint) => `${p.x},${p.y}`;
  let d = `M ${at(pts[0]!)}`;
  let i = 1;
  while (i < pts.length) {
    const left = pts.length - i;
    if (left >= 3) {
      d += ` C ${at(pts[i]!)} ${at(pts[i + 1]!)} ${at(pts[i + 2]!)}`;
      i += 3;
    } else if (left === 2) {
      d += ` Q ${at(pts[i]!)} ${at(pts[i + 1]!)}`;
      i += 2;
    } else {
      d += ` L ${at(pts[i]!)}`;
      i += 1;
    }
  }
  return d;
}

interface LabEdgeData extends Record<string, unknown> {
  label?: string;
  /** Untruncated text, when the chip is showing less than the whole of it. */
  title?: string;
  /** ELK's route. Absent → fall back to React Flow's handle-to-handle bezier. */
  path?: string;
  /** ELK's own label centre, in flow coordinates. */
  labelX?: number;
  labelY?: number;
  labelClass?: string;
}

/**
 * ELK's route plus a label chip placed where ELK put it.
 *
 * `<EdgeLabelRenderer>` portals into a layer INSIDE React Flow's viewport
 * transform, so a flow-coordinate `translate` lands the chip in the gap the
 * layout reserved and it pans and zooms with the graph. The chip is opaque and
 * ruled: an edge running under it reads as passing behind a label rather than
 * through the middle of the text.
 */
function LabEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<Edge<LabEdgeData>>) {
  const [bezier, midX, midY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const label = data?.label;
  return (
    <>
      <BaseEdge id={id} path={data?.path ?? bezier} markerEnd={markerEnd} />
      {label !== undefined && label !== '' && (
        <EdgeLabelRenderer>
          <div
            // The chip is portalled away from its edge's <g>, so it carries the
            // edge id back — the only handle anything (a test, a hover) has to
            // pair a label with the line it names.
            data-edge={id}
            className={clsx('elk-edge-label', data?.title && 'is-clipped', data?.labelClass)}
            title={data?.title}
            style={{
              transform: `translate(-50%, -50%) translate(${data?.labelX ?? midX}px, ${
                data?.labelY ?? midY
              }px)`,
            }}
          >
            {label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const edgeTypes = { lab: LabEdge };

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
  directed = true,
  direction = 'RIGHT',
  height = DEFAULT_HEIGHT,
  controls,
  className,
}: ElkGraphProps) {
  const { theme } = useTheme();
  const fs = useFullscreen();
  // Per-instance so several graphs on one page never share a <marker> id.
  const markerId = `elk-arrow-${useId().replace(/:/g, '')}`;

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

  // Drawn label text + the box ELK must keep free for it. Both are layout
  // inputs, so they are resolved once here and hashed with the topology.
  const labels = useMemo(() => {
    const out = new Map<string, { text: string; title?: string } & ElkGraphSize>();
    for (const e of edges) {
      if (e.label === undefined || e.label === '') continue;
      const text = clipEdgeLabel(e.label);
      const full = e.title ?? e.label;
      out.set(elkEdgeId(e), {
        text,
        ...(full === text ? {} : { title: full }),
        ...estimateEdgeLabelSize(text),
      });
    }
    return out;
  }, [edges]);

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
          edges.map((e) => {
            const id = elkEdgeId(e);
            const l = labels.get(id);
            return [id, e.source, e.target, l?.text ?? '', l?.width ?? 0, l?.height ?? 0];
          }),
        ]),
      ),
    [nodes, edges, direction, sizes, labels],
  );

  const [layout, setLayout] = useState<{
    hash: string;
    positions: ReadonlyMap<string, { x: number; y: number }>;
    /** ELK's route per edge, as an SVG path in flow coordinates. */
    routes: ReadonlyMap<string, string>;
    /** Where ELK put each edge's label, centre-point, in flow coordinates. */
    labelPositions: ReadonlyMap<string, { x: number; y: number }>;
  } | null>(null);

  // Keep latest props in refs so the async layout reads current data without
  // being re-triggered by highlight-only changes.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const sizesRef = useRef(sizes);
  sizesRef.current = sizes;
  const labelsRef = useRef(labels);
  labelsRef.current = labels;

  useEffect(() => {
    let cancelled = false;
    const graphNodes = nodesRef.current;
    const graphEdges = edgesRef.current;
    const graphSizes = sizesRef.current;
    const graphLabels = labelsRef.current;
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': direction,
        /*
         * Halved once labels are in play, because the gap is then paid TWICE:
         * a labelled edge is routed through a label layer, so two adjacent
         * states are separated by gap + chip + gap rather than by gap. Left at
         * 48 the LR(0) GOTO graph grew 40% wider and fitView answered by
         * shrinking every state name past reading; the label layer is itself
         * the separation, so 24 either side restores the old total.
         */
        'elk.layered.spacing.nodeNodeBetweenLayers': graphLabels.size > 0 ? '24' : '48',
        'elk.spacing.nodeNode': '24',
        'elk.edgeRouting': 'SPLINES',
        /*
         * Edge labels. CENTER placement is the whole mechanism — it is what
         * makes layered insert a label dummy NODE per labelled edge, so the
         * chips inherit `spacing.nodeNode` from each other and the layer they
         * sit in is as wide as the widest of them. (It is also ELK's default;
         * it is written out because everything here depends on it.) The
         * spacing then lifts the chip clear of the line it names — measured,
         * 6 puts the route exactly along the chip's rule, which reads as
         * attached without any of the text sitting under the stroke.
         */
        'elk.edgeLabels.placement': 'CENTER',
        'elk.spacing.edgeLabel': '6',
      },
      children: graphNodes.map((n) => {
        const s = graphSizes.get(n.id) ?? estimateNodeSize(n);
        return { id: n.id, width: s.width, height: s.height };
      }),
      edges: graphEdges.map((e) => {
        const id = elkEdgeId(e);
        const l = graphLabels.get(id);
        return {
          id,
          sources: [e.source],
          targets: [e.target],
          ...(l ? { labels: [{ text: l.text, width: l.width, height: l.height }] } : {}),
        };
      }),
    };
    getElk()
      .then((elk) => elk.layout(graph))
      .then((res) => {
        if (cancelled) return;
        const positions = new Map<string, { x: number; y: number }>();
        for (const child of res.children ?? []) {
          positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
        }
        // Routes and label coordinates come back in the same frame as the
        // children (all relative to `root`), so they are already flow
        // coordinates. Labels address their TOP-LEFT; the chip is centred on
        // its point, so convert here rather than at render time.
        const routes = new Map<string, string>();
        const labelPositions = new Map<string, { x: number; y: number }>();
        for (const edge of res.edges ?? []) {
          const section = edge.sections?.[0];
          if (section) routes.set(edge.id, elkRoutePath(section));
          const label = edge.labels?.[0];
          if (!label || label.x === undefined || label.y === undefined) continue;
          labelPositions.set(edge.id, {
            x: label.x + (label.width ?? 0) / 2,
            y: label.y + (label.height ?? 0) / 2,
          });
        }
        setLayout({ hash: structuralHash, positions, routes, labelPositions });
      })
      .catch(() => {
        /* layout failure: keep previous layout rather than crash the view */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structuralHash, direction]);

  /*
   * Refit the VIEWPORT when the canvas changes size — going fullscreen and
   * coming back. Without it the whole point of fullscreen is lost: the graph
   * keeps the pan/zoom it was given for a 22rem panel and sits in the top-left
   * corner of the screen with three-quarters of it empty.
   *
   * This does NOT re-run layout (PLAN.md layout-stability): ELK's node
   * positions are untouched, only React Flow's pan/zoom transform moves, so
   * nothing shifts relative to anything else.
   *
   * Two frames, not one: React Flow learns its new size from a ResizeObserver,
   * and resize observations are delivered AFTER requestAnimationFrame callbacks
   * in the same frame, so a single rAF would fit against the old dimensions.
   */
  const rfRef = useRef<ReactFlowInstance<Node<LabNodeData>, Edge<LabEdgeData>> | null>(null);
  useEffect(() => {
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        rfRef.current?.fitView({ padding: 0.15, maxZoom: 1.25 });
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [fs.isFullscreen]);

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

  const rfEdges = useMemo<Edge<LabEdgeData>[]>(
    () =>
      layout && layout.hash === structuralHash
        ? edges.map((e) => {
            const id = elkEdgeId(e);
            const isCurrent = currentE.has(id);
            const isVisited = !isCurrent && visited.has(id);
            const isHidden = hidden.has(id);
            const label = labels.get(id);
            const at = layout.labelPositions.get(id);
            return {
              id,
              source: e.source,
              target: e.target,
              // `type: 'lab'` — the same bezier as `default`, plus a label chip
              // at ELK's coordinates. No `label` prop: React Flow would draw a
              // SECOND copy at the curve's midpoint, i.e. back inside a box.
              type: 'lab' as const,
              className: clsx(
                isCurrent && 'elk-edge-current',
                isVisited && 'elk-edge-visited',
                isHidden && 'elk-edge-hidden',
                edgeClassName?.(e, id),
              ),
              data: {
                label: label?.text,
                title: label?.title,
                path: layout.routes.get(id),
                ...(at ? { labelX: at.x, labelY: at.y } : {}),
                // The chip is portalled out of the edge's <g>, so no selector on
                // the edge can reach it: emphasis has to travel in `data`.
                // A ghost's chip recedes to `ink-faint` (6.3:1) — still text.
                labelClass: clsx(
                  isCurrent && 'is-current',
                  isVisited && 'is-visited',
                  isHidden && 'is-hidden',
                ),
              },
              // Direction is part of what a transition MEANS: `0 -a-> 1` is not
              // the same claim as `1 -a-> 0`, and layout order only implies it.
              // The marker paints with `context-stroke`, so the head inherits
              // whatever colour the edge's state gave it — no per-state markers.
              // The BARE id: React Flow wraps a string markerEnd in `url(#…)`
              // itself, so passing `url(#id)` here yields the double-wrapped
              // `url('#url(#id)')` — an invalid reference that paints nothing.
              ...(directed ? { markerEnd: markerId } : {}),
            };
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      layout,
      structuralHash,
      edges,
      labels,
      currentEdgeIds,
      visitedIds,
      hiddenIds,
      edgeClassName,
      directed,
      markerId,
    ],
  );

  return (
    <div
      ref={fs.ref}
      // A graph is a contained artifact, so it earns the one border `.framed`
      // grants: the sheet it is drawn on, edged with a hairline.
      className={clsx(
        'framed relative overflow-hidden',
        // Column in fullscreen so the transport bar takes real space off the
        // canvas instead of floating over its bottom-right zoom cluster.
        fs.isFullscreen && 'flex flex-col',
        className,
      )}
      // Fullscreen needs a real backdrop (the API paints black otherwise) and
      // must fill the screen rather than keep its inline height.
      style={fs.isFullscreen ? { height: '100%', background: 'var(--surface)' } : { height }}
    >
      {(!layout || layout.hash !== structuralHash) && (
        <div className="prose-note absolute inset-0 z-10 flex items-center justify-center text-ink-faint">
          Laying out graph…
        </div>
      )}
      {layout && layout.hash === structuralHash && (
        <ReactFlow
        key={structuralHash /* remount → fitView re-applies on structure change */}
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={theme}
        onInit={(inst) => {
          rfRef.current = inst;
        }}
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.25 }}
        minZoom={0.1}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        proOptions={{ hideAttribution: true }}
        // `!h-auto` in fullscreen: xyflow's own stylesheet pins the root to
        // `height: 100%`, which in a flex column would resolve against the whole
        // screen and slide the canvas under the transport bar. Auto hands the
        // height to the flex algorithm, which already subtracted the bar.
        className={clsx('!bg-transparent', fs.isFullscreen && 'min-h-0 flex-1 !h-auto')}
        /*
         * Retone the UNHIGHLIGHTED edge. xyflow ships
         * `--xy-edge-stroke-default: #b1b1b7`, and under `.react-flow.dark` —
         * which `colorMode` switches on — `#3e3e3e`. Measured on our sheet that
         * is 1.65:1 in dark and 2.10:1 in light, so every transition the step
         * had not touched was simply not on the screen: the single biggest
         * reason a hundred-state NFA read as an unusable smudge. `--control` is
         * 3.95:1 dark / 4.09:1 light, and arrow markers read the same variable.
         *
         * Inline, not in a stylesheet: xyflow's rule is unlayered, so nothing
         * layered can reach it and an unlayered rule of ours would be fighting
         * on bundler-dependent source order. An inline custom property always
         * wins and inherits to every edge.
         */
        style={
          {
            '--xy-edge-stroke-default': 'var(--control)',
            '--xy-edge-stroke-width-default': '1.25',
            '--xy-edge-stroke-selected-default': 'var(--ink-faint)',
            /*
             * `!bg-transparent` above only clears the `.react-flow` ROOT.
             * `<Background/>` renders its own full-size <svg> whose
             * `background-color` resolves to `--xy-background-color-default`,
             * which `.react-flow.dark` sets to a flat `#141414` — measured, the
             * graph canvas was painting #141414 while the sheet around it was
             * `--surface` #151920 and the page was `--canvas` #0f1216. So the
             * graph box was the DARKEST thing on the page and a different,
             * neutral black from everything else: an automaton drawn in a hole.
             * In fullscreen it was worse — the wrapper's `background: surface`
             * was covered by #141414 and only the transport bar kept it, so the
             * bottom of the screen visibly stepped in tone. Transparent lets the
             * `.framed` sheet through, which is what every other artifact in the
             * app is drawn on.
             */
            '--xy-background-color': 'transparent',
          } as CSSProperties
        }
        >
          {/* The dot grid is spatial reference while panning, so it is the one
              mark here held BELOW the 3:1 contract on purpose. `--line` measures
              1.27:1 on the sheet in dark — it simply does not render, and the
              canvas loses its horizon; `--line-strong` (2.34:1) is visible and
              still quiet enough to sit behind a hundred-state NFA. */}
          {/*
           * Arrowhead for directed edges. `fill="context-stroke"` makes the head
           * take the colour of the edge it terminates, so current / visited /
           * ghost edges each get a matching head without four marker variants.
           * `markerUnits="strokeWidth"` scales it with the edge, which keeps the
           * emphasised current edge's head proportionate.
           */}
          {directed && (
            <svg aria-hidden width="0" height="0" className="absolute">
              <defs>
                <marker
                  id={markerId}
                  viewBox="0 0 10 10"
                  refX="9.5"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  markerUnits="strokeWidth"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1.5 L 9.5 5 L 0 8.5 z" fill="context-stroke" />
                </marker>
              </defs>
            </svg>
          )}
          <Background gap={20} size={1} color="var(--line-strong)" />
          <Controls showInteractive={false} position="bottom-right" />
        </ReactFlow>
      )}
      {/* Last child: the bar is in normal flow, so it must come after the
          canvas it sits under. The toggle inside is absolute and unaffected. */}
      <FullscreenChrome fs={fs} label="diagram" controls={controls} />
    </div>
  );
}
