/**
 * Traced AST → three-address-code translation (Dragon Book 2nd ed., Ch. 6).
 *
 * - Expressions per §6.4 (Fig 6.19/6.20): a new temporary per subexpression.
 * - Boolean expressions and control flow as jumping code with backpatching per
 *   §6.6/§6.7: makelist / merge / backpatch (§6.7.1), the marker-nonterminal
 *   translation scheme of Fig 6.43 (§6.7.2) and Fig 6.46 (§6.7.3).
 * - Arrays per §6.4.3 (element address = base + i × width) translated with the
 *   semantic actions of Fig 6.22 (§6.4.4), then index-load / index-store.
 * - Address / pointer instruction forms (x = &y, x = *y, *x = y) per §6.2.1.
 * - Type conversions per §6.5.2 (explicit inttofloat quads where SemanticInfo
 *   recorded a widening).
 * - Functions per §6.9 (param / call / return).
 *
 * One TacFunction per FuncDef; global variables are collected. Labels are
 * L1, L2, … per function in creation order and are bound by emitted `label`
 * quads; backpatching fills jump targets with those labels.
 */
import type { SourceSpan, StepMeta, Steps, Recorded } from '@lab/trace';
import { record } from '@lab/trace';
import type {
  Ast,
  AssignExprNode,
  BinaryExprNode,
  CallExprNode,
  CompoundStmtNode,
  Expr,
  ForStmtNode,
  FuncDefNode,
  IfStmtNode,
  IndexExprNode,
  ReturnStmtNode,
  Stmt,
  UnaryExprNode,
  VarDeclNode,
  WhileStmtNode,
} from '../ast/types.js';
import type { CType, SemanticInfo, SymbolEntry } from '../sem/types.js';
import { evalConstExpr } from '../sem/const-expr.js';
import type { GlobalInit, Quad, TacFunction, TacOp, TacOperand, TacProgram } from './types.js';
import { formatConst } from './types.js';
import type { BpList } from './backpatch.js';
import { backpatch, emptyList, makelist, mergeLists } from './backpatch.js';
import type { IrEvent, IrGenState } from './ir-events.js';
import { initialIrGenState, irGenReducer } from './ir-events.js';

export type { TacProgram, TacFunction, Quad } from './types.js';

// ── widths (§6.3.4 / task spec) ──────────────────────────────────────────────

/** Storage width in bytes: char = 1, int = 4, float = 8, pointer = 8. */
export function typeWidth(t: CType): number {
  switch (t.kind) {
    case 'base':
      if (t.name === 'char') return 1;
      if (t.name === 'int') return 4;
      if (t.name === 'float') return 8;
      throw new Error('void has no width');
    case 'pointer':
      return 8;
    case 'array':
      return typeWidth(t.of) * (t.length ?? 0);
    case 'function':
      throw new Error('function type has no width');
  }
}

// ── generator context (internal, never emitted) ──────────────────────────────

interface GenCtx {
  ast: Ast;
  sem: SemanticInfo;
  symById: Map<number, SymbolEntry>;
  func: string;
  section: string;
  quads: Quad[];
  tempCount: number;
  labelCount: number;
  nextListId: () => number;
}

interface LabelMark {
  name: string;
  instr: number;
}

function cloneOperand(o: TacOperand | null): TacOperand | null {
  return o === null ? null : { ...o };
}

function cloneQuad(q: Quad): Quad {
  const c: Quad = {
    index: q.index,
    op: q.op,
    arg1: cloneOperand(q.arg1),
    arg2: cloneOperand(q.arg2),
    result: cloneOperand(q.result),
    astNodeId: q.astNodeId,
  };
  if (q.relop !== undefined) c.relop = q.relop;
  return c;
}

function intConst(value: number): TacOperand {
  return { kind: 'const', value, ctype: 'int' };
}

function isFloatBase(t: CType | undefined): boolean {
  return !!t && t.kind === 'base' && t.name === 'float';
}

// ── step-meta helpers ────────────────────────────────────────────────────────

function macro(
  ctx: GenCtx,
  section: string,
  cite: StepMeta['cite'],
  prose: string,
  groupId: string,
  extras?: Partial<StepMeta>,
): StepMeta {
  return { cite, prose, level: 'macro', groupId, section, ...extras };
}

function micro(
  ctx: GenCtx,
  cite: StepMeta['cite'],
  prose: string,
  groupId: string,
  extras?: Partial<StepMeta>,
): StepMeta {
  return { cite, prose, level: 'micro', groupId, section: ctx.section, ...extras };
}

// ── primitive emitters ───────────────────────────────────────────────────────

function* emitQuad(
  ctx: GenCtx,
  q: Omit<Quad, 'index'>,
  cite: StepMeta['cite'],
  prose: string,
): Steps<IrEvent, Quad> {
  const quad: Quad = { index: ctx.quads.length, ...q };
  ctx.quads.push(quad);
  yield [
    { kind: 'emit-quad', func: ctx.func, quad: cloneQuad(quad) },
    micro(ctx, cite, prose, `n${q.astNodeId}`, {
      irRefs: [
        { kind: 'tacInstr', id: quad.index },
        { kind: 'astNode', id: q.astNodeId },
      ],
    }),
  ];
  return quad;
}

function newTemp(ctx: GenCtx): TacOperand {
  ctx.tempCount += 1;
  return { kind: 'temp', id: ctx.tempCount };
}

/** Emit a fresh label Ln bound to the next instruction — the marker
 *  nonterminal M of §6.7.2 ("M → ε { M.instr = nextinstr }") made concrete as
 *  a `label` quad. */
function* newLabel(ctx: GenCtx, astNodeId: number, why: string): Steps<IrEvent, LabelMark> {
  ctx.labelCount += 1;
  const name = `L${ctx.labelCount}`;
  const instr = ctx.quads.length;
  yield* emitQuad(
    ctx,
    { op: 'label', arg1: null, arg2: null, result: { kind: 'label', name }, astNodeId },
    { section: '6.7.2', rule: 'M → ε { M.instr = nextinstr }' },
    `Marker M: bind label ${name} to instruction ${instr} — ${why}`,
  );
  return { name, instr };
}

// ── typed lookups ────────────────────────────────────────────────────────────

function nodeType(ctx: GenCtx, id: number): CType {
  const t = ctx.sem.nodeTypes[id];
  if (!t) throw new Error(`ir gen: no type recorded for AST node ${id}`);
  return t;
}

