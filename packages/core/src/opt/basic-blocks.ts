/**
 * Basic-block partitioning — Dragon Book (2nd ed.) Algorithm 8.5 (§8.4.1):
 * identify leaders, then each basic block runs from a leader up to (but not
 * including) the next leader or the end of the intermediate program.
 */
import type { Quad, TacFunction } from '../ir/types.js';
import { formatQuad } from '../ir/types.js';
import type { Reducer, Recorded, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { BasicBlock } from './types.js';

/** Leader rules of Algorithm 8.5. */
export type LeaderRule = 1 | 2 | 3;

export type BasicBlockEvent =
  | { kind: 'leader-found'; quadIndex: number; rule: LeaderRule }
  | { kind: 'block-formed'; blockId: number; leaderIndex: number; quadIndices: number[] };

export interface BasicBlocksResult {
  blocks: BasicBlock[];
  leaders: Array<{ quadIndex: number; rule: LeaderRule }>;
}

export interface BasicBlocksState {
  blocks: BasicBlock[];
  leaders: Array<{ quadIndex: number; rule: LeaderRule }>;
}

export const initialBasicBlocksState: BasicBlocksState = { blocks: [], leaders: [] };

export const basicBlocksReducer: Reducer<BasicBlocksState, BasicBlockEvent> = (state, event) => {
  switch (event.kind) {
    case 'leader-found':
      return {
        ...state,
        leaders: [...state.leaders, { quadIndex: event.quadIndex, rule: event.rule }],
      };
    case 'block-formed':
      return {
        ...state,
        blocks: [
          ...state.blocks,
          {
            id: event.blockId,
            leaderIndex: event.leaderIndex,
            quadIndices: [...event.quadIndices],
          },
        ],
      };
  }
};

function isJump(q: Quad): boolean {
  return q.op === 'goto' || q.op === 'if' || q.op === 'iffalse' || q.op === 'ifrel';
}

/**
 * Instructions after which control does not simply continue with the next
 * instruction: the conditional/unconditional jumps of Algorithm 8.5, plus
 * `return`, which transfers control out of the procedure. A `return` therefore
 * ends its basic block (rule 3), which is what lets §8.4.3 give that block its
 * edge to EXIT — without it, an instruction placed after a `return` would sit
 * in the same block and the flow graph would claim the procedure never
 * terminates.
 */
function isControlTransfer(q: Quad): boolean {
  return isJump(q) || q.op === 'return';
}

/** Label name targeted by a jump quad, if any. */
function jumpTargetLabel(q: Quad): string | null {
  if (!isJump(q)) return null;
  return q.result && q.result.kind === 'label' ? q.result.name : null;
}

/** Map label name -> quad index of its 'label' quad. */
export function labelIndex(fn: TacFunction): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of fn.quads) {
    if (q.op === 'label' && q.result && q.result.kind === 'label') {
      out[q.result.name] = q.index;
    }
  }
  return out;
}

const cite = (rule?: string): StepMeta['cite'] => ({
  section: '8.4.1',
  figureOrAlgo: 'Algorithm 8.5',
  ...(rule ? { rule } : {}),
});

/**
 * Algorithm 8.5: partition three-address instructions into basic blocks.
 * Leader rules: (1) the first instruction; (2) any target of a conditional or
 * unconditional jump; (3) any instruction that immediately follows a jump.
 */
