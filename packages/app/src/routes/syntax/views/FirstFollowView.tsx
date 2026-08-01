/**
 * FIRST / FOLLOW — §4.4.2 (Example 4.30).
 *
 * The sets grow one addition at a time; the table shows one column per fixpoint
 * pass so the shape of the computation is visible ("pass 3 added nothing, so we
 * stop"). Each cell holds exactly the symbols that pass contributed, and the
 * justifying §4.4.2 rule for the newest addition is in the ExplainCard.
 *
 * The tables used to carry a standing caption each and the panel a 40-word
 * paragraph about fixpoints. Deleted: the column headers say "Pass 3", the pass
 * count says "4 passes", and the per-step prose says what this step did.
 */
import { useMemo } from 'react';
import { clsx } from 'clsx';
import type { Trace } from '@lab/trace';
import {
  firstFollowReducer,
  type FirstFollowEvent,
  type FirstFollowState,
} from '@lab/core/grammar/first-follow.js';
import { useStepper } from '../../../lib/useStepper';
import { useTrace } from '../lib/useTrace';
import type { ViewContext } from '../lib/view';
import { GrammarRail, productionRefs } from '../components/GrammarRail';
import { ViewGrid } from '../components/Layout';
import { Diagnostics, Panel, Skeleton, StepPanel, Stat } from '../components/ui';

type Phase = 'first' | 'follow';

interface Addition {
  phase: Phase;
  target: string;
  symbol: string;
  pass: number;
  stepIndex: number;
}

function additionsOf(trace: Trace<FirstFollowState, FirstFollowEvent>): {
  additions: Addition[];
  passes: Record<Phase, number[]>;
} {
  const additions: Addition[] = [];
  const passes: Record<Phase, number[]> = { first: [], follow: [] };
  let phase: Phase = 'first';
  let pass = 1;
  for (const step of trace.steps) {
    const ev = step.event;
    if (ev.kind === 'ff.pass') {
      phase = ev.phase;
      pass = ev.pass;
      if (!passes[phase].includes(pass)) passes[phase].push(pass);
      continue;
    }
    if (ev.kind === 'ff.first.add') {
      additions.push({ phase: 'first', target: ev.target, symbol: ev.symbol, pass, stepIndex: step.index });
    } else if (ev.kind === 'ff.follow.add') {
      // FOLLOW rule 1 ($ into FOLLOW(start)) fires before the first pass.
      const p = ev.production === null ? 0 : pass;
      if (!passes.follow.includes(p)) passes.follow.push(p);
      additions.push({ phase: 'follow', target: ev.target, symbol: ev.symbol, pass: p, stepIndex: step.index });
    }
  }
  passes.first.sort((a, b) => a - b);
  passes.follow.sort((a, b) => a - b);
  return { additions, passes };
}

export function FirstFollowView(ctx: ViewContext) {
  const { trace, phase, diagnostics } = useTrace<FirstFollowState, FirstFollowEvent>(
    'syntax.first-follow',
    { grammarId: ctx.grammarId },
    firstFollowReducer,
  );

  if (trace) return <Ready ctx={ctx} trace={trace} />;
  if (phase === 'unavailable') {
    return (
      <Diagnostics
        title="FIRST/FOLLOW could not be computed for this grammar"
        diagnostics={diagnostics}
      />
    );
  }
  return <Skeleton label="Computing the FIRST and FOLLOW fixpoints…" />;
}

