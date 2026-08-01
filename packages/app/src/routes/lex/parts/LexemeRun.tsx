/**
 * The one place the constructions touch YOUR program.
 *
 * The automaton above is built from the token pattern and never moves when you
 * edit the editor. This band picks a lexeme the scanner actually produced for
 * this class and walks the SAME machine over it — the states and transitions
 * light up in the graph above, and the row below writes the path out.
 *
 * A subsection inside the automaton's band, not a band of its own: it is a
 * control over that drawing, so it costs no extra chrome (docs/EDITORIAL.md §0).
 */
import { clsx } from 'clsx';
import { showSymbol } from '../graph';
import { walkOutcome, walkSentence, type LexemeRunModel } from '../lexemeRun';
import type { LexTokenClass } from '../tokenClasses';

/** Beyond this the chips stop being a control and become a token stream. */
const MAX_CHIPS = 12;

function StateChip({
  id,
  accepting,
  start,
}: {
  id: string;
  accepting: boolean;
  start: boolean;
}) {
  return (
    <span
      className={clsx(
        'whitespace-nowrap',
        accepting ? 'font-semibold text-ink' : 'text-ink-muted',
      )}
    >
      {start && '▸'}
      {accepting ? `((${id}))` : id}
    </span>
  );
}

function Walk({
  model,
  isAccepting,
}: {
  model: LexemeRunModel;
  isAccepting: (id: string) => boolean;
}) {
  const walk = model.walk;
  if (walk === null) return null;
  const states = [walk.start, ...walk.moves.map((m) => m.to)];

  return (
    <div role="status" className="mt-2.5 flex flex-col gap-1">
      <span className="sr-only">{walkSentence(walk)}</span>
      <div
        aria-hidden
        className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-xs"
      >
        {states.map((s, i) => (
          <span key={`${s}-${i}`} className="flex items-center gap-1.5">
            <StateChip id={s} accepting={isAccepting(s)} start={i === 0} />
            {i < walk.moves.length && (
              <span className="text-ink-faint">─{showSymbol(walk.moves[i]!.char)}→</span>
            )}
          </span>
        ))}
        {walk.stuckAt !== null && <span className="text-err">⊘</span>}
      </div>
      <p
        className={clsx(
          'font-mono text-2xs',
          walk.accepted ? 'text-ink-muted' : 'text-err',
        )}
      >
        {walk.accepted ? '◎ ' : '⊘ '}
        {walkOutcome(walk)}
      </p>
    </div>
  );
}

export function LexemeRun({
  cls,
  model,
  isAccepting,
}: {
  cls: LexTokenClass;
  model: LexemeRunModel;
  /** Accepting test for the machine the stage drew. */
  isAccepting: (id: string) => boolean;
}) {
  const shown = model.lexemes.slice(0, MAX_CHIPS);
  const hidden = model.lexemes.length - shown.length;

  return (
    <div className="mt-5">
      <h3 className="subsection-title flex flex-wrap items-baseline gap-x-3">
        Run a lexeme from your program
        <span className="section-meta ml-auto">fixed machine · your path</span>
      </h3>

      {!model.hasCompilation ? (
        <p className="prose-note text-sm">Compile a program to run its lexemes.</p>
      ) : model.lexemes.length === 0 ? (
        <p className="prose-note text-sm">No {cls.def.name} tokens in your program.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            <div
              role="radiogroup"
              aria-label={`${cls.def.name} lexemes from your program`}
              className="flex flex-wrap items-center gap-x-1 gap-y-1"
            >
              {shown.map((lexeme) => {
                const selected = model.selected === lexeme;
                return (
                  <button
                    key={lexeme}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => model.select(lexeme)}
                    className={clsx(
                      // Quiet mono entries; the chosen one carries a marker
                      // glyph AND an accent underline rule, never colour alone.
                      'flex min-h-11 cursor-pointer items-center gap-1 rounded-sm px-2.5 font-mono text-xs transition-colors',
                      selected
                        ? 'bg-accent-soft font-semibold text-ink shadow-[inset_0_-2px_0_var(--accent)]'
                        : 'text-ink-muted hover:bg-raised hover:text-ink',
                    )}
                  >
                    <span aria-hidden className="text-[10px] text-ink-faint">
                      {selected ? '▸' : '·'}
                    </span>
                    {lexeme}
                  </button>
                );
              })}
            </div>
            {hidden > 0 && (
              <span className="px-1 font-mono text-2xs text-ink-faint">+{hidden} more</span>
            )}
            {model.selected !== null && (
              <button
                type="button"
                onClick={() => model.select(null)}
                className="flex min-h-11 cursor-pointer items-center px-2 text-sm text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
              >
                clear
              </button>
            )}
          </div>
          <Walk model={model} isAccepting={isAccepting} />
        </>
      )}
    </div>
  );
}
