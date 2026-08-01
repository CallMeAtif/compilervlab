/**
 * The annotated AST: the parse's tree, relabelled with the synthesized type of
 * each node as the pass types it (§6.3 — types flow up, post-order). Nodes the
 * pass has not reached yet carry no type and stay hollow; typed nodes are
 * filled; the node of the current step gets the double ring (shape, not colour).
 *
 * Widening conversions (§6.5.2) and type errors are listed as clickable
 * annotations under the tree: clicking one seeks the trace to the step that
 * produced it, which is what re-focuses the ExplainCard and the source strip.
 */
import { useMemo, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { ArrowBigUpDash, ChevronDown, CircleAlert } from 'lucide-react';
import type { SemState } from '@lab/core/sem/sem-events.js';
import type { Ast, AstNode } from '@lab/core/ast/types.js';
import type { Diagnostic } from '@lab/core';
import { TidyTree, type TidyTreeNode } from '../../components/viz/TidyTree';
import { Reveal } from './parts';
import {
  childrenOf,
  nodeLabel,
  subtreeChoices,
  truncate,
  typeLabel,
  type AstSubtreeChoice,
} from './derive';

export interface AstPaneProps {
  ast: Ast;
  state: SemState;
  /** Node the current step is about (double ring). */
  currentNodeId: number | null;
  /** Nodes carrying a reported diagnostic (matched by span). */
  errorNodeIds: ReadonlySet<number>;
  /** Diagnostics revealed so far, in report order. */
  diagnostics: readonly Diagnostic[];
  subtreeId: string;
  onSubtreeChange: (id: string) => void;
  /** Seek the trace to the step that typed / converted this node. */
  onFocusNode: (nodeId: number, prefer?: 'typed' | 'convert') => void;
  onFocusDiagnostic: (d: Diagnostic) => void;
  /**
   * Transport for the tree's fullscreen bar. Fullscreen hides the TracePanel,
   * so without it the annotated AST freezes on whatever step it was expanded
   * from — and the whole point of expanding it is to watch types flow up.
   */
  controls?: ReactNode;
}

export function AstPane({
  ast,
  state,
  currentNodeId,
  errorNodeIds,
  diagnostics,
  subtreeId,
  onSubtreeChange,
  onFocusNode,
  onFocusDiagnostic,
  controls,
}: AstPaneProps) {
  const choices = useMemo<AstSubtreeChoice[]>(() => subtreeChoices(ast.root), [ast]);
  const choice = choices.find((c) => c.id === subtreeId) ?? choices[0]!;

  const nodeById = useMemo(() => {
    const m = new Map<number, AstNode>();
    for (const n of ast.nodes) m.set(n.id, n);
    return m;
  }, [ast]);

  // Structure is fixed (it is the parse tree); only labels/emphasis change as
  // the pass types nodes, so positions never move between steps.
  const root = useMemo(
    () => toTreeNode(choice.node, state, errorNodeIds),
    [choice, state, errorNodeIds],
  );

  const typedIds = useMemo(
    () => Object.keys(state.nodeTypes).map((id) => `n${id}`),
    [state.nodeTypes],
  );

  const conversions = Object.entries(state.conversions).map(([id, c]) => ({
    nodeId: Number(id),
    ...c,
  }));

  const typedCount = Object.keys(state.nodeTypes).length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          Subtree
          {/*
            A FIELD, drawn the way every other picker in the app is drawn (the
            example picker, the grammar picker, the sentence input): a rule
            under it at >= 3:1, never a box. `appearance-none` is what removes
            the platform chrome — without it this was the one control on the
            six pages that looked like it came from a different application.
          */}
          <span className="relative inline-flex items-center">
            <select
              value={choice.id}
              onChange={(e) => onSubtreeChange(e.target.value)}
              aria-label="AST subtree to display"
              className="h-11 w-full cursor-pointer appearance-none border-b border-control bg-transparent py-0 pr-7 pl-1 font-mono text-xs text-ink transition-colors hover:border-accent"
            >
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-1 size-4 text-ink-muted"
            />
          </span>
        </label>
        <span className="flex-1" />
        <Reveal label="key" className="mr-3">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-2xs text-ink-faint">
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full border border-line-strong" />
              no type yet
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-full border border-ink-faint bg-raised"
              />
              typed · label shows <span className="text-ink">:type</span>
            </li>
            <li className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-full border-2 border-accent bg-accent-soft"
              />
              current step
            </li>
            <li className="flex items-center gap-1.5">⇧ widened int→float</li>
            <li className="flex items-center gap-1.5">✕ type error</li>
            <li className="flex items-center gap-1.5">
              decay (§6.3.1 rule 6) is a step, not an annotation
            </li>
          </ul>
        </Reveal>
        <span className="font-mono text-2xs text-ink-faint">
          {typedCount} node{typedCount === 1 ? '' : 's'} typed
        </span>
      </div>

      <TidyTree
        root={root}
        currentIds={currentNodeId === null ? [] : [`n${currentNodeId}`]}
        visitedIds={typedIds}
        controls={controls}
        className="max-h-112"
      />

      <div className="mt-2 grid gap-6 sm:grid-cols-2">
        <Annotations title="Inserted conversions" empty="None so far.">
          {conversions.map((c) => {
            const n = nodeById.get(c.nodeId);
            return (
              <button
                key={c.nodeId}
                type="button"
                onClick={() => onFocusNode(c.nodeId, 'convert')}
                aria-label={`conversion on node ${c.nodeId}: ${typeLabel(c.from)} to ${typeLabel(c.to)}`}
                className="flex min-h-11 w-full cursor-pointer flex-col items-start justify-center gap-0.5 border-l-2 border-line px-2 py-1 text-left transition-colors hover:border-accent hover:bg-raised"
              >
                <span className="flex flex-wrap items-center gap-1.5 font-mono text-xs text-ink">
                  <ArrowBigUpDash aria-hidden className="size-3.5 shrink-0 text-accent" />
                  {n ? truncate(nodeLabel(n), 18) : `node #${c.nodeId}`}
                  <span className="text-ink-muted">
                    {typeLabel(c.from)} → {typeLabel(c.to)}
                  </span>
                </span>
                <span className="font-mono text-2xs leading-snug text-ink-faint">
                  §6.5.2 · inttofloat
                </span>
              </button>
            );
          })}
        </Annotations>

        <Annotations
          title="Type errors"
          empty="None so far."
          tone={diagnostics.length > 0 ? 'error' : 'neutral'}
        >
          {diagnostics.map((d, i) => (
            <button
              key={`${d.span.start}-${i}`}
              type="button"
              onClick={() => onFocusDiagnostic(d)}
              aria-label={`${d.severity} at line ${d.span.line}: ${d.message}`}
              className={clsx(
                'flex min-h-11 w-full cursor-pointer flex-col items-start justify-center gap-0.5 border-l-2 px-2 py-1 text-left transition-colors',
                d.severity === 'error'
                  ? 'border-err bg-err-soft/60 hover:bg-err-soft'
                  : 'border-warn bg-warn-soft/60 hover:bg-warn-soft',
              )}
            >
              <span
                className={clsx(
                  'flex items-center gap-1.5 font-mono text-xs',
                  d.severity === 'error' ? 'text-err' : 'text-warn',
                )}
              >
                <CircleAlert aria-hidden className="size-3.5 shrink-0" />
                {d.severity} · line {d.span.line}
              </span>
              <span className="text-2xs leading-snug text-ink">{d.message}</span>
            </button>
          ))}
        </Annotations>
      </div>
    </div>
  );
}

