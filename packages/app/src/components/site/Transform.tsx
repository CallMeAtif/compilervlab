/**
 * THE TRANSFORM — the hero of `/`, and the one thing this page is remembered by.
 *
 * One real C function and its compiled forms, SIDE BY SIDE:
 *
 *     max.c  ──▸  TOKENS │ THREE-ADDRESS │ x86-64
 *
 * The source never leaves the frame. That is the whole idea: you are not
 * watching four slides go past, you are watching ONE program become each of
 * the things a compiler turns it into, with the input still in front of you to
 * compare against. Crimson marks the form being produced now and nothing else.
 *
 * Every listing is output from THIS repository's compiler (see max-program.ts);
 * nothing is illustrative.
 *
 * Behaviour:
 *  • Tabs, properly: roving tabindex, Left/Right/Home/End, one tabpanel.
 *  • Auto-advance every 4.2s, with a rule under the active name as its clock.
 *  • WCAG 2.2.2 — auto-updating content that runs past five seconds needs a
 *    pause. There is a real Pause/Play control; choosing a form also pauses,
 *    because a reader who picked a form did not ask to be moved off it.
 *  • Pointer or keyboard inside the figure suspends the timer while you read.
 *  • `prefers-reduced-motion: reduce` → no timer at all. The composed state is
 *    shown and the tabs still work, so nothing is lost, it just never moves.
 *
 * Layout is computed once: the output cell has a fixed min-height and rows
 * animate only opacity/transform, so a form change never reflows the page.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { Pause, Play } from 'lucide-react';
import {
  ASM_HERO,
  ASM_HERO_FIRST_LINE,
  QUADS,
  SOURCE_LINES,
  TOKENS,
  type TokenPair,
} from './max-program';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

const DWELL_MS = 4200;

type StageId = 'tokens' | 'tac' | 'asm';

interface Stage {
  id: StageId;
  /** The tab label. Mono, upper — it names a compiler artifact. */
  name: string;
  /** Narrow-screen label, where the full name would push the rail off-screen. */
  shortName?: string;
  /** What produced this form. Sits under the well, in mono. */
  caption: string;
}

const STAGES: readonly Stage[] = [
  {
    id: 'tokens',
    name: 'Tokens',
    caption: '23 tokens · 3 interned identifiers · §3.8.3',
  },
  {
    id: 'tac',
    name: 'Three-address',
    shortName: 'TAC',
    caption: '6 quadruples · 0 temporaries · §6.4',
  },
  {
    id: 'asm',
    name: 'x86-64',
    caption: 'lines 4–13 of 25 · AT&T syntax · §8.8',
  },
];

/**
 * A listing row. `i` drives the stagger (the delay is a CSS custom property);
 * `num` is the number the artifact ITSELF uses — source line, quad index, or
 * position in the 25-line assembly listing — so the gutter always agrees with
 * the caption and with what the lab shows for the same run.
 */
function Row({
  i,
  num,
  animate = true,
  children,
}: {
  i: number;
  num: number;
  animate?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx('flex gap-3', animate && 'site-row')}
      style={{ '--i': i } as React.CSSProperties}
    >
      <span aria-hidden className="w-5 shrink-0 text-right text-ink-faint select-none">
        {num}
      </span>
      <span className="min-w-0 whitespace-pre">{children}</span>
    </div>
  );
}

/**
 * The token's class, as the scanner labels it. For a keyword or a punctuator
 * the class IS the lexeme (`int` is an `int` token), which would print the same
 * word twice, so those two families are named instead.
 */
function tokenClass(token: TokenPair): string {
  if (token.type !== token.lexeme) return token.type;
  return /^[a-z]+$/.test(token.type) ? 'keyword' : 'punct';
}

/** One token: the lexeme over its class, the way `/lab/lex` draws the stream. */
function TokenChip({ token, i }: { token: TokenPair; i: number }) {
  return (
    <span
      className="site-row inline-flex flex-col items-center rounded-xs border border-line bg-surface px-2 py-1.5 leading-none"
      style={{ '--i': i } as React.CSSProperties}
    >
      <span className="text-ink">{token.lexeme}</span>
      <span className="mt-1.5 text-3xs text-ink-faint">{tokenClass(token)}</span>
    </span>
  );
}

function StagePanel({ stage }: { stage: StageId }) {
  if (stage === 'tokens') {
    return (
      <div className="flex flex-wrap gap-1.5">
        {TOKENS.map((t, i) => (
          <TokenChip key={`${t.type}-${i}`} token={t} i={i} />
        ))}
      </div>
    );
  }

  if (stage === 'tac') {
    return (
      <div>
        {QUADS.map((q) => (
          <Row key={q.index} i={q.index} num={q.index}>
            {q.text}
          </Row>
        ))}
      </div>
    );
  }

  return (
    <div>
      {ASM_HERO.map((line, i) => (
        <Row key={`${line.text}-${i}`} i={i} num={ASM_HERO_FIRST_LINE + i}>
          <span className={line.kind === 'label' ? 'text-ink' : 'text-ink-muted'}>{line.text}</span>
        </Row>
      ))}
    </div>
  );
}