function resolvedSymbol(ctx: GenCtx, id: number): SymbolEntry {
  const sid = ctx.sem.resolved[id];
  if (sid === undefined) throw new Error(`ir gen: AST node ${id} is unresolved`);
  const sym = ctx.symById.get(sid);
  if (!sym) throw new Error(`ir gen: unknown symbol id ${sid}`);
  return sym;
}

function varOperand(sym: SymbolEntry): TacOperand {
  return { kind: 'var', symbolId: sym.id, name: sym.name };
}

/** Emit `t = (float) x` when SemanticInfo recorded an int/char → float
 *  widening for this expression node (§6.5.2). */
function* maybeConvert(
  ctx: GenCtx,
  op: TacOperand,
  exprNodeId: number,
): Steps<IrEvent, TacOperand> {
  const conv = ctx.sem.conversions[exprNodeId];
  if (!conv) return op;
  if (isFloatBase(conv.to) && !isFloatBase(conv.from)) {
    const t = newTemp(ctx);
    yield* emitQuad(
      ctx,
      { op: 'inttofloat', arg1: op, arg2: null, result: t, astNodeId: exprNodeId },
      { section: '6.5.2', figureOrAlgo: 'Fig 6.26', rule: 'widen(a, t, w): gen(temp = (float) a)' },
      'Widen the integer operand to float: emit an explicit inttofloat conversion into a new temporary.',
    );
    return t;
  }
  return op;
}

// ── expressions as r-values (§6.4) ───────────────────────────────────────────

const RELOPS = ['==', '!=', '<', '>', '<=', '>='] as const;
type Relop = (typeof RELOPS)[number];

function isRelop(op: string): op is Relop {
  return (RELOPS as readonly string[]).includes(op);
}

function* enterNode(
  ctx: GenCtx,
  n: { id: number; kind: string; span: SourceSpan },
  cite: StepMeta['cite'],
  prose: string,
): Steps<IrEvent, null> {
  yield [
    { kind: 'enter-node', func: ctx.func, astNodeId: n.id, nodeKind: n.kind },
    macro(ctx, ctx.section, cite, prose, `n${n.id}`, {
      srcSpans: [n.span],
      irRefs: [{ kind: 'astNode', id: n.id }],
    }),
  ];
  return null;
}

function* genRvalue(ctx: GenCtx, e: Expr): Steps<IrEvent, TacOperand> {
  switch (e.kind) {
    case 'Const':
      // E → num: the address of a constant is the constant itself (Fig 6.20).
      return { kind: 'const', value: e.value, ctype: e.constType };
    case 'Ident': {
      const sym = resolvedSymbol(ctx, e.id);
      if (sym.type.kind === 'array') {
        // Array name in value context decays to a pointer to its first
        // element (c-subset rule 6): take its base address.
        yield* enterNode(
          ctx,
          e,
          { section: '6.4.3', rule: 'array name in an expression denotes the base address' },
          `Array ${sym.name} appears in value context: it decays to a pointer, so take its base address.`,
        );
        const t = newTemp(ctx);
        yield* emitQuad(
          ctx,
          { op: 'addr', arg1: varOperand(sym), arg2: null, result: t, astNodeId: e.id },
          { section: '6.2.1', rule: 'x = &y sets x to the location of y' },
          `${sym.name} is an array; its value as a pointer is its base address.`,
        );
        return t;
      }
      // E → id { E.addr = top.get(id.lexeme) } — no code (Fig 6.20).
      return varOperand(sym);
    }
    case 'Assign':
      return yield* genAssign(ctx, e);
    case 'Unary':
      return yield* genUnaryRvalue(ctx, e);
    case 'Binary':
      return yield* genBinaryRvalue(ctx, e);
    case 'Index':
      return yield* genIndexRvalue(ctx, e);
    case 'Call': {
      const r = yield* genCall(ctx, e, true);
      if (!r) throw new Error('ir gen: void call used as a value');
      return r;
    }
  }
}

function* genUnaryRvalue(ctx: GenCtx, e: UnaryExprNode): Steps<IrEvent, TacOperand> {
  switch (e.op) {
    case '-': {
      yield* enterNode(
        ctx,
        e,
        { section: '6.4.1', figureOrAlgo: 'Fig 6.19', rule: 'E → - E1 { gen(E.addr = minus E1.addr) }' },
        'Unary minus: translate the operand, then negate it into a new temporary.',
      );
      const o = yield* genRvalue(ctx, e.operand);
      const t = newTemp(ctx);
      yield* emitQuad(
        ctx,
        { op: 'neg', arg1: o, arg2: null, result: t, astNodeId: e.id },
        { section: '6.4.1', figureOrAlgo: 'Fig 6.19', rule: 'E → - E1 { gen(E.addr = minus E1.addr) }' },
        'Negate the operand into a fresh temporary.',
      );
      return t;
    }
    case '!': {
      yield* enterNode(
        ctx,
        e,
        { section: '6.6.1', rule: 'numerical representation: !x computes 1 − truth(x)' },
        'Logical not in value context: compute the 0/1 value numerically.',
      );
      const o = yield* genRvalue(ctx, e.operand);
      const t = newTemp(ctx);
      yield* emitQuad(
        ctx,
        { op: 'not', arg1: o, arg2: null, result: t, astNodeId: e.id },
        { section: '6.6.1', rule: 'booleans represented numerically: 0 = false, 1 = true' },
        'Compute the logical negation as a 0/1 value in a fresh temporary.',
      );
      return t;
    }
    case '*': {
      yield* enterNode(
        ctx,
        e,
        { section: '6.2.1', rule: 'x = *y: set x to the value at location y' },
        'Pointer dereference in value context: load through the pointer.',
      );
      const p = yield* genRvalue(ctx, e.operand);
      const t = newTemp(ctx);
      yield* emitQuad(
        ctx,
        { op: 'deref-load', arg1: p, arg2: null, result: t, astNodeId: e.id },
        { section: '6.2.1', rule: 'x = *y: set x to the value at location y' },
        'Load the value the pointer refers to into a fresh temporary.',
      );
      return t;
    }
    case '&':
      return yield* genAddressOf(ctx, e);
  }
}

