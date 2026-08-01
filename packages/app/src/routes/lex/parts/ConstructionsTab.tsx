/**
 * Tab (a) — the three chained constructions that turn one token-class regex
 * into the machine the scanner runs:
 *
 *     regex  ──Algorithm 3.23──▶  NFA  ──Algorithm 3.20──▶  DFA  ──Algorithm 3.39──▶  min-DFA
 *
 * The token class is chosen once and carried through all three stages, so the
 * D-states in stage 2 are the ε-closures of stage 1's NFA and the groups in
 * stage 3 partition stage 2's D-states.
 */
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';
import { LEX_TOKEN_CLASSES, type LexTokenClass } from '../tokenClasses';
import { LEX_STAGES, type LexStage, type TokenClassId } from '../lexUrl';
import { ThompsonView } from './ThompsonView';
import { SubsetView } from './SubsetView';
import { MinimizeView } from './MinimizeView';

const STAGE_META: Record<LexStage, { label: string; produces: string; cite: string }> = {
  thompson: { label: 'Thompson', produces: 'regex → NFA', cite: 'Algorithm 3.23' },
  subset: { label: 'Subset construction', produces: 'NFA → DFA', cite: 'Algorithm 3.20' },
  minimize: { label: 'Minimization', produces: 'DFA → min-DFA', cite: 'Algorithm 3.39' },
};

function TokenClassPicker({
  value,
  onChange,
}: {
  value: LexTokenClass;
  onChange: (id: TokenClassId) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Token class" className="flex flex-wrap gap-2">
      {LEX_TOKEN_CLASSES.map((c) => {
        const selected = c.index === value.index;
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(c.id)}
            className={clsx(
              'flex min-h-11 flex-col items-start gap-0.5 rounded-md border px-3 py-1.5 text-left transition-colors',
              selected
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              {c.def.name}
              {c.heavy && (
                <span className="rounded-full border border-warn/50 bg-warn-soft px-1.5 text-[10px] font-medium text-warn">
                  large
                </span>
              )}
            </span>
            <span className="font-mono text-xs opacity-80">{c.def.display}</span>
            <span className="font-mono text-[10px] text-ink-faint">
              {c.alphabet.length} symbols · {c.nfaStates} NFA states
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StageChain({
  value,
  onChange,
}: {
  value: LexStage;
  onChange: (stage: LexStage) => void;
}) {
  return (
    <ol
      aria-label="Construction stages"
      className="flex flex-wrap items-center gap-1"
    >
      {LEX_STAGES.map((stage, i) => {
        const selected = stage === value;
        const meta = STAGE_META[stage];
        return (
          <li key={stage} className="flex items-center gap-1">
            {i > 0 && <ChevronRight aria-hidden className="size-4 text-ink-faint" />}
            <button
              type="button"
              aria-current={selected ? 'step' : undefined}
              onClick={() => onChange(stage)}
              className={clsx(
                'flex min-h-11 flex-col items-start rounded-md border px-3 py-1 transition-colors',
                selected
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
              )}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span
                  aria-hidden
                  className={clsx(
                    'flex size-4 items-center justify-center rounded-full border font-mono text-[10px]',
                    selected ? 'border-accent bg-accent text-on-accent' : 'border-line-strong',
                  )}
                >
                  {i + 1}
                </span>
                {meta.label}
              </span>
              <span className="font-mono text-[10px] text-ink-faint">
                {meta.produces} · {meta.cite}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

export function ConstructionsTab({
  cls,
  stage,
  initialStep,
  onSelectClass,
  onSelectStage,
}: {
  cls: LexTokenClass;
  stage: LexStage;
  initialStep: number | null;
  onSelectClass: (id: TokenClassId) => void;
  onSelectStage: (stage: LexStage) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold tracking-tight text-ink">Token class</h2>
          <TokenClassPicker value={cls} onChange={onSelectClass} />
        </div>
        <div className="flex flex-col gap-1.5">
          <h2 className="text-sm font-semibold tracking-tight text-ink">Stage</h2>
          <StageChain value={stage} onChange={onSelectStage} />
        </div>
      </div>

      {stage === 'thompson' && <ThompsonView cls={cls} initialStep={initialStep} />}
      {stage === 'subset' && (
        <SubsetView cls={cls} initialStep={initialStep} onSelectClass={onSelectClass} />
      )}
      {stage === 'minimize' && <MinimizeView cls={cls} initialStep={initialStep} />}
    </div>
  );
}