export function* findBasicBlocks(fn: TacFunction): Steps<BasicBlockEvent, BasicBlocksResult> {
  const quads = fn.quads;
  const leaders: Array<{ quadIndex: number; rule: LeaderRule }> = [];
  const leaderSet = new Set<number>();
  const labels = labelIndex(fn);

  const addLeader = (quadIndex: number, rule: LeaderRule): { quadIndex: number; rule: LeaderRule } | null => {
    if (leaderSet.has(quadIndex)) return null;
    leaderSet.add(quadIndex);
    const rec = { quadIndex, rule };
    leaders.push(rec);
    return rec;
  };

  const section = `Leaders (${fn.name})`;

  // Rule 1: the first instruction is a leader.
  if (quads.length > 0) {
    const rec = addLeader(0, 1);
    if (rec) {
      yield [
        { kind: 'leader-found', quadIndex: 0, rule: 1 },
        {
          cite: cite('Rule 1: the first three-address instruction is a leader'),
          prose: `Instruction 0 (${formatQuad(quads[0]!)}) is a leader because it is the first instruction of ${fn.name}.`,
          level: 'macro',
          section,
          irRefs: [{ kind: 'tacInstr', id: 0 }],
        },
      ];
    }
  }

  // Rules 2 and 3, scanning instructions in program order (deterministic).
  for (const q of quads) {
    if (!isControlTransfer(q)) continue;
    const targetName = jumpTargetLabel(q);
    if (targetName !== null) {
      const t = labels[targetName];
      if (t !== undefined && addLeader(t, 2)) {
        yield [
          { kind: 'leader-found', quadIndex: t, rule: 2 },
          {
            cite: cite('Rule 2: any instruction that is the target of a jump is a leader'),
            prose: `Instruction ${t} (${formatQuad(quads[t]!)}) is a leader because it is the target of the jump at instruction ${q.index} (${formatQuad(q)}).`,
            level: 'macro',
            section,
            irRefs: [
              { kind: 'tacInstr', id: t },
              { kind: 'tacInstr', id: q.index },
            ],
          },
        ];
      }
    }
    const follow = q.index + 1;
    if (follow < quads.length && addLeader(follow, 3)) {
      const kindOfTransfer = q.op === 'return' ? 'return' : 'jump';
      yield [
        { kind: 'leader-found', quadIndex: follow, rule: 3 },
        {
          cite: cite(
            'Rule 3: any instruction that immediately follows a jump (or a return, which also transfers control away) is a leader',
          ),
          prose: `Instruction ${follow} (${formatQuad(quads[follow]!)}) is a leader because it immediately follows the ${kindOfTransfer} at instruction ${q.index}.`,
          level: 'macro',
          section,
          irRefs: [
            { kind: 'tacInstr', id: follow },
            { kind: 'tacInstr', id: q.index },
          ],
        },
      ];
    }
  }

  // Block formation: each block is a leader up to the next leader (§8.4.1).
  const sortedLeaders = [...leaderSet].sort((a, b) => a - b);
  const blocks: BasicBlock[] = [];
  const blockSection = `Blocks (${fn.name})`;
  for (let i = 0; i < sortedLeaders.length; i++) {
    const leaderIndex = sortedLeaders[i]!;
    const end = i + 1 < sortedLeaders.length ? sortedLeaders[i + 1]! : quads.length;
    const quadIndices: number[] = [];
    for (let j = leaderIndex; j < end; j++) quadIndices.push(j);
    const block: BasicBlock = { id: i, leaderIndex, quadIndices };
    blocks.push(block);
    yield [
      { kind: 'block-formed', blockId: i, leaderIndex, quadIndices: [...quadIndices] },
      {
        cite: cite(
          'A basic block consists of a leader and all instructions up to but not including the next leader',
        ),
        prose: `Block B${i} runs from instruction ${leaderIndex} up to instruction ${end - 1}, ending just before ${
          end < quads.length ? `the next leader at ${end}` : 'the end of the program'
        }.`,
        level: 'macro',
        section: blockSection,
        irRefs: [{ kind: 'block', id: i }],
      },
    ];
  }

  // Leaders reported in discovery order (rule 1, then program-order scan) so the
  // reduced state replays exactly.
  return { blocks, leaders };
}

export function projectBasicBlocks(result: BasicBlocksResult): BasicBlocksState {
  return { blocks: result.blocks, leaders: result.leaders };
}

export function runFindBasicBlocks(
  fn: TacFunction,
): Recorded<BasicBlocksState, BasicBlockEvent, BasicBlocksResult> {
  return record(() => findBasicBlocks(fn), initialBasicBlocksState, basicBlocksReducer, {
    id: `opt.basic-blocks.${fn.name}`,
  });
}
