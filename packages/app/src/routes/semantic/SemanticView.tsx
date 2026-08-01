/**
 * Semantic-analysis phase view — one recorded `sem.analyze` trace driving
 * everything on screen.
 *
 * Left (the artifact): the chained symbol tables as a nested, ruled OUTLINE and
 * the type-annotated AST, plus the symbol-table and diagnostics tabs. Right:
 * the shared TracePanel (StepControls + ExplainCard + CitationBadge).
 *
 * The trace is built in the worker and replayed here with `semReducer`; the
 * route never re-derives semantic state — every pane reads `stepper.state`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { traceFromSerialized, type SourceSpan } from '@lab/trace';
import { semReducer, type SemEvent, type SemState } from '@lab/core/sem/sem-events.js';
import type { SymbolEntry } from '@lab/core/sem/types.js';
import type { Compilation, Diagnostic } from '@lab/core';
import { TracePanel } from '../../components/TracePanel';
import { PhaseNav } from '../../components/PhaseNav';
import type { JumpTarget as StepJumpTarget } from '../../components/StepControls';
import { CodeStrip } from '../../components/viz/CodeStrip';
import { FullscreenTransport } from '../../components/Fullscreen';
import { CompileCta } from '../../components/CompileCta';
import { useStepper, type Stepper } from '../../lib/useStepper';
import { usePhaseUrlState } from '../../lib/urlState';
import { useCompilationStore } from '../../store/compilation';
import { getCompilerClient } from '../../worker/api';
import { AstPane } from './AstPane';
import { DiagnosticsPane } from './DiagnosticsPane';
import { ScopesPane } from './ScopesPane';
import { SymbolTablePane } from './SymbolTablePane';
import { Panel, Skeleton, StateCard } from './parts';
import {
  JUMP_PREDICATES,
  activeLookup,
  countMatching,
  diagnosticNodeIds,
  diagnosticStepIndex,
  nodesBySpan,
  stepNodeId,
  stepSpans,
  stepSymbolId,
  type JumpTarget,
  type SemStep,
  type SemTrace,
} from './derive';

type LoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; trace: SemTrace }
  | { status: 'unavailable'; diagnostics: Diagnostic[] };

type ViewTab = 'workbench' | 'symbols' | 'errors';

function tabFromParam(pass: string | null): ViewTab {
  return pass === 'symbols' || pass === 'errors' ? pass : 'workbench';
}

/**
 * The route's one nav row: the two algorithms of this phase, then the two
 * artifacts it produces. `?algo=` picks which pane leads the workbench,
 * `?pass=` picks the artifact — one row, four choices, no second tab band.
 */
type SemNavId = 'scopes' | 'typecheck' | 'symbols' | 'errors';

export function SemanticNav() {
  const compilation = useCompilationStore((s) => s.compilation);
  const { algo, pass, setPhaseParamsNow } = usePhaseUrlState();
  const tab = tabFromParam(pass);
  const symbols = compilation?.semantic?.symbols.length ?? 0;
  const semDiagnostics = compilation?.diagnostics.filter((d) => d.phase === 'semantic') ?? [];
  const diagnostics = semDiagnostics.length;
  const hasErrors = semDiagnostics.some((d) => d.severity === 'error');

  const value: SemNavId =
    tab === 'workbench' ? (algo === 'typecheck' ? 'typecheck' : 'scopes') : tab;

  const count = (n: number, tone?: 'error') =>
    n > 0 ? (
      <span className={clsx('font-mono text-2xs tabular-nums', tone === 'error' ? 'text-err' : 'text-ink-faint')}>
        {n}
      </span>
    ) : undefined;

  return (
    <PhaseNav<SemNavId>
      label="Semantic analysis views"
      value={value}
      onSelect={(id) => {
        if (id === 'scopes' || id === 'typecheck') setPhaseParamsNow({ algo: id, pass: null });
        else setPhaseParamsNow({ pass: id });
      }}
      items={[
        { id: 'scopes', label: 'Scope construction', hint: 'scopes lead the workbench' },
        { id: 'typecheck', label: 'Type checking', hint: 'the annotated AST leads' },
        { id: 'symbols', label: 'Symbol table', badge: count(symbols) },
        {
          id: 'errors',
          label: 'Errors',
          badge: count(diagnostics, hasErrors ? 'error' : undefined),
        },
      ]}
    />
  );
}

