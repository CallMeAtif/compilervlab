/**
 * Before/after instruction-list diff for optimization passes.
 * Row kinds carry shape signifiers (glyph column), not color alone; changed
 * rows expose a per-row justification popover.
 */
import * as Popover from '@radix-ui/react-popover';
import { Info, X } from 'lucide-react';
import { clsx } from 'clsx';

export type DiffRowKind = 'unchanged' | 'added' | 'removed' | 'changed';

export interface DiffRow {
  kind: DiffRowKind;
  /** Instruction text before the pass (absent for added rows). */
  before?: string | null;
  /** Instruction text after the pass (absent for removed rows). */
  after?: string | null;
  /** Why the pass made this change (Dragon Book justification). */
  justification?: string;
}

const KIND_META: Record<
  DiffRowKind,
  { glyph: string; label: string; rowClass: string; glyphClass: string }
> = {
  unchanged: { glyph: '·', label: 'unchanged', rowClass: '', glyphClass: 'text-ink-faint' },
  added: { glyph: '+', label: 'added', rowClass: 'bg-ok-soft', glyphClass: 'text-ok' },
  removed: {
    glyph: '−',
    label: 'removed',
    rowClass: 'bg-err-soft',
    glyphClass: 'text-err',
  },
  changed: {
    glyph: '~',
    label: 'changed',
    rowClass: 'bg-warn-soft',
    glyphClass: 'text-warn',
  },
};

function JustificationPopover({ text }: { text: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="Why this change?"
          // 24x24: WCAG 2.2 SC 2.5.8 minimum. A 44px target cannot fit one row
          // of a dense instruction listing without destroying the listing.
          className="flex size-6 cursor-pointer items-center justify-center rounded text-ink-muted transition-colors duration-[var(--dur-fast)] hover:bg-accent-soft hover:text-accent"
        >
          <Info aria-hidden className="size-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="left"
          sideOffset={6}
          collisionPadding={8}
          className="overlay-panel z-50 w-72 rounded-md p-3 text-sm leading-relaxed text-ink"
        >
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-semibold text-ink-muted">Justification</span>
            <Popover.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="flex size-6 cursor-pointer items-center justify-center rounded text-ink-faint hover:bg-raised hover:text-ink"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </Popover.Close>
          </div>
          {text}
          <Popover.Arrow className="fill-line-strong" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export interface DiffViewProps {
  rows: DiffRow[];
  beforeLabel?: string;
  afterLabel?: string;
  className?: string;
}

export function DiffView({
  rows,
  beforeLabel = 'Before',
  afterLabel = 'After',
  className,
}: DiffViewProps) {
  return (
    <div className={clsx('framed overflow-hidden', className)}>
      {/*
        ONE table, so the column headers cannot drift out of alignment with the
        cells (they used to live in a separate 1fr/1fr grid while the cells were
        content-sized — any uneven instruction pushed the labels off their
        column). `artifact-scroll` keeps a long asm listing scrolling inside its
        own box instead of widening the page.
      */}
      <div className="artifact-scroll max-h-160">
        <table className="w-full border-separate border-spacing-0 font-mono text-xs">
          <caption className="sr-only">
            {beforeLabel} compared with {afterLabel}. Each row is marked unchanged, added,
            removed or changed.
          </caption>
          <colgroup>
            <col style={{ width: '1.5rem' }} />
            <col style={{ width: '50%' }} />
            <col style={{ width: '50%' }} />
            <col style={{ width: '2rem' }} />
          </colgroup>
          {/* Column heads are LABELS, not a filled band: small caps mono over a
              single strong hairline. The sticky row still needs an opaque
              background, and `surface` is the sheet it sits on. */}
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface text-2xs font-medium tracking-[0.1em] text-ink-faint uppercase">
              <th scope="col" className="border-b border-line-strong px-1.5 py-2">
                <span className="sr-only">Change</span>
              </th>
              <th scope="col" className="border-b border-line-strong px-3 py-2 text-left">
                {beforeLabel}
              </th>
              <th scope="col" className="border-b border-line-strong px-3 py-2 text-left">
                {afterLabel}
              </th>
              <th scope="col" className="border-b border-line-strong px-1 py-2">
                <span className="sr-only">Justification</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const meta = KIND_META[row.kind];
              return (
                <tr key={i} className={clsx('align-top', meta.rowClass)}>
                  {/* glyph + a visually-hidden word: the row kind is never
                      communicated by background colour alone. */}
                  <th
                    scope="row"
                    className={clsx(
                      'px-1.5 py-1 text-center font-normal select-none',
                      meta.glyphClass,
                    )}
                  >
                    <span aria-hidden>{meta.glyph}</span>
                    <span className="sr-only">{meta.label}</span>
                  </th>
                  <td
                    className={clsx(
                      'px-3 py-1 whitespace-pre',
                      row.kind === 'removed' && 'line-through decoration-err',
                      row.before == null && 'text-ink-faint',
                    )}
                  >
                    {row.before ?? ''}
                  </td>
                  <td className="border-l border-line px-3 py-1 whitespace-pre">
                    {row.after ?? ''}
                  </td>
                  <td className="py-0.5 text-center">
                    {row.justification && <JustificationPopover text={row.justification} />}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-ink-faint">
                  No differences — this pass changed nothing.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
