/**
 * Constant folding — Dragon Book (2nd ed.) §8.5.4: "we can eliminate any step
 * that computes a value all of whose operands are constants, replacing it by
 * the constant value". Respects the lab's C-subset semantics: int arithmetic
 * truncates toward zero, mixed int/float folds in float, and division or
 * remainder by zero is NEVER folded (it must remain a runtime error).
 */
import type { Quad, TacOperand, TacProgram } from '../../ir/types.js';
import { formatQuad } from '../../ir/types.js';
import type { Recorded, Steps } from '@lab/trace';
import { record } from '@lab/trace';
import type { OptPassResult } from '../types.js';
import type { PassEvent, PassState, RewriteChange } from '../opt-events.js';
import { initialPassState, passReducer, passStateFromResult } from '../opt-events.js';
import {
  cloneProgram,
  finishPass,
  passBeginStep,
  passEndStep,
  rewriteStep,
  type PassCite,
} from './util.js';

const CITE: PassCite = {
  section: '8.5.4',
  rule: 'Constant folding: evaluate constant expressions at compile time and replace them by their values',
};

type ConstOp = Extract<TacOperand, { kind: 'const' }>;

const isConst = (o: TacOperand | null): o is ConstOp => o !== null && o.kind === 'const';

/** Fold one quad if all value operands are constants; null if not foldable. */
export function foldQuad(q: Quad): { value: number; ctype: ConstOp['ctype'] } | null | 'div-by-zero' {
  const binary = ['+', '-', '*', '/', '%', '==', '!=', '<', '>', '<=', '>='];
  if (binary.includes(q.op)) {
    if (!isConst(q.arg1) || !isConst(q.arg2)) return null;
    const a = q.arg1;
    const b = q.arg2;
    const float = a.ctype === 'float' || b.ctype === 'float';
    const x = a.value;
    const y = b.value;
    switch (q.op) {
      case '+':
      case '-':
      case '*':
      case '/':
      case '%': {
        if ((q.op === '/' || q.op === '%') && y === 0) return 'div-by-zero';
        if (q.op === '%' && float) return null; // % requires integer operands
        let v: number;
        if (q.op === '+') v = x + y;
        else if (q.op === '-') v = x - y;
        else if (q.op === '*') v = x * y;
        else if (q.op === '/') v = float ? x / y : Math.trunc(x / y);
        else v = x % y; // JS % truncates toward zero, matching C
        return { value: v, ctype: float ? 'float' : 'int' };
      }
      default: {
        // Relational/equality: int 0/1 result.
        const r =
          q.op === '==' ? x === y
          : q.op === '!=' ? x !== y
          : q.op === '<' ? x < y
          : q.op === '>' ? x > y
          : q.op === '<=' ? x <= y
          : x >= y;
        return { value: r ? 1 : 0, ctype: 'int' };
      }
    }
  }
  if (q.op === 'neg' && isConst(q.arg1)) {
    return { value: -q.arg1.value, ctype: q.arg1.ctype === 'float' ? 'float' : 'int' };
  }
  if (q.op === 'not' && isConst(q.arg1)) {
    return { value: q.arg1.value === 0 ? 1 : 0, ctype: 'int' };
  }
  if (q.op === 'inttofloat' && isConst(q.arg1)) {
    return { value: q.arg1.value, ctype: 'float' };
  }
  return null;
}

export function* constFold(program: TacProgram): Steps<PassEvent, OptPassResult> {
  const working = cloneProgram(program);
  const changes: RewriteChange[] = [];

  yield passBeginStep(
    'const-fold',
    working,
    CITE,
    'Constant folding scans every instruction and evaluates those whose operands are all compile-time constants (§8.5.4).',
  );

  for (const fn of working.functions) {
    for (const q of fn.quads) {
      const folded = foldQuad(q);
      if (folded === null) continue;
      const before = formatQuad(q);
      if (folded === 'div-by-zero') {
        yield [
          {
            kind: 'rewrite-skipped',
            pass: 'const-fold',
            functionName: fn.name,
            quadIndex: q.index,
            reason: `${before} divides by the constant 0: folding would erase a runtime error, so the instruction is left unchanged.`,
          },
          {
            cite: CITE,
            prose: `Skip ${before}: division/remainder by zero is a runtime error in the C subset and must not be evaluated at compile time.`,
            level: 'macro',
            section: `Rewrites (${fn.name})`,
            irRefs: [{ kind: 'tacInstr', id: q.index }],
          },
        ];
        continue;
      }
      // Replace the computation by x = constant.
      q.op = 'copy';
      q.arg1 = { kind: 'const', value: folded.value, ctype: folded.ctype };
      q.arg2 = null;
      delete q.relop;
      const change: RewriteChange = {
        functionName: fn.name,
        kind: 'replace',
        beforeIndex: q.index,
        afterIndex: q.index,
        justification: `Constant folding (§8.5.4): "${before}" has only constant operands and evaluates to ${folded.value}${
          folded.ctype === 'float' ? ' (float)' : ''
        }, so it becomes "${formatQuad(q)}".`,
      };
      changes.push(change);
      yield rewriteStep('const-fold', change, fn, CITE);
    }
  }

  const result = finishPass('const-fold', working, changes);
  yield passEndStep('const-fold', result.after, changes.length, CITE);
  return result;
}

export function runConstFold(program: TacProgram): Recorded<PassState, PassEvent, OptPassResult> {
  return record(() => constFold(program), initialPassState, passReducer, { id: 'opt.pass.const-fold' });
}

export { passStateFromResult as projectConstFold };