function Ready({
  ctx,
  trace,
}: {
  ctx: ViewContext;
  trace: Trace<FirstFollowState, FirstFollowEvent>;
}) {
  const stepper = useStepper(trace, ctx.stepperOptions);
  const { additions, passes } = useMemo(() => additionsOf(trace), [trace]);

  const visible = useMemo(
    () => additions.filter((a) => a.stepIndex < stepper.index),
    [additions, stepper.index],
  );
  const newest = visible[visible.length - 1] ?? null;

  const cell = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of visible) {
      const key = `${a.phase}|${a.target}|${a.pass}`;
      const list = m.get(key);
      if (list) list.push(a.symbol);
      else m.set(key, [a.symbol]);
    }
    return m;
  }, [visible]);

  const state = stepper.state;

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
          <SetsTable
            title="FIRST"
            nonterminals={ctx.grammar.nonterminals}
            passes={passes.first}
            phase="first"
            cell={cell}
            current={state.first}
            newest={newest}
          />
          <SetsTable
            title="FOLLOW"
            nonterminals={ctx.grammar.nonterminals}
            passes={passes.follow}
            phase="follow"
            cell={cell}
            current={state.follow}
            newest={newest}
          />
        </>
      }
      panel={
        <StepPanel
          stepper={stepper}
          jumps={[
            { label: 'next pass', pred: (s) => s.event.kind === 'ff.pass' },
            { label: 'fixpoint', pred: (s) => s.event.kind === 'ff.fixpoint' },
          ]}
        >
          {/* Counters, not a panel: three numbers need no heading and no
              paragraph about what a fixpoint is. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 pb-1">
            <Stat label="additions" value={`${visible.length} / ${additions.length}`} />
            <Stat label="FIRST passes" value={passes.first.length} />
            <Stat label="FOLLOW passes" value={Math.max(0, passes.follow.length - 1)} />
          </div>
        </StepPanel>
      }
    />
  );
}

function SetsTable({
  title,
  nonterminals,
  passes,
  phase,
  cell,
  current,
  newest,
}: {
  title: string;
  nonterminals: readonly string[];
  passes: readonly number[];
  phase: Phase;
  cell: ReadonlyMap<string, string[]>;
  current: Record<string, string[]>;
  newest: Addition | null;
}) {
  return (
    <Panel
      title={`${title} sets`}
      subtitle={`${passes.length} pass${passes.length === 1 ? '' : 'es'}`}
      bodyClassName="flex flex-col gap-3"
    >
      <div className="framed artifact-scroll max-h-[26rem] min-w-0">
        <table className="w-full border-collapse font-mono text-xs">
          <thead className="sticky top-0 z-10 bg-raised text-ink-muted">
            <tr>
              <th scope="col" className="sticky left-0 z-20 bg-raised px-2 py-1.5 text-left font-semibold">
                A
              </th>
              {passes.map((p) => (
                <th key={p} scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                  {p === 0 ? 'rule 1' : `Pass ${p}`}
                </th>
              ))}
              <th scope="col" className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                {title}(A) now
              </th>
            </tr>
          </thead>
          <tbody>
            {nonterminals.map((nt) => {
              const now = current[nt] ?? [];
              return (
                <tr key={nt} className="border-t border-line/60 align-top">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-surface px-2 py-1 text-left font-semibold text-ink"
                  >
                    {nt}
                  </th>
                  {passes.map((p) => {
                    const added = cell.get(`${phase}|${nt}|${p}`) ?? [];
                    return (
                      <td key={p} className="px-2 py-1">
                        <span className="flex flex-wrap gap-1">
                          {added.map((sym) => {
                            const isNewest =
                              newest !== null &&
                              newest.phase === phase &&
                              newest.target === nt &&
                              newest.pass === p &&
                              newest.symbol === sym;
                            return (
                              <span
                                key={sym}
                                title={isNewest ? 'added by this step' : 'added earlier'}
                                className={clsx(
                                  'inline-flex h-5 items-center rounded border px-1',
                                  isNewest
                                    ? 'border-accent bg-accent-soft font-semibold text-ink'
                                    : 'border-line bg-canvas text-ink-muted',
                                )}
                              >
                                {isNewest && (
                                  <span aria-hidden className="mr-0.5 text-accent">
                                    ＋
                                  </span>
                                )}
                                {sym}
                              </span>
                            );
                          })}
                          {added.length === 0 && <span className="text-ink-faint">—</span>}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 text-ink">
                    {now.length === 0 ? <span className="text-ink-faint">∅</span> : `{ ${now.join(', ')} }`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
