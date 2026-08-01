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
  Controls,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ElkNode } from 'elkjs/lib/elk.bundled.js';
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
  const rfRef = useRef<ReactFlowInstance<Node<LabNodeData>, Edge> | null>(null);
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
              // A ghost edge's label recedes with it — `ink-faint` rather than
              // `ink-muted` — but stays real text at 6.3:1, not a smudge.
              labelStyle: {
                fill: hidden.has(id) ? 'var(--ink-faint)' : 'var(--ink-muted)',
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
              },
              labelBgStyle: { fill: 'var(--surface)', fillOpacity: 0.85 },
              // Direction is part of what a transition MEANS: `0 -a-> 1` is not
              // the same claim as `1 -a-> 0`, and layout order only implies it.
              // The marker paints with `context-stroke`, so the head inherits
              // whatever colour the edge's state gave it — no per-state markers.
              ...(directed ? { markerEnd: `url(#${markerId})` } : {}),
            };
          })
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [layout, structuralHash, edges, currentEdgeIds, visitedIds, hiddenIds, edgeClassName, directed, markerId],
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