function* genAddressOf(ctx: GenCtx, e: UnaryExprNode): Steps<IrEvent, TacOperand> {
  yield* enterNode(
    ctx,
    e,
    { section: '6.2.1', rule: 'x = &y sets x to the location of y' },
    'Address-of: compute the address of the l-value operand.',
  );
  const target = e.operand;
  if (target.kind === 'Ident') {
    const sym = resolvedSymbol(ctx, target.id);
    const t = newTemp(ctx);
    yield* emitQuad(
      ctx,
      { op: 'addr', arg1: varOperand(sym), arg2: null, result: t, astNodeId: e.id },
      { section: '6.2.1', rule: 'x = &y sets x to the location of y' },
      `Take the address of ${sym.name} into a fresh temporary.`,
    );
    return t;
  }
  if (target.kind === 'Index') {
    const { base, offset, viaPointer } = yield* genArrayAddr(ctx, target);
    let baseAddr = base;
    if (!viaPointer) {
      const t = newTemp(ctx);
      yield* emitQuad(
        ctx,
        { op: 'addr', arg1: base, arg2: null, result: t, astNodeId: e.id },
        { section: '6.2.1', rule: 'x = &y sets x to the location of y' },
        'Take the base address of the array.',
      );
      baseAddr = t;
    }
    const t2 = newTemp(ctx);
    yield* emitQuad(
      ctx,
      { op: '+', arg1: baseAddr, arg2: offset, result: t2, astNodeId: e.id },
      { section: '6.4.3', rule: 'element address = base + i × w' },
      'Element address = base address plus the scaled offset.',
    );
    return t2;
  }
  if (target.kind === 'Unary' && target.op === '*') {
    // &*p is just p.
    return yield* genRvalue(ctx, target.operand);
  }
  throw new Error(`ir gen: & applied to non-l-value ${target.kind}`);
}

function* genBinaryRvalue(ctx: GenCtx, e: BinaryExprNode): Steps<IrEvent, TacOperand> {
  if (e.op === '&&' || e.op === '||') {
    // Boolean value in an expression context (§6.6.6): generate jumping code,
    // then materialize 1/0 into a temporary.
    const lists = yield* genBool(ctx, e);
    const t = newTemp(ctx);
    const lTrue = yield* newLabel(ctx, e.id, 'target for the true exits of the boolean expression.');
    yield* backpatch(ctx, lists.t, lTrue.instr, lTrue.name, `n${e.id}`, ctx.section);
    yield* emitQuad(
      ctx,
      { op: 'copy', arg1: intConst(1), arg2: null, result: t, astNodeId: e.id },
      { section: '6.6.6', rule: 'boolean value: true exit assigns 1' },
      'True exit of the jumping code: the boolean value is 1.',
    );
    const g = yield* emitQuad(
      ctx,
      { op: 'goto', arg1: null, arg2: null, result: null, astNodeId: e.id },
      { section: '6.6.6', rule: 'jump over the false-branch assignment' },
      'Skip the false-branch assignment; target is the code after the boolean value.',
    );
    const over = yield* makelist(ctx, g.index, 'nextlist', e.id, `n${e.id}`, ctx.section);
    const lFalse = yield* newLabel(ctx, e.id, 'target for the false exits of the boolean expression.');
    yield* backpatch(ctx, lists.f, lFalse.instr, lFalse.name, `n${e.id}`, ctx.section);
    yield* emitQuad(
      ctx,
      { op: 'copy', arg1: intConst(0), arg2: null, result: t, astNodeId: e.id },
      { section: '6.6.6', rule: 'boolean value: false exit assigns 0' },
      'False exit of the jumping code: the boolean value is 0.',
    );
    const lEnd = yield* newLabel(ctx, e.id, 'join point after materializing the boolean value.');
    yield* backpatch(ctx, over, lEnd.instr, lEnd.name, `n${e.id}`, ctx.section);
    return t;
  }
  if (isRelop(e.op)) {
    // Relational in value context: numerical 0/1 representation (§6.6.1).
    yield* enterNode(
      ctx,
      e,
      { section: '6.6.1', rule: 'relational operators compute a 0/1 value numerically' },
      `Relational ${e.op} in value context: compute its 0/1 value into a temporary.`,
    );
    let l = yield* genRvalue(ctx, e.left);
    l = yield* maybeConvert(ctx, l, e.left.id);
    let r = yield* genRvalue(ctx, e.right);
    r = yield* maybeConvert(ctx, r, e.right.id);
    const t = newTemp(ctx);
    yield* emitQuad(
      ctx,
      { op: e.op as TacOp, arg1: l, arg2: r, result: t, astNodeId: e.id },
      { section: '6.6.1', rule: 'booleans represented numerically: 0 = false, 1 = true' },
      `Compare the operands with ${e.op}; the result is 0 or 1.`,
    );
    return t;
  }
  // Arithmetic + - * / %
  yield* enterNode(
    ctx,
    e,
    { section: '6.4.1', figureOrAlgo: 'Fig 6.19', rule: 'E → E1 + E2 { E.addr = new Temp(); gen(E.addr = E1.addr + E2.addr) }' },
    `Arithmetic ${e.op}: translate both operands, then combine them into a new temporary.`,
  );
  let l = yield* genRvalue(ctx, e.left);
  l = yield* maybeConvert(ctx, l, e.left.id);
  let r = yield* genRvalue(ctx, e.right);
  r = yield* maybeConvert(ctx, r, e.right.id);
  const t = newTemp(ctx);
  yield* emitQuad(
    ctx,
    { op: e.op as TacOp, arg1: l, arg2: r, result: t, astNodeId: e.id },
    { section: '6.4.1', figureOrAlgo: 'Fig 6.19', rule: 'E → E1 + E2 { E.addr = new Temp(); gen(E.addr = E1.addr + E2.addr) }' },
    `Apply ${e.op} to the operand addresses and store the result in a fresh temporary.`,
  );
  return t;
}

// ── arrays (§6.4.3) ──────────────────────────────────────────────────────────

interface ArrayAddr {
  /** Base operand: the array variable itself, or a pointer value. */
  base: TacOperand;
  /** Byte offset i × w in a temporary (or constant). */
  offset: TacOperand;
  /** True when the base is a pointer value (decayed array / T*): the element
   *  is reached by pointer arithmetic + deref rather than index-load/store. */
  viaPointer: boolean;
}

