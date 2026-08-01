/**
 * /ir — Intermediate Code Generation (Dragon Book §6).
 *
 * One trace kind: `ir.gen {source}` (worker → SerializedTrace → replayed here
 * with `irGenReducer`). Everything rendered comes from `stepper.state`; nothing
 * is re-derived except the triples / indirect-triples VIEWS of the same quads,
 * which §6.2.3 defines as derived-not-stored and `@lab/core/ir/views.js`
 * computes.
 *
 * Layout: [AST + TAC + backpatching | TracePanel], stacking under lg. The route
 * owns the stepper and hands it to both columns, so the workbench and the
 * transport controls are one stepper, one cursor, no duplicated playback state
 * and no frame of lag between them.
 *
 * Deep links: ?algo= selects the representation (quads | triples | indirect),
 * ?pass= pins the function, ?step= restores the cursor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { traceFromSerialized, type Trace } from '@lab/trace';
import { irGenReducer, type IrEvent, type IrGenState } from '@lab/core/ir/ir-events.js';
import type { Ast } from '@lab/core/ast/types.js';
import type { SymbolEntry } from '@lab/core/sem/types.js';
import type { Diagnostic } from '@lab/core/common/types.js';
import { PhasePage } from '../../components/PhasePage';
import { TracePanel } from '../../components/TracePanel';
import type { JumpTarget } from '../../components/StepControls';
import { useStepper, type UseStepperOptions } from '../../lib/useStepper';
import { usePhaseUrlState } from '../../lib/urlState';
import { useCompilationStore } from '../../store/compilation';
import { getCompilerClient } from '../../worker/api';
import { IrWorkbench } from './IrWorkbench';
import type { IrRepresentation } from './RepresentationView';
import { SourceTrail } from './SourceTrail';
import { IrBlocked, IrFailed, IrIdle, IrSkeleton, IrStyles } from './states';

type Load =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; trace: Trace<IrGenState, IrEvent> }
  | { status: 'blocked'; diagnostics: Diagnostic[] }
  | { status: 'failed'; message: string };

function representationOf(algo: string | null): IrRepresentation {
  return algo === 'triples' || algo === 'indirect' ? algo : 'quads';
}

/**
 * The landmarks of a syntax-directed translation (§6.4–§6.7), in the shared
 * StepControls "Jump to…" menu. The backpatching panel keeps its own
 * makelist/merge/backpatch shortcuts: those are scoped to the function it is
 * showing, which a global menu entry cannot express.
 */
const IR_JUMPS: ReadonlyArray<JumpTarget<IrEvent>> = [
  {
    label: 'Next function',
    hint: 'function whose body is translated',
    predicate: (s) => s.event.kind === 'func-begin',
  },
  {
    label: 'Next emitted instruction',
    hint: 'three-address instruction emitted',
    predicate: (s) => s.event.kind === 'emit-quad',
  },
  {
    label: 'Next makelist',
    hint: 'one-element list of jumps with no target yet (§6.7.1)',
    predicate: (s) => s.event.kind === 'makelist',
  },
  {
    label: 'Next backpatch',
    hint: 'jump list whose target is finally filled in (§6.7.1)',
    predicate: (s) => s.event.kind === 'backpatch',
  },
];

export function IrPhaseView() {
  const compilation = useCompilationStore((s) => s.compilation);
  const editorSource = useCompilationStore((s) => s.source);
  const stale = useCompilationStore((s) => s.stale);
  const { algo, step, pass, setPhaseParams } = usePhaseUrlState();

  const source = compilation?.source ?? null;
  const [load, setLoad] = useState<Load>({ status: 'idle' });

  useEffect(() => {
    if (source === null) {
      setLoad({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setLoad({ status: 'loading' });
    getCompilerClient()
      .getTraceOrError({ kind: 'ir.gen', params: { source } })
      .then((res) => {
        if (cancelled) return;
        if (!res.trace) {
          setLoad({ status: 'blocked', diagnostics: res.diagnostics });
          return;
        }
        setLoad({
          status: 'ready',
          trace: traceFromSerialized<IrGenState, IrEvent>(res.trace as never, irGenReducer),
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoad({
          status: 'failed',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  // ?step= is restored once, when the stepper mounts with its trace; later
  // cursor moves write back (debounced inside urlState). Keeping these
  // callbacks referentially stable keeps playback timing steady.
  const paramsRef = useRef(setPhaseParams);
  paramsRef.current = setPhaseParams;
  const initialStepRef = useRef(step ?? 0);
  const onIndexChange = useCallback((i: number) => paramsRef.current({ step: i }), []);
  const stepperOptions = useMemo(
    () => ({ initialIndex: initialStepRef.current, onIndexChange }),
    [onIndexChange],
  );
  const onRepresentationChange = useCallback(
    (r: IrRepresentation) => paramsRef.current({ algo: r }),
    [],
  );
  const onSelectFunc = useCallback(
    (name: string | null) => paramsRef.current({ pass: name }),
    [],
  );

  const representation = representationOf(algo);
  const ast = compilation?.ast ?? null;

  if (load.status === 'idle') return <IrIdle source={editorSource} />;
  if (load.status === 'loading') return <IrSkeleton />;
  if (load.status === 'failed') return <IrFailed message={load.message} />;
  if (load.status === 'blocked') {
    return <IrBlocked diagnostics={load.diagnostics} source={source ?? editorSource} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <IrStyles />

      {stale && (
        <p
          role="status"
          className="rounded-lg border border-dashed border-warn/60 bg-warn-soft px-3 py-2 text-sm text-warn"
        >
          The editor source has changed since this compilation — you are stepping through the
          translation of the program that was last compiled.
        </p>
      )}

      <IrReady
        trace={load.trace}
        stepperOptions={stepperOptions}
        ast={ast}
        symbols={compilation?.semantic?.symbols ?? []}
        source={source}
        representation={representation}
        onRepresentationChange={onRepresentationChange}
        selectedFunc={pass}
        onSelectFunc={onSelectFunc}
      />
    </div>
  );
}

/** [workbench | TracePanel] over ONE stepper, owned here and shared by both. */
function IrReady({
  trace,
  stepperOptions,
  ast,
  symbols,
  source,
  representation,
  onRepresentationChange,
  selectedFunc,
  onSelectFunc,
}: {
  trace: Trace<IrGenState, IrEvent>;
  stepperOptions: UseStepperOptions;
  ast: Ast | null;
  symbols: readonly SymbolEntry[];
  source: string | null;
  representation: IrRepresentation;
  onRepresentationChange: (r: IrRepresentation) => void;
  selectedFunc: string | null;
  onSelectFunc: (name: string | null) => void;
}) {
  const stepper = useStepper<IrGenState, IrEvent>(trace, stepperOptions);

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
      <div className="min-w-0">
        {ast && (
          <IrWorkbench
            stepper={stepper}
            ast={ast}
            symbols={symbols}
            representation={representation}
            onRepresentationChange={onRepresentationChange}
            selectedFunc={selectedFunc}
            onSelectFunc={onSelectFunc}
          />
        )}
      </div>

      <TracePanel
        stepper={stepper}
        title="Syntax-directed translation — §6.4, §6.6, §6.7"
        className="min-w-0"
        jumpTargets={IR_JUMPS}
      >
        {source !== null ? () => <SourceTrail source={source} stepper={stepper} /> : undefined}
      </TracePanel>
    </div>
  );
}

export default function IrPhaseRoute() {
  return (
    <PhasePage phase="ir">
      <IrPhaseView />
    </PhasePage>
  );
}
