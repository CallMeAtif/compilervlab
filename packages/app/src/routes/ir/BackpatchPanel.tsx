/**
 * §6.7 backpatching, made visible.
 *
 * A jump whose target is not yet known is emitted as `goto _` and its
 * instruction index is put on a list (makelist). Lists are concatenated
 * (merge) as the translation moves up the syntax tree, and when the target
 * finally becomes known every instruction on the list gets it (backpatch).
 * Everything below is read straight from the reduced state's `activeLists`
 * and `labels` — the panel derives nothing.
 */
import { clsx } from 'clsx';
import { ArrowRight, Check, SkipForward, Tag, X, Wrench } from 'lucide-react';
import type { ActiveList, IrEvent, LabelEntry, ListRole } from '@lab/core/ir/ir-events.js';

export type BackpatchOpKind = 'makelist' | 'merge' | 'backpatch';

export interface BackpatchPanelProps {
  lists: readonly ActiveList[];
  labels: readonly LabelEntry[];
  tempCount: number;
  listOp: Extract<IrEvent, { kind: BackpatchOpKind }> | null;
  hoveredListId: number | null;
  onHoverList: (id: number | null) => void;
  onHoverInstr: (instr: number | null) => void;
  describeAst: (astNodeId: number) => string;
  /** Seek to the next step of this kind (micro steps: StepControls' macro
   *  filter hides them, so the panel offers its own jump-to). */
  onJumpToOp: (kind: BackpatchOpKind) => void;
}

/** Role styling: colour AND border pattern AND glyph — never colour alone. */
const ROLE: Record<
  ListRole,
  { label: string; border: string; text: string; glyph: 'check' | 'x' | 'arrow' }
> = {
  truelist: {
    label: 'truelist',
    border: 'border-solid border-ok',
    text: 'text-ok',
    glyph: 'check',
  },
  falselist: {
    label: 'falselist',
    border: 'border-dashed border-err',
    text: 'text-err',
    glyph: 'x',
  },
  nextlist: {
    label: 'nextlist',
    border: 'border-dotted border-accent',
    text: 'text-accent',
    glyph: 'arrow',
  },
};

function RoleGlyph({ glyph, className }: { glyph: 'check' | 'x' | 'arrow'; className?: string }) {
  if (glyph === 'check') return <Check aria-hidden className={className} />;
  if (glyph === 'x') return <X aria-hidden className={className} />;
  return <ArrowRight aria-hidden className={className} />;
}

function InstrBadge({
  instr,
  onHoverInstr,
  tone = 'default',
}: {
  instr: number;
  onHoverInstr: (i: number | null) => void;
  tone?: 'default' | 'accent';
}) {
  return (
    <span
      onMouseEnter={() => onHoverInstr(instr)}
      onMouseLeave={() => onHoverInstr(null)}
      className={clsx(
        'inline-flex h-5 min-w-6 items-center justify-center rounded px-1 font-mono text-[11px]',
        tone === 'accent'
          ? 'bg-accent text-on-accent'
          : 'bg-raised text-ink-muted ring-1 ring-line',
      )}
    >
      {instr}
    </span>
  );
}

function OpCallout({
  listOp,
  onHoverInstr,
}: {
  listOp: NonNullable<BackpatchPanelProps['listOp']>;
  onHoverInstr: (i: number | null) => void;
}) {
  const instrs =
    listOp.kind === 'makelist'
      ? [listOp.instr]
      : listOp.kind === 'merge'
        ? listOp.instrs
        : listOp.instrs;
  return (
    <div
      role="status"
      className={clsx(
        'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs',
        listOp.kind === 'backpatch'
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-line bg-raised text-ink-muted',
      )}
    >
      <Wrench aria-hidden className="size-3.5 shrink-0 text-accent" />
      <span className="font-mono font-semibold text-ink">{listOp.kind}</span>
      <span className="flex flex-wrap items-center gap-1">
        {instrs.map((i) => (
          <InstrBadge
            key={i}
            instr={i}
            onHoverInstr={onHoverInstr}
            tone={listOp.kind === 'backpatch' ? 'accent' : 'default'}
          />
        ))}
      </span>
      {listOp.kind === 'backpatch' ? (
        <>
          <ArrowRight aria-hidden className="size-3.5 text-accent" />
          <span className="font-mono font-semibold text-accent">
            {listOp.targetLabel}
          </span>
          <span className="text-ink-muted">
            (instruction {listOp.targetInstr}) — targets filled in.
          </span>
        </>
      ) : (
        <span className="text-ink-muted">
          {listOp.kind === 'makelist'
            ? 'a new one-element list of unfilled jumps.'
            : 'lists concatenated as translation moves up the tree.'}
        </span>
      )}
    </div>
  );
}

