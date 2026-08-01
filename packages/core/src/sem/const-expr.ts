/**
 * Constant expressions.
 *
 * A variable with static storage duration — every global in the lab's C subset —
 * is allocated in the static data area and its initial value must be known when
 * the program is laid out, so the initializer has to be a constant expression
 * (C11 6.7.9p4; Dragon Book §7.1 "static allocation": statically allocated names
 * hold values known at compile time). Everything computable from constants
 * alone is accepted: the operators of the subset applied to constants, with the
 * same typing rules the checker uses (char promotes to int; a float operand
 * makes the result float; `/` truncates on integers).
 *
 * Returns null for anything that is not a constant expression — a name, a call,
 * an index, an assignment, or an operation the language rejects at run time
 * (division by zero, `%` on floats).
 */
import type { Expr } from '../ast/types.js';

export interface ConstValue {
  value: number;
  /** True when the value has type float (the operand's ctype in the IR). */
  isFloat: boolean;
}

function num(value: number, isFloat: boolean): ConstValue | null {
  return Number.isFinite(value) ? { value, isFloat } : null;
}

/** Fold `e` to a compile-time constant, or null if it is not one. */
export function evalConstExpr(e: Expr): ConstValue | null {
  switch (e.kind) {
    case 'Const':
      // intconst : int, charconst : char (promotes to int), floatconst : float.
      return num(e.value, e.constType === 'float');
    case 'Unary': {
      if (e.op !== '-' && e.op !== '!') return null; // & and * need an object
      const v = evalConstExpr(e.operand);
      if (v === null) return null;
      return e.op === '-' ? num(-v.value, v.isFloat) : num(v.value === 0 ? 1 : 0, false);
    }
    case 'Binary': {
      const l = evalConstExpr(e.left);
      if (l === null) return null;
      // && and || short-circuit, but both operands must still be constant for
      // the whole expression to be one.
      const r = evalConstExpr(e.right);
      if (r === null) return null;
      const f = l.isFloat || r.isFloat;
      switch (e.op) {
        case '+': return num(l.value + r.value, f);
        case '-': return num(l.value - r.value, f);
        case '*': return num(l.value * r.value, f);
        case '/':
          if (r.value === 0) return null; // division by zero is not a constant
          return num(f ? l.value / r.value : Math.trunc(l.value / r.value), f);
        case '%':
          if (f || r.value === 0) return null; // '%' requires integers (rule 1)
          return num(l.value % r.value, false);
        case '==': return num(l.value === r.value ? 1 : 0, false);
        case '!=': return num(l.value !== r.value ? 1 : 0, false);
        case '<': return num(l.value < r.value ? 1 : 0, false);
        case '>': return num(l.value > r.value ? 1 : 0, false);
        case '<=': return num(l.value <= r.value ? 1 : 0, false);
        case '>=': return num(l.value >= r.value ? 1 : 0, false);
        case '&&': return num(l.value !== 0 && r.value !== 0 ? 1 : 0, false);
        case '||': return num(l.value !== 0 || r.value !== 0 ? 1 : 0, false);
      }
      return null;
    }
    default:
      // Ident, Call, Index, Assign: their value is not known until run time.
      return null;
  }
}
