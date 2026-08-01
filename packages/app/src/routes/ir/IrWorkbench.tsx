/**
 * The /ir visualization area: AST on the left, three-address code on the right,
 * backpatching underneath, all driven by one stepper.
 *
 * Provenance is bidirectional and runs through `Quad.astNodeId`: hovering (or
 * focusing) an instruction row lights up the AST node that emitted it, and
 * hovering an AST node lights up every instruction it emitted. Stepping never
 * moves a node — the tidy-tree layout is memoized on the FuncDef identity and
 * only highlight props change.
 */
import { useCallback, useMemo, useState, type MouseEvent, type FocusEvent } from 'react';
import { clsx } from 'clsx';
import { Braces, Crosshair, Radio } from 'lucide-react';
import type { Ast, FuncDefNode } from '@lab/core/ast/types.js';
import type { SymbolEntry } from '@lab/core/sem/types.js';
import type { ActiveList, IrEvent, IrGenState } from '@lab/core/ir/ir-events.js';
import { TidyTree } from '../../components/viz/TidyTree';
import type { Stepper } from '../../lib/useStepper';
import { buildFunctionTree, decodeAstId, describeAstNode } from './ast-tree';
import { useIrHighlight } from './provenance';
import {
  RepresentationView,
  REPRESENTATIONS,
  type IrRepresentation,
} from './RepresentationView';
import { BackpatchPanel, type BackpatchOpKind } from './BackpatchPanel';

export interface IrWorkbenchProps {
  stepper: Stepper<IrGenState, IrEvent>;
  ast: Ast;
  /** Symbol table, for naming the globals the translation collected first. */
  symbols: readonly SymbolEntry[];
  representation: IrRepresentation;
  onRepresentationChange: (r: IrRepresentation) => void;
  /** Explicitly selected function (?pass=), or null to follow the trace. */
  selectedFunc: string | null;
  onSelectFunc: (name: string | null) => void;
}

const EMPTY_LISTS: readonly ActiveList[] = [];

