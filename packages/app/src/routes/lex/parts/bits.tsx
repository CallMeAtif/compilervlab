/**
 * Tiny lex-specific display atoms: legends, chips, partition swatches, the
 * §3.2 input-buffer tape. Kept apart from `ui.tsx` (layout/shell) so each file
 * stays readable.
 */
import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { Token } from '@lab/core/csubset/tokens.js';

/** A mono metadata line beside a section title — no pills, no fills. */
export function StatChips({ items }: { items: ReadonlyArray<readonly [string, string]> }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-2xs">
      {items.map(([k, v]) => (
        <span key={k} className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
          <span className="text-ink-faint">{k}</span>
          <span className="tabular-nums text-ink">{v}</span>
        </span>
      ))}
    </div>
  );
}

/** Shape key for the automaton graphs — never colour alone. */
export function AutomatonLegend({ kind }: { kind: 'nfa' | 'dfa' }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-2xs text-ink-faint">
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-3.5 w-5 rounded-sm border border-line-strong border-l-4 border-l-ink-muted bg-surface"
        />
        start
      </li>
      <li className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-3.5 w-5 rounded-sm border border-line-strong bg-surface outline-2 outline-offset-1 outline-double outline-ink-faint"
        />
        accepting (double ring)
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3.5 w-5 rounded-sm border border-line-strong bg-surface opacity-20" />
        not built yet
      </li>
      {kind === 'nfa' && <li>ε = epsilon edge</li>}
      {kind === 'dfa' && <li>edge labels are condensed symbol ranges</li>}
    </ul>
  );
}

/** A partition group's colour + pattern swatch (Algorithm 3.39 views). */
export function GroupSwatch({ group, className }: { group: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx('lex-swatch', `lex-grp-${group % 8}`, className)}
    />
  );
}

export function GroupBadge({ group, children }: { group: number; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 font-mono text-3xs text-ink-muted">
      <GroupSwatch group={group} />
      G{group}
      {children}
    </span>
  );
}

export function SetText({ values }: { values: ReadonlyArray<string | number> }) {
  return <span className="font-mono">{`{${values.join(', ')}}`}</span>;
}

// ── token chips ─────────────────────────────────────────────────────────────

const CONSTANT_TYPES = new Set(['intconst', 'floatconst', 'charconst']);

/** Category is signalled by a glyph as well as a border, never by colour alone. */
function tokenGlyph(type: string): string {
  if (type === 'id') return '𝑥';
  if (CONSTANT_TYPES.has(type)) return '#';
  if (/^[a-z]+$/.test(type)) return 'kw';
  return 'op';
}

export function TokenChip({
  token,
  active,
  onClick,
}: {
  token: Token;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Token ${token.index}: ${token.type} ${token.lexeme}`}
      aria-current={active ? 'true' : undefined}
      className={clsx(
        'flex h-11 cursor-pointer items-center gap-1.5 rounded-sm px-2 font-mono text-xs transition-colors',
        active
          ? 'bg-accent-soft text-ink shadow-[inset_0_-2px_0_var(--accent)]'
          : 'text-ink-muted hover:bg-raised hover:text-ink',
      )}
    >
      <span aria-hidden className="text-[10px] text-ink-faint">
        {tokenGlyph(token.type)}
      </span>
      <span className="text-ink">{token.lexeme === '\n' ? '\\n' : token.lexeme}</span>
      <span className="text-[10px] text-ink-faint">{token.type}</span>
    </button>
  );
}

// ── the input buffer (§3.2, Fig 3.3) ────────────────────────────────────────

export interface TapeProps {
  source: string;
  /** `forward` pointer: the next character the DFA will read. */
  pos: number;
  /** `lexemeBegin` pointer, or null between tokens. */
  start: number | null;
  /** Position the scanner would retract to (last accepting state seen). */
  lastAccept: number | null;
  /** Characters the current step has just retracted, as [from, to). */
  retracted: { from: number; to: number } | null;
  window?: number;
}

function tapeChar(ch: string): string {
  if (ch === '\n') return '⏎';
  if (ch === '\t') return '→';
  if (ch === ' ') return '·';
  return ch;
}

/**
 * The two-pointer input buffer of §3.2 rendered literally: `lexemeBegin` under
 * the tape, `forward` over it, and the retraction that longest-match performs
 * struck through. This is what makes rollback visible.
 */
export function InputTape({
  source,
  pos,
  start,
  lastAccept,
  retracted,
  window = 56,
}: TapeProps) {
  const anchor = start ?? pos;
  const from = Math.max(0, Math.min(anchor, pos) - Math.floor(window / 3));
  const to = Math.min(source.length, from + window);
  const cells: ReactNode[] = [];
  for (let i = from; i < to; i++) {
    const inLexeme = start !== null && i >= start && i < pos;
    const isRetracted = retracted !== null && i >= retracted.to && i < retracted.from;
    cells.push(
      <span
        key={i}
        className={clsx(
          'lex-tape-cell',
          inLexeme && !isRetracted && 'lex-tape-lexeme',
          isRetracted && 'lex-tape-retracted',
          i === pos && 'lex-tape-forward',
        )}
      >
        {tapeChar(source[i]!)}
      </span>,
    );
  }

  const marker = (at: number, glyph: string, label: string) => {
    if (at < from || at > to) return null;
    return (
      <span
        className="absolute font-mono text-[10px] whitespace-nowrap text-ink-muted"
        style={{ left: `${(at - from) * 1.05}ch` }}
      >
        {glyph}
        <span className="ml-0.5">{label}</span>
      </span>
    );
  };

  return (
    <div className="framed artifact-scroll bg-code px-2 py-1">
      <div className="relative min-w-max pt-4 pb-4 font-mono text-sm leading-6">
        <div className="relative h-4">
          {marker(pos, '▼', 'forward')}
          {lastAccept !== null && lastAccept !== pos && marker(lastAccept, '▾', 'lastAccept')}
        </div>
        <div className="whitespace-pre text-ink">{cells}</div>
        <div className="relative h-4">
          {start !== null && marker(start, '▲', 'lexemeBegin')}
        </div>
      </div>
    </div>
  );
}
