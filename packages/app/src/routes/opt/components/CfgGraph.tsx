/**
 * The flow graph: one ELK-laid-out node per basic block, containing that
 * block's three-address instructions; ENTRY/EXIT are rendered as pseudo-nodes.
 *
 * Layout stability: the node/edge structure and every node LABEL (what ELK
 * measures and what ElkGraph hashes) are fixed for the lifetime of a view.
 * Stepping only changes `currentBlocks` / `visitedBlocks` / `currentEdges`,
 * which are emphasis-only props, and the React content inside a node — never
 * the graph structure, so ELK runs once.
 */
import { useMemo } from 'react';
import { clsx } from 'clsx';
import { CornerDownRight, LogIn, LogOut } from 'lucide-react';
import {
  ElkGraph,
  type ElkGraphEdge,
  type ElkGraphNode,
} from '../../../components/viz/ElkGraph';
import { ENTRY_ID, blockName, edgeKey } from '../lib/optModel';
import type { CfgBlockView } from '../lib/cfgModel';

/** Instruction lines shown inside a node; the rest are summarized. */
const MAX_LINES = 4;

/* Box geometry. ElkGraph's default estimate is one 34px line sized from the
 * label, which a basic block full of TAC overflows — so this view DECLARES the
 * box it needs and ELK reserves exactly that, routing edges around the real
 * outline instead of a 34px stub. Everything here is derived from data that is
 * fixed for the life of the view (block ids + their lines), never from the
 * cursor, so the layout hash is stable and ELK still runs once. */
const V_PAD = 14; // py-1.5 + the node's 1px borders
const HEADER_H = 21; // 11px block name + its rule and margins
const LINE_H = 12; // text-[10px] leading-[12px]
const H_PAD = 26; // px-3 + borders
const GUTTER = 22; // the w-4 instruction-index column + gap-1
const CHAR_W = 6.15; // 10px monospace
const BADGE_ROOM = 78; // per-step badges must not resize the box

function blockBox(block: CfgBlockView): { width: number; height: number } {
  const name = blockName(block.id);
  if (block.pseudo) {
    // A single tracking-widest uppercase label next to a 14px icon.
    return { width: Math.round(Math.max(92, name.length * 9 + 46)), height: 34 };
  }
  const shown = block.lines.slice(0, MAX_LINES);
  const rows = Math.max(1, shown.length + (block.lines.length > shown.length ? 1 : 0));
  let widest = name.length * 7 + BADGE_ROOM;
  for (const line of shown) {
    widest = Math.max(widest, GUTTER + `${line.index} ${line.text}`.length * CHAR_W);
  }
  return {
    width: Math.round(Math.min(340, Math.max(140, widest + H_PAD))),
    height: V_PAD + HEADER_H + rows * LINE_H,
  };
}

export interface CfgGraphEdgeView {
  from: number;
  to: number;
  /** Marked with an explicit "back edge" label — never colour alone. */
  back?: boolean;
}

export interface CfgGraphProps {
  blocks: readonly CfgBlockView[];
  edges: readonly CfgGraphEdgeView[];
  currentBlocks?: readonly number[];
  visitedBlocks?: readonly number[];
  currentEdges?: readonly string[];
  visitedEdges?: readonly string[];
  /** Static text badges per block id ("loop header", "in loop B3", …). */
  badges?: Readonly<Record<number, readonly string[]>>;
  /** Quad indices to mark inside their block (e.g. loop-invariant statements). */
  markedQuads?: ReadonlySet<number>;
  /** Definite height for the graph canvas (ElkGraph needs one — see its docs). */
  graphHeight?: number | string;
  className?: string;
  ariaLabel?: string;
}

function nodeLabel(block: CfgBlockView): string {
  if (block.pseudo) return blockName(block.id);
  const shown = block.lines.slice(0, MAX_LINES);
  let longest = blockName(block.id);
  for (const line of shown) {
    const text = `${line.index} ${line.text}`;
    if (text.length > longest.length) longest = text;
  }
  return longest;
}

