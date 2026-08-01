/**
 * Derived TAC views (§6.2.3): triples and indirect triples, computed on demand
 * from the canonical quadruples — never stored (the contract keeps quads as the
 * single representation).
 *
 * In a triple, the result of an operation is referred to by its position:
 * operand "(1)" means "the value computed by triple 1" (Fig 6.11(b)). A copy
 * into a named variable becomes an explicit "=" triple. Array accesses expand
 * to the book's two-row form when a named result is involved: "x = a[i]" is
 * `=[] a i` then `= x (that row)`; "a[i] = x" is `[]= a i` then `= (that row) x`
 * (Fig 6.11 discussion). Indirect triples add a listing of pointers to triples
 * so instructions can be reordered without renumbering (Fig 6.12).
 *
 * A position reference is only meaningful when one triple computes the value.
 * A temporary written by several quads — the 1/0 materialization of a boolean
 * value (§6.6.6), where the producer depends on which branch ran — is therefore
 * kept as a name (t1) and written by an explicit "=" row, never referenced as
 * "(i)".
 */
import { formatConst } from './types.js';
import type { Quad, TacFunction, TacOperand } from './types.js';

export interface TripleRow {
  /** Position of this triple — what "(i)" operands refer to. */
  index: number;
  op: string;
  arg1: string;
  arg2: string;
  /** Jump target label, when the row is a jump (kept symbolic; the book omits
   *  jumps from its triple examples because positions shift on reordering). */
  target?: string;
  /** Index of the quad this row was derived from (provenance). */
  quadIndex: number;
}

export interface IndirectTriplesView {
  /** The instruction listing: execution order as pointers into `triples`. */
  order: number[];
  triples: TripleRow[];
}

/** Render an operand for a triple row: temporaries become "(i)" position
 *  references to the row that computed them. */
function ref(o: TacOperand | null, tempDef: Map<number, number>): string {
  if (!o) return '';
  switch (o.kind) {
    case 'temp': {
      const def = tempDef.get(o.id);
      return def === undefined ? `t${o.id}` : `(${def})`;
    }
    case 'var':
      return o.name;
    case 'const':
      return formatConst(o);
    case 'label':
      return o.name;
  }
}

/**
 * Temporaries assigned by more than one quad. Position references ("(i)") name
 * *the value computed by triple i*, so a temporary whose producer is decided by
 * control flow — the 1/0 materialization of a boolean value, §6.6.6 — cannot be
 * referred to that way. Such temporaries keep their name and are written into
 * by an explicit "=" row, exactly like a named variable.
 */
function multiplyDefinedTemps(quads: readonly Quad[]): Set<number> {
  const seen = new Set<number>();
  const multi = new Set<number>();
  for (const q of quads) {
    const r = q.result;
    if (!r || r.kind !== 'temp') continue;
    if (q.op === 'label' || q.op === 'goto' || q.op === 'if' || q.op === 'iffalse' || q.op === 'ifrel') {
      continue; // `result` is the jump target there, not a definition
    }
    if (q.op === 'index-store' || q.op === 'deref-store') continue; // result is the destination address
    if (seen.has(r.id)) multi.add(r.id);
    seen.add(r.id);
  }
  return multi;
}

