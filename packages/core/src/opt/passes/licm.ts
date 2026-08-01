/**
 * Loop-invariant code motion.
 *
 * The transformation itself is code motion (§9.1.5): "an expression that
 * yields the same result independent of the number of times a loop is executed
 * may be evaluated before the loop". That section states the idea informally
 * and nothing more; the machinery used here is assembled from the sections
 * that do define it:
 *   - natural loops, back edges and dominators — §9.6 (§9.6.1 dominators,
 *     §9.6.4 back edges, Algorithm 9.46 natural loops);
 *   - "loop-invariant" and the legality of moving a definition — §9.2.4
 *     reaching definitions;
 *   - the safety side condition — §9.5.1: an optimized program must not
 *     perform a computation the original execution does not perform.
 * The three-condition legality test below is the classic code-motion criterion
 * (Dragon Book 1st ed., Algorithm 10.7); the 2nd edition reaches the same
 * effect through lazy code motion (§9.5). Each step cites the section that
 * actually supports it rather than attributing the whole rule set to §9.1.5.
 *
 * A statement is loop-invariant if each operand is a constant, has all
 * reaching definitions outside the loop, or has a single reaching definition
 * that is itself an invariant statement of the loop. An invariant statement
 * s: x = … may be moved to a newly created preheader only if:
 *   1. s's block dominates all loop exits, OR (x is dead after the loop and s
 *      cannot raise a runtime error — hoisting a trapping computation past a
 *      zero-trip test would add a computation the original never performs);
 *   2. x is not defined elsewhere in the loop;
 *   3. every use of x in the loop is reached only by the definition in s
 *      (and every invariant operand definition s depends on is moved first).
 */
import type { Quad, TacFunction, TacProgram } from '../../ir/types.js';
import { formatQuad } from '../../ir/types.js';
import type { Recorded, StepMeta, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Cfg, OptPassResult } from '../types.js';
import type { PassEvent, PassState, RewriteChange } from '../opt-events.js';
import { initialPassState, passReducer, passStateFromResult } from '../opt-events.js';
import {
  addressTakenVars,
  definedVar,
  difference,
  mayRaiseRuntimeError,
  reachingDefinitions,
  liveVariables,
  sortSet,
  union,
  usedVars,
  varKey,
  type DefInfo,
  type LiveVarsResult,
  type ReachingDefsResult,
} from '../dataflow.js';
import { EXIT, successors } from '../cfg.js';
import { computeDominators, type DominatorsResult } from '../dominators.js';
import { findLoops, type NaturalLoop } from '../loops.js';
import {
  cloneProgram,
  cfgOf,
  finishPass,
  freshLabelName,
  globalVarNames,
  passBeginStep,
  passEndStep,
  rewriteStep,
  type PassCite,
} from './util.js';

const CITE: PassCite = {
  section: '9.1.5',
  rule: 'Code motion: an expression that yields the same result independent of the number of loop iterations may be evaluated once, before the loop',
};

/**
 * §9.1.5 states the idea of code motion informally and does not give the
 * legality conditions, so each condition cites the section that does support
 * it (see the module header).
 */
const SAFETY_CITE: PassCite = {
  section: '9.5.1',
  rule: 'The optimized program must not perform any computation that is not in the original program execution',
};
const RD_CITE: PassCite = {
  section: '9.2.4',
  figureOrAlgo: 'Algorithm 9.11',
  rule: 'Reaching definitions decide which definition of x a use inside the loop can see',
};

/** Ops that may be considered for motion: pure value computations. */
const MOVABLE_OPS = new Set<string>([
  '+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>=',
  'neg', 'not', 'copy', 'inttofloat',
]);

