/**
 * The seven panels that advance beside the 3D stage.
 *
 * Each one names the phase, says in one sentence what is happening to `max.c`
 * on screen, shows the artifact the phase actually produced, and links into the
 * lab route where you can step through the run that produced it.
 *
 * Every listing is read straight out of max-program.ts. The only thing this
 * file adds is the order they arrive in.
 */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  ASM_HERO,
  ASM_HERO_FIRST_LINE,
  AST_NODES,
  BLOCKS,
  GRAMMAR_FACTS,
  OPT_PASSES,
  QUADS,
  REGISTER_ASSIGNMENT,
  SCOPES,
  SOURCE,
  SYMBOL_TABLE,
  TOKENS,
} from '../max-program';
import { AST_PREFIXES } from './program-geometry';
import { Decode, Typed } from '../motion/text';

export interface StageDef {
  readonly id: string;
  /** LEXICAL, SYNTAX, … as the rail prints it. */
  readonly rail: string;
  readonly heading: string;
  readonly cite: string;
  readonly caption: string;
  /** Lab route for this phase; the source panel has none. */
  readonly href?: string;
  readonly blurb: ReactNode;
  /**
   * The artifact. `typed` is the source-typing progress and `active` says the
   * panel is the one on screen, so an effect can start on arrival rather than
   * on mount.
   */
  artifact(ctx: { typed: number; active: boolean }): ReactNode;
}

/** One token, drawn the way `/lab/lex` draws the stream. */
function TokenChip({ i, delay }: { i: number; delay: number }) {
  const t = TOKENS[i]!;
  const cls = t.type !== t.lexeme ? t.type : /^[a-z]+$/.test(t.type) ? 'keyword' : 'punct';
  return (
    <span
      className="site-pop inline-flex flex-col items-center rounded-xs border border-line bg-surface px-1.5 py-1 leading-none"
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="text-ink">{t.lexeme}</span>
      <span className="mt-1 text-3xs text-ink-faint">{cls}</span>
    </span>
  );
}