function* genArrayAddr(ctx: GenCtx, e: IndexExprNode): Steps<IrEvent, ArrayAddr> {
  const arrType = nodeType(ctx, e.array.id);
  const elemType = nodeType(ctx, e.id);
  const w = typeWidth(elemType);
  let base: TacOperand;
  let viaPointer: boolean;
  if (arrType.kind === 'array') {
    if (e.array.kind !== 'Ident') {
      throw new Error('ir gen: array base must be a name (one-dimensional arrays only)');
    }
    base = varOperand(resolvedSymbol(ctx, e.array.id));
    viaPointer = false;
  } else {
    // pointer base (decayed array parameter, or T*)
    base = yield* genRvalue(ctx, e.array);
    viaPointer = true;
  }
  const iv = yield* genRvalue(ctx, e.index);
  const t = newTemp(ctx);
  yield* emitQuad(
    ctx,
    { op: '*', arg1: iv, arg2: intConst(w), result: t, astNodeId: e.id },
    { section: '6.4.4', figureOrAlgo: 'Fig 6.22', rule: 'L → id [ E ] { gen(L.addr = E.addr * width) }' },
    `Scale the index by the element width ${w} to get the byte offset.`,
  );
  return { base, offset: t, viaPointer };
}

function* genIndexRvalue(ctx: GenCtx, e: IndexExprNode): Steps<IrEvent, TacOperand> {
  yield* enterNode(
    ctx,
    e,
    { section: '6.4.4', figureOrAlgo: 'Fig 6.22', rule: 'E → L { E.addr = new Temp(); gen(E.addr = L.array.base [ L.addr ]) }' },
    'Array element in value context: compute the scaled offset, then load the element.',
  );
  const { base, offset, viaPointer } = yield* genArrayAddr(ctx, e);
  if (!viaPointer) {
    const t = newTemp(ctx);
    yield* emitQuad(
      ctx,
      { op: 'index-load', arg1: base, arg2: offset, result: t, astNodeId: e.id },
      { section: '6.4.4', figureOrAlgo: 'Fig 6.22', rule: 'E → L { gen(E.addr = L.array.base [ L.addr ]) }' },
      'Load the array element at the computed offset into a fresh temporary.',
    );
    return t;
  }
  const addr = newTemp(ctx);
  yield* emitQuad(
    ctx,
    { op: '+', arg1: base, arg2: offset, result: addr, astNodeId: e.id },
    { section: '6.4.3', rule: 'element address = base + i × w' },
    'Pointer base: element address = pointer value plus scaled offset.',
  );
  const t = newTemp(ctx);
  yield* emitQuad(
    ctx,
    { op: 'deref-load', arg1: addr, arg2: null, result: t, astNodeId: e.id },
    { section: '6.2.1', rule: 'x = *y: set x to the value at location y' },
    'Load the element through the computed address.',
  );
  return t;
}

// ── function calls (§6.9) ────────────────────────────────────────────────────

function* genCall(
  ctx: GenCtx,
  e: CallExprNode,
  wantResult: boolean,
): Steps<IrEvent, TacOperand | null> {
  yield* enterNode(
    ctx,
    e,
    { section: '6.9', rule: 'evaluate arguments, then: param x1 … param xn; call p, n' },
    `Call ${e.callee}: evaluate the arguments left to right, pass each with param, then call.`,
  );
  const fnSym = resolvedSymbol(ctx, e.id);
  const args: TacOperand[] = [];
  for (const arg of e.args) {
    let a = yield* genRvalue(ctx, arg);
    a = yield* maybeConvert(ctx, a, arg.id);
    args.push(a);
  }
  for (const a of args) {
    yield* emitQuad(
      ctx,
      { op: 'param', arg1: a, arg2: null, result: null, astNodeId: e.id },
      { section: '6.9', rule: 'param x for each argument, in left-to-right order' },
      'Pass the next argument with a param instruction.',
    );
  }
  const n = intConst(e.args.length);
  const callee = varOperand(fnSym);
  if (wantResult) {
    const t = newTemp(ctx);
    yield* emitQuad(
      ctx,
      { op: 'call', arg1: callee, arg2: n, result: t, astNodeId: e.id },
      { section: '6.9', rule: 'y = call p, n: call procedure p with n parameters' },
      `Call ${e.callee} with ${e.args.length} argument(s); its return value lands in a fresh temporary.`,
    );
    return t;
  }
  yield* emitQuad(
    ctx,
    { op: 'call', arg1: callee, arg2: n, result: null, astNodeId: e.id },
    { section: '6.9', rule: 'call p, n: call procedure p with n parameters (no result)' },
    `Call void function ${e.callee} with ${e.args.length} argument(s).`,
  );
  return null;
}

// ── assignment (§6.4, incl. *p = e and a[i] = e) ─────────────────────────────

function* genAssign(ctx: GenCtx, e: AssignExprNode): Steps<IrEvent, TacOperand> {
  const target = e.target;
  if (target.kind === 'Ident') {
    yield* enterNode(
      ctx,
      e,
      { section: '6.4.1', figureOrAlgo: 'Fig 6.19', rule: 'S → id = E { gen(top.get(id.lexeme) = E.addr) }' },
      'Assignment to a name: translate the right side, then copy it into the variable.',
    );
    const sym = resolvedSymbol(ctx, target.id);
    let v = yield* genRvalue(ctx, e.value);
    v = yield* maybeConvert(ctx, v, e.value.id);
    yield* emitQuad(
      ctx,
      { op: 'copy', arg1: v, arg2: null, result: varOperand(sym), astNodeId: e.id },
      { section: '6.4.1', figureOrAlgo: 'Fig 6.19', rule: 'S → id = E { gen(top.get(id.lexeme) = E.addr) }' },
      `Copy the value into ${sym.name}.`,
    );
    return v;
  }
  if (target.kind === 'Index') {
    yield* enterNode(
      ctx,
      e,
      { section: '6.4.4', figureOrAlgo: 'Fig 6.22', rule: 'S → L = E { gen(L.array.base [ L.addr ] = E.addr) }' },
      'Assignment to an array element: compute the element offset, translate the right side, then store.',
    );
    const { base, offset, viaPointer } = yield* genArrayAddr(ctx, target);
    let v = yield* genRvalue(ctx, e.value);
    v = yield* maybeConvert(ctx, v, e.value.id);
    if (!viaPointer) {
      yield* emitQuad(
        ctx,
        { op: 'index-store', arg1: v, arg2: offset, result: base, astNodeId: e.id },
        { section: '6.4.4', figureOrAlgo: 'Fig 6.22', rule: 'S → L = E { gen(L.array.base [ L.addr ] = E.addr) }' },
        'Store the value into the array element at the computed offset.',
      );
    } else {
      const addr = newTemp(ctx);
      yield* emitQuad(
        ctx,
        { op: '+', arg1: base, arg2: offset, result: addr, astNodeId: e.id },
        { section: '6.4.3', rule: 'element address = base + i × w' },
        'Pointer base: element address = pointer value plus scaled offset.',
      );
      yield* emitQuad(
        ctx,
        { op: 'deref-store', arg1: v, arg2: null, result: addr, astNodeId: e.id },
        { section: '6.2.1', rule: '*x = y: set the contents of location x to y' },
        'Store the value through the computed element address.',
      );
    }
    return v;
  }
  if (target.kind === 'Unary' && target.op === '*') {
    yield* enterNode(
      ctx,
      e,
      { section: '6.2.1', rule: '*x = y: set the contents of location x to y' },
      'Assignment through a pointer: evaluate the pointer, the right side, then store through it.',
    );
    const p = yield* genRvalue(ctx, target.operand);
    let v = yield* genRvalue(ctx, e.value);
    v = yield* maybeConvert(ctx, v, e.value.id);
    yield* emitQuad(
      ctx,
      { op: 'deref-store', arg1: v, arg2: null, result: p, astNodeId: e.id },
      { section: '6.2.1', rule: '*x = y: set the contents of location x to y' },
      'Store the value into the location the pointer refers to.',
    );
    return v;
  }
  throw new Error(`ir gen: invalid assignment target ${target.kind}`);
}

