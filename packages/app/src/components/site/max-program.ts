/**
 * `max.c` — the one program the public pages follow all the way down.
 *
 * EVERY value in this file was produced by running THIS repository's compiler
 * on the source below (`packages/core/src/compile.ts`) and copying the result.
 * Nothing here is illustrative or invented. If the compiler changes, these
 * listings are wrong and must be regenerated:
 *
 *   import { compile } from '@lab/core/compile.js';
 *   const c = compile(SOURCE);
 *   c.tokens.tokens · c.tokens.symbols · c.semantic.scopes · c.tac ·
 *   c.optimized.cfgs · c.optimized.passes · c.asm.lines · c.registers
 *
 * Verified against the pipeline on the same run:
 *   23 tokens · 3 symbols · 2 scopes · 0 conversions · 6 quads · 0 temporaries
 *   4 basic blocks · 6 CFG edges · 6 passes, 0 changes · 25 asm lines · 0 spills
 *
 * The LALR(1) numbers come from `pipelineTables()` on the C-subset grammar:
 *   86 productions · 553 canonical LR(1) states → 147 LALR states ·
 *   exactly 1 conflict (state 138, on `else`), resolved by shift per §4.8.2.
 */

/** The source, verbatim. Indented with two spaces, as the compiler saw it. */
export const SOURCE_LINES = [
  'int max(int a, int b) {',
  '  if (a > b) return a;',
  '  return b;',
  '}',
] as const;

export const SOURCE = SOURCE_LINES.join('\n') + '\n';

/** `c.tokens.tokens` — token class and lexeme, in scan order. All 23. */
export interface TokenPair {
  readonly type: string;
  readonly lexeme: string;
}

export const TOKENS: readonly TokenPair[] = [
  { type: 'int', lexeme: 'int' },
  { type: 'id', lexeme: 'max' },
  { type: '(', lexeme: '(' },
  { type: 'int', lexeme: 'int' },
  { type: 'id', lexeme: 'a' },
  { type: ',', lexeme: ',' },
  { type: 'int', lexeme: 'int' },
  { type: 'id', lexeme: 'b' },
  { type: ')', lexeme: ')' },
  { type: '{', lexeme: '{' },
  { type: 'if', lexeme: 'if' },
  { type: '(', lexeme: '(' },
  { type: 'id', lexeme: 'a' },
  { type: '>', lexeme: '>' },
  { type: 'id', lexeme: 'b' },
  { type: ')', lexeme: ')' },
  { type: 'return', lexeme: 'return' },
  { type: 'id', lexeme: 'a' },
  { type: ';', lexeme: ';' },
  { type: 'return', lexeme: 'return' },
  { type: 'id', lexeme: 'b' },
  { type: ';', lexeme: ';' },
  { type: '}', lexeme: '}' },
];

/** `c.tokens.symbols` — the interned identifiers and how often each was seen. */
export const SYMBOL_TABLE = [
  { id: 0, lexeme: 'max', line: 1, col: 5, occurrences: 1 },
  { id: 1, lexeme: 'a', line: 1, col: 13, occurrences: 3 },
  { id: 2, lexeme: 'b', line: 1, col: 20, occurrences: 3 },
] as const;

/** `c.ast.root`, printed as the lab prints it. Depth drives the indent. */
export const AST_NODES = [
  { depth: 0, kind: 'Program', detail: '' },
  { depth: 1, kind: 'FuncDef', detail: 'int max' },
  { depth: 2, kind: 'Param', detail: 'int a' },
  { depth: 2, kind: 'Param', detail: 'int b' },
  { depth: 2, kind: 'CompoundStmt', detail: '' },
  { depth: 3, kind: 'IfStmt', detail: '' },
  { depth: 4, kind: 'Binary', detail: '>' },
  { depth: 5, kind: 'Ident', detail: 'a' },
  { depth: 5, kind: 'Ident', detail: 'b' },
  { depth: 4, kind: 'ReturnStmt', detail: '' },
  { depth: 5, kind: 'Ident', detail: 'a' },
  { depth: 3, kind: 'ReturnStmt', detail: '' },
  { depth: 4, kind: 'Ident', detail: 'b' },
] as const;

/**
 * The one conflict the C-subset grammar still has, and how the table
 * constructor resolved it. Copied from `pipelineTables().resolutions[0]`.
 */
export const DANGLING_ELSE = {
  state: 138,
  symbol: 'else',
  kind: 'shift/reduce',
  reduce: {
    item: '[IfStmt → if ( Expr ) Stmt ·, else]',
    action: 'reduce 39',
  },
  shift: {
    item: '[IfStmt → if ( Expr ) Stmt · else Stmt, int]',
    action: 'shift 141',
  },
  reason:
    'shifting `else` attaches it to the closest previous unmatched `if`, which is the conventional resolution',
} as const;

