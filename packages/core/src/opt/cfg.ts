/**
 * Flow-graph construction — Dragon Book (2nd ed.) §8.4.3: the nodes are the
 * basic blocks; there is an edge from block B to block C if and only if C's
 * first instruction can immediately follow B's last instruction — either C's
 * leader is the target of a jump ending B, or C immediately follows B in the
 * program and B does not end in an unconditional jump. ENTRY and EXIT are
 * pseudo-nodes (ENTRY = -1, EXIT = -2 here).
 */
import type { Quad, TacFunction } from '../ir/types.js';
import { formatQuad } from '../ir/types.js';
import type { Reducer, Recorded, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { BasicBlock, Cfg } from './types.js';
import { labelIndex } from './basic-blocks.js';

export const ENTRY = -1;
export const EXIT = -2;

export type CfgEdgeReason = 'entry' | 'jump-target' | 'fallthrough' | 'return' | 'fall-off-end';

export type CfgEvent = {
  kind: 'cfg-edge';
  from: number;
  to: number;
  reason: CfgEdgeReason;
};

export type CfgState = Cfg;

export function initialCfgState(fn: TacFunction, blocks: BasicBlock[]): CfgState {
  return { functionName: fn.name, blocks, edges: [] };
}

export const cfgReducer: Reducer<CfgState, CfgEvent> = (state, event) => ({
  ...state,
  edges: [...state.edges, { from: event.from, to: event.to }],
});

const cite = (rule: string): StepMeta['cite'] => ({ section: '8.4.3', rule });

const blockName = (id: number): string =>
  id === ENTRY ? 'ENTRY' : id === EXIT ? 'EXIT' : `B${id}`;

function lastQuad(fn: TacFunction, block: BasicBlock): Quad | null {
  const last = block.quadIndices[block.quadIndices.length - 1];
  return last === undefined ? null : (fn.quads[last] ?? null);
}

/** Build the CFG for one function from its basic blocks (traced, one event per edge). */
export function* buildCfg(fn: TacFunction, blocks: BasicBlock[]): Steps<CfgEvent, Cfg> {
  const edges: Array<{ from: number; to: number }> = [];
  const labels = labelIndex(fn);
  const blockOfQuad: Record<number, number> = {};
  for (const b of blocks) for (const qi of b.quadIndices) blockOfQuad[qi] = b.id;
  const section = `CFG (${fn.name})`;

  // §8.4.3 defines the edges as a RELATION between blocks: B → C either holds
  // or it does not. A conditional jump whose target is also its fall-through
  // block therefore contributes the edge once, not twice.
  const emitted = new Set<string>();

  function* addEdge(
    from: number,
    to: number,
    reason: CfgEdgeReason,
    prose: string,
    rule: string,
  ): Steps<CfgEvent, void> {
    const key = `${from}->${to}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    edges.push({ from, to });
    yield [
      { kind: 'cfg-edge', from, to, reason },
      {
        cite: cite(rule),
        prose,
        level: 'macro',
        section,
        irRefs: [
          ...(from >= 0 ? [{ kind: 'block', id: from } as const] : []),
          ...(to >= 0 ? [{ kind: 'block', id: to } as const] : []),
        ],
      },
    ];
  }

  if (blocks.length > 0) {
    yield* addEdge(
      ENTRY,
      blocks[0]!.id,
      'entry',
      `Edge ENTRY → B${blocks[0]!.id}: the first instruction of the flow graph's first block follows the ENTRY pseudo-node.`,
      'There is an edge from ENTRY to the block containing the first instruction of the program',
    );
  } else {
    yield* addEdge(
      ENTRY,
      EXIT,
      'entry',
      `Function ${fn.name} has no instructions: ENTRY connects directly to EXIT.`,
      'There is an edge from ENTRY to the block containing the first instruction of the program',
    );
  }

  for (const b of blocks) {
    const last = lastQuad(fn, b);
    const nextBlock = b.id + 1 < blocks.length ? blocks[b.id + 1]! : null;
    if (last === null) continue;

    const isCond = last.op === 'if' || last.op === 'iffalse' || last.op === 'ifrel';
    const isGoto = last.op === 'goto';
    const isReturn = last.op === 'return';

    if (isGoto || isCond) {
      const targetName = last.result && last.result.kind === 'label' ? last.result.name : null;
      const targetQuad = targetName !== null ? labels[targetName] : undefined;
      const targetBlock = targetQuad !== undefined ? blockOfQuad[targetQuad] : undefined;
      if (targetBlock !== undefined) {
        yield* addEdge(
          b.id,
          targetBlock,
          'jump-target',
          `Edge ${blockName(b.id)} → ${blockName(targetBlock)}: block B${b.id} ends in the ${
            isGoto ? 'unconditional' : 'conditional'
          } jump "${formatQuad(last)}" whose target ${targetName} is the leader of B${targetBlock}.`,
          "There is an edge from B to C if there is a conditional or unconditional jump from the end of B to the beginning of C",
        );
      }
    }

    if (isReturn) {
      yield* addEdge(
        b.id,
        EXIT,
        'return',
        `Edge ${blockName(b.id)} → EXIT: block B${b.id} ends in "${formatQuad(last)}", which leaves the function.`,
        'A block ending in a return (or the last block) has an edge to the EXIT pseudo-node',
      );
    } else if (!isGoto) {
      // Fallthrough: C immediately follows B and B does not end in an unconditional jump.
      if (nextBlock !== null) {
        yield* addEdge(
          b.id,
          nextBlock.id,
          'fallthrough',
          `Edge ${blockName(b.id)} → ${blockName(nextBlock.id)}: B${nextBlock.id} immediately follows B${b.id} in program order and B${b.id} does not end in an unconditional jump.`,
          'There is an edge from B to C if C immediately follows B in the original order and B does not end in an unconditional jump',
        );
      } else {
        yield* addEdge(
          b.id,
          EXIT,
          'fall-off-end',
          `Edge ${blockName(b.id)} → EXIT: B${b.id} is the last block and control falls off the end of the function.`,
          'A block ending in a return (or the last block) has an edge to the EXIT pseudo-node',
        );
      }
    }
  }

  return { functionName: fn.name, blocks, edges };
}

export function projectCfg(result: Cfg): CfgState {
  return result;
}

export function runBuildCfg(fn: TacFunction, blocks: BasicBlock[]): Recorded<CfgState, CfgEvent, Cfg> {
  return record(() => buildCfg(fn, blocks), initialCfgState(fn, blocks), cfgReducer, {
    id: `opt.cfg.${fn.name}`,
  });
}

/** Untraced convenience used by passes when only the structure is needed. */
export function computeCfg(fn: TacFunction, blocks: BasicBlock[]): Cfg {
  const gen = buildCfg(fn, blocks);
  let it = gen.next();
  while (!it.done) it = gen.next();
  return it.value;
}

export function predecessors(cfg: Cfg, blockId: number): number[] {
  return cfg.edges
    .filter((e) => e.to === blockId)
    .map((e) => e.from)
    .sort((a, b) => a - b);
}

export function successors(cfg: Cfg, blockId: number): number[] {
  return cfg.edges
    .filter((e) => e.from === blockId)
    .map((e) => e.to)
    .sort((a, b) => a - b);
}