// ── boolean expressions as jumping code (§6.6/§6.7.2) ────────────────────────

interface BoolLists {
  t: BpList;
  f: BpList;
}

function* genBool(ctx: GenCtx, e: Expr): Steps<IrEvent, BoolLists> {
  if (e.kind === 'Binary' && e.op === '&&') {
    yield* enterNode(
      ctx,
      e,
      { section: '6.7.2', figureOrAlgo: 'Fig 6.43', rule: 'B → B1 && M B2 { backpatch(B1.truelist, M.instr); B.truelist = B2.truelist; B.falselist = merge(B1.falselist, B2.falselist) }' },
      'Short-circuit &&: if B1 is true, fall into B2; the false exits of both feed the combined falselist.',
    );
    const b1 = yield* genBool(ctx, e.left);
    const m = yield* newLabel(ctx, e.id, 'start of the right operand of && (reached when the left operand is true).');
    yield* backpatch(ctx, b1.t, m.instr, m.name, `n${e.id}`, ctx.section);
    const b2 = yield* genBool(ctx, e.right);
    const f = yield* mergeLists(ctx, b1.f, b2.f, 'falselist', e.id, `n${e.id}`, ctx.section);
    return { t: b2.t, f };
  }
  if (e.kind === 'Binary' && e.op === '||') {
    yield* enterNode(
      ctx,
      e,
      { section: '6.7.2', figureOrAlgo: 'Fig 6.43', rule: 'B → B1 || M B2 { backpatch(B1.falselist, M.instr); B.truelist = merge(B1.truelist, B2.truelist); B.falselist = B2.falselist }' },
      'Short-circuit ||: if B1 is false, fall into B2; the true exits of both feed the combined truelist.',
    );
    const b1 = yield* genBool(ctx, e.left);
    const m = yield* newLabel(ctx, e.id, 'start of the right operand of || (reached when the left operand is false).');
    yield* backpatch(ctx, b1.f, m.instr, m.name, `n${e.id}`, ctx.section);
    const b2 = yield* genBool(ctx, e.right);
    const t = yield* mergeLists(ctx, b1.t, b2.t, 'truelist', e.id, `n${e.id}`, ctx.section);
    return { t, f: b2.f };
  }
  if (e.kind === 'Unary' && e.op === '!') {
    yield* enterNode(
      ctx,
      e,
      { section: '6.7.2', figureOrAlgo: 'Fig 6.43', rule: 'B → ! B1 { B.truelist = B1.falselist; B.falselist = B1.truelist }' },
      'Logical not in jumping code: simply swap the true and false lists of the operand.',
    );
    const b = yield* genBool(ctx, e.operand);
    return { t: b.f, f: b.t };
  }
  if (e.kind === 'Binary' && isRelop(e.op)) {
    yield* enterNode(
      ctx,
      e,
      { section: '6.7.2', figureOrAlgo: 'Fig 6.43', rule: 'B → E1 rel E2 { B.truelist = makelist(nextinstr); B.falselist = makelist(nextinstr + 1); gen(if E1 rel E2 goto _); gen(goto _) }' },
      `Relational ${e.op} in jumping code: emit a conditional jump for true and an unconditional jump for false, both with unfilled targets.`,
    );
    let l = yield* genRvalue(ctx, e.left);
    l = yield* maybeConvert(ctx, l, e.left.id);
    let r = yield* genRvalue(ctx, e.right);
    r = yield* maybeConvert(ctx, r, e.right.id);
    const iq = yield* emitQuad(
      ctx,
      { op: 'ifrel', arg1: l, arg2: r, relop: e.op as Relop, result: null, astNodeId: e.id },
      { section: '6.7.2', figureOrAlgo: 'Fig 6.43', rule: 'gen(if E1.addr rel.op E2.addr goto _)' },
      `Jump if ${e.op} holds; the target is unfilled until backpatched.`,
    );
    const tl = yield* makelist(ctx, iq.index, 'truelist', e.id, `n${e.id}`, ctx.section);
    const gq = yield* emitQuad(
      ctx,
      { op: 'goto', arg1: null, arg2: null, result: null, astNodeId: e.id },
      { section: '6.7.2', figureOrAlgo: 'Fig 6.43', rule: 'gen(goto _)' },
      'Fall-through jump for the false case; the target is unfilled until backpatched.',
    );
    const fl = yield* makelist(ctx, gq.index, 'falselist', e.id, `n${e.id}`, ctx.section);
    return { t: tl, f: fl };
  }
  if (e.kind === 'Const') {
    yield* enterNode(
      ctx,
      e,
      { section: '6.7.2', figureOrAlgo: 'Fig 6.43', rule: e.value !== 0 ? 'B → true { B.truelist = makelist(nextinstr); gen(goto _) }' : 'B → false { B.falselist = makelist(nextinstr); gen(goto _) }' },
      `Constant condition ${e.value}: one unconditional jump on the ${e.value !== 0 ? 'true' : 'false'} list.`,
    );
    const gq = yield* emitQuad(
      ctx,
      { op: 'goto', arg1: null, arg2: null, result: null, astNodeId: e.id },
      { section: '6.7.2', figureOrAlgo: 'Fig 6.43', rule: 'gen(goto _)' },
      'Unconditional jump; the target is unfilled until backpatched.',
    );
    if (e.value !== 0) {
      const tl = yield* makelist(ctx, gq.index, 'truelist', e.id, `n${e.id}`, ctx.section);
      return { t: tl, f: emptyList(ctx, 'falselist', e.id) };
    }
    const fl = yield* makelist(ctx, gq.index, 'falselist', e.id, `n${e.id}`, ctx.section);
    return { t: emptyList(ctx, 'truelist', e.id), f: fl };
  }
  // Any other scalar expression used as a condition: compare ≠ 0
  // (lab C-subset rule 9), i.e. "if x goto _ ; goto _".
  const v = yield* genRvalue(ctx, e);
  const iq = yield* emitQuad(
    ctx,
    { op: 'if', arg1: v, arg2: null, result: null, astNodeId: e.id },
    { section: '6.6.4', rule: 'scalar condition tested ≠ 0 (C-subset rule 9): if x goto _' },
    'The scalar value is the condition: jump if it is non-zero.',
  );
  const tl = yield* makelist(ctx, iq.index, 'truelist', e.id, `n${e.id}`, ctx.section);
  const gq = yield* emitQuad(
    ctx,
    { op: 'goto', arg1: null, arg2: null, result: null, astNodeId: e.id },
    { section: '6.6.4', rule: 'fall-through jump for the false case' },
    'Fall-through jump for the zero (false) case.',
  );
  const fl = yield* makelist(ctx, gq.index, 'falselist', e.id, `n${e.id}`, ctx.section);
  return { t: tl, f: fl };
}