export function BackpatchPanel({
  lists,
  labels,
  tempCount,
  listOp,
  hoveredListId,
  onHoverList,
  onHoverInstr,
  describeAst,
  onJumpToOp,
}: BackpatchPanelProps) {
  return (
    <section
      aria-label="Backpatching state"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-sm font-semibold tracking-tight text-ink">Backpatching</h3>
        <span className="font-mono text-[11px] text-ink-faint">
          §6.7.1 — a jump is emitted as <span className="text-ink-muted">goto _</span> and its
          index parked on a list until the target exists
        </span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-ink-faint">
          {tempCount > 0 ? `t1 … t${tempCount}` : 'no temporaries yet'}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-faint">
          These are micro steps — jump to the next one:
        </span>
        {(['makelist', 'merge', 'backpatch'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            aria-label={`Jump to the next ${kind} step`}
            onClick={() => onJumpToOp(kind)}
            className="flex h-11 cursor-pointer items-center gap-1.5 rounded-md border border-control bg-surface px-3 font-mono text-xs text-ink-muted transition-colors hover:border-line-strong hover:text-ink"
          >
            <SkipForward aria-hidden className="size-3.5 text-accent" />
            {kind}
          </button>
        ))}
      </div>

      {listOp && <OpCallout listOp={listOp} onHoverInstr={onHoverInstr} />}

      <div className="flex flex-col gap-1.5">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
          Open lists — jumps still waiting for a target
        </h4>
        {lists.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong px-3 py-2 text-xs text-ink-faint">
            No open lists: every jump emitted so far already has its target.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {lists.map((l) => {
              const role = ROLE[l.role];
              const hot = hoveredListId === l.id;
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    aria-label={`${role.label} ${l.id} from ${describeAst(
                      l.astNodeId,
                    )}, instructions ${l.instrs.join(', ')}`}
                    onMouseEnter={() => onHoverList(l.id)}
                    onMouseLeave={() => onHoverList(null)}
                    onFocus={() => onHoverList(l.id)}
                    onBlur={() => onHoverList(null)}
                    className={clsx(
                      'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-md border-2 bg-surface px-2.5 py-1.5 text-left transition-colors duration-150',
                      role.border,
                      hot && 'bg-raised',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <RoleGlyph glyph={role.glyph} className={clsx('size-3.5', role.text)} />
                      <span className={clsx('font-mono text-[11px] font-semibold', role.text)}>
                        {role.label}
                      </span>
                      <span className="font-mono text-[11px] text-ink-faint">#{l.id}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      {l.instrs.map((i) => (
                        <InstrBadge key={i} instr={i} onHoverInstr={onHoverInstr} />
                      ))}
                      <span className="ml-1 text-[10px] text-ink-faint">
                        {describeAst(l.astNodeId)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">
          Label table — the marker instructions backpatching aims at (§6.7.2)
        </h4>
        {labels.length === 0 ? (
          <p className="text-xs text-ink-faint">No labels bound yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {labels.map((l: LabelEntry) => (
              <li key={`${l.name}-${l.instr}`}>
                <span
                  onMouseEnter={() => onHoverInstr(l.instr)}
                  onMouseLeave={() => onHoverInstr(null)}
                  className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line bg-raised px-2 font-mono text-[11px] text-ink-muted"
                >
                  <Tag aria-hidden className="size-3 text-accent" />
                  <span className="font-semibold text-ink">{l.name}</span>
                  <ArrowRight aria-hidden className="size-3" />
                  <span>instr {l.instr}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
