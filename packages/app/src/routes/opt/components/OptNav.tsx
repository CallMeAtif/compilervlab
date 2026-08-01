/**
 * Navigation for the optimization phase: the view switch, the ordered pass
 * pipeline rail (with per-pass instruction deltas), the analysis picker, and
 * the TAC function picker. Every control is a ≥44px target and announces its
 * selection through aria, not colour.
 */
import { clsx } from 'clsx';
import { ArrowRight, CircleDot, Circle, Sigma } from 'lucide-react';
import {
  ANALYSIS_LIST,
  PASS_LIST,
  type AnalysisId,
  type OptViewKind,
  type PassId,
} from '../lib/optModel';

// ── View switch ──────────────────────────────────────────────────────────────

const VIEWS: Array<{ kind: OptViewKind; label: string; hint: string }> = [
  { kind: 'pass', label: 'Passes', hint: 'One optimization pass at a time, with its diff' },
  { kind: 'analysis', label: 'Analyses', hint: 'Blocks, flow graph, data flow, dominators, loops' },
  { kind: 'pipeline', label: 'Whole pipeline', hint: 'All six passes in applied order' },
];

export function ViewTabs({
  active,
  onSelect,
}: {
  active: OptViewKind;
  onSelect: (kind: OptViewKind) => void;
}) {
  return (
    <div role="tablist" aria-label="Optimization views" className="flex flex-wrap gap-1.5">
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
              'flex h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
              selected
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
            )}
          >
            {selected ? (
              <CircleDot aria-hidden className="size-3.5 text-accent" />
            ) : (
              <Circle aria-hidden className="size-3.5 text-ink-faint" />
            )}
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
    <div className="overflow-x-auto">
      <div
        role="tablist"
        aria-label="Optimization passes, in applied order"
        className="flex min-w-max items-stretch gap-1.5 py-1"
      >
        <Endcap label="TAC in" value={`${inputQuads} quads`} />
        {PASS_LIST.map((pass, i) => {
          const stat = stats[pass.id];
          const isSelected = pass.id === selected;
          const delta = deltaText(stat);
          return (
            <div key={pass.id} className="flex items-center gap-1.5">
              <ArrowRight aria-hidden className="size-3.5 shrink-0 text-ink-faint" />
              <button
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-label={`${pass.label}: ${stat ? `${stat.changes} rewrites, ${delta} instructions` : 'not run'}`}
                onClick={() => onSelect(pass.id)}
                className={clsx(
                  'flex min-h-11 cursor-pointer flex-col items-start justify-center gap-0.5 rounded-md border px-3 py-1.5 text-left transition-colors',
                  isSelected
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                )}
              >
                <span className="flex items-center gap-1.5 font-mono text-xs font-semibold">
                  {isSelected && <CircleDot aria-hidden className="size-3 text-accent" />}
                  <span className="text-ink-faint">{i + 1}.</span>
                  {pass.short}
                </span>
                <span className="flex items-center gap-1.5 font-mono text-[11px]">
                  <span
                    className={clsx(
                      'rounded-sm border px-1',
                      stat && stat.after < stat.before
                        ? 'border-ok/50 text-ok'
                        : stat && stat.after > stat.before
                          ? 'border-warn/50 text-warn'
                          : 'border-line text-ink-faint',
                    )}
                  >
                    {delta}
                  </span>
                  <span className="text-ink-faint">
                    {stat ? `${stat.changes} rw` : 'not run'}
                  </span>
                </span>
              </button>
            </div>
          );
        })}
        <ArrowRight aria-hidden className="size-3.5 shrink-0 self-center text-ink-faint" />
        <Endcap label="TAC out" value={`${outputQuads} quads`} />
      </div>
    </div>
  );
}

function Endcap({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-11 flex-col items-start justify-center rounded-md border border-dashed border-line-strong px-3 py-1.5">
      <span className="text-[11px] tracking-wide text-ink-faint uppercase">{label}</span>
      <span className="font-mono text-xs text-ink-muted">{value}</span>
    </div>
  );
}

// ── Analysis picker ──────────────────────────────────────────────────────────

const GROUP_LABEL: Record<'structure' | 'dataflow' | 'loops', string> = {
  structure: '§8.4 structure',
  dataflow: '§9.2 data flow',
  loops: '§9.6 dominators & loops',
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
    <div role="tablist" aria-label="Analyses" className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {groups.map((group) => (
        <div key={group} className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-[11px] tracking-wide text-ink-faint uppercase">
            <Sigma aria-hidden className="size-3" />
            {GROUP_LABEL[group]}
          </span>
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
                className={clsx(
                  'flex h-11 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition-colors',
                  isSelected
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {isSelected && <CircleDot aria-hidden className="size-3 text-accent" />}
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
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] tracking-wide text-ink-faint uppercase">{label}</span>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-1.5">
        {functions.map((name) => {
          const isSelected = name === selected;
          return (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={isSelected}
              onClick={() => onSelect(name)}
              className={clsx(
                'flex h-11 cursor-pointer items-center rounded-md border px-3 font-mono text-xs transition-colors',
                isSelected
                  ? 'border-accent bg-accent-soft text-ink'
                  : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
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
