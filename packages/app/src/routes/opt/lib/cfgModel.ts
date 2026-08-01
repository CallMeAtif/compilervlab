/**
 * Turning the stored `Cfg` artifacts into something drawable.
 *
 * The CFG *structure* (blocks, edges, and — for decoration — which edges are
 * back edges) is a static property of the program a view is looking at, so it
 * is derived once from the compilation artifact and never re-derived per step.
 * Everything that changes as you step (which block is being analysed, which
 * edges have been discovered) arrives from the trace and is passed to the graph
 * as emphasis-only props, so the ELK layout runs exactly once per view.
 */
import type { BasicBlock, Cfg } from '@lab/core/opt/types.js';
import type { TacFunction, TacProgram } from '@lab/core/ir/types.js';
import { formatQuad } from '@lab/core/ir/types.js';
import { solveDominators } from '@lab/core/opt/dominators.js';
import { solveLoops } from '@lab/core/opt/loops.js';
import type { NaturalLoop } from '@lab/core/opt/loops.js';
import { ENTRY_ID, EXIT_ID, edgeKey } from './optModel';

export interface QuadLine {
  index: number;
  text: string;
}

export interface CfgBlockView {
  id: number;
  /** ENTRY/EXIT pseudo-nodes carry no instructions. */
  lines: QuadLine[];
  pseudo: boolean;
}

export function functionByName(
  program: TacProgram | null | undefined,
  name: string | null,
): TacFunction | null {
  if (!program || program.functions.length === 0) return null;
  if (name) {
    const found = program.functions.find((f) => f.name === name);
    if (found) return found;
  }
  return program.functions[0] ?? null;
}

export function quadLines(fn: TacFunction): QuadLine[] {
  return fn.quads.map((q, i) => ({ index: i, text: formatQuad(q) }));
}

export function blockLines(fn: TacFunction, block: BasicBlock): QuadLine[] {
  return block.quadIndices.map((i) => {
    const q = fn.quads[i];
    return { index: i, text: q ? formatQuad(q) : '‹missing›' };
  });
}

/** Block views for a CFG, ENTRY first and EXIT last when the edges use them. */
export function cfgBlockViews(fn: TacFunction, cfg: Cfg): CfgBlockView[] {
  const views: CfgBlockView[] = [{ id: ENTRY_ID, lines: [], pseudo: true }];
  for (const b of cfg.blocks) views.push({ id: b.id, lines: blockLines(fn, b), pseudo: false });
  if (cfg.edges.some((e) => e.to === EXIT_ID)) {
    views.push({ id: EXIT_ID, lines: [], pseudo: true });
  }
  return views;
}

export function blockOfQuad(cfg: Cfg): Map<number, number> {
  const map = new Map<number, number>();
  for (const b of cfg.blocks) for (const qi of b.quadIndices) map.set(qi, b.id);
  return map;
}

export interface LoopStructure {
  backEdges: ReadonlySet<string>;
  loops: readonly NaturalLoop[];
  /** blockId → ids of the loops (by header) whose body contains it. */
  loopHeaders: ReadonlySet<number>;
}

const LOOP_CACHE = new WeakMap<Cfg, LoopStructure>();

/**
 * Back edges and natural loops of a CFG (§9.6.4 / Algorithm 9.46), used only as
 * a static annotation of the drawn graph. The `loops` analysis view shows the
 * same facts arriving step by step from its own trace.
 */
export function loopStructure(cfg: Cfg): LoopStructure {
  const cached = LOOP_CACHE.get(cfg);
  if (cached) return cached;
  let value: LoopStructure;
  try {
    const doms = solveDominators(cfg);
    const { backEdges, loops } = solveLoops(cfg, doms);
    value = {
      backEdges: new Set(backEdges.map((e) => edgeKey(e.from, e.to))),
      loops,
      loopHeaders: new Set(loops.map((l) => l.header)),
    };
  } catch {
    value = { backEdges: new Set(), loops: [], loopHeaders: new Set() };
  }
  LOOP_CACHE.set(cfg, value);
  return value;
}

/** Sorted list of the blocks a loop body covers, as "B1, B2". */
export function bodyText(body: readonly number[]): string {
  return body.map((b) => `B${b}`).join(', ');
}

export function cfgForFunction(cfgs: readonly Cfg[], name: string): Cfg | null {
  return cfgs.find((c) => c.functionName === name) ?? null;
}
