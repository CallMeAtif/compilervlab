/**
 * Three-address code — quadruples are the canonical representation (§6.2.2);
 * triples and indirect triples are derived views (§6.2.3), computed not stored.
 */

export type TacOperand =
  | { kind: 'temp'; id: number } // t1, t2, …
  | { kind: 'var'; symbolId: number; name: string }
  | { kind: 'const'; value: number; ctype: 'int' | 'float' | 'char' }
  | { kind: 'label'; name: string };

export type TacOp =
  // x = y op z
  | '+' | '-' | '*' | '/' | '%'
  | '==' | '!=' | '<' | '>' | '<=' | '>='
  // x = op y
  | 'neg' | 'not'
  | 'copy' // x = y
  | 'inttofloat' // widening conversion (§6.5.2)
  // control flow
  | 'label' | 'goto'
  | 'if' // if x goto L        (x true)
  | 'iffalse' // ifFalse x goto L
  | 'ifrel' // if x relop y goto L  (§6.6.3 jumping code)
  // functions (§6.9 pattern: param x; call p, n; y = call p, n; return x)
  | 'param' | 'call' | 'return'
  // arrays (§6.4.3): x = y[i] / x[i] = y
  | 'index-load' | 'index-store'
  // pointers: x = &y / x = *y / *x = y
  | 'addr' | 'deref-load' | 'deref-store';

export interface Quad {
  index: number; // instruction number (the book numbers TAC instructions)
  op: TacOp;
  arg1: TacOperand | null;
  arg2: TacOperand | null;
  /** For ifrel: the relational operator applied to arg1/arg2. */
  relop?: '==' | '!=' | '<' | '>' | '<=' | '>=';
  result: TacOperand | null;
  /** AST node whose translation emitted this instruction (provenance). */
  astNodeId: number;
}

export interface TacFunction {
  name: string;
  symbolId: number;
  params: number[]; // symbolIds
  quads: Quad[];
  tempCount: number;
}

/**
 * The initial value of a statically allocated global. Globals are laid out in
 * the static data area before execution begins (§7.1), so an initializer is a
 * compile-time constant (enforced by the semantic pass) rather than code.
 */
export interface GlobalInit {
  symbolId: number;
  name: string;
  value: number;
  ctype: 'int' | 'float' | 'char';
}

export interface TacProgram {
  functions: TacFunction[];
  /** Global variable symbolIds in declaration order. */
  globals: number[];
  /** Initial values for the globals that have an initializer (declaration
   *  order). Globals absent from this list start at 0. */
  globalInits?: GlobalInit[];
}

/**
 * Render a constant operand. A float constant must stay distinguishable from an
 * int one — the §6.5.2 widening steps are only readable if `1` and `1.0` look
 * different — so an integral float keeps an explicit fractional part.
 */
export function formatConst(o: Extract<TacOperand, { kind: 'const' }>): string {
  const s = String(o.value);
  return o.ctype === 'float' && /^-?\d+$/.test(s) ? `${s}.0` : s;
}

/** Render one quad in the book's TAC syntax ("t1 = a + b", "ifFalse t1 goto L2"). */
export function formatQuad(q: Quad): string {
  const f = (o: TacOperand | null): string => {
    if (!o) return '';
    switch (o.kind) {
      case 'temp':
        return `t${o.id}`;
      case 'var':
        return o.name;
      case 'const':
        return formatConst(o);
      case 'label':
        return o.name;
    }
  };
  switch (q.op) {
    case 'label':
      return `${f(q.result)}:`;
    case 'goto':
      return `goto ${f(q.result)}`;
    case 'if':
      return `if ${f(q.arg1)} goto ${f(q.result)}`;
    case 'iffalse':
      return `ifFalse ${f(q.arg1)} goto ${f(q.result)}`;
    case 'ifrel':
      return `if ${f(q.arg1)} ${q.relop} ${f(q.arg2)} goto ${f(q.result)}`;
    case 'copy':
      return `${f(q.result)} = ${f(q.arg1)}`;
    case 'neg':
      return `${f(q.result)} = minus ${f(q.arg1)}`;
    case 'not':
      return `${f(q.result)} = not ${f(q.arg1)}`;
    case 'inttofloat':
      return `${f(q.result)} = (float) ${f(q.arg1)}`;
    case 'param':
      return `param ${f(q.arg1)}`;
    case 'call':
      return q.result
        ? `${f(q.result)} = call ${f(q.arg1)}, ${f(q.arg2)}`
        : `call ${f(q.arg1)}, ${f(q.arg2)}`;
    case 'return':
      return q.arg1 ? `return ${f(q.arg1)}` : 'return';
    case 'index-load':
      return `${f(q.result)} = ${f(q.arg1)} [ ${f(q.arg2)} ]`;
    case 'index-store':
      return `${f(q.result)} [ ${f(q.arg2)} ] = ${f(q.arg1)}`;
    case 'addr':
      return `${f(q.result)} = & ${f(q.arg1)}`;
    case 'deref-load':
      return `${f(q.result)} = * ${f(q.arg1)}`;
    case 'deref-store':
      return `* ${f(q.result)} = ${f(q.arg1)}`;
    default:
      return `${f(q.result)} = ${f(q.arg1)} ${q.op} ${f(q.arg2)}`;
  }
}