function Annotations({
  title,
  empty,
  tone = 'neutral',
  children,
}: {
  title: string;
  empty: string;
  tone?: 'neutral' | 'error';
  children: ReactNode[];
}) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col">
      <h3
        className={clsx(
          'subsection-title',
          tone === 'error' && 'text-err',
        )}
      >
        {title}
      </h3>
      {children.length === 0 ? (
        <p className="text-sm text-ink-faint">{empty}</p>
      ) : (
        <ul className="artifact-scroll flex max-h-48 flex-col gap-1">
          {children.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** AST → TidyTree, labelling each node with its synthesized type once typed. */
function toTreeNode(
  node: AstNode,
  state: SemState,
  errorNodeIds: ReadonlySet<number>,
): TidyTreeNode {
  const type = state.nodeTypes[node.id];
  const parts = [truncate(nodeLabel(node), 12)];
  if (type) parts.push(`:${truncate(typeLabel(type), 8)}`);
  if (state.conversions[node.id]) parts.push('⇧');
  if (errorNodeIds.has(node.id)) parts.push('✕');

  const kids = childrenOf(node);
  const out: TidyTreeNode = {
    id: `n${node.id}`,
    label: parts.join(' '),
    kind: node.kind,
  };
  if (kids.length > 0) out.children = kids.map((k) => toTreeNode(k, state, errorNodeIds));
  return out;
}