export function Transform() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  /** Set while the pointer or focus is inside — a courtesy hold, not a choice. */
  const [held, setHeld] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const running = playing && !held && !reduced;

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % STAGES.length), DWELL_MS);
    return () => window.clearTimeout(id);
  }, [running, index]);

  const select = useCallback((next: number) => {
    setIndex(next);
    // Picking a form is a decision. Do not slide off it two seconds later.
    setPlaying(false);
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const last = STAGES.length - 1;
      let next: number | null = null;
      if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
      else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = last;
      if (next === null) return;
      e.preventDefault();
      select(next);
      tabRefs.current[next]?.focus();
    },
    [index, select],
  );

  const active = STAGES[index]!;
  const clockKey = useMemo(() => `${index}-${running}`, [index, running]);

  return (
    <figure
      className="site-well site-transform overflow-hidden"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
    >
      {/* ── Header: the input names itself, the outputs are the rail ─────── */}
      <div className="site-transform-grid border-b border-line">
        {/* Not a tab: the source is the one thing that never changes. It is
            labelled the same way the forms are so the row reads left to right
            as `SOURCE ──▸ one of these`. */}
        <div className="site-transform-from flex min-h-11 items-center gap-2 px-4 sm:px-5">
          {/* Lower case, deliberately: it is a filename, and the rail beside it
              is upper case, so the two never read as one set of tabs. */}
          <span className="font-mono text-2xs tracking-[0.14em] text-ink-faint">max.c</span>
          <span aria-hidden className="h-px flex-1 bg-line" />
          <span aria-hidden className="font-mono text-2xs text-ink-faint">
            <span className="lg:hidden">&darr;</span>
            <span className="hidden lg:inline">&rarr;</span>
          </span>
        </div>

        <div className="flex items-stretch justify-between gap-2 pr-1 pl-1 sm:pr-2 sm:pl-2">
          <div
            role="tablist"
            aria-label="Compiled form"
            onKeyDown={onKeyDown}
            className="-mb-px flex min-w-0 flex-1 overflow-x-auto"
          >
            {STAGES.map((stage, i) => {
              const selected = i === index;
              return (
                <button
                  key={stage.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`transform-tab-${stage.id}`}
                  aria-selected={selected}
                  aria-controls="transform-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(i)}
                  className={clsx(
                    'relative flex min-h-11 shrink-0 cursor-pointer items-center px-2.5 font-mono text-2xs tracking-[0.14em] uppercase transition-colors duration-[var(--dur-fast)] sm:px-3.5',
                    selected ? 'text-somaiya-strong' : 'text-ink-faint hover:text-ink',
                  )}
                >
                  {stage.shortName ? (
                    <>
                      <span className="sm:hidden">{stage.shortName}</span>
                      <span className="hidden sm:inline">{stage.name}</span>
                    </>
                  ) : (
                    stage.name
                  )}
                  {/* The active mark is a bar AND a colour, so it survives
                      greyscale — the same contract the lab's rail uses. */}
                  <span
                    aria-hidden
                    className={clsx(
                      'absolute inset-x-1.5 bottom-0 h-0.5',
                      selected ? 'bg-somaiya' : 'bg-transparent',
                    )}
                  />
                  {selected && running && (
                    <span
                      key={clockKey}
                      aria-hidden
                      className="site-clock absolute inset-x-1.5 bottom-0 h-0.5 bg-ink-faint/60"
                      style={{ '--site-dwell': `${DWELL_MS}ms` } as React.CSSProperties}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {!reduced && (
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? 'Pause the compilation loop' : 'Play the compilation loop'}
              className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-xs text-ink-faint transition-colors duration-[var(--dur-fast)] hover:bg-raised hover:text-ink"
            >
              {playing ? (
                <Pause aria-hidden className="size-3.5" />
              ) : (
                <Play aria-hidden className="size-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── The well: input on the left, the form it becomes on the right ── */}
      <div className="site-transform-grid">
        <div className="site-transform-from site-stage site-listing-hero px-4 py-4 text-ink-muted sm:px-5 sm:py-5">
          <div>
            {SOURCE_LINES.map((line, i) => (
              <Row key={line} i={i} num={i + 1} animate={false}>
                {line}
              </Row>
            ))}
          </div>
        </div>

        <div
          id="transform-panel"
          role="tabpanel"
          aria-labelledby={`transform-tab-${active.id}`}
          tabIndex={0}
          className="site-stage site-stage-out site-listing-hero artifact-scroll px-4 py-4 text-ink sm:px-6 sm:py-5"
        >
          {/* Keyed on the form: React replaces the subtree, so the row
              animations restart instead of resuming mid-flight. */}
          <div key={active.id}>
            <StagePanel stage={active.id} />
          </div>
        </div>
      </div>

      <figcaption className="border-t border-line px-4 py-2.5 font-mono text-2xs text-ink-faint sm:px-6">
        {active.caption}
      </figcaption>
    </figure>
  );
}
