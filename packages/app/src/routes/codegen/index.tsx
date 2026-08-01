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
import { ArrowLeft } from 'lucide-react';
import { useCompilationStore, stageInfo } from '../../store/compilation';
import { CompileCta } from '../../components/CompileCta';
import { STATUS_META, StatusIcon } from '../../components/StatusBadge';
import { phaseInfo } from '../../lib/phases';
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
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);

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
        <section className="section max-w-2xl py-6">
          <h2 className="state-title">Nothing compiled yet</h2>
          <p className="prose-note mt-3">Compile to generate and run the code.</p>
          {/* The one cold-start button in the app (components/CompileCta), so
              /codegen's empty state is the same object as /ir's and /opt's. */}
          <CompileCta className="mt-5 flex flex-col items-start gap-2" />
        </section>
      );
    }

    // ── an upstream phase failed: nothing reached code generation ─────────
    if (compilation.optimized === null) {
      return (
        <div className="flex flex-col gap-8 lg:grid lg:grid-cols-[minmax(0,1.85fr)_minmax(0,1fr)] lg:items-start">
          <section className="section">
            <h2 className="state-title text-err">Code generation never ran</h2>
            <p className="prose-note mt-3">An earlier phase stopped the pipeline.</p>
            <hr className="rule" />
            <DiagnosticList diagnostics={blockingDiagnostics} />
            {blockingDiagnostics.length === 0 && (
              <p className="prose-note">No diagnostics recorded.</p>
            )}
          </section>
          <aside className="section">
            <header className="section-head">
              <h2 className="section-title">Source</h2>
            </header>
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

  const info = phaseInfo('codegen');
  const Icon = info.icon;
  const stage = stageInfo(compilation, stale, 'codegen', (c) => info.summary(c, pipeline));
  const statusMeta = STATUS_META[stage.status];

  return (
    <div className="mx-auto flex w-full max-w-450 flex-1 flex-col px-3 py-4 sm:px-5">
      {/* ONE band of chrome above the content: back link, title and status on a
          single line, with the stage rail directly under it. No running head
          above the title, and no page subtitle — the title says what this is. */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link
            to="/"
            className="-ml-1 flex h-8 shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-2xs tracking-[0.1em] text-ink-muted uppercase transition-colors hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            Overview
          </Link>
          <h1 className="page-title flex items-baseline gap-2.5">
            <Icon
              aria-hidden
              className="size-5 shrink-0 translate-y-0.5 text-ink-faint"
              strokeWidth={1.75}
            />
            {info.title}
          </h1>
          <span className={clsx('flex items-center gap-1.5 font-mono text-2xs', statusMeta.text)}>
            <StatusIcon status={stage.status} className="size-3" />
            {statusMeta.label}
            {stage.summary && (
              <>
                <span aria-hidden className="text-ink-faint">
                  ·
                </span>
                <span className="text-ink-muted">{stage.summary}</span>
              </>
            )}
          </span>
        </div>

        {showRail && (
          <div
            ref={railRef}
            role="tablist"
            aria-label="Code generation stages"
            onKeyDown={onRailKeyDown}
            // Same skin as the PhasePage algorithm tablist, plus the stage
            // ordinal: these six tabs ARE the pipeline, so they read as a
            // numbered sequence with the current stage on an accent rule.
            className="artifact-scroll -mb-px border-b border-line"
          >
            <div className="flex min-w-max items-center gap-x-1">
              {TABS.map((t, i) => {
                const selected = t.id === tab;
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    id={`cg-tab-${t.id}`}
                    aria-selected={selected}
                    aria-controls="cg-tabpanel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectTab(t.id)}
                    className={clsx(
                      'flex h-11 cursor-pointer items-center gap-2 px-2 text-sm whitespace-nowrap transition-colors duration-[var(--dur-fast)] sm:px-2.5',
                      selected
                        ? 'border-b-2 border-accent font-semibold text-ink'
                        : 'border-b-2 border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
                    )}
                  >
                    <span
                      aria-hidden
                      className={clsx(
                        'font-mono type-code tabular-nums',
                        selected ? 'text-accent' : 'text-ink-faint',
                      )}
                    >
                      {i + 1}
                    </span>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </header>

      {stale && compilation && (
        <Notice tone="warn" title="Stale: the source changed since this compile." className="mt-6" />
      )}

      <div
        id="cg-tabpanel"
        role={showRail ? 'tabpanel' : undefined}
        aria-labelledby={showRail ? `cg-tab-${tab}` : undefined}
        className="mt-8 min-w-0 flex-1"
      >
        {body}
      </div>
    </div>
  );
}
