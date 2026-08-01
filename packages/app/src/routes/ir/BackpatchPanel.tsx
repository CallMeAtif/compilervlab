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
import { ArrowRight, Check, Tag, X, Wrench } from 'lucide-react';
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
        'inline-flex h-5 min-w-6 items-center justify-center rounded-sm px-1 font-mono text-2xs',
        tone === 'accent' ? 'bg-accent text-on-accent' : 'bg-raised text-ink-muted',
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
        // A status line, edged not boxed: the accent bar means "this is the
        // step's focus"; a quiet ink bar means "context".
        'flex flex-wrap items-center gap-2 border-l-2 py-1.5 pl-3 text-xs',
        listOp.kind === 'backpatch'
          ? 'border-accent bg-accent-soft text-ink'
          : 'border-line-strong text-ink-muted',
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
          <span className="font-mono text-ink-muted">instr {listOp.targetInstr}</span>
        </>
      ) : null}
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
}: BackpatchPanelProps) {
  return (
    <section aria-label="Backpatching state" className="section mt-0 flex flex-col gap-4">
      <header className="section-head mb-0">
        <h2 className="section-title">Backpatching</h2>
        <span className="section-meta">
          §6.7.1 · {tempCount > 0 ? `t1 … t${tempCount}` : 'no temporaries'}
        </span>
      </header>

      {listOp && <OpCallout listOp={listOp} onHoverInstr={onHoverInstr} />}

      <div className="flex flex-col gap-2">
        <h3 className="subsection-title">Open lists</h3>
        {lists.length === 0 ? (
          <p className="text-sm text-ink-faint">No open lists.</p>
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
                      // A list IS an object with an identity, so it keeps its
                      // 2px edge — and the edge's DASH PATTERN, not its colour,
                      // is what names the role.
                      'flex min-h-11 cursor-pointer flex-col items-start gap-1 rounded-sm border-2 px-2.5 py-1.5 text-left transition-colors duration-[var(--dur)]',
                      role.border,
                      hot && 'bg-raised',
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <RoleGlyph glyph={role.glyph} className={clsx('size-3.5', role.text)} />
                      <span className={clsx('font-mono text-2xs font-semibold', role.text)}>
                        {role.label}
                      </span>
                      <span className="font-mono text-2xs text-ink-faint">#{l.id}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1">
                      {l.instrs.map((i) => (
                        <InstrBadge key={i} instr={i} onHoverInstr={onHoverInstr} />
                      ))}
                      <span className="ml-1 text-3xs text-ink-faint">
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

      <div className="flex flex-col gap-2">
        <h3 className="subsection-title">Label table</h3>
        {labels.length === 0 ? (
          <p className="text-sm text-ink-faint">No labels bound yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
            {labels.map((l: LabelEntry) => (
              <li key={`${l.name}-${l.instr}`}>
                <span
                  onMouseEnter={() => onHoverInstr(l.instr)}
                  onMouseLeave={() => onHoverInstr(null)}
                  className="inline-flex h-7 items-center gap-1.5 font-mono text-2xs text-ink-muted"
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