// ── statements (§6.7.3) ──────────────────────────────────────────────────────

function* genStmt(ctx: GenCtx, s: Stmt): Steps<IrEvent, BpList> {
  switch (s.kind) {
    case 'ExprStmt': {
      if (!s.expr) return emptyList(ctx, 'nextlist', s.id);
      yield* genVoidContext(ctx, s.expr);
      return emptyList(ctx, 'nextlist', s.id);
    }
    case 'CompoundStmt':
      return yield* genCompound(ctx, s);
    case 'IfStmt':
      return yield* genIf(ctx, s);
    case 'WhileStmt':
      return yield* genWhile(ctx, s);
    case 'ForStmt':
      return yield* genFor(ctx, s);
    case 'ReturnStmt':
      return yield* genReturn(ctx, s);
  }
}

function isVoidType(t: CType): boolean {
  return t.kind === 'base' && t.name === 'void';
}

/** Translate an expression evaluated for its side effects only (expression
 *  statement, for-initializer, for-update). A call whose result is discarded —
 *  and every call to a void procedure — takes §6.9's `call p, n` form with no
 *  result temporary. */
function* genVoidContext(ctx: GenCtx, e: Expr): Steps<IrEvent, void> {
  if (e.kind === 'Call' && isVoidType(nodeType(ctx, e.id))) {
    yield* genCall(ctx, e, false);
    return;
  }
  yield* genRvalue(ctx, e);
}

function* genCompound(ctx: GenCtx, s: CompoundStmtNode): Steps<IrEvent, BpList> {
  let pending = emptyList(ctx, 'nextlist', s.id);
  for (const item of s.items) {
    if (pending.instrs.length > 0) {
      const m = yield* newLabel(ctx, item.id, 'start of the next statement (target of the previous statement\'s nextlist).');
      yield* backpatch(ctx, pending, m.instr, m.name, `n${item.id}`, ctx.section);
    }
    pending =
      item.kind === 'VarDecl'
        ? yield* genVarDecl(ctx, item)
        : yield* genStmt(ctx, item);
  }
  return pending;
}

function* genVarDecl(ctx: GenCtx, d: VarDeclNode): Steps<IrEvent, BpList> {
  for (const init of d.decls) {
    if (!init.init) continue;
    yield* enterNode(
      ctx,
      init,
      { section: '6.4.1', figureOrAlgo: 'Fig 6.19', rule: 'S → id = E { gen(top.get(id.lexeme) = E.addr) }' },
      `Initialize ${init.declarator.name}: translate the initializer, then copy it into the variable.`,
    );
    const sym = declaredSymbol(ctx, init.id, init.declarator.name);
    let v = yield* genRvalue(ctx, init.init);
    v = yield* maybeConvert(ctx, v, init.init.id);
    yield* emitQuad(
      ctx,
      { op: 'copy', arg1: v, arg2: null, result: varOperand(sym), astNodeId: init.id },
      { section: '6.4.1', figureOrAlgo: 'Fig 6.19', rule: 'S → id = E { gen(top.get(id.lexeme) = E.addr) }' },
      `Copy the initializer value into ${init.declarator.name}.`,
    );
  }
  return emptyList(ctx, 'nextlist', d.id);
}

function declaredSymbol(ctx: GenCtx, declNodeId: number, name: string): SymbolEntry {
  for (const s of ctx.sem.symbols) {
    if (s.declNodeId === declNodeId && s.name === name) return s;
  }
  // Fallback: unique name lookup (fixture-friendly).
  const byName = ctx.sem.symbols.filter((s) => s.name === name && s.kind !== 'func');
  if (byName.length === 1 && byName[0]) return byName[0];
  throw new Error(`ir gen: cannot find symbol declared at node ${declNodeId} (${name})`);
}

