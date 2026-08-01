/**
 * Grammar transforms — §4.3.3 Algorithm 4.19 (eliminate left recursion) and
 * §4.3.4 Algorithm 4.21 (left factoring).
 *
 * Before/after production lists in the shared DiffView; the productions the
 * current step rewrites are marked, and the primed nonterminals the transform
 * introduces are called out, because "where did E′ come from" is the question
 * students actually have.
 */
import { useMemo } from 'react';
import type { Trace } from '@lab/trace';
import {
  transformReducer,
  type GProd,
  type TransformEvent,
  type TransformState,
} from '@lab/core/grammar/transforms.js';
import { useStepper } from '../../../lib/useStepper';
import { DiffView, type DiffRow } from '../../../components/DiffView';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { TRANSFORM_STAGES, type TransformStage } from '../lib/algorithms';
import { symbols } from '../lib/grammars';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { Diagnostics, Legend, Note, Panel, Segmented, Skeleton, StepPanel, Stat } from '../components/ui';

const ruleText = (p: GProd): string => `${p.lhs} → ${symbols(p.rhs)}`;

export function TransformsView({
  ctx,
  stage,
  onStage,
}: {
  ctx: ViewContext;
  stage: TransformStage;
  onStage: (s: TransformStage) => void;
}) {
  const { trace, phase, diagnostics } = useTrace<TransformState, TransformEvent>(
    'syntax.transforms',
    { grammarId: ctx.grammarId, stage },
    transformReducer,
  );
  if (trace) return <Ready ctx={ctx} trace={trace} stage={stage} onStage={onStage} />;
  if (phase === 'unavailable') {
    return <Diagnostics title="This transform could not be run" diagnostics={diagnostics} />;
  }
  return <Skeleton label="Rewriting the grammar…" />;
}

