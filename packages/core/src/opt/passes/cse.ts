/**
 * Global common-subexpression elimination — Dragon Book (2nd ed.) §9.1.2,
 * justified by available expressions (§9.2.6): at a statement x = y op z where
 * y op z is AVAILABLE (computed on every path, operands undisturbed since),
 * the recomputation can be replaced by a use of the previously computed value.
 * Where the previous value does not survive in a single well-defined variable,
 * a carrier temp u is introduced: each contributing computation w = y op z
 * becomes u = y op z; w = u, and the redundant statement becomes x = u.
 */
import type { Quad, TacFunction, TacProgram } from '../../ir/types.js';
import { formatQuad } from '../../ir/types.js';
import type { Recorded, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { Cfg, OptPassResult } from '../types.js';
import type { PassEvent, PassState, RewriteChange } from '../opt-events.js';
import { initialPassState, passReducer, passStateFromResult } from '../opt-events.js';
import {
  addressTakenVars,
  availableExpressions,
  definedVar,
  exprKey,
  exprOperandVars,
  expressionKilledBy,
  varKey,
  type AvailExprsResult,
} from '../dataflow.js';
import { predecessors } from '../cfg.js';
import {
  cloneProgram,
  cfgOf,
  finishPass,
  passBeginStep,
  passEndStep,
  rewriteStep,
  type PassCite,
} from './util.js';

const CITE: PassCite = {
  section: '9.1.2',
  rule: 'An expression available at a point (§9.2.6) need not be recomputed; reuse the previously computed value',
};

/**
 * Find the contributing computation sites for expression e, available just
 * before quad `useQuadIndex` in block `blockId`: scan backwards inside the
 * block; if none, DFS backwards through predecessors, stopping in each block
 * at its last (downward-exposed) evaluation of e. Deterministic: preds in
 * ascending id order; result sorted by quad index.
 */
function findContributingSites(
  fn: TacFunction,
  cfg: Cfg,
  blockId: number,
  useQuadIndex: number,
  e: string,
  addrTaken: ReadonlySet<string>,
): number[] {
  const sites = new Set<number>();
  const site0 = fn.quads.find((x) => exprKey(x) === e);
  const operands = site0 ? exprOperandVars(site0) : [];
  const killersOf = (q: Quad): boolean => expressionKilledBy(q, operands, addrTaken);

  /** Last evaluation of e in `quadIndices` (scanning from `fromPos` backwards)
   *  with no kill of e's operands after it; returns site index, 'killed', or
   *  'none'. */
  const scanBack = (quadIndices: number[], fromPos: number): number | 'killed' | 'none' => {
    for (let i = fromPos; i >= 0; i--) {
      const q = fn.quads[quadIndices[i]!]!;
      if (exprKey(q) === e && !killersOf(q)) return q.index; // x=y+z with x∈{y,z} kills, not gens
      if (killersOf(q)) return 'killed';
      if (exprKey(q) === e) return 'killed';
    }
    return 'none';
  };

  const visited = new Set<number>();
  const visit = (b: number): void => {
    if (visited.has(b) || b < 0) return;
    visited.add(b);
    const block = cfg.blocks.find((x) => x.id === b);
    if (!block) return;
    const found = scanBack(block.quadIndices, block.quadIndices.length - 1);
    if (typeof found === 'number') {
      sites.add(found);
      return;
    }
    if (found === 'killed') return; // availability cannot flow through — unreachable given e is available
    for (const p of predecessors(cfg, b)) visit(p);
  };

  const useBlock = cfg.blocks.find((x) => x.id === blockId)!;
  const usePos = useBlock.quadIndices.indexOf(useQuadIndex);
  const local = scanBack(useBlock.quadIndices, usePos - 1);
  if (typeof local === 'number') return [local];
  if (local === 'killed') return [];
  visited.add(blockId);
  for (const p of predecessors(cfg, blockId)) visit(p);
  return [...sites].sort((a, b) => a - b);
}

export function* cse(program: TacProgram): Steps<PassEvent, OptPassResult> {
  const working = cloneProgram(program);
  const changes: RewriteChange[] = [];

  yield passBeginStep(
    'cse',
    working,
    CITE,
    'Global CSE computes available expressions (§9.2.6); a statement recomputing an available expression reuses the earlier value instead (§9.1.2).',
  );

  for (const fn of working.functions) {
    const frozen: TacFunction = { ...fn, quads: fn.quads.map((q) => ({ ...q })) };
    const cfg = cfgOf(frozen);
    const ae: AvailExprsResult = yield* availableExpressions(frozen, cfg);
    const addrTaken = addressTakenVars(frozen);

    // Count of definitions per variable in the ORIGINAL function (for the
    // "reuse the previous temp directly" fast path).
    const defCount: Record<string, number> = {};
    for (const q of frozen.quads) {
      const d = definedVar(q);
      if (d !== null) defCount[d] = (defCount[d] ?? 0) + 1;
    }

    // Working-copy positions: track quads by identity; original index -> quad.
    const byOriginalIndex = new Map<number, Quad>();
    fn.quads.forEach((q, i) => byOriginalIndex.set(i, q));
    const positionOf = (q: Quad): number => fn.quads.indexOf(q);

    /** carrier temp per expression, once introduced; plus rewritten sites. */
    const carrierOf = new Map<string, number>();
    const rewrittenSites = new Set<number>();

    // Point-level availability walk over the FROZEN program.
    const operandsOf: Record<string, string[]> = {};
    for (const key of ae.domain) {
      const s0 = (ae.sites[key] ?? [])[0];
      operandsOf[key] = s0 !== undefined ? exprOperandVars(frozen.quads[s0]!) : [];
    }

    for (const block of cfg.blocks) {
      let avail = new Set(ae.in[String(block.id)] ?? []);
      for (const qi of block.quadIndices) {
        const frozenQ = frozen.quads[qi]!;
        const e = exprKey(frozenQ);

        if (e !== null && avail.has(e) && frozenQ.result) {
          // Redundant recomputation of an available expression.
          const sites = findContributingSites(frozen, cfg, block.id, qi, e, addrTaken);
          if (sites.length > 0) {
            const workQ = byOriginalIndex.get(qi)!;
            const before = formatQuad(workQ);
            const singleSite = sites.length === 1 ? frozen.quads[sites[0]!]! : null;
            const singleResult = singleSite?.result ? varKey(singleSite.result) : null;
            const canReuseDirectly =
              singleSite !== null &&
              singleResult !== null &&
              /^t\d+$/.test(singleResult) && // "reuse the previous temp": only temps, never globals a call could change
              !rewrittenSites.has(sites[0]!) &&
              (defCount[singleResult] ?? 0) === 1 &&
              !addrTaken.has(singleResult);

            if (canReuseDirectly && singleSite.result) {
              const r = singleSite.result;
              workQ.op = 'copy';
              workQ.arg1 = { ...r };
              workQ.arg2 = null;
              delete workQ.relop;
              const change: RewriteChange = {
                functionName: fn.name,
                kind: 'replace',
                beforeIndex: qi,
                afterIndex: positionOf(workQ),
                justification: `Global CSE (§9.1.2): "${e}" is available at instruction ${qi} (§9.2.6) and its only computation is instruction ${sites[0]} into ${singleResult}, which is never reassigned; "${before}" becomes "${formatQuad(workQ)}".`,
              };
              changes.push(change);
              yield rewriteStep('cse', change, fn, CITE);
            } else {
              // Carrier-temp form: u = y op z at every contributing site.
              let u = carrierOf.get(e);
              if (u === undefined) {
                // Fresh carrier temp above every temp id in use (temps are
                // 1-based t1..tN with tempCount = N by convention).
                let maxId = fn.tempCount;
                for (const wq of fn.quads) {
                  for (const o of [wq.arg1, wq.arg2, wq.result]) {
                    if (o && o.kind === 'temp') maxId = Math.max(maxId, o.id);
                  }
                }
                u = maxId + 1;
                fn.tempCount = u;
                carrierOf.set(e, u);
              }
              for (const s of sites) {
                if (rewrittenSites.has(s)) continue;
                rewrittenSites.add(s);
                const siteQ = byOriginalIndex.get(s)!;
                const siteBefore = formatQuad(siteQ);
                const w = siteQ.result!;
                // siteQ becomes: u = y op z
                siteQ.result = { kind: 'temp', id: u };
                // insert w = u right after it
                const copyQ: Quad = {
                  index: siteQ.index,
                  op: 'copy',
                  arg1: { kind: 'temp', id: u },
                  arg2: null,
                  result: w,
                  astNodeId: siteQ.astNodeId,
                };
                const pos = positionOf(siteQ);
                fn.quads.splice(pos + 1, 0, copyQ);
                const replaceChange: RewriteChange = {
                  functionName: fn.name,
                  kind: 'replace',
                  beforeIndex: s,
                  afterIndex: pos,
                  justification: `Global CSE (§9.1.2): instruction ${s} ("${siteBefore}") computes "${e}", which is reused later; it now computes carrier temp t${u} ("${formatQuad(siteQ)}").`,
                };
                changes.push(replaceChange);
                yield rewriteStep('cse', replaceChange, fn, CITE);
                const insertChange: RewriteChange = {
                  functionName: fn.name,
                  kind: 'insert',
                  beforeIndex: null,
                  afterIndex: pos + 1,
                  justification: `Global CSE (§9.1.2): "${formatQuad(copyQ)}" inserted so the original target of instruction ${s} still receives the value of "${e}".`,
                };
                changes.push(insertChange);
                yield rewriteStep('cse', insertChange, fn, CITE, {
                  irRefs: [{ kind: 'tacInstr', id: pos + 1 }],
                });
              }
              workQ.op = 'copy';
              workQ.arg1 = { kind: 'temp', id: u };
              workQ.arg2 = null;
              delete workQ.relop;
              const change: RewriteChange = {
                functionName: fn.name,
                kind: 'replace',
                beforeIndex: qi,
                afterIndex: positionOf(workQ),
                justification: `Global CSE (§9.1.2): "${e}" is available at instruction ${qi} on every path (§9.2.6); the recomputation "${before}" reuses carrier temp t${u} and becomes "${formatQuad(workQ)}".`,
              };
              changes.push(change);
              yield rewriteStep('cse', change, fn, CITE);
            }
          }
        }

        // Advance point-level availability past this (frozen) quad: a
        // redefined operand kills (§9.2.6), and so do the indirect writes of
        // §8.5.6 — stores through pointers, array stores, procedure calls.
        if (e !== null) avail.add(e);
        avail = new Set(
          [...avail].filter((x) => !expressionKilledBy(frozenQ, operandsOf[x] ?? [], addrTaken)),
        );
      }
    }
  }

  const result = finishPass('cse', working, changes);
  yield passEndStep('cse', result.after, changes.length, CITE);
  return result;
}

export function runCse(program: TacProgram): Recorded<PassState, PassEvent, OptPassResult> {
  return record(() => cse(program), initialPassState, passReducer, { id: 'opt.pass.cse' });
}

export { passStateFromResult as projectCse };