export function SemanticView() {
  const compilation = useCompilationStore((s) => s.compilation);
  const source = useCompilationStore((s) => s.source);
  const stale = useCompilationStore((s) => s.stale);
  const compiling = useCompilationStore((s) => s.compiling);

  const traceSource = compilation?.source ?? null;
  const [load, setLoad] = useState<LoadState>({ status: 'idle' });

  // ?step= is a deep link into *this* visit: honour it the first time a trace
  // mounts, then let later recompiles start from the initial state.
  const deepLinkUsed = useRef(false);
  const markDeepLinkUsed = useCallback(() => {
    deepLinkUsed.current = true;
  }, []);

  useEffect(() => {
    if (traceSource === null) {
      setLoad({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setLoad({ status: 'loading' });
    getCompilerClient()
      .getTraceOrError({ kind: 'sem.analyze', params: { source: traceSource } })
      .then((res) => {
        if (cancelled) return;
        if (res.trace === null) {
          setLoad({ status: 'unavailable', diagnostics: res.diagnostics });
          return;
        }
        setLoad({
          status: 'ready',
          trace: traceFromSerialized<SemState, SemEvent>(res.trace as never, semReducer),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad({
          status: 'unavailable',
          diagnostics: [
            {
              phase: 'semantic',
              severity: 'error',
              message: `the compile worker could not build the semantic trace: ${
                err instanceof Error ? err.message : String(err)
              }`,
              span: { start: 0, end: 0, line: 1, col: 1 },
            },
          ],
        });
      });
    return () => {
      cancelled = true;
    };
  }, [traceSource]);

  if (compilation === null) {
    return (
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <StateCard title="Compile a program to begin">
          <CompileCta className="flex flex-col items-start gap-2" />
        </StateCard>
        <aside className="section mt-0">
          <header className="section-head">
            <h2 className="section-title">Source</h2>
          </header>
          <CodeStrip source={source} maxHeight="24rem" />
        </aside>
      </div>
    );
  }

  if (load.status === 'loading' || load.status === 'idle' || compiling) {
    return <LoadingSkeleton />;
  }

  if (load.status === 'unavailable') {
    return (
      <BlockedState
        compilation={compilation}
        diagnostics={load.diagnostics}
        stale={stale}
      />
    );
  }

  return (
    <Workbench
      trace={load.trace}
      compilation={compilation}
      stale={stale}
      deepLink={!deepLinkUsed.current}
      onDeepLinkUsed={markDeepLinkUsed}
    />
  );
}

// ── Loading / blocked states ─────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Building the semantic-analysis trace"
      className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]"
    >
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-72" />
        <div className="grid gap-6 xl:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-40" />
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-28" />
        <Skeleton className="h-24" />
      </div>
      <span className="sr-only">Computing the semantic trace in the compile worker…</span>
    </div>
  );
}

function BlockedState({
  compilation,
  diagnostics,
  stale,
}: {
  compilation: Compilation;
  diagnostics: readonly Diagnostic[];
  stale: boolean;
}) {
  // Prefer the compilation's own upstream diagnostics — they are what actually
  // stopped this phase from running.
  const upstream = compilation.diagnostics.filter(
    (d) => (d.phase === 'lex' || d.phase === 'syntax') && d.severity === 'error',
  );
  const shown = upstream.length > 0 ? upstream : diagnostics;
  const spans = shown.map((d) => d.span);

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex flex-col gap-8">
        {stale && <StaleBanner />}
        <StateCard tone="error" title="Semantic analysis could not run">
          This pass needs a complete AST. Fix the diagnostics below and compile again.
        </StateCard>
        <section aria-label="Blocking diagnostics" className="section mt-0">
          <header className="section-head">
            <h2 className="section-title">What stopped it</h2>
            <span className="section-meta">
              {shown.length} diagnostic{shown.length === 1 ? '' : 's'}
            </span>
          </header>
          <ul className="flex flex-col gap-4">
            {shown.map((d, i) => (
              <li
                key={`${d.phase}-${d.span.start}-${i}`}
                className="border-l-2 border-err pl-3"
              >
                <p className="flex flex-wrap items-center gap-x-2 font-mono text-2xs text-err">
                  <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                  {d.phase} · {d.severity}
                  <span className="text-ink-faint">
                    line {d.span.line}:{d.span.col}
                  </span>
                </p>
                <p className="mt-0.5 text-ink">{d.message}</p>
                {d.rule && (
                  <p className="mt-1 font-mono text-2xs text-ink-muted">rule · {d.rule}</p>
                )}
                {d.hint && <p className="mt-1 text-sm text-ink-muted">hint · {d.hint}</p>}
              </li>
            ))}
          </ul>
        </section>
      </div>
      <aside className="section mt-0">
        <header className="section-head">
          <h2 className="section-title">Where it stopped</h2>
        </header>
        <CodeStrip source={compilation.source} spans={spans} maxHeight="28rem" />
      </aside>
    </div>
  );
}

/** Quiet prose with a dashed status edge — the shape says "stale", not a box. */
function StaleBanner() {
  return (
    <p
      role="status"
      className="flex items-baseline gap-2 border-l-2 border-dashed border-warn pl-3 text-sm text-warn"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0 translate-y-0.5" />
      <span>Source edited since this compilation. Compile to refresh.</span>
    </p>
  );
}

// ── The workbench ────────────────────────────────────────────────────────────

interface Selection {
  symbolId: number | null;
  diagnosticIndex: number | null;
  span: SourceSpan | null;
}

const NO_SELECTION: Selection = { symbolId: null, diagnosticIndex: null, span: null };

function Workbench({
  trace,
  compilation,
  stale,
  deepLink,
  onDeepLinkUsed,
}: {
  trace: SemTrace;
  compilation: Compilation;
  stale: boolean;
  deepLink: boolean;
  onDeepLinkUsed: () => void;
}) {
  const { algo, step: urlStep, pass, setPhaseParams } = usePhaseUrlState();
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [subtreeId, setSubtreeId] = useState('program');

  // ?step= is honoured once, when the stepper mounts with this trace.
  const initialStepRef = useRef<number | null>(deepLink ? urlStep : null);
  useEffect(() => {
    onDeepLinkUsed();
  }, [onDeepLinkUsed]);
  const stepperOptions = useMemo(
    () => ({
      ...(initialStepRef.current !== null ? { initialIndex: initialStepRef.current } : {}),
      onIndexChange: (i: number) => setPhaseParams({ step: i }),
    }),
    [setPhaseParams],
  );

  const stepper = useStepper<SemState, SemEvent>(trace, stepperOptions);

  const tab = tabFromParam(pass);

  // The per-algorithm "jump to…" menu, now a StepControls affordance rather
  // than a chip row this route drew itself. Counts come from the trace, so the
  // menu can grey out targets this program never reaches.
  const jumpTargets = useMemo<ReadonlyArray<StepJumpTarget<SemEvent>>>(
    () =>
      JUMP_CHIPS.map((chip) => ({
        label: chip.label,
        hint: chip.hint,
        predicate: JUMP_PREDICATES[chip.target],
        count: countMatching(trace, JUMP_PREDICATES[chip.target]),
      })),
    [trace],
  );

  const final = useMemo(() => trace.final(), [trace]);
  const spanIndex = useMemo(
    () => (compilation.ast ? nodesBySpan(compilation.ast) : null),
    [compilation.ast],
  );

  const totals = useMemo(
    () => ({
      symbols: final.symbols.length,
      diagnostics: final.diagnostics.length,
      errors: final.diagnostics.filter((d) => d.severity === 'error').length,
    }),
    [final],
  );

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0">
        <VizArea
          stepper={stepper}
          compilation={compilation}
          stale={stale}
          tab={tab}
          algo={algo}
          selection={selection}
          setSelection={setSelection}
          subtreeId={subtreeId}
          setSubtreeId={setSubtreeId}
          spanIndex={spanIndex}
          totals={totals}
        />
      </div>
      <TracePanel<SemState, SemEvent>
        stepper={stepper}
        jumpTargets={jumpTargets}
        className="min-w-0"
      />
    </div>
  );
}