export function IrWorkbench({
  stepper,
  ast,
  symbols,
  representation,
  onRepresentationChange,
  selectedFunc,
  onSelectFunc,
}: IrWorkbenchProps) {
  const state = stepper.state;

  const funcDefs = useMemo(
    () => ast.root.decls.filter((d): d is FuncDefNode => d.kind === 'FuncDef'),
    [ast],
  );

  const traceFunc = state.currentFunc ?? state.functions[state.functions.length - 1]?.name ?? null;
  const explicit = selectedFunc !== null && funcDefs.some((f) => f.name === selectedFunc);
  const activeName = explicit ? selectedFunc : (traceFunc ?? funcDefs[0]?.name ?? null);

  const fnDecl = useMemo(
    () => funcDefs.find((f) => f.name === activeName) ?? null,
    [funcDefs, activeName],
  );
  const fnState = state.functions.find((f) => f.name === activeName) ?? null;
  const quads = fnState?.quads ?? [];

  // Layout is computed once per function: the tree object identity is stable.
  const tree = useMemo(() => (fnDecl ? buildFunctionTree(fnDecl) : null), [fnDecl]);

  const highlight = useIrHighlight(stepper, activeName);

  // ── provenance links ──────────────────────────────────────────────────────
  const [hoverAst, setHoverAst] = useState<number | null>(null);
  const [hoverInstr, setHoverInstr] = useState<number | null>(null);
  const [pinnedInstr, setPinnedInstr] = useState<number | null>(null);
  const [hoveredListId, setHoveredListId] = useState<number | null>(null);

  const astOf = useCallback(
    (instr: number | null): number | null => {
      if (instr === null) return null;
      return quads.find((q) => q.index === instr)?.astNodeId ?? null;
    },
    [quads],
  );

  const linkedAst = hoverAst ?? astOf(hoverInstr) ?? astOf(pinnedInstr);

  const linkedInstrs = useMemo(() => {
    const out = new Set<number>();
    if (linkedAst === null) return out;
    for (const q of quads) if (q.astNodeId === linkedAst) out.add(q.index);
    return out;
  }, [quads, linkedAst]);

  const activeLists = activeName
    ? state.activeLists.filter((l) => l.func === activeName)
    : EMPTY_LISTS;

  const pendingLists = useMemo(() => {
    const m = new Map<number, ActiveList>();
    for (const l of activeLists) for (const i of l.instrs) m.set(i, l);
    return m;
  }, [activeLists]);

  const listedInstrs = useMemo(() => {
    const out = new Set<number>(highlight.listed);
    if (hoveredListId !== null) {
      const l = activeLists.find((x) => x.id === hoveredListId);
      if (l) for (const i of l.instrs) out.add(i);
    }
    return out;
  }, [highlight.listed, hoveredListId, activeLists]);

  const currentIds = useMemo(() => {
    const s = new Set<string>();
    if (state.currentAstNode !== null) s.add(String(state.currentAstNode));
    if (linkedAst !== null) s.add(String(linkedAst));
    for (const i of highlight.emitted) {
      const q = quads.find((x) => x.index === i);
      if (q) s.add(String(q.astNodeId));
    }
    return s;
  }, [state.currentAstNode, linkedAst, highlight.emitted, quads]);

  const describeAst = useCallback((id: number) => describeAstNode(ast.nodes[id]), [ast]);

  const jumpToOp = useCallback(
    (kind: BackpatchOpKind) => {
      stepper.jumpToNextMatching(
        (s) =>
          s.event.kind === kind &&
          (activeName === null || !('func' in s.event) || s.event.func === activeName),
      );
    },
    [stepper, activeName],
  );

  // TidyTree exposes no per-node callbacks; it does render `kind` as data-kind,
  // where ast-tree.ts encoded the node id. Delegate hover/focus off that.
  const pickAstFromEvent = useCallback(
    (e: MouseEvent<HTMLDivElement> | FocusEvent<HTMLDivElement>) => {
      const el = e.target instanceof Element ? e.target.closest('[data-kind]') : null;
      setHoverAst(decodeAstId(el?.getAttribute('data-kind')));
    },
    [],
  );

  const globalNames = useMemo(() => {
    const byId = new Map(symbols.map((s) => [s.id, s.name]));
    return state.globals.map((id) => byId.get(id) ?? `sym${id}`);
  }, [symbols, state.globals]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {globalNames.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <span className="font-medium">Globals (§6.2.1)</span>
          {globalNames.map((n) => (
            <span
              key={n}
              className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-ink"
            >
              {n}
            </span>
          ))}
          <span className="text-ink-faint">
            — addressable from every function; their initializers are not translated.
          </span>
        </p>
      )}

      {/* ── function selector ────────────────────────────────────────────── */}
      {funcDefs.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-muted">Function</span>
          <div role="tablist" aria-label="TAC function" className="flex flex-wrap gap-1.5">
            {funcDefs.map((f) => {
              const done = state.functions.some((x) => x.name === f.name);
              const selected = f.name === activeName;
              return (
                <button
                  key={f.name}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onSelectFunc(f.name)}
                  className={clsx(
                    'flex h-11 cursor-pointer items-center gap-2 rounded-md border px-3 font-mono text-xs transition-colors',
                    selected
                      ? 'border-accent bg-accent-soft text-ink'
                      : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                  )}
                >
                  {f.name}()
                  <span className={clsx('text-[10px]', done ? 'text-ink-faint' : 'text-warn')}>
                    {done
                      ? `${state.functions.find((x) => x.name === f.name)?.quads.length ?? 0} quads`
                      : 'not translated yet'}
                  </span>
                </button>
              );
            })}
          </div>
          {explicit && traceFunc !== null && traceFunc !== activeName && (
            <button
              type="button"
              onClick={() => onSelectFunc(null)}
              className="flex h-11 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-line-strong px-3 text-xs text-ink-muted hover:text-ink"
            >
              <Radio aria-hidden className="size-3.5 text-accent" />
              Trace is in {traceFunc}() — follow it
            </button>
          )}
        </div>
      )}

      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        {/* ── AST ────────────────────────────────────────────────────────── */}
        <section aria-label="Abstract syntax tree" className="flex min-w-0 flex-col gap-1.5">
          <header className="flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-sm font-semibold tracking-tight text-ink">
              Abstract syntax tree
            </h3>
            <span className="font-mono text-[11px] text-ink-faint">
              {activeName ? `${activeName}()` : '—'}
            </span>
            <span className="flex-1" />
            <span className="flex items-center gap-1 font-mono text-[11px] text-accent">
              <Crosshair aria-hidden className="size-3" />
              {state.currentAstNode !== null
                ? describeAst(state.currentAstNode)
                : 'not translating'}
            </span>
          </header>
          {tree ? (
            <div
              onMouseOver={pickAstFromEvent}
              onFocus={pickAstFromEvent}
              onMouseLeave={() => setHoverAst(null)}
              onBlur={() => setHoverAst(null)}
            >
              <TidyTree
                root={tree}
                currentIds={currentIds}
                visitedIds={highlight.visitedAstIds}
                className="max-h-[26rem]"
              />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-center text-sm text-ink-faint">
              This program declares no functions, so there is nothing to translate.
            </p>
          )}
          <p className="text-[11px] text-ink-faint">
            Double ring = node being translated · filled dot = already visited · click a node
            with children to collapse it. Hover a node to light up the instructions it emitted.
          </p>
        </section>

        {/* ── representations ────────────────────────────────────────────── */}
        <section aria-label="Three-address code" className="flex min-w-0 flex-col gap-1.5">
          <header className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-ink">
              <Braces aria-hidden className="size-4 text-accent" />
              Three-address code
            </h3>
            <span className="flex-1" />
            <div
              role="tablist"
              aria-label="TAC representation"
              className="flex flex-wrap gap-1.5"
            >
              {REPRESENTATIONS.map((r) => {
                const selected = r.id === representation;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => onRepresentationChange(r.id)}
                    className={clsx(
                      'h-11 cursor-pointer rounded-md border px-3 text-xs font-medium transition-colors',
                      selected
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                    )}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </header>

          <p className="rounded-md bg-raised px-3 py-2 text-[11px] leading-relaxed text-ink-muted">
            <span className="font-mono font-semibold text-ink">
              {REPRESENTATIONS.find((r) => r.id === representation)?.cite}
            </span>{' '}
            {REPRESENTATIONS.find((r) => r.id === representation)?.hint}
            {representation !== 'quads' && (
              <>
                {' '}
                Derived live from the same quadruples — nothing is stored twice; the{' '}
                <span className="font-mono">from quad</span> link is the provenance back to the
                canonical row.
              </>
            )}
          </p>

          <RepresentationView
            representation={representation}
            fn={fnState}
            emitted={highlight.emitted}
            patched={highlight.patched}
            linkedInstrs={linkedInstrs}
            listedInstrs={listedInstrs}
            pendingLists={pendingLists}
            pinnedInstr={pinnedInstr}
            onHoverInstr={setHoverInstr}
            onPinInstr={setPinnedInstr}
          />
        </section>
      </div>

      <BackpatchPanel
        lists={activeLists}
        labels={fnState?.labels ?? []}
        tempCount={fnState?.tempCount ?? 0}
        listOp={
          highlight.listOp && highlight.listOp.func === activeName ? highlight.listOp : null
        }
        hoveredListId={hoveredListId}
        onHoverList={setHoveredListId}
        onHoverInstr={setHoverInstr}
        describeAst={describeAst}
        onJumpToOp={jumpToOp}
      />
    </div>
  );
}
