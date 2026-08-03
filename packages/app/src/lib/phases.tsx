/** Static metadata for the six pipeline phases (routes, labels, planned algos). */
import type { Phase, Compilation } from '@lab/core';
import type { LucideIcon } from 'lucide-react';
import { ScanText, ListTree, SearchCheck, Braces, Gauge, Cpu } from 'lucide-react';
import type { PipelineInfo } from '../worker/api';

export interface PhaseInfo {
  phase: Phase;
  path: string;
  title: string;
  /** Short label for chips. */
  short: string;
  blurb: string;
  icon: LucideIcon;
  /** Planned selectable algorithms (?algo= values) for this phase. */
  algorithms: Array<{ id: string; label: string }>;
  /**
   * One-line artifact summary for the pipeline diagram. `info` carries the
   * source-independent parser facts once the store has them (see
   * worker/api.ts `getPipelineInfo`); it is null until then.
   */
  summary: (c: Compilation, info?: PipelineInfo | null) => string | null;
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

const quadCount = (fns: ReadonlyArray<{ quads: unknown[] }>): number =>
  fns.reduce((n, f) => n + f.quads.length, 0);

export const PHASES: readonly PhaseInfo[] = [
  {
    phase: 'lex',
    path: '/lab/lex',
    title: 'Lexical Analysis',
    short: 'Lex',
    blurb: 'Regex → NFA → DFA → minimized DFA, and DFA-driven tokenization of the source.',
    icon: ScanText,
    algorithms: [
      { id: 'thompson', label: 'Thompson NFA' },
      { id: 'subset', label: 'Subset construction' },
      { id: 'minimize', label: 'DFA minimization' },
      { id: 'scan', label: 'Tokenize' },
    ],
    summary: (c) =>
      c.tokens
        ? `${plural(c.tokens.tokens.length, 'token')} · ${plural(
            c.tokens.symbols.length,
            'identifier',
          )}`
        : null,
  },
  {
    phase: 'syntax',
    path: '/lab/syntax',
    title: 'Syntax Analysis',
    short: 'Syntax',
    blurb: 'FIRST/FOLLOW, LL(1), recursive descent, LR(0)/SLR, LR(1)/LALR — tables, automata, and the live parse.',
    icon: ListTree,
    algorithms: [
      { id: 'first-follow', label: 'FIRST / FOLLOW' },
      { id: 'll1', label: 'LL(1)' },
      { id: 'rd', label: 'Recursive descent' },
      { id: 'lr0', label: 'LR(0)' },
      { id: 'slr', label: 'SLR(1)' },
      { id: 'lr1', label: 'Canonical LR(1)' },
      { id: 'lalr1', label: 'LALR(1)' },
    ],
    summary: (c, info) => {
      if (!c.ast) return null;
      const ast = `AST · ${plural(c.ast.nodes.length, 'node')}`;
      // The LALR(1) machine is the same for every program, so it is worth
      // showing: it is the parser this compilation actually ran.
      return info ? `${ast} · ${info.lalrStates} LALR states` : ast;
    },
  },
  {
    phase: 'semantic',
    path: '/lab/semantic',
    title: 'Semantic Analysis',
    short: 'Semantic',
    blurb: 'Scoped symbol tables, name resolution, and type checking over the AST.',
    icon: SearchCheck,
    algorithms: [
      { id: 'scopes', label: 'Scope construction' },
      { id: 'typecheck', label: 'Type checking' },
    ],
    summary: (c) =>
      c.semantic
        ? `${plural(c.semantic.symbols.length, 'symbol')} · ${plural(
            c.semantic.scopes.length,
            'scope',
          )}`
        : null,
  },
  {
    phase: 'ir',
    path: '/lab/ir',
    title: 'Intermediate Code',
    short: 'IR',
    blurb: 'AST → three-address code: quadruples (canonical), triples, indirect triples.',
    icon: Braces,
    algorithms: [
      { id: 'quads', label: 'Quadruples' },
      { id: 'triples', label: 'Triples' },
      { id: 'indirect', label: 'Indirect triples' },
    ],
    summary: (c) =>
      c.tac
        ? `${plural(quadCount(c.tac.functions), 'quad')} · ${plural(
            c.tac.functions.length,
            'function',
          )}`
        : null,
  },
  {
    phase: 'opt',
    path: '/lab/opt',
    title: 'Optimization',
    short: 'Opt',
    blurb: 'Basic blocks, CFGs, and classic passes with before/after diffs.',
    icon: Gauge,
    algorithms: [
      { id: 'const-fold', label: 'Constant folding' },
      { id: 'const-prop', label: 'Constant propagation' },
      { id: 'copy-prop', label: 'Copy propagation' },
      { id: 'cse', label: 'Common subexpr. elim.' },
      { id: 'dce', label: 'Dead code elim.' },
      { id: 'licm', label: 'Loop-invariant motion' },
    ],
    summary: (c) => {
      if (!c.optimized) return null;
      const before = quadCount(c.optimized.input.functions);
      const after = quadCount(c.optimized.output.functions);
      const changes = c.optimized.passes.reduce((n, p) => n + p.changes.length, 0);
      const delta = after === before ? '±0' : `${after > before ? '+' : '−'}${Math.abs(after - before)}`;
      return `${plural(c.optimized.passes.length, 'pass', 'passes')} · ${plural(
        changes,
        'rewrite',
      )} · ${before}→${after} quads (${delta})`;
    },
  },
  {
    phase: 'codegen',
    path: '/lab/codegen',
    title: 'Code Generation',
    short: 'Codegen',
    blurb: 'Instruction selection to x86-64, liveness, interference graph coloring, spills.',
    icon: Cpu,
    algorithms: [
      { id: 'select', label: 'Instruction selection' },
      { id: 'liveness', label: 'Liveness' },
      { id: 'color', label: 'Graph coloring' },
    ],
    summary: (c) => {
      if (!c.asm) return null;
      const regs = new Set<string>();
      let spills = 0;
      for (const ra of c.registers ?? []) {
        spills += ra.spilled.length;
        for (const slot of Object.values(ra.assignment)) {
          if ('reg' in slot) regs.add(slot.reg);
        }
      }
      const alloc = c.registers
        ? ` · ${plural(regs.size, 'register')} · ${plural(spills, 'spill')}`
        : '';
      return `${plural(c.asm.lines.length, 'asm line')}${alloc}`;
    },
  },
];

export function phaseInfo(phase: Phase): PhaseInfo {
  const info = PHASES.find((p) => p.phase === phase);
  if (!info) throw new Error(`unknown phase ${phase}`);
  return info;
}
