/**
 * Navigation for the optimization phase: the view switch, the ordered pass
 * pipeline rail (with per-pass instruction deltas), the analysis picker, and
 * the TAC function picker.
 *
 * EDITORIAL: controls read as running text with a rule under (or a soft accent
 * fill behind) the CURRENT one — not as a wall of equally-weighted buttons. The
 * pass rail is a NUMBERED SEQUENCE: an ordinal, the pass name, and its delta,
 * separated by hairlines and bracketed by the quad counts entering and leaving
 * the pipeline. Every control is still a ≥44px target and still announces its
 * selection through aria, never through colour alone.
 */
import { clsx } from 'clsx';
import { PASS_LIST, ANALYSIS_LIST, type AnalysisId, type OptViewKind, type PassId } from '../lib/optModel';

/**
 * The one control skin this phase uses. Current = soft accent wash plus an
 * underline rule (the rule is the shape signifier); everything else is quiet
 * text that only earns a background on hover.
 */
function controlClass(selected: boolean, extra?: string): string {
  return clsx(
    'cursor-pointer transition-colors duration-[var(--dur-fast)]',
    selected
      ? 'bg-accent-soft text-ink shadow-[inset_0_-2px_0_var(--accent)]'
      : 'text-ink-muted hover:bg-raised hover:text-ink',
    extra,
  );
}

// ── View switch ──────────────────────────────────────────────────────────────

const VIEWS: Array<{ kind: OptViewKind; label: string; hint: string }> = [
  { kind: 'pass', label: 'Passes', hint: 'One pass, with its diff' },
  { kind: 'analysis', label: 'Analyses', hint: 'Blocks, flow graph, data flow, loops' },
  { kind: 'pipeline', label: 'Pipeline', hint: 'All six passes in order' },
];