interface VizAreaProps {
  stepper: Stepper<SemState, SemEvent>;
  compilation: Compilation;
  stale: boolean;
  tab: ViewTab;
  algo: string | null;
  selection: Selection;
  setSelection: (s: Selection) => void;
  subtreeId: string;
  setSubtreeId: (id: string) => void;
  spanIndex: Map<string, number> | null;
  totals: { symbols: number; diagnostics: number; errors: number };
}

function VizArea({
  stepper,
  compilation,
  stale,
  tab,
  algo,
  selection,
  setSelection,
  subtreeId,
  setSubtreeId,
  spanIndex,
  totals,
}: VizAreaProps) {
  const { state, currentStep, index, trace } = stepper;
  const lookup = useMemo(() => activeLookup(trace, index), [trace, index]);
  const currentNodeId = stepNodeId(currentStep);
  const activeSymbolId = stepSymbolId(currentStep);
  const errorNodeIds = useMemo(
    () => diagnosticNodeIds(state.diagnostics, spanIndex),
    [state.diagnostics, spanIndex],
  );

  /** Seek to a recorded step, revealing it if the macro filter hides it. */
  const seek = useCallback(
    (stepIndex: number) => {
      if (stepIndex < 0) return;
      const s: SemStep | undefined = trace.steps[stepIndex];
      if (s && s.meta.level === 'micro' && stepper.level === 'macro') {
        const gid = s.meta.groupId;
        if (gid !== undefined) {
          if (!stepper.expandedGroups.has(gid)) stepper.toggleGroup(gid);
        } else {
          stepper.setLevel('micro');
        }
      }
      stepper.jumpTo(stepIndex + 1);
    },
    [stepper, trace],
  );

  const focusNode = useCallback(
    (nodeId: number, prefer: SemEvent['kind'] = 'typed') => {
      const match = (kind: SemEvent['kind']) =>
        trace.findIndex(
          (s) =>
            s.event.kind === kind &&
            'nodeId' in s.event &&
            (s.event as { nodeId: number }).nodeId === nodeId,
          0,
        );
      const found = match(prefer) >= 0 ? match(prefer) : match('typed');
      if (found >= 0) {
        seek(found);
        const span = trace.steps[found]?.meta.srcSpans?.[0] ?? null;
        setSelection({ symbolId: null, diagnosticIndex: null, span });
      }
    },
    [trace, seek, setSelection],
  );

  const focusDiagnostic = useCallback(
    (d: Diagnostic) => {
      const found = diagnosticStepIndex(trace, d);
      if (found >= 0) seek(found);
      setSelection({
        symbolId: null,
        diagnosticIndex: state.diagnostics.indexOf(d),
        span: d.span,
      });
    },
    [trace, seek, setSelection, state.diagnostics],
  );

  const focusSymbol = useCallback(
    (sym: SymbolEntry) => {
      const found = trace.findIndex(
        (s) => s.event.kind === 'declare' && s.event.symbol.id === sym.id,
        0,
      );
      if (found >= 0) seek(found);
      setSelection({ symbolId: sym.id, diagnosticIndex: null, span: sym.declSpan });
    },
    [trace, seek, setSelection],
  );

  const spans = useMemo(() => {
    const out = stepSpans(currentStep);
    if (selection.span) out.push(selection.span);
    return out;
  }, [currentStep, selection.span]);

  const astFirst = algo === 'typecheck';

  const scopesPane = (
    <Panel
      key="scopes"
      title="Scopes & symbol tables"
      className={astFirst ? 'xl:order-2' : 'xl:order-1'}
      primary={!astFirst}
      // The frame is earned by the scrolling outline, not drawn around the
      // empty state — before the first scope opens this is just prose.
      framed={state.scopes.length > 0}
      bodyClassName="max-h-144"
      meta="§2.7 · Fig. 2.36"
    >
      <ScopesPane
        state={state}
        lookup={lookup}
        activeSymbolId={activeSymbolId}
        selectedSymbolId={selection.symbolId}
        onSelectSymbol={focusSymbol}
      />
    </Panel>
  );

  const astPane = (
    <Panel
      key="ast"
      title="Annotated AST"
      className={astFirst ? 'xl:order-1' : 'xl:order-2'}
      primary={astFirst}
      meta="§6.3"
    >
      {compilation.ast ? (
        <AstPane
          ast={compilation.ast}
          state={state}
          currentNodeId={currentNodeId}
          errorNodeIds={errorNodeIds}
          diagnostics={state.diagnostics}
          subtreeId={subtreeId}
          onSubtreeChange={setSubtreeId}
          onFocusNode={focusNode}
          onFocusDiagnostic={focusDiagnostic}
          controls={<FullscreenTransport stepper={stepper} />}
        />
      ) : (
        <p className="prose-note">The AST artifact is not available.</p>
      )}
    </Panel>
  );

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {stale && <StaleBanner />}

      <div className="flex min-w-0 flex-col gap-8">
        {tab === 'workbench' && (
          <div
            role="tabpanel"
            aria-label="Scopes and annotated AST"
            className="grid min-w-0 items-start gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
          >
            {astFirst ? [astPane, scopesPane] : [scopesPane, astPane]}
          </div>
        )}

        {tab === 'symbols' && (
          <div role="tabpanel" aria-label="Symbol table">
            <Panel title="Symbol table" meta="§2.7">
              <SymbolTablePane
                state={state}
                activeSymbolId={activeSymbolId}
                selectedSymbolId={selection.symbolId}
                totalSymbols={totals.symbols}
                controls={<FullscreenTransport stepper={stepper} />}
              />
            </Panel>
          </div>
        )}

        {tab === 'errors' && (
          <div role="tabpanel" aria-label="Diagnostics">
            <Panel title="Diagnostics">
              <DiagnosticsPane
                diagnostics={state.diagnostics}
                total={totals.diagnostics}
                onFocus={focusDiagnostic}
                selectedIndex={selection.diagnosticIndex}
              />
            </Panel>
          </div>
        )}

        <Panel title="Source">
          <CodeStrip source={compilation.source} spans={spans} maxHeight="15rem" />
        </Panel>
      </div>
    </div>
  );
}

// ── Chips ────────────────────────────────────────────────────────────────────

const JUMP_CHIPS: ReadonlyArray<{ target: JumpTarget; label: string; hint: string }> = [
  { target: 'scope', label: 'scope', hint: 'next scope opened' },
  { target: 'declare', label: 'declaration', hint: 'next symbol entered into a table' },
  { target: 'lookup', label: 'lookup', hint: 'next scope-chain walk (a micro step)' },
  { target: 'miss', label: 'miss', hint: 'next unresolved name' },
  { target: 'convert', label: 'conversion', hint: 'next inserted int→float widening' },
  { target: 'error', label: 'error', hint: 'next reported rule violation' },
];

