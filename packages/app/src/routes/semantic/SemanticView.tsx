/**
 * Semantic-analysis phase view — one recorded `sem.analyze` trace driving
 * everything on screen.
 *
 * Left (the artifact): the chained symbol tables as nested scope boxes and the
 * type-annotated AST, plus the symbol-table and diagnostics tabs. Right: the
 * shared TracePanel (StepControls + ExplainCard + CitationBadge).
 *
 * The trace is built in the worker and replayed here with `semReducer`; the
 * route never re-derives semantic state — every pane reads `stepper.state`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import {
  Boxes,
  CircleAlert,
  FileCode2,
  ListTree,
  PlayCircle,
  Table2,
  TriangleAlert,
} from 'lucide-react';
import { traceFromSerialized, type SourceSpan } from '@lab/trace';
import { semReducer, type SemEvent, type SemState } from '@lab/core/sem/sem-events.js';
import type { SymbolEntry } from '@lab/core/sem/types.js';
import type { Compilation, Diagnostic } from '@lab/core';
import { TracePanel } from '../../components/TracePanel';
import type { JumpTarget as StepJumpTarget } from '../../components/StepControls';
import { CodeStrip } from '../../components/viz/CodeStrip';
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
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <StateCard icon={<PlayCircle className="size-8" strokeWidth={1.5} />} title="Compile a program to begin">
          Semantic analysis runs on the AST the parser produced, so there is nothing to trace
          yet. Compile, and this page replays the pass step by step: scopes opening and closing,
          symbols entering their table, names resolving through the scope chain, and types
          flowing up the tree.
          <CompileCta className="mt-4 flex flex-col items-center gap-2" />
        </StateCard>
        <aside className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-tight text-ink-muted">
            Source waiting to compile
          </h3>
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
      className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]"
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-72" />
        <div className="grid gap-3 xl:grid-cols-2">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
        <Skeleton className="h-40" />
      </div>
      <div className="flex flex-col gap-3">
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
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex flex-col gap-3">
        {stale && <StaleBanner />}
        <StateCard
          tone="error"
          icon={<CircleAlert className="size-8" strokeWidth={1.5} />}
          title="Semantic analysis could not run"
        >
          This pass needs a complete AST: it walks the tree the parser built. The compilation
          stopped earlier, so there is no tree to annotate — fix the diagnostics below and
          compile again.
        </StateCard>
        <ul className="flex flex-col gap-2">
          {shown.map((d, i) => (
            <li
              key={`${d.phase}-${d.span.start}-${i}`}
              className="flex flex-col gap-1 rounded-lg border border-err/50 bg-err-soft p-3"
            >
              <span className="flex flex-wrap items-center gap-2 text-xs font-semibold text-err">
                <CircleAlert aria-hidden className="size-4 shrink-0" />
                {d.phase} · {d.severity}
                <span className="font-mono font-normal">
                  line {d.span.line}:{d.span.col}
                </span>
              </span>
              <span className="text-sm text-ink">{d.message}</span>
              {d.rule && (
                <span className="font-mono text-[11px] text-ink-muted">rule · {d.rule}</span>
              )}
              {d.hint && <span className="text-[13px] text-ink-muted">hint · {d.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
      <aside className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold tracking-tight text-ink-muted">
          Where it stopped
        </h3>
        <CodeStrip source={compilation.source} spans={spans} maxHeight="28rem" />
      </aside>
    </div>
  );
}

function StaleBanner() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-dashed border-warn/60 bg-warn-soft px-3 py-2 text-sm text-warn"
    >
      <TriangleAlert aria-hidden className="size-4 shrink-0" />
      The editor source has changed since this compilation — this trace still replays the
      compiled program. Press Compile to refresh it.
    </div>
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
  const setTab = (next: ViewTab) =>
    setPhaseParams({ pass: next === 'workbench' ? null : next });

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
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="min-w-0">
        <VizArea
          stepper={stepper}
          compilation={compilation}
          stale={stale}
          tab={tab}
          setTab={setTab}
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
        title="Recorded pass · scopes, resolution, typing"
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
  setTab: (t: ViewTab) => void;
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
  setTab,
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
      icon={<Boxes aria-hidden className="size-4 text-accent" />}
      className={clsx(astFirst ? 'xl:order-2' : 'xl:order-1', !astFirst && 'border-accent/50')}
      bodyClassName="max-h-144 overflow-auto"
      actions={
        <span className="font-mono text-[11px] text-ink-faint">
          §2.7 · Fig. 2.36 chained tables
        </span>
      }
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
      icon={<ListTree aria-hidden className="size-4 text-accent" />}
      className={clsx(astFirst ? 'xl:order-1' : 'xl:order-2', astFirst && 'border-accent/50')}
      bodyClassName="max-h-192 overflow-auto"
      actions={
        <span className="font-mono text-[11px] text-ink-faint">§6.3 · synthesized types</span>
      }
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
        />
      ) : (
        <p className="p-6 text-sm text-ink-faint">The AST artifact is not available.</p>
      )}
    </Panel>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {stale && <StaleBanner />}

      <div role="tablist" aria-label="Semantic analysis views" className="flex flex-wrap gap-1.5">
        <TabButton
          id="workbench"
          current={tab}
          onSelect={setTab}
          icon={<Boxes aria-hidden className="size-3.5" />}
          label="Scopes & AST"
        />
        <TabButton
          id="symbols"
          current={tab}
          onSelect={setTab}
          icon={<Table2 aria-hidden className="size-3.5" />}
          label="Symbol table"
          badge={totals.symbols}
        />
        <TabButton
          id="errors"
          current={tab}
          onSelect={setTab}
          icon={<CircleAlert aria-hidden className="size-3.5" />}
          label="Errors"
          badge={totals.diagnostics}
          tone={totals.errors > 0 ? 'error' : 'neutral'}
        />
      </div>

      {tab === 'workbench' && (
        <div
          role="tabpanel"
          id="sem-panel-workbench"
          aria-labelledby="sem-tab-workbench"
          className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
        >
          {astFirst ? [astPane, scopesPane] : [scopesPane, astPane]}
        </div>
      )}

      {tab === 'symbols' && (
        <div role="tabpanel" id="sem-panel-symbols" aria-labelledby="sem-tab-symbols">
        <Panel
          title="Symbol table"
          icon={<Table2 aria-hidden className="size-4 text-accent" />}
          actions={
            <span className="font-mono text-[11px] text-ink-faint">
              id · name · type · kind · scope · declared at
            </span>
          }
        >
          <SymbolTablePane
            state={state}
            activeSymbolId={activeSymbolId}
            selectedSymbolId={selection.symbolId}
            totalSymbols={totals.symbols}
          />
        </Panel>
        </div>
      )}

      {tab === 'errors' && (
        <div role="tabpanel" id="sem-panel-errors" aria-labelledby="sem-tab-errors">
          <Panel
            title="Diagnostics"
            icon={<CircleAlert aria-hidden className="size-4 text-accent" />}
            actions={
              <span className="font-mono text-[11px] text-ink-faint">
                message · failed rule · hint · span
              </span>
            }
          >
            <DiagnosticsPane
              diagnostics={state.diagnostics}
              total={totals.diagnostics}
              onFocus={focusDiagnostic}
              selectedIndex={selection.diagnosticIndex}
            />
          </Panel>
        </div>
      )}

      <Panel
        title="Source"
        icon={<FileCode2 aria-hidden className="size-4 text-accent" />}
        actions={
          <span className="font-mono text-[11px] text-ink-faint">
            highlighted: the span of the current step
          </span>
        }
      >
        <CodeStrip source={compilation.source} spans={spans} maxHeight="15rem" />
      </Panel>
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

function TabButton({
  id,
  current,
  onSelect,
  icon,
  label,
  badge,
  tone = 'neutral',
}: {
  id: ViewTab;
  current: ViewTab;
  onSelect: (t: ViewTab) => void;
  icon: ReactNode;
  label: string;
  badge?: number;
  tone?: 'neutral' | 'error';
}) {
  const selected = current === id;
  return (
    <button
      type="button"
      role="tab"
      id={`sem-tab-${id}`}
      aria-selected={selected}
      aria-controls={`sem-panel-${id}`}
      onClick={() => onSelect(id)}
      className={clsx(
        'flex h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
        selected
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
      )}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className={clsx(
            'inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1 font-mono text-[10px]',
            tone === 'error' ? 'bg-err-soft text-err' : 'bg-raised text-ink-muted',
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
