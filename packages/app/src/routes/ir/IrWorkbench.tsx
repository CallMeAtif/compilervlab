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
import { Crosshair, Radio } from 'lucide-react';
import type { Ast, FuncDefNode } from '@lab/core/ast/types.js';
import type { SymbolEntry } from '@lab/core/sem/types.js';
import type { ActiveList, IrEvent, IrGenState } from '@lab/core/ir/ir-events.js';
import { TidyTree } from '../../components/viz/TidyTree';
import {
  FullscreenBody,
  FullscreenToggle,
  FullscreenTransport,
} from '../../components/Fullscreen';
import { useFullscreen } from '../../lib/useFullscreen';
import type { Stepper } from '../../lib/useStepper';
import { buildFunctionTree, decodeAstId, describeAstNode } from './ast-tree';
import { useIrHighlight } from './provenance';
import {
  RepresentationView,
  REPRESENTATIONS,
  type IrRepresentation,
} from './RepresentationView';
import { BackpatchPanel } from './BackpatchPanel';
import { Reveal } from './parts';

export interface IrWorkbenchProps {
  stepper: Stepper<IrGenState, IrEvent>;
  ast: Ast;
  /** Symbol table, for naming the globals the translation collected first. */
  symbols: readonly SymbolEntry[];
  representation: IrRepresentation;
  /** Explicitly selected function (?pass=), or null to follow the trace. */
  selectedFunc: string | null;
  onSelectFunc: (name: string | null) => void;
}

const EMPTY_LISTS: readonly ActiveList[] = [];

/**
 * Editorial tabs. Quiet text on a shared hairline; the selected one is bolder
 * ink with an accent rule drawn ON that hairline as an ::after bar — so
 * selecting a tab changes no box's height, and the emphasis is a SHAPE (a rule
 * plus weight) rather than colour alone. 44px tall.
 */
const TAB =
  'relative flex h-11 cursor-pointer items-baseline gap-x-2 px-0.5 pt-3 text-[15px] transition-colors duration-[var(--dur-fast)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:content-[""]';
const TAB_ON = 'font-semibold text-ink after:bg-accent';
const TAB_OFF = 'text-ink-muted after:bg-transparent hover:text-ink';

export function IrWorkbench({
  stepper,
  ast,
  symbols,
  representation,
  selectedFunc,
  onSelectFunc,
}: IrWorkbenchProps) {
  const state = stepper.state;

  // The TAC listing is not a canvas, so its toggle lives in the section head
  // rather than floating over the first instruction row (see components/Fullscreen).
  const tacFs = useFullscreen();
  const transport = <FullscreenTransport stepper={stepper} />;

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

  const active = REPRESENTATIONS.find((r) => r.id === representation);

  return (
    <div className="flex min-w-0 flex-col gap-8">
      {globalNames.length > 0 && (
        <p className="flex flex-wrap items-baseline gap-x-2 font-mono text-2xs">
          <span className="group-label">Globals</span>
          {globalNames.map((n) => (
            <span key={n} className="text-ink">
              {n}
            </span>
          ))}
          <span className="text-ink-faint">§6.2.1</span>
        </p>
      )}

      {/* ── function selector: editorial tabs, ruled, active underlined ──── */}
      {funcDefs.length > 1 && (
        <div className="flex flex-wrap items-end gap-x-4">
          <span className="group-label pb-2">Function</span>
          <div
            role="tablist"
            aria-label="TAC function"
            className="flex flex-1 flex-wrap items-stretch gap-x-5 border-b border-line"
          >
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
                  className={clsx(TAB, selected ? TAB_ON : TAB_OFF)}
                >
                  <span className="font-mono">{f.name}()</span>
                  <span className={clsx('font-mono text-2xs', done ? 'text-ink-faint' : 'text-warn')}>
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
              className="flex h-11 cursor-pointer items-center gap-1.5 text-sm text-ink-muted underline decoration-dashed decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
            >
              <Radio aria-hidden className="size-3.5 text-accent" />
              Trace is in {traceFunc}() — follow it
            </button>
          )}
        </div>
      )}

      <div className="grid min-w-0 items-start gap-8 xl:grid-cols-2">
        {/* ── AST ────────────────────────────────────────────────────────── */}
        <section aria-label="Abstract syntax tree" className="section mt-0 flex min-w-0 flex-col">
          <header className="section-head">
            <h2 className="section-title">Abstract syntax tree</h2>
            <span className="flex flex-wrap items-baseline gap-x-4">
              <span className="section-meta flex items-center gap-x-3">
                <span>{activeName ? `${activeName}()` : '—'}</span>
                <span className="flex items-center gap-1 text-accent">
                  <Crosshair aria-hidden className="size-3" />
                  {state.currentAstNode !== null
                    ? describeAst(state.currentAstNode)
                    : 'not translating'}
                </span>
              </span>
              <Reveal label="key">
                <ul className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs text-ink-faint">
                  <li>double ring = being translated</li>
                  <li>filled dot = visited</li>
                  <li>hover = instructions it emitted</li>
                  <li>click = collapse subtree</li>
                </ul>
              </Reveal>
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
                controls={transport}
                className="max-h-[26rem]"
              />
            </div>
          ) : (
            <p className="prose-note text-sm">No functions to translate.</p>
          )}
        </section>

        {/* ── representations ────────────────────────────────────────────── */}
        {/*
          NO second tab row here. The three representations are the phase's
          ?algo= values, so the header tablist at the top of the page already
          selects them; rendering the identical strip again 150px lower doubled
          the tab stops and made one page look like two. The head names the
          region, the meta cites it, and the prose says which form is showing.
        */}
        <section aria-label="Three-address code" className="section mt-0 flex min-w-0 flex-col">
          <header className="section-head">
            <h2 className="section-title">Three-address code</h2>
            <span className="flex shrink-0 items-center gap-1.5">
              {/* The form is named once, in the head. What distinguishes the
                  three is what stepping shows — so the definition is a
                  disclosure, not a paragraph standing over the listing. */}
              <Reveal label={`${active?.label ?? ''} · ${active?.cite ?? ''}`}>
                <p className="prose-note text-sm">{active?.hint}</p>
              </Reveal>
              <FullscreenToggle fs={tacFs} label="the three-address code" />
            </span>
          </header>

          <FullscreenBody fs={tacFs} controls={transport}>
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
              expanded={tacFs.isFullscreen}
            />
          </FullscreenBody>
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
      />
    </div>
  );
}
