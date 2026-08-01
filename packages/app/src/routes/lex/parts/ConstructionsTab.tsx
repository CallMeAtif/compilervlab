/**
 * Tab (a) — the three chained constructions that turn one token-class regex
 * into the machine the scanner runs:
 *
 *     regex  ──Algorithm 3.23──▶  NFA  ──Algorithm 3.20──▶  DFA  ──Algorithm 3.39──▶  min-DFA
 *
 * The stage is chosen by the phase header's algorithm tablist (?algo=), which
 * is the ONLY selector for it — this tab used to draw a second, numbered chain
 * saying the same thing one band lower.
 *
 * The token class is chosen once and carried through all three stages, so the
 * D-states in stage 2 are the ε-closures of stage 1's NFA and the groups in
 * stage 3 partition stage 2's D-states.
 */
import { clsx } from 'clsx';
import { LEX_TOKEN_CLASSES, type LexTokenClass } from '../tokenClasses';
import type { LexStage, TokenClassId } from '../lexUrl';
import { ThompsonView } from './ThompsonView';
import { SubsetView } from './SubsetView';
import { MinimizeView } from './MinimizeView';

/**
 * Rendered by `index.tsx` ON the tab row, not above the artifact: the class is
 * a filter over the same four tabs, so it costs no band of its own.
 */
export function TokenClassPicker({
  value,
  onChange,
}: {
  value: LexTokenClass;
  onChange: (id: TokenClassId) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Token class"
      className="flex flex-wrap items-center gap-x-1 gap-y-1"
    >
      {LEX_TOKEN_CLASSES.map((c) => {
        const selected = c.index === value.index;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(c.id)}
            title={`${c.def.display} · ${c.alphabet.length} symbols · ${c.nfaStates} NFA states`}
            className={clsx(
              // Quiet text entries; the current one carries a soft fill and an
              // accent underline rule, never colour alone.
              'flex min-h-11 items-center gap-2 rounded-sm px-2.5 py-1 text-left transition-colors',
              selected
                ? 'bg-accent-soft text-ink shadow-[inset_0_-2px_0_var(--accent)]'
                : 'text-ink-muted hover:bg-raised hover:text-ink',
            )}
          >
            <span className={clsx('text-sm', selected && 'font-semibold')}>{c.def.name}</span>
            <span className="font-mono text-3xs text-ink-faint">{c.def.display}</span>
            {c.heavy && (
              <span className="rounded-full border border-dashed border-warn px-1.5 font-mono text-3xs text-warn">
                large
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Orientation, not a lecture — one line, because without it these three stages
 * look broken. They are built from the TOKEN PATTERN, which is a property of C
 * itself, so they are identical for every program you compile; readers
 * reasonably expect everything under "Lexical Analysis" to move with their
 * source, and only the Tokenize tab does.
 */
function ScopeNote({ cls, onGoToScan }: { cls: LexTokenClass; onGoToScan: () => void }) {
  return (
    <p className="mb-4 text-sm text-ink-muted">
      Built from the <span className="font-mono text-ink">{cls.def.name}</span> pattern{' '}
      <span className="font-mono text-ink-faint">{cls.def.display}</span> — the same for every
      program.{' '}
      <button
        type="button"
        onClick={onGoToScan}
        className="cursor-pointer border-b border-control text-ink transition-colors hover:border-accent hover:text-accent"
      >
        Tokenize
      </button>{' '}
      runs it on your source.
    </p>
  );
}

export function ConstructionsTab({
  cls,
  stage,
  initialStep,
  onSelectClass,
  onGoToScan,
}: {
  cls: LexTokenClass;
  stage: LexStage;
  initialStep: number | null;
  onSelectClass: (id: TokenClassId) => void;
  onGoToScan: () => void;
}) {
  return (
    <>
      <ScopeNote cls={cls} onGoToScan={onGoToScan} />
      {stage === 'thompson' && <ThompsonView cls={cls} initialStep={initialStep} />}
      {stage === 'subset' && (
        <SubsetView cls={cls} initialStep={initialStep} onSelectClass={onSelectClass} />
      )}
      {stage === 'minimize' && <MinimizeView cls={cls} initialStep={initialStep} />}
    </>
  );
}