/** Point-level reaching set just before quadIndex, given RD on the frozen fn. */
function reachingBefore(
  cfg: Cfg,
  rd: ReachingDefsResult,
  blockOfQuad: Record<number, number>,
  quadIndex: number,
): string[] {
  const blockId = blockOfQuad[quadIndex]!;
  const block = cfg.blocks.find((b) => b.id === blockId)!;
  const defAtQuad: Record<number, DefInfo> = {};
  for (const d of rd.defs) defAtQuad[d.quadIndex] = d;
  const defsOfVar: Record<string, string[]> = {};
  for (const d of rd.defs) (defsOfVar[d.var] ??= []).push(d.id);
  let cur = rd.in[String(blockId)] ?? [];
  for (const qi of block.quadIndices) {
    if (qi === quadIndex) return cur;
    const d = defAtQuad[qi];
    if (d) cur = union([d.id], difference(cur, (defsOfVar[d.var] ?? []).filter((x) => x !== d.id)));
  }
  return cur;
}

export function* licm(program: TacProgram): Steps<PassEvent, OptPassResult> {
  const working = cloneProgram(program);
  const changes: RewriteChange[] = [];
  const globals = sortSet(globalVarNames(working));

  yield passBeginStep(
    'licm',
    working,
    CITE,
    'LICM finds natural loops via dominators and back edges (§9.6), marks loop-invariant statements, checks the code-motion legality conditions (§9.1.5), and moves legal statements to a newly created preheader.',
  );

  for (const fn of working.functions) {
    const frozen: TacFunction = { ...fn, quads: fn.quads.map((q) => ({ ...q })) };
    const cfg = cfgOf(frozen);
    const doms: DominatorsResult = yield* computeDominators(cfg);
    const { loops } = yield* findLoops(cfg, doms);
    if (loops.length === 0) continue;

    const rd: ReachingDefsResult = yield* reachingDefinitions(frozen, cfg);
    const addrTaken = addressTakenVars(frozen);
    const boundary = sortSet([...globals, ...addrTaken]);
    const lv: LiveVarsResult = yield* liveVariables(frozen, cfg, boundary);

    const blockOfQuad: Record<number, number> = {};
    for (const b of cfg.blocks) for (const qi of b.quadIndices) blockOfQuad[qi] = b.id;
    const defAtQuad: Record<number, DefInfo> = {};
    for (const d of rd.defs) defAtQuad[d.quadIndex] = d;

    // Working-copy identity map: original quad index -> working quad object.
    const byOriginalIndex = new Map<number, Quad>();
    fn.quads.forEach((q, i) => byOriginalIndex.set(i, q));
    const originalIndexOf = new Map<Quad, number>();
    for (const [i, wq] of byOriginalIndex) originalIndexOf.set(wq, i);

    const movedOriginal = new Set<number>(); // across all loops of this fn
    const hasCallInFn = frozen.quads.some((q) => q.op === 'call');

    for (const loop of loops) {
      const body = new Set(loop.body);
      const section = `LICM loop B${loop.backEdge.from}→B${loop.header} (${fn.name})`;
      const groupId = `licm-${fn.name}-${loop.backEdge.from}-${loop.header}`;
      const meta = (
        prose: string,
        ruleOrCite?: string | PassCite,
        level: StepMeta['level'] = 'micro',
      ): StepMeta => ({
        cite:
          ruleOrCite === undefined
            ? CITE
            : typeof ruleOrCite === 'string'
              ? { ...CITE, rule: ruleOrCite }
              : ruleOrCite,
        prose,
        level,
        section,
        groupId,
      });

      const loopQuadIndices: number[] = [];
      for (const b of cfg.blocks) {
        if (body.has(b.id)) loopQuadIndices.push(...b.quadIndices);
      }
      loopQuadIndices.sort((a, b) => a - b);
      const loopQuadSet = new Set(loopQuadIndices);

      // Several back edges can share one header; §9.6.6 treats their natural
      // loops as one region entered only through that header. The preheader
      // belongs to ALL of them, so "inside the loop" for preheader placement
      // and jump retargeting means "inside any natural loop with this header".
      const headerRegion = new Set<number>();
      for (const l of loops) if (l.header === loop.header) for (const b of l.body) headerRegion.add(b);
      const headerRegionQuads = new Set<number>();
      for (const b of cfg.blocks) {
        if (headerRegion.has(b.id)) for (const qi of b.quadIndices) headerRegionQuads.add(qi);
      }
      const loopHasCall = loopQuadIndices.some((qi) => frozen.quads[qi]!.op === 'call');

      // ---- Invariant marking (iterate to fixpoint) ----
      const invariant = new Set<number>();
      let changedMark = true;
      while (changedMark) {
        changedMark = false;
        for (const qi of loopQuadIndices) {
          if (invariant.has(qi) || movedOriginal.has(qi)) continue;
          const q = frozen.quads[qi]!;
          if (!MOVABLE_OPS.has(q.op)) continue;
          const uses = usedVars(q);
          const reasons: string[] = [];
          let ok = true;
          for (const v of sortSet(uses)) {
            if (addrTaken.has(v)) {
              ok = false;
              break;
            }
            if (globals.includes(v) && (loopHasCall || hasCallInFn)) {
              ok = false; // a call could change the global between iterations
              break;
            }
            const reaching = reachingBefore(cfg, rd, blockOfQuad, qi).filter(
              (d) => rd.defs.find((x) => x.id === d)!.var === v,
            );
            const inLoop = reaching.filter((d) => loopQuadSet.has(rd.defs.find((x) => x.id === d)!.quadIndex));
            if (inLoop.length === 0) {
              reasons.push(`all reaching definitions of ${v} are outside the loop`);
            } else if (
              reaching.length === 1 &&
              inLoop.length === 1 &&
              invariant.has(rd.defs.find((x) => x.id === inLoop[0]!)!.quadIndex)
            ) {
              reasons.push(`the single reaching definition of ${v} (${inLoop[0]}) is itself loop-invariant`);
            } else {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          const constOnly = uses.length === 0;
          invariant.add(qi);
          changedMark = true;
          yield [
            {
              kind: 'licm-invariant',
              functionName: fn.name,
              quadIndex: qi,
              loopHeader: loop.header,
              reason: constOnly ? 'all operands are constants' : reasons.join('; '),
            },
            meta(
              `Instruction ${qi} ("${formatQuad(q)}") is loop-invariant: ${
                constOnly ? 'all operands are constants' : reasons.join('; ')
              }.`,
              'A statement is loop-invariant if each operand is constant, defined only outside the loop, or defined by a single loop-invariant statement',
            ),
          ];
        }
      }

      // ---- Legality checks and motion ----
      const exits = cfg.blocks
        .map((b) => b.id)
        .filter((id) => body.has(id) && successors(cfg, id).some((s) => !body.has(s)))
        .sort((a, b) => a - b);

      const moved: number[] = []; // original indices moved for THIS loop, in order
      for (const qi of [...invariant].sort((a, b) => a - b)) {
        const q = frozen.quads[qi]!;
        const x = definedVar(q);
        if (x === null) continue;
        const def = defAtQuad[qi];
        if (!def) continue;
        const qBlock = blockOfQuad[qi]!;

        // Condition 1: dominate all exits, or x dead at every exit target.
        //
        // The "x is dead after the loop" relaxation is only sound for a
        // computation that cannot fail: the preheader runs whenever the loop
        // is ENTERED, but a block that does not dominate the loop exits may
        // run zero times (a while-loop whose test fails immediately). Hoisting
        // a trapping instruction out of such a block would make the optimized
        // program perform a computation the original never performs (§9.5.1),
        // turning a normal result into a runtime error. So a may-trap
        // statement must be guaranteed to execute: its block dominates every
        // loop exit, and the loop has an exit at all.
        const dominatesAllExits = exits.every((e) => (doms.dom[String(e)] ?? []).includes(qBlock));
        let deadAfterLoop = true;
        for (const e of exits) {
          for (const s of successors(cfg, e)) {
            if (body.has(s)) continue;
            const liveIn = s === EXIT ? boundary : (lv.in[String(s)] ?? []);
            if (liveIn.includes(x)) deadAfterLoop = false;
          }
        }
        const mayTrap = mayRaiseRuntimeError(q);
        const guaranteedToExecute = exits.length > 0 && dominatesAllExits;
        const cond1 = mayTrap ? guaranteedToExecute : dominatesAllExits || deadAfterLoop;
        const cond1Detail = cond1
          ? mayTrap
            ? `B${qBlock} dominates every loop exit {${exits.map((e) => `B${e}`).join(', ')}}, so "${formatQuad(q)}" is evaluated in the original program too`
            : dominatesAllExits
              ? `B${qBlock} dominates every loop exit {${exits.map((e) => `B${e}`).join(', ')}}`
              : `${x} is not live at any block reached on loop exit`
          : mayTrap
            ? `"${formatQuad(q)}" can raise a runtime error and B${qBlock} does not dominate the loop exits {${exits
                .map((e) => `B${e}`)
                .join(', ')}}, so the loop body may run zero times and the preheader would evaluate it anyway`
            : `B${qBlock} does not dominate exits {${exits.map((e) => `B${e}`).join(', ')}} and ${x} is live after the loop`;
        yield [
          {
            kind: 'licm-legality',
            functionName: fn.name,
            quadIndex: qi,
            loopHeader: loop.header,
            condition: 'dominates-exits-or-dead',
            ok: cond1,
            detail: cond1Detail,
          },
          meta(
            `Legality 1 for instruction ${qi}: the statement must dominate all loop exits${
              mayTrap ? ' (it may raise a runtime error, so it must be guaranteed to execute)' : ', or its target must be dead after the loop'
            } — ${cond1 ? 'holds' : 'FAILS'} (${cond1Detail}).`,
            SAFETY_CITE,
          ),
        ];

        // Condition 2: no other definition of x in the loop.
        const otherDefs = rd.defs.filter((d) => d.var === x && d.quadIndex !== qi && loopQuadSet.has(d.quadIndex));
        const cond2 = otherDefs.length === 0;
        yield [
          {
            kind: 'licm-legality',
            functionName: fn.name,
            quadIndex: qi,
            loopHeader: loop.header,
            condition: 'only-def-in-loop',
            ok: cond2,
            detail: cond2
              ? `instruction ${qi} is the only definition of ${x} in the loop`
              : `${x} is also defined at {${otherDefs.map((d) => d.quadIndex).join(', ')}} inside the loop`,
          },
          meta(
            `Legality 2 for instruction ${qi}: x must have no other definition in the loop — ${cond2 ? 'holds' : 'FAILS'}.`,
            RD_CITE,
          ),
        ];

        // Condition 3: every use of x in the loop is reached only by this def.
        let cond3 = true;
        let cond3Detail = `every use of ${x} in the loop is reached only by ${def.id}`;
        for (const useQi of loopQuadIndices) {
          if (!usedVars(frozen.quads[useQi]!).includes(x)) continue;
          const reachingX = reachingBefore(cfg, rd, blockOfQuad, useQi).filter(
            (d) => rd.defs.find((y) => y.id === d)!.var === x,
          );
          if (!(reachingX.length === 1 && reachingX[0] === def.id)) {
            cond3 = false;
            cond3Detail = `the use of ${x} at instruction ${useQi} is reached by {${reachingX.join(', ')}}, not only ${def.id}`;
            break;
          }
        }
        yield [
          {
            kind: 'licm-legality',
            functionName: fn.name,
            quadIndex: qi,
            loopHeader: loop.header,
            condition: 'only-def-reaching-uses',
            ok: cond3,
            detail: cond3Detail,
          },
          meta(
            `Legality 3 for instruction ${qi}: all uses of ${x} in the loop must be reached only by this definition — ${cond3 ? 'holds' : 'FAILS'}.`,
            RD_CITE,
          ),
        ];

        // Dependency: invariant operands defined in the loop must already be moved.
        let depsOk = true;
        let depsDetail = 'all in-loop operand definitions are already moved to the preheader';
        for (const v of sortSet(usedVars(q))) {
          const reaching = reachingBefore(cfg, rd, blockOfQuad, qi).filter(
            (d) => rd.defs.find((y) => y.id === d)!.var === v,
          );
          for (const d of reaching) {
            const dq = rd.defs.find((y) => y.id === d)!.quadIndex;
            if (loopQuadSet.has(dq) && !moved.includes(dq) && !movedOriginal.has(dq)) {
              depsOk = false;
              depsDetail = `operand ${v} is defined at instruction ${dq} inside the loop, which was not moved`;
            }
          }
        }
        yield [
          {
            kind: 'licm-legality',
            functionName: fn.name,
            quadIndex: qi,
            loopHeader: loop.header,
            condition: 'depends-on-moved-invariants',
            ok: depsOk,
            detail: depsDetail,
          },
          meta(
            `Dependency check for instruction ${qi}: any in-loop definitions its operands rely on must themselves have been moved — ${depsOk ? 'holds' : 'FAILS'}.`,
            'Invariant statements are moved in order; a statement may move only after the invariant definitions it uses',
          ),
        ];

        if (cond1 && cond2 && cond3 && depsOk) moved.push(qi);
      }

      if (moved.length === 0) continue;

      // ---- Create the preheader and move the statements ----
      const headerBlock = cfg.blocks.find((b) => b.id === loop.header)!;
      const headerLeader = frozen.quads[headerBlock.leaderIndex]!;
      if (headerLeader.op !== 'label' || !headerLeader.result || headerLeader.result.kind !== 'label') {
        // Header not addressable by name (no label): skip motion conservatively.
        yield [
          {
            kind: 'rewrite-skipped',
            pass: 'licm',
            functionName: fn.name,
            quadIndex: headerBlock.leaderIndex,
            reason: 'loop header has no label; preheader insertion skipped',
          },
          meta('The loop header has no label to retarget, so no preheader is created.', undefined, 'macro'),
        ];
        continue;
      }
      const headerLabelName = headerLeader.result.name;
      const preheaderLabel = freshLabelName(working);
      const headerWorkQ = byOriginalIndex.get(headerBlock.leaderIndex)!;

      // Remove moved quads from their current positions (identity-based).
      const movedQuads = moved.map((qi) => byOriginalIndex.get(qi)!);
      for (const mq of movedQuads) {
        const pos = fn.quads.indexOf(mq);
        fn.quads.splice(pos, 1);
      }
      // Insert preheader: Lpre: followed by the moved quads, before the header
      // label. The preheader must be reachable ONLY from outside the loop
      // (§9.1.5 / Fig 9.6: its single successor is the header and its
      // predecessors are the header's predecessors from outside). Placing it
      // textually in front of the header label is only enough when control
      // cannot fall INTO it from inside the loop — which is exactly what a
      // bottom-test loop does, where the block textually preceding the header
      // (the test) is the loop body. In that case a "goto <header>" is
      // inserted ahead of the preheader label so the in-loop fall-through
      // jumps straight to the header and skips the hoisted code.
      const insertAt = fn.quads.indexOf(headerWorkQ);
      const prevQuad = insertAt > 0 ? fn.quads[insertAt - 1]! : null;
      const prevOriginalIndex = prevQuad ? (originalIndexOf.get(prevQuad) ?? -1) : -1;
      const fallsIntoPreheaderFromLoop =
        prevQuad !== null &&
        prevQuad.op !== 'goto' &&
        prevQuad.op !== 'return' &&
        headerRegionQuads.has(prevOriginalIndex);

      const labelQuad: Quad = {
        index: headerWorkQ.index,
        op: 'label',
        arg1: null,
        arg2: null,
        result: { kind: 'label', name: preheaderLabel },
        astNodeId: headerWorkQ.astNodeId,
      };
      const skipQuad: Quad | null = fallsIntoPreheaderFromLoop
        ? {
            index: headerWorkQ.index,
            op: 'goto',
            arg1: null,
            arg2: null,
            result: { kind: 'label', name: headerLabelName },
            astNodeId: headerWorkQ.astNodeId,
          }
        : null;
      fn.quads.splice(insertAt, 0, ...(skipQuad ? [skipQuad] : []), labelQuad, ...movedQuads);

      if (skipQuad) {
        const skipChange: RewriteChange = {
          functionName: fn.name,
          kind: 'insert',
          beforeIndex: null,
          afterIndex: insertAt,
          justification: `LICM (§9.1.5): the instruction preceding loop header B${loop.header} (${headerLabelName}) is inside the loop and falls through into it, so "${formatQuad(skipQuad)}" is inserted to keep that in-loop path out of the new preheader ${preheaderLabel}.`,
        };
        changes.push(skipChange);
        yield rewriteStep('licm', skipChange, fn, CITE, { section, groupId });
      }

      const labelChange: RewriteChange = {
        functionName: fn.name,
        kind: 'insert',
        beforeIndex: null,
        afterIndex: fn.quads.indexOf(labelQuad),
        justification: `LICM (§9.1.5): preheader ${preheaderLabel} created immediately before loop header B${loop.header} (${headerLabelName}); it is entered only from outside the loop, so the moved invariants execute once, before the loop is entered.`,
      };
      changes.push(labelChange);
      yield rewriteStep('licm', labelChange, fn, CITE, { section, groupId });

      for (let i = 0; i < movedQuads.length; i++) {
        const mq = movedQuads[i]!;
        const originalIndex = moved[i]!;
        movedOriginal.add(originalIndex);
        const moveChange: RewriteChange = {
          functionName: fn.name,
          kind: 'move',
          beforeIndex: originalIndex,
          afterIndex: fn.quads.indexOf(mq),
          justification: `LICM (§9.1.5): loop-invariant "${formatQuad(mq)}" (instruction ${originalIndex}) moved to preheader ${preheaderLabel}; it satisfies the code-motion legality conditions.`,
        };
        changes.push(moveChange);
        yield rewriteStep('licm', moveChange, fn, CITE, { section, groupId });
      }

      // Retarget jumps to the header from OUTSIDE the loop to the preheader.
      // "Outside" is measured against every natural loop that shares this
      // header: a second back edge to the same header is still a back edge,
      // not a loop entry, so it must keep jumping to the header itself.
      for (let qi = 0; qi < frozen.quads.length; qi++) {
        if (headerRegionQuads.has(qi)) continue;
        const fq = frozen.quads[qi]!;
        if (fq.op !== 'goto' && fq.op !== 'if' && fq.op !== 'iffalse' && fq.op !== 'ifrel') continue;
        if (!fq.result || fq.result.kind !== 'label' || fq.result.name !== headerLabelName) continue;
        const wq = byOriginalIndex.get(qi)!;
        const before = formatQuad(wq);
        wq.result = { kind: 'label', name: preheaderLabel };
        const retarget: RewriteChange = {
          functionName: fn.name,
          kind: 'replace',
          beforeIndex: qi,
          afterIndex: fn.quads.indexOf(wq),
          justification: `LICM (§9.1.5): jump "${before}" enters the loop from outside, so it is retargeted to the preheader ("${formatQuad(wq)}"); the back edge still jumps to ${headerLabelName}.`,
        };
        changes.push(retarget);
        yield rewriteStep('licm', retarget, fn, CITE, { section, groupId });
      }
    }
  }

  const result = finishPass('licm', working, changes);
  yield passEndStep('licm', result.after, changes.length, CITE);
  return result;
}

export function runLicm(program: TacProgram): Recorded<PassState, PassEvent, OptPassResult> {
  return record(() => licm(program), initialPassState, passReducer, { id: 'opt.pass.licm' });
}

export { passStateFromResult as projectLicm };