function* genIf(ctx: GenCtx, s: IfStmtNode): Steps<IrEvent, BpList> {
  if (!s.else_) {
    yield* enterNode(
      ctx,
      s,
      { section: '6.7.3', figureOrAlgo: 'Fig 6.46', rule: 'S → if ( B ) M S1 { backpatch(B.truelist, M.instr); S.nextlist = merge(B.falselist, S1.nextlist) }' },
      'if without else: true exits of the condition enter the then-part; its false exits skip it.',
    );
    const b = yield* genBool(ctx, s.cond);
    const m = yield* newLabel(ctx, s.id, 'start of the then-part (target of the condition\'s truelist).');
    yield* backpatch(ctx, b.t, m.instr, m.name, `n${s.id}`, ctx.section);
    const n1 = yield* genStmt(ctx, s.then);
    return yield* mergeLists(ctx, b.f, n1, 'nextlist', s.id, `n${s.id}`, ctx.section);
  }
  yield* enterNode(
    ctx,
    s,
    { section: '6.7.3', figureOrAlgo: 'Fig 6.46', rule: 'S → if ( B ) M1 S1 N else M2 S2 { backpatch(B.truelist, M1.instr); backpatch(B.falselist, M2.instr); S.nextlist = merge(S1.nextlist, merge(N.nextlist, S2.nextlist)) }' },
    'if/else: true exits enter the then-part, false exits enter the else-part; a goto after the then-part skips the else-part.',
  );
  const b = yield* genBool(ctx, s.cond);
  const m1 = yield* newLabel(ctx, s.id, 'start of the then-part (target of the condition\'s truelist).');
  yield* backpatch(ctx, b.t, m1.instr, m1.name, `n${s.id}`, ctx.section);
  const n1 = yield* genStmt(ctx, s.then);
  const g = yield* emitQuad(
    ctx,
    { op: 'goto', arg1: null, arg2: null, result: null, astNodeId: s.id },
    { section: '6.7.3', figureOrAlgo: 'Fig 6.46', rule: 'N → ε { N.nextlist = makelist(nextinstr); gen(goto _) }' },
    'After the then-part, jump past the else-part; the target joins the statement\'s nextlist.',
  );
  const nGoto = yield* makelist(ctx, g.index, 'nextlist', s.id, `n${s.id}`, ctx.section);
  const m2 = yield* newLabel(ctx, s.id, 'start of the else-part (target of the condition\'s falselist).');
  yield* backpatch(ctx, b.f, m2.instr, m2.name, `n${s.id}`, ctx.section);
  const n2 = yield* genStmt(ctx, s.else_);
  const t1 = yield* mergeLists(ctx, n1, nGoto, 'nextlist', s.id, `n${s.id}`, ctx.section);
  return yield* mergeLists(ctx, t1, n2, 'nextlist', s.id, `n${s.id}`, ctx.section);
}

function* genWhile(ctx: GenCtx, s: WhileStmtNode): Steps<IrEvent, BpList> {
  yield* enterNode(
    ctx,
    s,
    { section: '6.7.3', figureOrAlgo: 'Fig 6.46', rule: 'S → while M1 ( B ) M2 S1 { backpatch(S1.nextlist, M1.instr); backpatch(B.truelist, M2.instr); S.nextlist = B.falselist; gen(goto M1.instr) }' },
    'while: test the condition; true exits enter the body, the body loops back to the test, and false exits leave the loop.',
  );
  const m1 = yield* newLabel(ctx, s.id, 'top of the loop: the condition is re-tested here.');
  const b = yield* genBool(ctx, s.cond);
  const m2 = yield* newLabel(ctx, s.id, 'start of the loop body (target of the condition\'s truelist).');
  yield* backpatch(ctx, b.t, m2.instr, m2.name, `n${s.id}`, ctx.section);
  const n1 = yield* genStmt(ctx, s.body);
  yield* backpatch(ctx, n1, m1.instr, m1.name, `n${s.id}`, ctx.section);
  yield* emitQuad(
    ctx,
    { op: 'goto', arg1: null, arg2: null, result: { kind: 'label', name: m1.name }, astNodeId: s.id },
    { section: '6.7.3', figureOrAlgo: 'Fig 6.46', rule: 'gen(goto M1.instr)' },
    `Loop back to re-test the condition at ${m1.name}.`,
  );
  return b.f;
}

function* genFor(ctx: GenCtx, s: ForStmtNode): Steps<IrEvent, BpList> {
  yield* enterNode(
    ctx,
    s,
    { section: '6.7.3', rule: 'for (E1; B; E3) S1 ≡ E1; while-style loop: test B, run S1 then E3, jump back to the test (scheme derived from S → while M1 (B) M2 S1, Fig 6.46)' },
    'for: run the initializer once, test the condition, run the body then the update, and loop back to the test.',
  );
  if (s.init) yield* genVoidContext(ctx, s.init);
  const m1 = yield* newLabel(ctx, s.id, 'top of the loop: the condition is re-tested here.');
  let b: BoolLists | null = null;
  if (s.cond) {
    b = yield* genBool(ctx, s.cond);
    const m2 = yield* newLabel(ctx, s.id, 'start of the loop body (target of the condition\'s truelist).');
    yield* backpatch(ctx, b.t, m2.instr, m2.name, `n${s.id}`, ctx.section);
  }
  const n1 = yield* genStmt(ctx, s.body);
  if (s.update) {
    if (n1.instrs.length > 0) {
      const mu = yield* newLabel(ctx, s.id, 'start of the update expression (target of the body\'s nextlist).');
      yield* backpatch(ctx, n1, mu.instr, mu.name, `n${s.id}`, ctx.section);
    }
    yield* genVoidContext(ctx, s.update);
  } else {
    yield* backpatch(ctx, n1, m1.instr, m1.name, `n${s.id}`, ctx.section);
  }
  yield* emitQuad(
    ctx,
    { op: 'goto', arg1: null, arg2: null, result: { kind: 'label', name: m1.name }, astNodeId: s.id },
    { section: '6.7.3', rule: 'gen(goto M1.instr): loop back to the test' },
    `Loop back to re-test the condition at ${m1.name}.`,
  );
  return b ? b.f : emptyList(ctx, 'nextlist', s.id);
}

function* genReturn(ctx: GenCtx, s: ReturnStmtNode): Steps<IrEvent, BpList> {
  yield* enterNode(
    ctx,
    s,
    { section: '6.9', rule: 'return x: return the value x from the procedure' },
    s.expr ? 'return with a value: translate the expression, then return it.' : 'return without a value.',
  );
  if (s.expr) {
    let v = yield* genRvalue(ctx, s.expr);
    v = yield* maybeConvert(ctx, v, s.expr.id);
    yield* emitQuad(
      ctx,
      { op: 'return', arg1: v, arg2: null, result: null, astNodeId: s.id },
      { section: '6.9', rule: 'return x' },
      'Return the computed value to the caller.',
    );
  } else {
    yield* emitQuad(
      ctx,
      { op: 'return', arg1: null, arg2: null, result: null, astNodeId: s.id },
      { section: '6.9', rule: 'return' },
      'Return to the caller with no value.',
    );
  }
  return emptyList(ctx, 'nextlist', s.id);
}

// ── program-level generator ──────────────────────────────────────────────────

