/**
 * The traced semantic-analysis pass: scope/symbol-table construction (§2.7)
 * interleaved with synthesized-attribute type checking (§6.3, §6.5.1) and
 * explicit conversion insertion (§6.5.2 widening), over the C-subset Ast.
 *
 * Types are synthesized bottom-up exactly as in the Dragon Book's translation
 * schemes: each expression node gets its type from its children's types via
 * one cited rule; a mixed int/float operand pair triggers an explicit
 * inttofloat conversion node on the non-float operand (widen / max(t1,t2)).
 * Every rule violation carries the exact rule text from docs/c-subset.md.
 */
import { record } from '@lab/trace';
import type { Citation, Recorded, SourceSpan, Steps } from '@lab/trace';
import type {
  Ast,
  CompoundStmtNode,
  Expr,
  FuncDefNode,
  Stmt,
  VarDeclNode,
} from '../ast/types.js';
import { evalConstExpr } from './const-expr.js';
import { baseType, typeToString } from './types.js';
import type { CType, SemanticInfo } from './types.js';
import {
  RULE,
  initialSemState,
  projectSemanticInfo,
  semReducer,
  step,
} from './sem-events.js';
import type { SemEvent, SemState } from './sem-events.js';
import {
  containsVoid,
  createSemCtx,
  declareSymbol,
  emitDiagnostic,
  enterScope,
  exitScope,
  lookup,
  resolveDeclaratorType,
} from './scopes.js';
import type { SemSteps } from './scopes.js';

// ── Type predicates (docs/c-subset.md "Types and typing rules") ──────────────

export function typeEquals(a: CType, b: CType): boolean {
  if (a.kind === 'base' && b.kind === 'base') return a.name === b.name;
  if (a.kind === 'pointer' && b.kind === 'pointer') return typeEquals(a.to, b.to);
  if (a.kind === 'array' && b.kind === 'array') {
    return a.length === b.length && typeEquals(a.of, b.of);
  }
  if (a.kind === 'function' && b.kind === 'function') {
    return (
      typeEquals(a.ret, b.ret) &&
      a.params.length === b.params.length &&
      a.params.every((p, i) => typeEquals(p, b.params[i]!))
    );
  }
  return false;
}

function isArith(t: CType): boolean {
  return t.kind === 'base' && t.name !== 'void';
}

function isIntegerT(t: CType): boolean {
  return t.kind === 'base' && (t.name === 'int' || t.name === 'char');
}

function isFloatT(t: CType): boolean {
  return t.kind === 'base' && t.name === 'float';
}

function isVoidT(t: CType): boolean {
  return t.kind === 'base' && t.name === 'void';
}

/** Scalar = arithmetic or pointer (rule 3 / rule 9). */
function isScalar(t: CType): boolean {
  return isArith(t) || t.kind === 'pointer';
}

/** char promotes to int in arithmetic contexts (rule 1). */
function promote(t: CType): CType {
  return t.kind === 'base' && t.name === 'char' ? baseType('int') : t;
}

/** Does `s` guarantee a return on the (simple) paths we check? Conservative:
 *  loops are assumed to possibly not execute (rule 8's warning). */
function stmtReturns(s: Stmt): boolean {
  switch (s.kind) {
    case 'ReturnStmt':
      return true;
    case 'CompoundStmt':
      return s.items.some((it) => it.kind !== 'VarDecl' && stmtReturns(it));
    case 'IfStmt':
      return s.else_ !== null && stmtReturns(s.then) && stmtReturns(s.else_);
    default:
      return false;
  }
}

// ── The pass ─────────────────────────────────────────────────────────────────

type ExprInfo = { type: CType; lval: boolean } | null;