export const STAGES: readonly StageDef[] = [
  {
    id: 'source',
    rail: 'Source',
    heading: 'Four lines of C',
    cite: 'max.c',
    caption: `${SOURCE.trimEnd().split('\n').length} lines · the whole program`,
    blurb: (
      <>
        One function, written out. Everything below this point is the same program — the compiler
        never gets a second input.
      </>
    ),
    artifact: ({ typed }) => (
      <pre className="site-listing whitespace-pre text-ink">
        <Typed text={SOURCE.trimEnd()} progress={typed} />
      </pre>
    ),
  },
  {
    id: 'lex',
    rail: 'Lexical',
    heading: 'Characters break into tokens',
    cite: '§3.8.3 · Fig 3.54',
    href: '/lab/lex',
    caption: `${TOKENS.length} tokens · ${SYMBOL_TABLE.length} interned identifiers`,
    blurb: (
      <>
        The scanner takes the longest match at each position and interns identifiers as it goes, so
        both <code>a</code>s are one symbol seen three times.
      </>
    ),
    artifact: () => (
      <div className="flex flex-wrap gap-1">
        {TOKENS.map((t, i) => (
          <TokenChip key={`${t.type}-${i}`} i={i} delay={i * 26} />
        ))}
      </div>
    ),
  },
  {
    id: 'syntax',
    rail: 'Syntax',
    heading: 'Tokens assemble into a tree',
    cite: '§4.7.4 · Fig 4.43',
    href: '/lab/syntax',
    caption: `${AST_NODES.length} nodes · ${GRAMMAR_FACTS.canonicalLr1States} → ${GRAMMAR_FACTS.lalrStates} states`,
    blurb: (
      <>
        A real LALR(1) machine, built by this repo's own table constructor. Ten tokens are consumed
        by productions rather than kept — watch them leave.
      </>
    ),
    artifact: () => (
      <div className="site-listing whitespace-pre">
        {AST_NODES.map((n, i) => (
          <div key={`${n.kind}-${i}`} className="site-pop" style={{ animationDelay: `${i * 34}ms` }}>
            <span className="text-ink-faint">{AST_PREFIXES[i]}</span>
            <span className="text-ink">{n.kind}</span>
            {n.detail ? <span className="text-ink-muted"> {n.detail}</span> : null}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'semantic',
    rail: 'Semantic',
    heading: 'Names get scopes and types',
    cite: '§2.7 · §6.5',
    href: '/lab/semantic',
    caption: `${SCOPES.length} scopes · ${SYMBOL_TABLE.length} symbols · 0 conversions`,
    blurb: (
      <>
        Every identifier resolves to a declaration in an enclosing scope and takes its type. Two{' '}
        <code>int</code>s need no widening, so nothing is inserted.
      </>
    ),
    artifact: () => (
      <div className="site-listing">
        {SCOPES.map((scope) => (
          <div key={scope.id} style={{ paddingLeft: `${scope.id * 1.1}rem` }}>
            <div className="text-ink-faint">
              scope {scope.id} · {scope.kind}
              {scope.label ? ` ${scope.label}` : ''}
            </div>
            {scope.entries.map((e) => (
              <div key={e.name} className="pt-0.5 pl-4">
                <span className="text-ink">{e.name}</span>
                <span className="text-ink-faint"> : </span>
                <span className="text-ok">{e.type}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'ir',
    rail: 'Intermediate',
    heading: 'The tree flattens to quadruples',
    cite: '§6.4 · §6.6',
    href: '/lab/ir',
    caption: `${QUADS.length} quadruples · 0 temporaries`,
    blurb: (
      <>
        The <code>if</code> emits a jump to a label that does not exist yet: the quad keeps a hole,
        and the hole is filled once the target is known — backpatching.
      </>
    ),
    artifact: ({ active }) => (
      <div className="site-listing whitespace-pre">
        {QUADS.map((q) => (
          <div key={q.index} className="flex gap-3">
            <span className="w-3 shrink-0 text-right text-ink-faint tabular-nums">{q.index}</span>
            <Decode
              text={q.text}
              now={active}
              delay={q.index * 70}
              className={q.text.endsWith(':') ? 'text-ink' : 'text-ink-muted'}
            />
          </div>
        ))}
      </div>
    ),
  },
  {
    id: 'opt',
    rail: 'Optimisation',
    heading: 'Blocks, wired into a graph',
    cite: '§8.4 · §9',
    href: '/lab/opt',
    caption: `${BLOCKS.length} blocks · 6 edges · ${OPT_PASSES.length} passes, 0 changes`,
    blurb: (
      <>
        A leader starts a block, and the blocks become a control-flow graph. Six passes run over it
        and none of them finds anything to change — a result worth reading too.
      </>
    ),
    artifact: () => (
      <div className="site-listing">
        {BLOCKS.map((b, i) => (
          <div
            key={b.id}
            className="site-pop flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
            style={{ animationDelay: `${i * 60}ms` }}
          >
            <span className="text-accent">{b.id}</span>
            <span className="text-ink-muted">{b.body}</span>
            <span className="text-2xs text-ink-faint">→ {b.to.join(', ')}</span>
          </div>
        ))}
        <div className="mt-3 flex flex-wrap gap-1 border-t border-line pt-2">
          {OPT_PASSES.map((p, i) => (
            <span
              key={p}
              className="site-fire rounded-xs border border-line px-1.5 py-0.5 text-2xs text-ink-faint"
              style={{ animationDelay: `${300 + i * 190}ms` }}
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    ),
  },
  {
    id: 'codegen',
    rail: 'Codegen',
    heading: 'Live ranges get registers',
    cite: '§8.8 · §7.2',
    href: '/lab/codegen',
    caption: `lines ${ASM_HERO_FIRST_LINE}–${ASM_HERO_FIRST_LINE + ASM_HERO.length - 1} of 25 · 0 spills`,
    blurb: (
      <>
        <code>a</code> and <code>b</code> are live at the same moment, so they interfere and take
        different registers. Two colours are enough; nothing spills.
      </>
    ),
    artifact: ({ active }) => (
      <div className="site-listing whitespace-pre">
        {ASM_HERO.map((line, i) => (
          <div key={`${line.text}-${i}`} className="flex gap-3">
            <span className="w-4 shrink-0 text-right text-ink-faint tabular-nums">
              {ASM_HERO_FIRST_LINE + i}
            </span>
            <Decode
              text={line.text}
              now={active}
              delay={i * 55}
              className={clsx(
                line.text.includes('%rcx')
                  ? 'text-accent'
                  : line.text.includes('%rbx')
                    ? 'text-warn'
                    : line.kind === 'label'
                      ? 'text-ink'
                      : 'text-ink-muted',
              )}
            />
          </div>
        ))}
        <div className="mt-3 flex flex-wrap gap-x-4 border-t border-line pt-2 text-2xs">
          {REGISTER_ASSIGNMENT.map((r) => (
            <span key={r.name}>
              <span className={r.reg === '%rcx' ? 'text-accent' : 'text-warn'}>{r.name}</span>
              <span className="text-ink-faint"> → </span>
              <span className="text-ink-muted">{r.reg}</span>
            </span>
          ))}
        </div>
      </div>
    ),
  },
];