function funcSymbol(sem: SemanticInfo, fn: FuncDefNode): SymbolEntry {
  for (const s of sem.symbols) {
    if (s.kind === 'func' && s.name === fn.name) return s;
  }
  throw new Error(`ir gen: no symbol for function ${fn.name}`);
}

function paramSymbolIds(sem: SemanticInfo, fn: FuncDefNode): number[] {
  const ids: number[] = [];
  for (const p of fn.params) {
    let found: SymbolEntry | null = null;
    for (const s of sem.symbols) {
      if (s.kind === 'param' && s.declNodeId === p.id) {
        found = s;
        break;
      }
    }
    if (!found) {
      // fixture-friendly fallback: match by name within the function's scope
      const scope = sem.scopes.find((sc) => sc.kind === 'function' && sc.label === fn.name);
      if (scope) {
        for (const sid of scope.symbolIds) {
          const s = sem.symbols.find((x) => x.id === sid);
          if (s && s.kind === 'param' && s.name === p.declarator.name) {
            found = s;
            break;
          }
        }
      }
    }
    if (!found) throw new Error(`ir gen: no symbol for parameter ${p.declarator.name} of ${fn.name}`);
    ids.push(found.id);
  }
  return ids;
}

/** The ctype an initial value is stored with: the global's declared type
 *  (an int initializer of a float global is widened, §6.5.2). */
function initCtype(t: CType): GlobalInit['ctype'] {
  if (t.kind === 'base' && t.name === 'float') return 'float';
  if (t.kind === 'base' && t.name === 'char') return 'char';
  return 'int';
}

/**
 * Globals in declaration order, with the initial values of those that have an
 * initializer. A global lives in the statically allocated data area, so its
 * initializer is folded here into the value its cell holds when the program
 * starts — no code runs before `main` (§7.1). The semantic pass has already
 * rejected an initializer that is not a constant expression.
 */
function globalVars(ast: Ast, sem: SemanticInfo): { ids: number[]; inits: GlobalInit[] } {
  const ids: number[] = [];
  const inits: GlobalInit[] = [];
  for (const decl of ast.root.decls) {
    if (decl.kind !== 'VarDecl') continue;
    for (const init of decl.decls) {
      for (const s of sem.symbols) {
        if (s.declNodeId === init.id && s.kind === 'var') {
          ids.push(s.id);
          if (init.init) {
            const v = evalConstExpr(init.init);
            if (v === null) {
              throw new Error(
                `ir gen: the initializer of global '${s.name}' is not a constant expression`,
              );
            }
            inits.push({ symbolId: s.id, name: s.name, value: v.value, ctype: initCtype(s.type) });
          }
          break;
        }
      }
    }
  }
  return { ids, inits };
}

/** The traced AST → TAC translation: one TacFunction per FuncDef, globals
 *  collected in declaration order. */
export function* generateTac(ast: Ast, sem: SemanticInfo): Steps<IrEvent, TacProgram> {
  const symById = new Map<number, SymbolEntry>();
  for (const s of sem.symbols) symById.set(s.id, s);

  const { ids: globals, inits: globalInits } = globalVars(ast, sem);
  yield [
    { kind: 'ir-globals', symbolIds: globals, inits: globalInits },
    {
      cite: { section: '6.2.1', rule: 'three-address instructions operate on names with addresses; globals live at fixed addresses' },
      prose:
        `Collect the ${globals.length} global variable(s) in declaration order; every function's code may address them.` +
        (globalInits.length > 0
          ? ` ${globalInits.length} of them carry an initializer: a global is statically allocated, so its cell already holds ` +
            `${globalInits.map((g) => `${g.name} = ${formatConst({ kind: 'const', value: g.value, ctype: g.ctype })}`).join(', ')} ` +
            'when execution begins — no instruction is needed.'
          : ''),
      level: 'macro',
      section: 'globals',
    },
  ];

  const functions: TacFunction[] = [];
  for (const decl of ast.root.decls) {
    if (decl.kind !== 'FuncDef') continue;
    const fnSym = funcSymbol(sem, decl);
    const params = paramSymbolIds(sem, decl);
    const section = `${decl.name}()`;
    // per-function backpatch-list ids, deterministic
    const listCounter = { n: 0 };
    const ctx: GenCtx = {
      ast,
      sem,
      symById,
      func: decl.name,
      section,
      quads: [],
      tempCount: 0,
      labelCount: 0,
      nextListId: () => ++listCounter.n,
    };
    yield [
      { kind: 'func-begin', name: decl.name, symbolId: fnSym.id, params },
      {
        cite: { section: '6.9', rule: 'a procedure definition yields its own sequence of three-address instructions' },
        prose: `Begin translating function ${decl.name}; temporaries and labels restart from t1 / L1.`,
        level: 'macro',
        section,
        srcSpans: [decl.nameSpan],
        irRefs: [{ kind: 'astNode', id: decl.id }],
      },
    ];
    const nextlist = yield* genCompound(ctx, decl.body);
    if (nextlist.instrs.length > 0) {
      const m = yield* newLabel(ctx, decl.id, 'end of the function body (target of the dangling nextlist).');
      yield* backpatch(ctx, nextlist, m.instr, m.name, `n${decl.id}`, section);
    }
    const last = ctx.quads[ctx.quads.length - 1];
    if (!last || last.op !== 'return') {
      yield* emitQuad(
        ctx,
        { op: 'return', arg1: null, arg2: null, result: null, astNodeId: decl.id },
        { section: '6.9', rule: 'return: control returns to the caller at the end of the body' },
        'Implicit return at the end of the function body.',
      );
    }
    yield [
      { kind: 'func-end', name: decl.name, tempCount: ctx.tempCount },
      {
        cite: { section: '6.9', rule: 'end of the procedure body' },
        prose: `Finished translating ${decl.name}: ${ctx.quads.length} instructions, ${ctx.tempCount} temporaries, ${ctx.labelCount} labels.`,
        level: 'macro',
        section,
        irRefs: [{ kind: 'astNode', id: decl.id }],
      },
    ];
    functions.push({
      name: decl.name,
      symbolId: fnSym.id,
      params,
      quads: ctx.quads,
      tempCount: ctx.tempCount,
    });
  }
  return { functions, globals, globalInits };
}

/** Convenience: record the full translation as a replayable trace. */
export function runIrGen(ast: Ast, sem: SemanticInfo): Recorded<IrGenState, IrEvent, TacProgram> {
  return record(() => generateTac(ast, sem), initialIrGenState(), irGenReducer, { id: 'ir.gen' });
}