export function ViewTabs({
  active,
  onSelect,
}: {
  active: OptViewKind;
  onSelect: (kind: OptViewKind) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Optimization views"
      // Same skin as the PhasePage algorithm tablist directly above it: one
      // hairline under the row, the current view on an accent rule cut into it.
      // Two stacked tab rows must read as one system, not two.
      className="-mb-px flex flex-wrap items-center gap-x-1 border-b border-line"
    >
      {VIEWS.map((v) => {
        const selected = v.kind === active;
        return (
          <button
            key={v.kind}
            type="button"
            role="tab"
            aria-selected={selected}
            title={v.hint}
            onClick={() => onSelect(v.kind)}
            className={clsx(
              'h-11 cursor-pointer px-2 text-sm whitespace-nowrap transition-colors duration-[var(--dur-fast)] sm:px-2.5',
              selected
                ? 'border-b-2 border-accent font-semibold text-ink'
                : 'border-b-2 border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Pass rail ────────────────────────────────────────────────────────────────

export interface PassStat {
  before: number;
  after: number;
  changes: number;
  ran: boolean;
}

function deltaText(stat: PassStat | undefined): string {
  if (!stat) return '—';
  const d = stat.after - stat.before;
  if (d === 0) return '±0';
  return d > 0 ? `+${d}` : `−${-d}`;
}

/** The pipeline as a numbered sequence, bracketed by its quad counts. */
export function PassRail({
  selected,
  onSelect,
  stats,
  inputQuads,
  outputQuads,
}: {
  selected: PassId;
  onSelect: (pass: PassId) => void;
  stats: Partial<Record<PassId, PassStat>>;
  inputQuads: number;
  outputQuads: number;
}) {
  return (
    <div className="artifact-scroll border-y border-line">
      <div
        role="tablist"
        aria-label="Optimization passes, in applied order"
        className="flex min-w-max items-stretch"
      >
        <Endcap label="TAC in" value={`${inputQuads} quads`} />
        {PASS_LIST.map((pass, i) => {
          const stat = stats[pass.id];
          const isSelected = pass.id === selected;
          const delta = deltaText(stat);
          const shrank = stat !== undefined && stat.after < stat.before;
          const grew = stat !== undefined && stat.after > stat.before;
          return (
            <button
              key={pass.id}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-label={pass.label}
              // What the pass does, and what it did here, are a hover away —
              // never standing on the page.
              title={`${pass.label}. ${pass.blurb}. ${
                stat ? `${stat.changes} rewrites, ${delta} instructions` : 'not run'
              }.`}
              onClick={() => onSelect(pass.id)}
              className={controlClass(
                isSelected,
                'flex min-h-11 flex-col justify-center gap-0.5 border-l border-line px-3.5 py-2 text-left',
              )}
            >
              <span className="flex items-baseline gap-2">
                <span
                  className={clsx(
                    'font-mono type-code tabular-nums',
                    isSelected ? 'text-accent' : 'text-ink-faint',
                  )}
                >
                  {i + 1}
                </span>
                <span
                  className={clsx(
                    'font-mono text-xs',
                    isSelected ? 'font-semibold text-ink' : 'text-ink-muted',
                  )}
                >
                  {pass.short}
                </span>
              </span>
              <span className="flex items-baseline gap-2 font-mono text-2xs">
                <span
                  className={clsx(
                    'tabular-nums',
                    shrank ? 'text-ok' : grew ? 'text-warn' : 'text-ink-faint',
                  )}
                >
                  {delta}
                </span>
                <span className="text-ink-faint">{stat ? `${stat.changes} rw` : 'not run'}</span>
              </span>
            </button>
          );
        })}
        <Endcap label="TAC out" value={`${outputQuads} quads`} leadingRule />
      </div>
    </div>
  );
}

function Endcap({
  label,
  value,
  leadingRule = false,
}: {
  label: string;
  value: string;
  leadingRule?: boolean;
}) {
  return (
    <div
      className={clsx(
        'flex min-h-11 flex-col justify-center px-3.5 py-2',
        leadingRule && 'border-l border-line',
      )}
    >
      <span className="group-label">{label}</span>
      <span className="font-mono text-xs text-ink-muted tabular-nums">{value}</span>
    </div>
  );
}

// ── Analysis picker ──────────────────────────────────────────────────────────

const GROUP_LABEL: Record<'structure' | 'dataflow' | 'loops', string> = {
  structure: '§8.4',
  dataflow: '§9.2',
  loops: '§9.6',
};

export function AnalysisPicker({
  selected,
  onSelect,
}: {
  selected: AnalysisId;
  onSelect: (analysis: AnalysisId) => void;
}) {
  const groups: Array<'structure' | 'dataflow' | 'loops'> = ['structure', 'dataflow', 'loops'];
  return (
    <div
      role="tablist"
      aria-label="Analyses"
      className="flex flex-wrap items-center gap-x-6 gap-y-1"
    >
      {groups.map((group) => (
        <div key={group} className="flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="mr-1 font-mono text-2xs text-ink-faint">{GROUP_LABEL[group]}</span>
          {ANALYSIS_LIST.filter((a) => a.group === group).map((a) => {
            const isSelected = a.id === selected;
            return (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                title={a.blurb}
                onClick={() => onSelect(a.id)}
                className={controlClass(
                  isSelected,
                  'flex h-11 items-center rounded-sm px-2.5 text-sm' +
                    (isSelected ? ' font-semibold' : ''),
                )}
              >
                {a.short}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Function picker ──────────────────────────────────────────────────────────

export function FunctionPicker({
  functions,
  selected,
  onSelect,
  label = 'TAC function',
}: {
  functions: readonly string[];
  selected: string;
  onSelect: (name: string) => void;
  label?: string;
}) {
  if (functions.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
      <span className="group-label mr-1">{label}</span>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1">
        {functions.map((name) => {
          const isSelected = name === selected;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelect(name)}
              className={controlClass(
                isSelected,
                'flex h-11 items-center rounded-sm px-2.5 font-mono text-xs' +
                  (isSelected ? ' font-semibold' : ''),
              )}
            >
              {name}()
            </button>
          );
        })}
      </div>
    </div>
  );
}
