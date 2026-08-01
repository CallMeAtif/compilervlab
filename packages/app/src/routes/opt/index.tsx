/**
 * /opt — Code Optimization.
 *
 * Three views over the optimizer, all deep-linkable:
 *   ?algo=<pass>      one pass with its analysis and its diff (also ?pass=)
 *   ?algo=<analysis>  one analysis in isolation (?pass= = TAC function)
 *   ?algo=pipeline    the whole default sequence
 * plus ?step= for the cursor. Restoring a URL re-selects the view and seeks.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { Clock } from 'lucide-react';
import { PhasePage } from '../../components/PhasePage';
import { usePhaseUrlState } from '../../lib/urlState';
import { useCompilationStore } from '../../store/compilation';
import type { UseStepperOptions } from '../../lib/useStepper';
import {
  DEFAULT_ANALYSIS,
  DEFAULT_PASS,
  isPassId,
  viewFromParams,
  viewKey,
  type AnalysisId,
  type OptViewKind,
  type PassId,
} from './lib/optModel';
import { cfgForFunction, functionByName } from './lib/cfgModel';
import { AnalysisPicker, FunctionPicker, ViewTabs } from './components/OptNav';
import { NothingCompiled, Notice, UpstreamBlocked } from './components/OptStates';
import { AnalysisView } from './views/AnalysisView';
import { PassView } from './views/PassView';
import { PipelineView } from './views/PipelineView';

export default function OptPhaseRoute() {
  return (
    <PhasePage phase="opt">
      <OptPhase />
    </PhasePage>
  );
}

function OptPhase() {
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const compile = useCompilationStore((s) => s.compile);
  const compiling = useCompilationStore((s) => s.compiling);
  const { algo, step, pass, setPhaseParams } = usePhaseUrlState();

  const view = viewFromParams(algo, pass);
  const optimized = compilation?.optimized ?? null;

  // ?pass= doubles as the TAC-function selector in the analysis views (the URL
  // helper exposes exactly algo/step/pass).
  const analysisFunction = useMemo(() => {
    if (!optimized) return '';
    const wanted = view.kind === 'analysis' && !isPassId(pass) ? pass : null;
    return functionByName(optimized.input, wanted)?.name ?? '';
  }, [optimized, view.kind, pass]);

  // The cursor is restored from ?step= for the view the page was opened on;
  // switching view or function starts that trace from the beginning.
  const key = viewKey(view, analysisFunction);
  const initialRef = useRef<{ key: string; value: number } | null>(null);
  if (initialRef.current === null) initialRef.current = { key, value: step ?? 0 };
  else if (initialRef.current.key !== key) initialRef.current = { key, value: 0 };
  const initialIndex = initialRef.current.value;

  const onIndexChange = useCallback(
    (i: number) => setPhaseParams({ step: i }),
    [setPhaseParams],
  );
  const stepperOptions = useMemo<UseStepperOptions>(
    () => ({ initialIndex, onIndexChange }),
    // A new options object per view keeps the restore honest.
    [key, initialIndex, onIndexChange],
  );

  const [lastPass, setLastPass] = useState<PassId>(
    view.kind === 'pass' ? view.pass : DEFAULT_PASS,
  );

  const selectPass = useCallback(
    (p: PassId) => {
      setLastPass(p);
      setPhaseParams({ algo: p, pass: p, step: null });
    },
    [setPhaseParams],
  );
  const selectAnalysis = useCallback(
    (a: AnalysisId) => setPhaseParams({ algo: a, step: null }),
    [setPhaseParams],
  );
  const selectFunction = useCallback(
    (name: string) => setPhaseParams({ pass: name, step: null }),
    [setPhaseParams],
  );
  const selectView = useCallback(
    (kind: OptViewKind) => {
      if (kind === 'pass') setPhaseParams({ algo: lastPass, pass: lastPass, step: null });
      else if (kind === 'analysis')
        setPhaseParams({ algo: DEFAULT_ANALYSIS, pass: null, step: null });
      else setPhaseParams({ algo: 'pipeline', pass: null, step: null });
    },
    [lastPass, setPhaseParams],
  );

  if (!compilation) return <NothingCompiled />;
  if (!optimized) {
    return <UpstreamBlocked diagnostics={compilation.diagnostics} />;
  }

  const source = compilation.source;
  const fn = functionByName(optimized.input, analysisFunction);
  const cfg = fn ? cfgForFunction(optimized.cfgs, fn.name) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {stale && (
        <Notice tone="warn" icon={<Clock aria-hidden className="size-4 shrink-0" />}>
          <span className="flex flex-wrap items-center gap-2">
            <span className="flex-1">
              The source changed since the last compile — every optimization trace below still
              describes the previously compiled program.
            </span>
            <button
              type="button"
              onClick={() => void compile()}
              disabled={compiling}
              className="h-11 shrink-0 cursor-pointer rounded-md border border-warn/60 px-3 text-xs font-semibold text-warn transition-colors hover:bg-warn/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recompile now
            </button>
          </span>
        </Notice>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ViewTabs active={view.kind} onSelect={selectView} />
      </div>

      {view.kind === 'analysis' && (
        <div className="flex flex-col gap-2">
          <AnalysisPicker selected={view.analysis} onSelect={selectAnalysis} />
          <FunctionPicker
            functions={optimized.input.functions.map((f) => f.name)}
            selected={analysisFunction}
            onSelect={selectFunction}
          />
        </div>
      )}

      {view.kind === 'pass' && (
        <PassView
          pass={view.pass}
          source={source}
          optimized={optimized}
          stepperOptions={stepperOptions}
          onSelectPass={selectPass}
        />
      )}

      {view.kind === 'analysis' &&
        (fn && cfg ? (
          <AnalysisView
            analysis={view.analysis}
            source={source}
            fn={fn}
            cfg={cfg}
            stepperOptions={stepperOptions}
            onSelectAnalysis={selectAnalysis}
          />
        ) : (
          <Notice tone="warn">
            The optimizer input has no function to analyse — the program contains no translated
            function bodies.
          </Notice>
        ))}

      {view.kind === 'pipeline' && (
        <PipelineView
          source={source}
          optimized={optimized}
          stepperOptions={stepperOptions}
          onSelectPass={selectPass}
        />
      )}
    </div>
  );
}