export function CfgGraph({
  blocks,
  edges,
  currentBlocks,
  visitedBlocks,
  currentEdges,
  visitedEdges,
  badges,
  markedQuads,
  graphHeight = '24rem',
  className,
  ariaLabel = 'Control-flow graph',
}: CfgGraphProps) {
  const current = useMemo(() => new Set((currentBlocks ?? []).map((id) => `n${id}`)), [currentBlocks]);
  const visited = useMemo(
    () => new Set([...(visitedBlocks ?? []).map((id) => `n${id}`), ...(visitedEdges ?? [])]),
    [visitedBlocks, visitedEdges],
  );
  const currentEdgeSet = useMemo(() => new Set(currentEdges ?? []), [currentEdges]);

  // Structure + labels: memoized on the structural inputs only.
  const structureKey = useMemo(
    () =>
      JSON.stringify([
        blocks.map((b) => [b.id, b.lines.map((l) => `${l.index} ${l.text}`)]),
        edges.map((e) => [e.from, e.to, e.back ?? false]),
      ]),
    [blocks, edges],
  );

  const elkEdges = useMemo<ElkGraphEdge[]>(
    () =>
      edges.map((e) => ({
        id: edgeKey(e.from, e.to),
        source: `n${e.from}`,
        target: `n${e.to}`,
        ...(e.back ? { label: '↩ back edge' } : {}),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structureKey],
  );

  const elkNodes = useMemo<ElkGraphNode[]>(
    () =>
      blocks.map((block) => ({
        id: `n${block.id}`,
        label: nodeLabel(block),
        kind: block.pseudo ? (block.id === ENTRY_ID ? 'entry' : 'exit') : 'block',
        ...blockBox(block),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structureKey],
  );

  // Node CONTENT may change per step (badges, marked instructions) — it is not
  // part of the ElkGraph structural hash, so it never triggers a re-layout.
  const nodes = useMemo<ElkGraphNode[]>(
    () =>
      elkNodes.map((node, i) => {
        const block = blocks[i]!;
        return { ...node, reactNode: <BlockNode block={block} badges={badges?.[block.id]} markedQuads={markedQuads} /> };
      }),
    [elkNodes, blocks, badges, markedQuads],
  );

  return (
    <div className={clsx('flex flex-col gap-1', className)}>
      <ElkGraph
        nodes={nodes}
        edges={elkEdges}
        direction="DOWN"
        currentNodeIds={current}
        visitedIds={visited}
        currentEdgeIds={currentEdgeSet}
        height={graphHeight}
        className="w-full"
      />
      <p className="sr-only">
        {ariaLabel}: {blocks.length} nodes ({blocks.map((b) => blockName(b.id)).join(', ')}) and{' '}
        {edges.length} edges (
        {edges
          .map((e) => `${blockName(e.from)} to ${blockName(e.to)}${e.back ? ' (back edge)' : ''}`)
          .join('; ')}
        ).
      </p>
    </div>
  );
}

function BlockNode({
  block,
  badges,
  markedQuads,
}: {
  block: CfgBlockView;
  badges?: readonly string[];
  markedQuads?: ReadonlySet<number>;
}) {
  if (block.pseudo) {
    const Icon = block.id === ENTRY_ID ? LogIn : LogOut;
    return (
      <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase">
        <Icon aria-hidden className="size-3.5" />
        {blockName(block.id)}
      </span>
    );
  }
  const shown = block.lines.slice(0, MAX_LINES);
  const rest = block.lines.length - shown.length;
  return (
    <div className="w-full overflow-hidden text-left">
      <div className="mb-0.5 flex items-center gap-1 border-b border-line pb-0.5">
        <span className="text-[11px] font-semibold">{blockName(block.id)}</span>
        {(badges ?? []).map((b) => (
          <span
            key={b}
            className="rounded-sm border border-line-strong px-1 text-[9px] tracking-wide text-ink-muted uppercase"
          >
            {b}
          </span>
        ))}
      </div>
      <div className="text-[10px] leading-[12px]">
        {shown.map((line) => {
          const marked = markedQuads?.has(line.index) ?? false;
          return (
            <div key={line.index} className="flex gap-1 overflow-hidden whitespace-nowrap">
              <span className="w-4 shrink-0 text-right text-ink-faint">{line.index}</span>
              <span className={clsx('truncate', marked && 'font-semibold text-ink')} title={line.text}>
                {marked && <CornerDownRight aria-hidden className="mr-0.5 inline size-2.5" />}
                {line.text}
              </span>
            </div>
          );
        })}
        {rest > 0 && <div className="pl-5 text-[10px] leading-[12px] text-ink-faint">+{rest} more…</div>}
        {block.lines.length === 0 && <div className="text-[10px] text-ink-faint">(empty)</div>}
      </div>
    </div>
  );
}
