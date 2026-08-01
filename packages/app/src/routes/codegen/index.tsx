/**
 * /codegen — Code Generation (§8.2–8.9).
 *
 * Six tabs in pipeline order, each replaying exactly one recorded trace kind
 * from `worker/trace-kinds.ts`:
 *
 *   Select   codegen.isel          quad → x86-64 tile
 *   Liveness codegen.liveness      backward live-variable analysis
 *   Graph    codegen.interference  interference-graph construction
 *   Color    codegen.color         Kempe/Chaitin simplify–select + spilling
 *   Assembly codegen.emit          final AT&T listing with provenance
 *   Run      codegen.exec          the emitted program, executed
 *
 * Deep links: `?tab=` selects the stage, `?k=` the number of registers offered
 * to the allocator, `?step=` seeks inside the active trace. `?algo=` from the
 * shared phase metadata (select / liveness / color) is accepted as an alias.
 */
import { useCallback, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { ArrowLeft, ChevronRight, Cpu, PlayCircle } from 'lucide-react';
import { PHASES, phaseInfo } from '../../lib/phases';
import { useCompilationStore, stageInfo } from '../../store/compilation';
import { STATUS_META, StatusIcon } from '../../components/StatusBadge';
import { CodeStrip } from '../../components/viz/CodeStrip';
import { usePhaseUrlState } from '../../lib/urlState';
import { DiagnosticList, Notice } from './shared';
import { IselTab } from './tabs/IselTab';
import { LivenessTab } from './tabs/LivenessTab';
import { InterferenceTab } from './tabs/InterferenceTab';
import { ColorTab } from './tabs/ColorTab';
import { AssemblyTab } from './tabs/AssemblyTab';
import { RunTab } from './tabs/RunTab';
import './codegen.css';

// ── tabs ────────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'isel', short: 'Select', label: 'Instruction selection' },
  { id: 'liveness', short: 'Liveness', label: 'Liveness' },
  { id: 'interference', short: 'Graph', label: 'Interference graph' },
  { id: 'color', short: 'Color', label: 'Register coloring' },
  { id: 'asm', short: 'Assembly', label: 'Assembly' },
  { id: 'run', short: 'Run', label: 'Run' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** `?algo=` values from lib/phases.tsx map onto the tabs they belong to. */
const ALGO_ALIAS: Record<string, TabId> = {
  select: 'isel',
  isel: 'isel',
  liveness: 'liveness',
  interference: 'interference',
  color: 'color',
  asm: 'asm',
  emit: 'asm',
  run: 'run',
  exec: 'run',
};

function isTabId(v: string | null): v is TabId {
  return v !== null && TABS.some((t) => t.id === v);
}

// ── route ───────────────────────────────────────────────────────────────────

export default function CodegenPhaseRoute() {
  const info = phaseInfo('codegen');
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const compiling = useCompilationStore((s) => s.compiling);
  const compile = useCompilationStore((s) => s.compile);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);

  const stage = stageInfo(compilation, stale, 'codegen', (c) => info.summary(c, pipeline));
  const statusMeta = STATUS_META[stage.status];

  // ?tab= and ?k= are phase-specific, but they go through the SAME writer as
  // ?algo=/?step=/?pass= so a selection can never race an in-flight step write.
  const url = usePhaseUrlState();
  const { param, int: intParam, setPhaseParamsNow } = url;
  const rawTab = param('tab');
  const rawAlgo = url.algo;
  const tab: TabId = isTabId(rawTab)
    ? rawTab
    : (rawAlgo !== null ? ALGO_ALIAS[rawAlgo] : undefined) ?? 'isel';

  const k = intParam('k', { min: 1, max: 8 });

  const selectTab = useCallback(
    (next: TabId) => {
      // A step index only means something inside one trace.
      setPhaseParamsNow({ tab: next, step: null });
    },
    [setPhaseParamsNow],
  );

  const setK = useCallback(
    (next: number | null) => {
      setPhaseParamsNow({ k: next, step: null });
    },
    [setPhaseParamsNow],
  );

  // Roving focus across the pipeline rail (tablist keyboard contract).
  const railRef = useRef<HTMLDivElement | null>(null);
  const refocusRail = useRef(false);
  const onRailKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (dir === 0) return;
      e.preventDefault();
      const i = TABS.findIndex((t) => t.id === tab);
      const next = TABS[(i + dir + TABS.length) % TABS.length];
      if (!next) return;
      refocusRail.current = true;
      selectTab(next.id);
    },
    [tab, selectTab],
  );

  // Keep focus on the newly selected tab after a keyboard move (roving tabindex
  // would otherwise strand it on the tab that just became unselected).
  useEffect(() => {
    if (!refocusRail.current) return;
    refocusRail.current = false;
    railRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [tab]);

  // Normalize a legacy/partial URL (?algo=color) into the canonical ?tab=.
  useEffect(() => {
    if (!isTabId(rawTab)) setPhaseParamsNow({ tab });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawTab]);

  const source = compilation?.source ?? null;

  const blockingDiagnostics = useMemo(() => {
    if (!compilation) return [];
    return compilation.diagnostics.filter((d) => d.severity === 'error' && d.phase !== 'codegen');
  }, [compilation]);

  const body = (() => {
    // ── no compilation yet ────────────────────────────────────────────────
    if (!compilation || source === null) {
      return (
        <section className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-line-strong bg-surface p-10 text-center">
          <Cpu aria-hidden className="size-8 text-ink-faint" strokeWidth={1.5} />
          <h2 className="text-base font-semibold text-ink">Compile a program to begin</h2>
          <p className="max-w-lg text-sm text-ink-muted">
            Code generation runs on the <em>optimized</em> three-address code, so it needs a
            successful scan, parse, semantic check and IR build first. Press Compile — every
            stage below then replays step by step, ending with the emitted assembly actually
            executing.
          </p>
          <button
            type="button"
            onClick={() => void compile()}
            disabled={compiling}
            className="flex h-11 cursor-pointer items-center gap-2 rounded-md border border-accent bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            <PlayCircle aria-hidden className="size-4.5" />
            {compiling ? 'Compiling…' : 'Compile'}
          </button>
          <p className="text-xs text-ink-faint">
            Or open the <Link to="/" className="underline underline-offset-2">overview</Link> to
            pick a different example first.
          </p>
        </section>
      );
    }

    // ── an upstream phase failed: nothing reached code generation ─────────
    if (compilation.optimized === null) {
      return (
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] lg:items-start">
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <Notice tone="error" title="Code generation never ran">
              <p className="text-sm">
                An earlier phase stopped the pipeline, so there is no optimized TAC to select
                instructions from. These are the diagnostics that blocked it:
              </p>
            </Notice>
            <DiagnosticList diagnostics={blockingDiagnostics} />
            {blockingDiagnostics.length === 0 && (
              <p className="text-sm text-ink-muted">
                No error diagnostics were recorded — the optimizer produced no output for this
                program. Try one of the bundled examples from the overview.
              </p>
            )}
          </div>
          <aside className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold tracking-tight text-ink-muted">Source</h3>
            <CodeStrip
              source={compilation.source}
              spans={blockingDiagnostics.map((d) => d.span)}
              maxHeight="28rem"
            />
          </aside>
        </div>
      );
    }

    // ── the real thing ────────────────────────────────────────────────────
    switch (tab) {
      case 'isel':
        return <IselTab source={source} compilation={compilation} />;
      case 'liveness':
        return <LivenessTab source={source} />;
      case 'interference':
        return <InterferenceTab source={source} />;
      case 'color':
        return <ColorTab source={source} k={k} onChangeK={setK} />;
      case 'asm':
        return <AssemblyTab source={source} compilation={compilation} />;
      case 'run':
        return <RunTab source={source} />;
    }
  })();

  const showRail = compilation !== null && compilation.optimized !== null;

  return (
    <div className="mx-auto flex w-full max-w-450 flex-1 flex-col gap-4 px-3 py-4 sm:px-5">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            to="/"
            className="flex h-9 items-center gap-1 rounded-md px-2 text-sm text-ink-muted transition-colors hover:bg-raised hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-4" />
            Overview
          </Link>
          <span aria-hidden className="h-5 w-px bg-line" />
          {/* Same shape as components/PhasePage's h1, ordinal included. */}
          <h1 className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
            <Cpu
              aria-hidden
              className="size-5 shrink-0 translate-y-0.5 text-accent"
              strokeWidth={2}
            />
            <span>
              <span aria-hidden className="mr-1.5 font-mono text-sm font-normal text-ink-faint">
                {PHASES.findIndex((p) => p.phase === 'codegen') + 1}/{PHASES.length}
              </span>
              {info.title}
            </span>
          </h1>
          <span
            className={clsx(
              'flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium',
              statusMeta.chip,
            )}
          >
            <StatusIcon status={stage.status} />
            {statusMeta.label}
            {stage.summary && (
              <>
                <span aria-hidden className="text-ink-faint">
                  ·
                </span>
                <span className="font-mono">{stage.summary}</span>
              </>
            )}
          </span>
        </div>
        <p className="max-w-3xl text-sm text-ink-muted">{info.blurb}</p>

        {showRail && (
          <div
            ref={railRef}
            role="tablist"
            aria-label="Code generation stages"
            onKeyDown={onRailKeyDown}
            className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1"
          >
            {TABS.map((t, i) => {
              const selected = t.id === tab;
              return (
                <div key={t.id} role="presentation" className="flex shrink-0 items-center">
                  {i > 0 && (
                    <ChevronRight aria-hidden className="mx-0.5 size-3.5 text-ink-faint" />
                  )}
                  <button
                    type="button"
                    role="tab"
                    id={`cg-tab-${t.id}`}
                    aria-selected={selected}
                    aria-controls="cg-tabpanel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectTab(t.id)}
                    className={clsx(
                      'flex h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-xs font-medium whitespace-nowrap transition-colors',
                      selected
                        ? 'border-accent bg-accent-soft text-ink'
                        : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
                    )}
                  >
                    <span
                      aria-hidden
                      className={clsx(
                        'flex size-5 items-center justify-center rounded-full border font-mono text-[10px]',
                        selected ? 'border-accent text-ink' : 'border-line-strong text-ink-faint',
                      )}
                    >
                      {i + 1}
                    </span>
                    {t.label}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </header>

      {stale && compilation && (
        <Notice tone="warn" title="Stale — the source changed since this compilation">
          <p className="text-sm">
            Every stage below still replays the previously compiled program. Recompile from the
            overview to regenerate the code.
          </p>
        </Notice>
      )}

      <div
        id="cg-tabpanel"
        role={showRail ? 'tabpanel' : undefined}
        aria-labelledby={showRail ? `cg-tab-${tab}` : undefined}
        className="flex-1"
      >
        {body}
      </div>
    </div>
  );
}