/** `c.semantic.scopes` joined with `c.semantic.symbols`. */
export const SCOPES = [
  {
    id: 0,
    kind: 'global',
    label: null as string | null,
    entries: [{ name: 'max', type: 'int (int, int)' }],
  },
  {
    id: 1,
    kind: 'function',
    label: 'max',
    entries: [
      { name: 'a', type: 'int' },
      { name: 'b', type: 'int' },
    ],
  },
] as const;

/** `c.tac.functions[0].quads`, rendered the way the IR view renders them. */
export const QUADS = [
  { index: 0, text: 'if a > b goto L1' },
  { index: 1, text: 'goto L2' },
  { index: 2, text: 'L1:' },
  { index: 3, text: 'return a' },
  { index: 4, text: 'L2:' },
  { index: 5, text: 'return b' },
] as const;

/** `c.optimized.cfgs[0]` — four blocks, six edges, entry -1 and exit -2. */
export const BLOCKS = [
  { id: 'B0', quads: '0', body: 'if a > b goto L1', to: ['B2', 'B1'] },
  { id: 'B1', quads: '1', body: 'goto L2', to: ['B3'] },
  { id: 'B2', quads: '2–3', body: 'L1: return a', to: ['exit'] },
  { id: 'B3', quads: '4–5', body: 'L2: return b', to: ['exit'] },
] as const;

/** `DEFAULT_OPT_PASSES`, in the order the pipeline applies them. */
export const OPT_PASSES = ['const-fold', 'const-prop', 'copy-prop', 'cse', 'licm', 'dce'] as const;

/** `c.asm.lines` — all 25, text and kind, in emission order. */
export interface AsmLine {
  readonly text: string;
  readonly kind: 'directive' | 'label' | 'instr';
}

export const ASM: readonly AsmLine[] = [
  {
    text: '# Lab x86-64 subset (AT&T syntax). int/char are treated as 64-bit for simplicity.',
    kind: 'directive',
  },
  { text: '.text', kind: 'directive' },
  { text: '.globl main', kind: 'directive' },
  { text: 'max:', kind: 'label' },
  { text: 'pushq %rbp', kind: 'instr' },
  { text: 'movq %rsp, %rbp', kind: 'instr' },
  { text: 'pushq %rbx', kind: 'instr' },
  { text: 'pushq %rcx', kind: 'instr' },
  { text: 'movq %rdi, %rcx', kind: 'instr' },
  { text: 'movq %rsi, %rbx', kind: 'instr' },
  { text: 'cmpq %rbx, %rcx', kind: 'instr' },
  { text: 'jg .Lmax_L1', kind: 'instr' },
  { text: 'jmp .Lmax_L2', kind: 'instr' },
  { text: '.Lmax_L1:', kind: 'label' },
  { text: 'movq %rcx, %rax', kind: 'instr' },
  { text: 'jmp .Lmax_ret', kind: 'instr' },
  { text: '.Lmax_L2:', kind: 'label' },
  { text: 'movq %rbx, %rax', kind: 'instr' },
  { text: 'jmp .Lmax_ret', kind: 'instr' },
  { text: '.Lmax_ret:', kind: 'label' },
  { text: 'popq %rcx', kind: 'instr' },
  { text: 'popq %rbx', kind: 'instr' },
  { text: 'movq %rbp, %rsp', kind: 'instr' },
  { text: 'popq %rbp', kind: 'instr' },
  { text: 'ret', kind: 'instr' },
];

/**
 * The hero shows the entry through both branch targets: `max:` down to the
 * `jmp` that skips the taken branch. Ten of twenty-five lines — the caption
 * says which ten, and the full listing is in `/lab/codegen`.
 */
export const ASM_HERO = ASM.slice(3, 13);

/** 1-based position of `ASM_HERO[0]` in the full listing, for the row gutter. */
export const ASM_HERO_FIRST_LINE = 4;

/** `c.registers[0]` — graph colouring found two colours and spilled nothing. */
export const REGISTER_ASSIGNMENT = [
  { name: 'a', reg: '%rcx' },
  { name: 'b', reg: '%rbx' },
] as const;

/** Grammar and table facts, from `pipelineTables()` on `cGrammar()`. */
export const GRAMMAR_FACTS = {
  productions: 86,
  nonterminals: 36,
  terminals: 37,
  canonicalLr1States: 553,
  lalrStates: 147,
  conflicts: 1,
} as const;