function Ready({
  ctx,
  trace,
  stage,
  onStage,
}: {
  ctx: ViewContext;
  trace: Trace<TransformState, TransformEvent>;
  stage: TransformStage;
  onStage: (s: TransformStage) => void;
}) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const before = trace.initial;
  const after = stepper.state;

  const ev = stepper.currentStep?.event ?? null;
  const prose = stepper.currentStep?.meta.prose ?? '';

  const touched = useMemo(() => {
    const s = new Set<string>();
    if (!ev) return s;
    if (ev.kind === 'lr.subst') {
      for (const p of ev.results) s.add(ruleText(p));
      s.add(ruleText(ev.replaced));
    } else if (ev.kind === 'lr.immediate') {
      for (const p of [...ev.aProds, ...ev.primeProds]) s.add(ruleText(p));
      for (const p of [...ev.recursive, ...ev.nonrecursive]) s.add(ruleText(p));
    } else if (ev.kind === 'lf.factor') {
      for (const p of [...ev.aProds, ...ev.primeProds, ...ev.group]) s.add(ruleText(p));
    }
    return s;
  }, [ev]);

  const rows = useMemo<DiffRow[]>(() => {
    const b = before.productions.map(ruleText);
    const a = after.productions.map(ruleText);
    return diffLines(b, a).map((row) => {
      const key = row.after ?? row.before ?? '';
      return touched.has(key) && prose ? { ...row, justification: prose } : row;
    });
  }, [before, after, touched, prose]);

  const primes = useMemo(
    () => after.nonterminals.filter((n) => !before.nonterminals.includes(n)),
    [before, after],
  );

  const currentPrime =
    ev && (ev.kind === 'lr.immediate' || ev.kind === 'lf.factor') ? ev.prime : null;

  return (
    <ViewGrid
      rail={
        <GrammarRail
          grammar={ctx.grammar}
          augmented={false}
          highlighted={productionRefs(stepper.currentStep)}
          leftRecursive={ctx.leftRecursive}
        />
      }
      main={
        <>
          <Panel
            title="Transform"
            subtitle={
              stage === 'eliminate-left-recursion'
                ? '§4.3.3 · Algorithm 4.19 — runs on the raw grammar'
                : '§4.3.4 · Algorithm 4.21 — runs on the left-recursion-eliminated grammar'
            }
            bodyClassName="flex flex-col gap-2"
          >
            <Segmented
              label="Transform stage"
              value={stage}
              options={TRANSFORM_STAGES}
              onChange={onStage}
            />
            <p className="text-xs leading-relaxed text-ink-muted">
              {stage === 'eliminate-left-recursion'
                ? 'For A₁ … Aₙ in declaration order: substitute earlier nonterminals out of the leading position, then replace A → A α | β by A → β A′ and A′ → α A′ | ε. Left recursion becomes right recursion, which a top-down parser can handle.'
                : 'While two alternatives of A share a prefix α, replace them by A → α A′ and let A′ carry the differing suffixes. The parser can then defer the choice until it has seen α.'}
            </p>
          </Panel>

          <Panel
            title="Productions"
            subtitle={`${before.productions.length} → ${after.productions.length}`}
            bodyClassName="flex flex-col gap-2 p-2"
          >
            <DiffView
              rows={rows}
              beforeLabel={
                stage === 'left-factor' ? 'After left-recursion elimination' : 'Original grammar'
              }
              afterLabel="After the steps so far"
            />
            <Legend
              items={[
                { label: '+ introduced by the transform', swatch: <span aria-hidden className="font-mono text-ok">+</span> },
                { label: '− rewritten away', swatch: <span aria-hidden className="font-mono text-err">−</span> },
                { label: '· untouched', swatch: <span aria-hidden className="font-mono text-ink-faint">·</span> },
              ]}
            />
          </Panel>
        </>
      }
      panel={
        <StepPanel
          stepper={stepper}
          jumps={[
            {
              label: stage === 'left-factor' ? 'next factoring' : 'next elimination',
              pred: (s) => s.event.kind === 'lf.factor' || s.event.kind === 'lr.immediate',
            },
            {
              label: 'next substitution',
              pred: (s) => s.event.kind === 'lr.subst',
            },
          ]}
        >
          <Panel title="Introduced symbols" bodyClassName="flex flex-col gap-2">
            <div className="flex flex-wrap gap-1.5">
              <Stat label="new nonterminals" value={primes.length} />
              <Stat label="productions" value={after.productions.length} />
            </div>
            {primes.length === 0 ? (
              <p className="text-xs leading-relaxed text-ink-muted">
                No primed symbol has been introduced yet.
                {stage === 'eliminate-left-recursion'
                  ? ' One appears the first time an immediately left-recursive nonterminal is rewritten.'
                  : ' One appears the first time two alternatives are found to share a prefix.'}
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {primes.map((p) => (
                  <li
                    key={p}
                    className={
                      p === currentPrime
                        ? 'inline-flex h-6 items-center rounded border border-accent bg-accent-soft px-2 font-mono text-[11px] font-semibold text-ink'
                        : 'inline-flex h-6 items-center rounded border border-line bg-canvas px-2 font-mono text-[11px] text-ink-muted'
                    }
                  >
                    {p === currentPrime && (
                      <span aria-hidden className="mr-1 text-accent">
                        ＋
                      </span>
                    )}
                    {p}
                  </li>
                ))}
              </ul>
            )}
            {ev && ev.kind === 'lf.factor' && (
              <Note tone="info" title={`Common prefix: ${symbols(ev.prefix)}`}>
                {ev.group.length} alternatives of {ev.nonterminal} start with it, so the choice is
                deferred into {ev.prime}.
              </Note>
            )}
            {ev && ev.kind === 'lr.immediate' && (
              <Note tone="info" title={`${ev.nonterminal} was immediately left recursive`}>
                {ev.recursive.length} recursive and {ev.nonrecursive.length} non-recursive
                alternative(s); {ev.prime} now carries the repetition.
              </Note>
            )}
          </Panel>
        </StepPanel>
      }
    />
  );
}

/** Classic LCS line diff — the production lists are at most a few hundred long. */
function diffLines(before: readonly string[], after: readonly string[]): DiffRow[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = before[i] === after[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      rows.push({ kind: 'unchanged', before: before[i]!, after: after[j]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ kind: 'removed', before: before[i]!, after: null });
      i++;
    } else {
      rows.push({ kind: 'added', before: null, after: after[j]! });
      j++;
    }
  }
  while (i < n) rows.push({ kind: 'removed', before: before[i++]!, after: null });
  while (j < m) rows.push({ kind: 'added', before: null, after: after[j++]! });
  return rows;
}