/** Derive the triple view of one function's quads (§6.2.3, Fig 6.11(b)). */
export function toTriples(fn: TacFunction): TripleRow[] {
  const rows: TripleRow[] = [];
  /** temp id → triple index that computes it */
  const tempDef = new Map<number, number>();
  const multiDef = multiplyDefinedTemps(fn.quads);

  const push = (row: Omit<TripleRow, 'index'>): TripleRow => {
    const r: TripleRow = { index: rows.length, ...row };
    rows.push(r);
    return r;
  };
  /** A temporary is representable by its producing position only when exactly
   *  one quad defines it; otherwise it behaves like a named variable. */
  const byPosition = (result: TacOperand | null): boolean =>
    !!result && result.kind === 'temp' && !multiDef.has(result.id);
  const defineTemp = (result: TacOperand | null, rowIndex: number): void => {
    if (result && result.kind === 'temp' && !multiDef.has(result.id)) {
      tempDef.set(result.id, rowIndex);
    }
  };

  for (const q of fn.quads) {
    switch (q.op) {
      case 'label':
        push({ op: 'label', arg1: ref(q.result, tempDef), arg2: '', quadIndex: q.index });
        break;
      case 'goto':
        push({
          op: 'goto',
          arg1: '',
          arg2: '',
          ...(q.result && q.result.kind === 'label' ? { target: q.result.name } : {}),
          quadIndex: q.index,
        });
        break;
      case 'if':
      case 'iffalse':
        push({
          op: q.op === 'if' ? 'if' : 'ifFalse',
          arg1: ref(q.arg1, tempDef),
          arg2: '',
          ...(q.result && q.result.kind === 'label' ? { target: q.result.name } : {}),
          quadIndex: q.index,
        });
        break;
      case 'ifrel':
        push({
          op: `if${q.relop ?? '?'}`,
          arg1: ref(q.arg1, tempDef),
          arg2: ref(q.arg2, tempDef),
          ...(q.result && q.result.kind === 'label' ? { target: q.result.name } : {}),
          quadIndex: q.index,
        });
        break;
      case 'copy': {
        // x = y becomes an explicit "=" triple (Fig 6.11(b) row 5: "= a (4)").
        if (byPosition(q.result)) {
          const r = push({ op: '=', arg1: ref(q.arg1, tempDef), arg2: '', quadIndex: q.index });
          defineTemp(q.result, r.index);
        } else {
          push({ op: '=', arg1: ref(q.result, tempDef), arg2: ref(q.arg1, tempDef), quadIndex: q.index });
        }
        break;
      }
      case 'index-load': {
        // x = y[i]: "=[] y i" then, for a named x, "= x (row)".
        const access = push({
          op: '=[]',
          arg1: ref(q.arg1, tempDef),
          arg2: ref(q.arg2, tempDef),
          quadIndex: q.index,
        });
        if (byPosition(q.result)) {
          defineTemp(q.result, access.index);
        } else {
          push({ op: '=', arg1: ref(q.result, tempDef), arg2: `(${access.index})`, quadIndex: q.index });
        }
        break;
      }
      case 'index-store': {
        // x[i] = y: "[]= x i" then "= (row) y" (Fig 6.11 discussion).
        const access = push({
          op: '[]=',
          arg1: ref(q.result, tempDef),
          arg2: ref(q.arg2, tempDef),
          quadIndex: q.index,
        });
        push({ op: '=', arg1: `(${access.index})`, arg2: ref(q.arg1, tempDef), quadIndex: q.index });
        break;
      }
      case 'param':
        push({ op: 'param', arg1: ref(q.arg1, tempDef), arg2: '', quadIndex: q.index });
        break;
      case 'call': {
        const r = push({
          op: 'call',
          arg1: ref(q.arg1, tempDef),
          arg2: ref(q.arg2, tempDef),
          quadIndex: q.index,
        });
        if (byPosition(q.result)) {
          defineTemp(q.result, r.index);
        } else if (q.result) {
          push({ op: '=', arg1: ref(q.result, tempDef), arg2: `(${r.index})`, quadIndex: q.index });
        }
        break;
      }
      case 'return':
        push({ op: 'return', arg1: ref(q.arg1, tempDef), arg2: '', quadIndex: q.index });
        break;
      case 'deref-store':
        // *x = y
        push({
          op: '*=',
          arg1: ref(q.result, tempDef),
          arg2: ref(q.arg1, tempDef),
          quadIndex: q.index,
        });
        break;
      default: {
        // value-producing ops: + - * / % relops neg not inttofloat addr deref-load
        const opName =
          q.op === 'neg' ? 'minus' : q.op === 'addr' ? '&' : q.op === 'deref-load' ? '*(deref)' : q.op;
        const r = push({
          op: opName,
          arg1: ref(q.arg1, tempDef),
          arg2: ref(q.arg2, tempDef),
          quadIndex: q.index,
        });
        if (byPosition(q.result)) {
          defineTemp(q.result, r.index);
        } else if (q.result) {
          push({ op: '=', arg1: ref(q.result, tempDef), arg2: `(${r.index})`, quadIndex: q.index });
        }
        break;
      }
    }
  }
  return rows;
}

/** Derive the indirect-triple view (§6.2.3, Fig 6.12): the same triples plus
 *  an instruction listing of pointers into them. Freshly derived, the listing
 *  is the identity order; an optimizer could permute it without renumbering. */
export function toIndirectTriples(fn: TacFunction): IndirectTriplesView {
  const triples = toTriples(fn);
  return { order: triples.map((t) => t.index), triples };
}