export function* analyze(ast: Ast): Steps<SemEvent, SemanticInfo> {
  const ctx = createSemCtx();
  const info: SemanticInfo = {
    scopes: ctx.scopes,
    symbols: ctx.symbols,
    nodeTypes: {},
    resolved: {},
    conversions: {},
    diagnostics: ctx.diagnostics,
  };
  let currentFunc: { name: string; ret: CType } | null = null;

  function* err(
    span: SourceSpan,
    message: string,
    rule: string,
    hint: string,
    cite: Citation,
  ): SemSteps<null> {
    yield* emitDiagnostic(
      ctx,
      { phase: 'semantic', severity: 'error', message, rule, hint, span },
      cite,
    );
    return null;
  }

  function* warn(
    span: SourceSpan,
    message: string,
    rule: string,
    hint: string,
    cite: Citation,
  ): SemSteps<void> {
    yield* emitDiagnostic(
      ctx,
      { phase: 'semantic', severity: 'warning', message, rule, hint, span },
      cite,
    );
  }

  /** Record the synthesized type of a node (post-order 'typed' event). */
  function* typedEv(
    node: { id: number; span: SourceSpan },
    type: CType,
    ruleApplied: string,
    cite: Citation,
    prose: string,
  ): SemSteps<void> {
    info.nodeTypes[node.id] = type;
    yield [
      { kind: 'typed', nodeId: node.id, type, ruleApplied },
      step(cite, prose, 'macro', {
        section: ctx.section,
        srcSpans: [node.span],
        irRefs: [{ kind: 'astNode', id: node.id }],
      }),
    ];
  }

  /** Insert an explicit inttofloat conversion on `node` (§6.5.2 widening). */
  function* insertConversion(node: Expr, from: CType): SemSteps<void> {
    const to = baseType('float');
    info.conversions[node.id] = { from, to };
    yield [
      { kind: 'convert', nodeId: node.id, from, to, op: 'inttofloat' },
      step(
        { section: '6.5.2', figureOrAlgo: 'widen(a, t, w) / max(t1, t2)', rule: RULE.widening },
        `Insert an explicit inttofloat conversion: widen this ${typeToString(from)} operand to float so both operands have a common type.`,
        'macro',
        { section: ctx.section, srcSpans: [node.span], irRefs: [{ kind: 'astNode', id: node.id }] },
      ),
    ];
  }

  /** Use an expression as a value: arrays decay to pointers (rule 6) and void
   *  values are rejected (rule 7). Returns null if an error was reported. */
  function* asValue(e: Expr, r: ExprInfo): SemSteps<{ type: CType } | null> {
    if (r === null) return null;
    let t = r.type;
    if (t.kind === 'array') {
      const to: CType = { kind: 'pointer', to: t.of };
      yield [
        { kind: 'decay', nodeId: e.id, from: t, to },
        step(
          { section: '6.3.1', rule: RULE.arrayDecay },
          `The array value of type ${typeToString(t)} decays to ${typeToString(to)} when used as a value.`,
          'micro',
          { section: ctx.section, srcSpans: [e.span], irRefs: [{ kind: 'astNode', id: e.id }] },
        ),
      ];
      t = to;
    }
    if (isVoidT(t)) {
      yield* err(
        e.span,
        'a void value cannot be used here',
        RULE.voidValue,
        'call the void function as a standalone statement instead of using its (nonexistent) value',
        { section: '6.5.1' },
      );
      return null;
    }
    return { type: t };
  }

  /** Rule-4-style assignability (used by assignment, initialization, argument
   *  passing, and return). Emits conversions/diagnostics; returns success. */
  function* checkAssignable(
    valueNode: Expr,
    from: CType,
    to: CType,
    context: string,
    ruleText: string,
    cite: Citation,
  ): SemSteps<boolean> {
    if (to.kind === 'array') {
      yield* err(
        valueNode.span,
        `an array cannot be the target of ${context}`,
        RULE.arrayNotAssignable,
        'assign element-by-element with a[i] = …',
        { section: '6.5.1' },
      );
      return false;
    }
    if (typeEquals(from, to)) return true;
    if (from.kind === 'base' && to.kind === 'base') {
      const fi = from.name === 'int' || from.name === 'char';
      const ti = to.name === 'int' || to.name === 'char';
      if (fi && ti) return true; // char↔int match after promotion
      if (to.name === 'float' && fi) {
        yield* insertConversion(valueNode, from);
        return true;
      }
      if (from.name === 'float' && ti) {
        yield* err(
          valueNode.span,
          `cannot narrow float to ${to.name} in ${context}`,
          ruleText,
          'the subset has no float→int narrowing; keep the target float or use an integer expression',
          { section: '6.5.2' },
        );
        return false;
      }
    }
    yield* err(
      valueNode.span,
      `type mismatch in ${context}: cannot use ${typeToString(from)} where ${typeToString(to)} is expected`,
      ruleText,
      to.kind === 'pointer'
        ? 'pointer assignment requires identical pointer types'
        : 'operand types must match after promotions',
      cite,
    );
    return false;
  }

  // ── Expressions (post-order, synthesized attributes) ──────────────────────

  function* checkExpr(e: Expr): SemSteps<ExprInfo> {
    switch (e.kind) {
      case 'Const': {
        const t = baseType(e.constType);
        yield* typedEv(
          e,
          t,
          RULE.constant,
          { section: '6.5.1' },
          `The constant '${e.lexeme}' has type ${e.constType} from its lexical class.`,
        );
        return { type: t, lval: false };
      }

      case 'Ident': {
        const sym = yield* lookup(ctx, info.resolved, e.name, e.id, e.span);
        if (sym === null) {
          return yield* err(
            e.span,
            `'${e.name}' is used before any declaration is in scope`,
            RULE.declBeforeUse,
            `declare '${e.name}' before this point — the subset requires declaration before use`,
            { section: '2.7' },
          );
        }
        if (sym.kind === 'func') {
          return yield* err(
            e.span,
            `function '${e.name}' cannot be used as a value (not in the lab's C subset)`,
            RULE.funcAsValue,
            `call it with parentheses: ${e.name}(…)`,
            { section: '6.5.1' },
          );
        }
        yield* typedEv(
          e,
          sym.type,
          RULE.identifier,
          { section: '2.7' },
          `'${e.name}' has the declared type ${typeToString(sym.type)} of symbol #${sym.id}; identifiers are l-values.`,
        );
        return { type: sym.type, lval: true };
      }

      case 'Unary': {
        const r = yield* checkExpr(e.operand);
        switch (e.op) {
          case '-': {
            const v = yield* asValue(e.operand, r);
            if (v === null) return null;
            if (!isArith(v.type)) {
              return yield* err(
                e.span,
                `unary '-' needs an arithmetic operand, got ${typeToString(v.type)}`,
                RULE.arithOperands,
                'negate an int, float, or char value',
                { section: '6.5.1' },
              );
            }
            const t = promote(v.type);
            yield* typedEv(
              e,
              t,
              RULE.arithOperands,
              { section: '6.5.1' },
              `Unary '-' on ${typeToString(v.type)} yields ${typeToString(t)} (char promotes to int).`,
            );
            return { type: t, lval: false };
          }
          case '!': {
            const v = yield* asValue(e.operand, r);
            if (v === null) return null;
            if (!isScalar(v.type)) {
              return yield* err(
                e.span,
                `'!' needs a scalar operand, got ${typeToString(v.type)}`,
                RULE.logical,
                'apply ! to an arithmetic or pointer value',
                { section: '6.6.1' },
              );
            }
            yield* typedEv(
              e,
              baseType('int'),
              RULE.logical,
              { section: '6.6.1' },
              `'!' tests its scalar operand against 0 and yields int 0/1.`,
            );
            return { type: baseType('int'), lval: false };
          }
          case '*': {
            const v = yield* asValue(e.operand, r);
            if (v === null) return null;
            if (v.type.kind !== 'pointer') {
              return yield* err(
                e.span,
                `'*' needs a pointer operand, got ${typeToString(v.type)}`,
                RULE.deref,
                'only T* values can be dereferenced',
                { section: '6.5.1' },
              );
            }
            yield* typedEv(
              e,
              v.type.to,
              RULE.deref,
              { section: '6.5.1' },
              `Dereferencing ${typeToString(v.type)} yields the l-value ${typeToString(v.type.to)}.`,
            );
            return { type: v.type.to, lval: true };
          }
          case '&': {
            if (r === null) return null;
            if (!r.lval) {
              return yield* err(
                e.span,
                `'&' needs an l-value operand`,
                RULE.addrOf,
                'take the address of a variable, *e, or a[i] — not of a temporary value',
                { section: '2.8.3' },
              );
            }
            const t: CType = { kind: 'pointer', to: r.type };
            yield* typedEv(
              e,
              t,
              RULE.addrOf,
              { section: '2.8.3' },
              `'&' on an l-value of type ${typeToString(r.type)} yields ${typeToString(t)}.`,
            );
            return { type: t, lval: false };
          }
        }
        break;
      }

      case 'Binary': {
        const lr = yield* checkExpr(e.left);
        const lv = yield* asValue(e.left, lr);
        const rr = yield* checkExpr(e.right);
        const rv = yield* asValue(e.right, rr);
        if (lv === null || rv === null) return null;
        const op = e.op;
        const lt = lv.type;
        const rt = rv.type;

        if (op === '+' || op === '-' || op === '*' || op === '/' || op === '%') {
          if ((op === '+' || op === '-') && (lt.kind === 'pointer' || rt.kind === 'pointer')) {
            return yield* err(
              e.span,
              `pointer arithmetic ('${op}') is not in the lab's C subset`,
              RULE.noPtrArith,
              'index with a[i] instead of *(a + i)',
              { section: '6.5.1' },
            );
          }
          if (!isArith(lt) || !isArith(rt)) {
            return yield* err(
              e.span,
              `'${op}' needs arithmetic operands, got ${typeToString(lt)} and ${typeToString(rt)}`,
              RULE.arithOperands,
              'both operands must be int, float, or char',
              { section: '6.5.1' },
            );
          }
          if (op === '%') {
            if (!isIntegerT(lt) || !isIntegerT(rt)) {
              return yield* err(
                e.span,
                `'%' needs integer operands, got ${typeToString(lt)} and ${typeToString(rt)}`,
                RULE.modInt,
                "use '/' for float division; '%' is defined only on integers",
                { section: '6.5.1' },
              );
            }
            yield* typedEv(
              e,
              baseType('int'),
              RULE.modInt,
              { section: '6.5.1' },
              `'%' on integer operands yields int (char promotes to int).`,
            );
            return { type: baseType('int'), lval: false };
          }
          const lf = isFloatT(lt);
          const rf = isFloatT(rt);
          if (lf || rf) {
            if (!lf) yield* insertConversion(e.left, lt);
            if (!rf) yield* insertConversion(e.right, rt);
            yield* typedEv(
              e,
              baseType('float'),
              RULE.widening,
              { section: '6.5.2', figureOrAlgo: 'max(t1, t2)' },
              `max(${typeToString(lt)}, ${typeToString(rt)}) = float, so '${op}' yields float after widening.`,
            );
            return { type: baseType('float'), lval: false };
          }
          yield* typedEv(
            e,
            baseType('int'),
            RULE.arithOperands,
            { section: '6.5.1' },
            `'${op}' on integer operands yields int (char promotes to int).`,
          );
          return { type: baseType('int'), lval: false };
        }

        if (op === '==' || op === '!=' || op === '<' || op === '>' || op === '<=' || op === '>=') {
          if (lt.kind === 'pointer' || rt.kind === 'pointer') {
            if (
              lt.kind === 'pointer' &&
              rt.kind === 'pointer' &&
              (op === '==' || op === '!=') &&
              typeEquals(lt, rt)
            ) {
              yield* typedEv(
                e,
                baseType('int'),
                RULE.relational,
                { section: '6.5.1' },
                `'${op}' on two identical pointer types ${typeToString(lt)} yields int 0/1.`,
              );
              return { type: baseType('int'), lval: false };
            }
            const why =
              lt.kind === 'pointer' && rt.kind === 'pointer'
                ? op === '==' || op === '!='
                  ? `pointer types differ: ${typeToString(lt)} vs ${typeToString(rt)}`
                  : `only '==' and '!=' may compare pointers`
                : `cannot compare ${typeToString(lt)} with ${typeToString(rt)}`;
            return yield* err(
              e.span,
              `invalid pointer comparison: ${why}`,
              RULE.relational,
              "pointers compare only with '=='/'!=' against a pointer of the identical type",
              { section: '6.5.1' },
            );
          }
          if (!isArith(lt) || !isArith(rt)) {
            return yield* err(
              e.span,
              `'${op}' needs arithmetic operands (or two identical pointers for '=='/'!='), got ${typeToString(lt)} and ${typeToString(rt)}`,
              RULE.relational,
              'compare arithmetic values, or two pointers of the identical type',
              { section: '6.5.1' },
            );
          }
          const lf = isFloatT(lt);
          const rf = isFloatT(rt);
          if (lf || rf) {
            if (!lf) yield* insertConversion(e.left, lt);
            if (!rf) yield* insertConversion(e.right, rt);
          }
          yield* typedEv(
            e,
            baseType('int'),
            RULE.relational,
            { section: '6.5.1' },
            `'${op}' compares its ${lf || rf ? 'widened ' : ''}operands and yields int 0/1.`,
          );
          return { type: baseType('int'), lval: false };
        }

        // '&&' | '||'
        if (!isScalar(lt) || !isScalar(rt)) {
          return yield* err(
            e.span,
            `'${op}' needs scalar operands, got ${typeToString(lt)} and ${typeToString(rt)}`,
            RULE.logical,
            'logical operators take arithmetic or pointer values',
            { section: '6.6.1' },
          );
        }
        yield* typedEv(
          e,
          baseType('int'),
          RULE.logical,
          { section: '6.6.1', rule: 'B → B1 || B2 / B → B1 && B2: short-circuit jumping code' },
          `'${op}' takes scalar operands and yields int 0/1, evaluated with short-circuit jumping code.`,
        );
        return { type: baseType('int'), lval: false };
      }

      case 'Assign': {
        const tr = yield* checkExpr(e.target);
        const vr = yield* checkExpr(e.value);
        if (tr !== null) {
          if (tr.type.kind === 'array') {
            return yield* err(
              e.target.span,
              'arrays are not assignable',
              RULE.arrayNotAssignable,
              'assign element-by-element with a[i] = …',
              { section: '6.5.1' },
            );
          }
          if (!tr.lval) {
            return yield* err(
              e.target.span,
              'assignment target is not an l-value',
              RULE.assignLValue,
              'assign to a variable, *e, or a[i]',
              { section: '2.8.3' },
            );
          }
        }
        const v = yield* asValue(e.value, vr);
        if (tr === null || v === null) return null;
        const ok = yield* checkAssignable(e.value, v.type, tr.type, 'assignment', RULE.assignTypes, {
          section: '6.5.2',
        });
        if (!ok) return null;
        yield* typedEv(
          e,
          tr.type,
          RULE.assignTypes,
          { section: '6.5.1' },
          `The assignment stores into its l-value target and yields the target's type ${typeToString(tr.type)}.`,
        );
        return { type: tr.type, lval: false };
      }

      case 'Index': {
        const ar = yield* checkExpr(e.array);
        const ir = yield* checkExpr(e.index);
        const iv = yield* asValue(e.index, ir);
        if (ar === null) return null;
        const at = ar.type;
        if (at.kind !== 'array' && at.kind !== 'pointer') {
          return yield* err(
            e.array.span,
            `only arrays and pointers can be indexed, got ${typeToString(at)}`,
            RULE.indexing,
            'index a T[n] array or a T* pointer',
            { section: '6.4.3' },
          );
        }
        if (iv === null) return null;
        if (!isIntegerT(iv.type)) {
          return yield* err(
            e.index.span,
            `array index must be int or char, got ${typeToString(iv.type)}`,
            RULE.indexing,
            'use an integer index expression',
            { section: '6.4.3' },
          );
        }
        const elem = at.kind === 'array' ? at.of : at.to;
        yield* typedEv(
          e,
          elem,
          RULE.indexing,
          { section: '6.4.3' },
          `Indexing ${typeToString(at)} yields the l-value element type ${typeToString(elem)}.`,
        );
        return { type: elem, lval: true };
      }

      case 'Call': {
        const sym = yield* lookup(ctx, info.resolved, e.callee, e.id, e.calleeSpan);
        const argVals: Array<{ type: CType } | null> = [];
        for (const a of e.args) {
          const r = yield* checkExpr(a);
          argVals.push(yield* asValue(a, r));
        }
        if (sym === null) {
          return yield* err(
            e.calleeSpan,
            `call to undeclared function '${e.callee}'`,
            RULE.callDeclared,
            `define '${e.callee}' before this call — the subset has no forward prototypes, so call-before-definition is an error`,
            { section: '6.9' },
          );
        }
        if (sym.kind !== 'func' || sym.type.kind !== 'function') {
          return yield* err(
            e.calleeSpan,
            `'${e.callee}' is not a function (it is a ${sym.kind} of type ${typeToString(sym.type)})`,
            RULE.callDeclared,
            'only declared functions can be called',
            { section: '6.9' },
          );
        }
        const ft = sym.type;
        if (ft.params.length !== e.args.length) {
          return yield* err(
            e.span,
            `'${e.callee}' expects ${ft.params.length} argument(s) but got ${e.args.length}`,
            RULE.callArity,
            'match the call to the function definition',
            { section: '6.9' },
          );
        }
        let ok = true;
        for (let i = 0; i < e.args.length; i++) {
          const v = argVals[i]!;
          if (v === null) {
            ok = false;
            continue;
          }
          const good = yield* checkAssignable(
            e.args[i]!,
            v.type,
            ft.params[i]!,
            `argument ${i + 1} of '${e.callee}'`,
            RULE.callArg,
            { section: '6.9' },
          );
          ok = ok && good;
        }
        if (!ok) return null;
        yield* typedEv(
          e,
          ft.ret,
          RULE.call,
          { section: '6.5.1' },
          `The call to '${e.callee}' matches the declaration and yields the return type ${typeToString(ft.ret)}.`,
        );
        return { type: ft.ret, lval: false };
      }
    }
    return null; // unreachable: all cases return
  }

  // ── Statements ────────────────────────────────────────────────────────────

  function* checkCond(e: Expr, what: string): SemSteps<void> {
    const r = yield* checkExpr(e);
    const v = yield* asValue(e, r);
    if (v === null) return;
    if (!isScalar(v.type)) {
      yield* err(
        e.span,
        `${what} condition must be a scalar, got ${typeToString(v.type)}`,
        RULE.condScalar,
        'use an arithmetic or pointer value; the condition is compared against 0',
        { section: '6.6.1' },
      );
    }
  }

  function* checkStmt(s: Stmt): SemSteps<void> {
    switch (s.kind) {
      case 'ExprStmt':
        if (s.expr !== null) yield* checkExpr(s.expr); // a bare void call is fine here
        return;
      case 'CompoundStmt':
        yield* checkCompound(s, true);
        return;
      case 'IfStmt':
        yield* checkCond(s.cond, 'if');
        yield* checkStmt(s.then);
        if (s.else_ !== null) yield* checkStmt(s.else_);
        return;
      case 'WhileStmt':
        yield* checkCond(s.cond, 'while');
        yield* checkStmt(s.body);
        return;
      case 'ForStmt':
        if (s.init !== null) yield* checkExpr(s.init);
        if (s.cond !== null) yield* checkCond(s.cond, 'for');
        if (s.update !== null) yield* checkExpr(s.update);
        yield* checkStmt(s.body);
        return;
      case 'ReturnStmt': {
        const fn = currentFunc!;
        if (s.expr === null) {
          if (!isVoidT(fn.ret)) {
            yield* err(
              s.span,
              `non-void function '${fn.name}' must return a ${typeToString(fn.ret)} value`,
              RULE.returnVoid,
              `write 'return <expr>;' with a ${typeToString(fn.ret)}-assignable expression`,
              { section: '6.9' },
            );
          }
          return;
        }
        const r = yield* checkExpr(s.expr);
        if (isVoidT(fn.ret)) {
          yield* err(
            s.expr.span,
            `void function '${fn.name}' cannot return a value`,
            RULE.returnVoid,
            "write 'return;' with no expression",
            { section: '6.9' },
          );
          return;
        }
        const v = yield* asValue(s.expr, r);
        if (v === null) return;
        yield* checkAssignable(
          s.expr,
          v.type,
          fn.ret,
          `the return from '${fn.name}'`,
          RULE.returnAssignable,
          { section: '6.9' },
        );
        return;
      }
    }
  }

  /** Function bodies share the function scope (params + body locals in one
   *  table, as in C); nested `{}` blocks open fresh scopes. */
  function* checkCompound(c: CompoundStmtNode, opensScope: boolean): SemSteps<void> {
    if (opensScope) yield* enterScope(ctx, 'block', c.span);
    for (const item of c.items) {
      if (item.kind === 'VarDecl') yield* checkVarDecl(item);
      else yield* checkStmt(item);
    }
    if (opensScope) yield* exitScope(ctx);
  }

  function* checkVarDecl(d: VarDeclNode, isGlobal = false): SemSteps<void> {
    for (const init of d.decls) {
      let t = resolveDeclaratorType(d.baseType, init.declarator);
      if (containsVoid(t)) {
        yield* err(
          init.declarator.nameSpan,
          `'${init.declarator.name}' cannot have type ${typeToString(t)}: void is a function-return type only`,
          RULE.voidVar,
          `give '${init.declarator.name}' a value type such as int`,
          { section: '6.3.3' },
        );
        t = baseType('int'); // error recovery: avoid cascading diagnostics
      }
      yield* typedEv(
        init,
        t,
        RULE.declResolve,
        { section: '6.3.3' },
        `The declarator resolves '${init.declarator.name}' to type ${typeToString(t)} (base ${d.baseType}, ${init.declarator.pointerDepth} pointer level(s)${init.declarator.array !== null ? ', array' : ''}).`,
      );
      const sym = yield* declareSymbol(
        ctx,
        init.declarator.name,
        t,
        'var',
        init.id,
        init.declarator.nameSpan,
      );
      if (init.init !== null) {
        const r = yield* checkExpr(init.init);
        const v = yield* asValue(init.init, r);
        if (v !== null && sym !== null) {
          yield* checkAssignable(
            init.init,
            v.type,
            sym.type,
            `the initialization of '${sym.name}'`,
            RULE.assignTypes,
            { section: '6.5.2' },
          );
        }
        // A global lives in the statically allocated data area: its initial
        // value is written into that cell before execution begins, so it must
        // be computable at compile time (§7.1 static allocation).
        if (isGlobal && evalConstExpr(init.init) === null) {
          yield* err(
            init.init.span,
            `the initializer for global '${init.declarator.name}' must be a constant expression`,
            RULE.globalConstInit,
            `only constants and operations on constants may initialize a global; assign '${init.declarator.name}' inside a function instead`,
            { section: '7.1' },
          );
        }
      }
    }
  }

  function* checkFuncDef(f: FuncDefNode): SemSteps<void> {
    ctx.section = `Function ${f.name}`;
    // Resolve parameter types first (silently — the typed events follow inside
    // the function scope); array parameters are adjusted to pointers (rule 6).
    const paramTypes: CType[] = [];
    for (const p of f.params) {
      let t = resolveDeclaratorType(p.baseType, p.declarator);
      if (containsVoid(t)) {
        yield* err(
          p.declarator.nameSpan,
          `parameter '${p.declarator.name}' cannot have type ${typeToString(t)}: void is a function-return type only`,
          RULE.voidVar,
          `give '${p.declarator.name}' a value type such as int`,
          { section: '6.3.3' },
        );
        t = baseType('int');
      }
      if (t.kind === 'array') t = { kind: 'pointer', to: t.of };
      paramTypes.push(t);
    }
    const ftype: CType = { kind: 'function', ret: baseType(f.returnType), params: paramTypes };
    yield* declareSymbol(ctx, f.name, ftype, 'func', f.id, f.nameSpan);
    yield* enterScope(ctx, 'function', f.span, f.name);
    for (let i = 0; i < f.params.length; i++) {
      const p = f.params[i]!;
      const t = paramTypes[i]!;
      yield* typedEv(
        p,
        t,
        RULE.declResolve,
        { section: '6.3.3' },
        `Parameter '${p.declarator.name}' has type ${typeToString(t)}${p.declarator.array !== null ? ' (an array parameter is adjusted to a pointer, rule 6)' : ''}.`,
      );
      yield* declareSymbol(ctx, p.declarator.name, t, 'param', p.id, p.declarator.nameSpan);
    }
    currentFunc = { name: f.name, ret: baseType(f.returnType) };
    yield* checkCompound(f.body, false); // body shares the function scope
    if (!isVoidT(currentFunc.ret) && !stmtReturns(f.body)) {
      yield* warn(
        f.nameSpan,
        `non-void function '${f.name}' may fall off the end without returning a value`,
        RULE.missingReturn,
        `add a 'return <${f.returnType}>;' on every path out of '${f.name}'`,
        { section: '6.9' },
      );
    }
    yield* exitScope(ctx);
    currentFunc = null;
  }

  // ── Program ───────────────────────────────────────────────────────────────

  ctx.section = 'Global scope';
  yield* enterScope(ctx, 'global', ast.root.span);
  for (const d of ast.root.decls) {
    if (d.kind === 'VarDecl') {
      ctx.section = 'Global scope';
      yield* checkVarDecl(d, true);
    } else {
      yield* checkFuncDef(d);
    }
  }
  ctx.section = 'Global scope';
  yield* exitScope(ctx);
  return info;
}

/** Convenience runner: record the semantic pass as a replayable trace. */
export function runSemanticAnalysis(ast: Ast): Recorded<SemState, SemEvent, SemanticInfo> {
  return record(() => analyze(ast), initialSemState(), semReducer, { id: 'sem.analyze' });
}

// Re-exports so the module presents the full algorithm surface
// (event union, UI state, initial state, reducer, runner, raw result type).
export { RULE, initialSemState, projectSemanticInfo, semReducer } from './sem-events.js';
export type { SemEvent, SemState } from './sem-events.js';
export type { SemanticInfo } from './types.js';
