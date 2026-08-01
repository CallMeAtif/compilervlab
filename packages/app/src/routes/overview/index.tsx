/**
 * '/' — the front door: title, editor, diagnostics, pipeline.
 *
 * It is deliberately short. The three-step "01 pick / 02 compile / 03 step"
 * strip and the paragraph explaining what a trace is are gone — the picker, the
 * Compile button and the six stage links say all of it by being on screen.
 * Every count in the pipeline is the REAL artifact size of the compilation
 * currently loaded; a stage with nothing compiled says so.
 */
import { useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { EditorView } from '@codemirror/view';
import * as Select from '@radix-ui/react-select';
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Hammer,
  Lightbulb,
  Loader2,
  ScrollText,
} from 'lucide-react';
import { clsx } from 'clsx';
import type { Diagnostic, Phase } from '@lab/core';
import type { SourceSpan } from '@lab/trace';
import { useCompilationStore, stageInfo, type StageStatus } from '../../store/compilation';
import { EXAMPLES, exampleById } from '../../examples';
import { PHASES } from '../../lib/phases';
import { useTheme } from '../../lib/theme';
import { STATUS_META, StatusIcon, StatusMark } from '../../components/StatusBadge';

// ── Stale banner ─────────────────────────────────────────────────────────────

function StaleBanner() {
  const stale = useCompilationStore((s) => s.stale);
  const compiling = useCompilationStore((s) => s.compiling);
  const compile = useCompilationStore((s) => s.compile);
  if (!stale) return null;
  return (
    // A marginal note behind a dashed warn rule — dashed IS the warn signifier,
    // so this reads the same in greyscale without being a loud box.
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-dashed border-warn py-1 pl-3 text-sm text-warn"
    >
      <Clock aria-hidden className="size-4 shrink-0" />
      <span className="min-w-40 flex-1 leading-relaxed">
        The source changed since the last compile. Phase views show the previous program.
      </span>
      <button
        type="button"
        onClick={() => void compile()}
        disabled={compiling}
        className="h-11 shrink-0 cursor-pointer border-b border-warn px-1 text-sm font-semibold text-warn transition-colors duration-[var(--dur-fast)] hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
      >
        Recompile
      </button>
    </div>
  );
}

// ── Example picker ───────────────────────────────────────────────────────────

function ExamplePicker() {
  const selectedExample = useCompilationStore((s) => s.selectedExample);
  const selectExample = useCompilationStore((s) => s.selectExample);
  const selected = exampleById(selectedExample);
  return (
    <Select.Root value={selectedExample} onValueChange={selectExample}>
      <Select.Trigger
        aria-label="Start from an example program"
        // A field: its >= 3:1 boundary is the rule under it, not a box.
        className="flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 border-b border-control px-1 text-sm text-ink transition-colors duration-[var(--dur-fast)] hover:border-accent sm:min-w-64 sm:flex-none"
      >
        <span className="truncate font-mono">{selected?.name ?? 'Your program'}</span>
        <Select.Icon>
          <ChevronDown aria-hidden className="size-4 text-ink-muted" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="overlay-panel z-50 w-(--radix-select-trigger-width) min-w-72 rounded-md p-1"
        >
          <Select.Viewport>
            {EXAMPLES.map((e) => (
              <Select.Item
                key={e.id}
                value={e.id}
                className="cursor-pointer rounded px-2 py-2 outline-none select-none data-[highlighted]:bg-accent-soft data-[highlighted]:shadow-[inset_2px_0_0_var(--accent)]"
              >
                <div className="flex items-center gap-2">
                  <Select.ItemText>
                    <span className="font-mono text-sm text-ink">{e.name}</span>
                  </Select.ItemText>
                  <Select.ItemIndicator>
                    <Check aria-hidden className="size-3.5 text-accent" />
                  </Select.ItemIndicator>
                </div>
                <p className="mt-0.5 text-sm text-ink-muted">{e.description}</p>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// ── Pipeline diagram ─────────────────────────────────────────────────────────

/**
 * What each phase hands the next one. Short enough to sit on a connector at
 * 1280px without wrapping; the long form is the `title`.
 */
const HANDOFF: Partial<Record<Phase, { short: string; long: string }>> = {
  lex: { short: 'tokens', long: 'a token stream and a symbol table' },
  syntax: { short: 'AST', long: 'an abstract syntax tree' },
  semantic: { short: 'typed AST', long: 'the AST annotated with types and resolved names' },
  ir: { short: 'TAC', long: 'three-address code (quadruples)' },
  opt: { short: 'opt. TAC', long: 'optimised three-address code' },
};

/**
 * What each stage does. NOT set as standing copy under the six names — six
 * taglines is a paragraph the reader has to cross every visit. It rides on the
 * link instead, as its tooltip and part of its accessible name.
 */
const TAGLINE: Record<Phase, string> = {
  lex: 'Regex → NFA → DFA, then scan the source.',
  syntax: 'FIRST/FOLLOW, LL(1) and LR tables, live parse.',
  semantic: 'Scopes, symbol tables, type checking.',
  ir: 'Quadruples, triples, indirect triples.',
  opt: 'Basic blocks, dataflow, classic passes.',
  codegen: 'x86-64 selection, liveness, register colouring.',
};

/** The status vocabulary, stated once so the six phases never have to. */
/** The status marks, one interaction away — the same `> key` every route uses. */
function StatusLegend() {
  const order: readonly StageStatus[] = ['ok', 'errors', 'stale', 'pending'];
  return (
    <details className="group min-w-0">
      <summary className="flex h-8 w-fit cursor-pointer list-none items-center gap-1 rounded-sm font-mono text-2xs text-ink-faint transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform duration-[var(--dur-fast)] group-open:rotate-90 motion-reduce:transition-none"
        />
        key
      </summary>
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
        {order.map((s) => (
          <li key={s} className="flex items-center gap-1.5 font-mono text-2xs text-ink-faint">
            <StatusMark status={s} />
            {STATUS_META[s].label}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The connector between two stages. This is what makes the row read as a
 * pipeline rather than as six unrelated cards: it names the artifact that
 * actually crosses the boundary, and draws the flow line it crosses on.
 */

function PipelineDiagram() {
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);
  return (
    <section aria-labelledby="pipeline-heading" className="section mt-10">
      <div className="section-head">
        <h2 id="pipeline-heading" className="section-title">
          Pipeline
        </h2>
        <StatusLegend />
      </div>

      {/*
       * Reads as a pipeline, not a table: ONE unbroken rule runs the whole
       * width, each stage hangs off it as an equal column, and the artifact
       * handed to the next stage is printed on the rule at the boundary the
       * handoff actually happens. Previously each stage carried its own short
       * rule with an arrow floating in a gutter, which made six ragged blocks.
       */}
      <ol className="mt-4 grid grid-cols-1 gap-y-5 sm:grid-cols-2 xl:grid-cols-6 xl:gap-y-0">
        {PHASES.map((p, i) => {
          const info = stageInfo(compilation, stale, p.phase, (c) => p.summary(c, pipeline));
          const meta = STATUS_META[info.status];
          const handoff = HANDOFF[p.phase];
          const compiled = info.status !== 'pending';
          return (
            <li key={p.phase} className="relative flex min-w-0">
              <Link
                to={p.path}
                title={TAGLINE[p.phase]}
                aria-label={`Phase ${i + 1} of ${PHASES.length}: ${p.title}. ${
                  info.summary ?? meta.label
                }. ${TAGLINE[p.phase]}`}
                className="group flex min-w-0 flex-1 flex-col gap-1 border-t-2 border-line pt-2 pr-5 pb-1 transition-colors duration-[var(--dur-fast)] hover:border-accent"
              >
                <span className="flex items-baseline gap-2">
                  <span aria-hidden className="font-mono text-2xs text-ink-faint tabular-nums">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-serif text-base font-semibold text-ink group-hover:text-accent">
                    {p.short}
                  </span>
                  <StatusMark status={info.status} />
                </span>
                {/*
                 * Before compiling, six repetitions of "not yet compiled" was
                 * the loudest thing on the page while saying nothing. An em
                 * dash holds the row; the state is already on the heading.
                 */}
                <span
                  className={clsx(
                    'font-mono text-2xs break-words tabular-nums',
                    // A healthy stage states its numbers quietly; colour is
                    // spent only where the status needs the reader's attention.
                    compiled && info.status === 'ok' ? 'text-ink-muted' : meta.text,
                  )}
                  title={info.summary ?? meta.label}
                >
                  {compiled ? (info.summary ?? meta.label) : '—'}
                </span>
              </Link>

              {/* The artifact, printed on the rule where it is handed over. */}
              {handoff && (
                <span
                  title={handoff.long}
                  /*
                   * `z-10`, or the rule strikes through the word. The label
                   * straddles the boundary (`translate-x-1/2`), so its right
                   * half lies over the NEXT `<li>` — and that `<li>` is
                   * `position: relative` too, so at `z-index: auto` its own
                   * `border-t-2` paints AFTER this absolutely-positioned span
                   * and drew a line through "AST", "TAC" and "opt. TAC".
                   * Raising the label puts it above the rule it knocks out.
                   */
                  className="pointer-events-none absolute -top-2 right-0 z-10 hidden translate-x-1/2 bg-surface px-1.5 font-mono text-3xs whitespace-nowrap text-ink-faint xl:block"
                >
                  <span className="sr-only">produces </span>
                  {handoff.short} <span aria-hidden>›</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── Diagnostics ──────────────────────────────────────────────────────────────

function DiagnosticCard({ d, onJump }: { d: Diagnostic; onJump: (span: SourceSpan) => void }) {
  const isError = d.severity === 'error';
  return (
    <button
      type="button"
      onClick={() => onJump(d.span)}
      title="Jump to this span in the editor"
      className={clsx(
        // Entries in a list of findings: a rule in the margin (solid for an
        // error, DASHED for a warning) instead of a filled box.
        'w-full cursor-pointer border-l-2 py-1.5 pl-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-raised',
        isError ? 'border-err' : 'border-dashed border-warn',
      )}
    >
      <div className="flex items-start gap-2">
        <CircleAlert
          aria-hidden
          className={clsx('mt-1 size-4 shrink-0', isError ? 'text-err' : 'text-warn')}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-relaxed text-ink">
            {/* severity as a word, not only as a colour */}
            <span className={clsx('font-semibold', isError ? 'text-err' : 'text-warn')}>
              {isError ? 'Error: ' : 'Warning: '}
            </span>
            {d.message}
            <span className="ml-2 font-mono text-2xs whitespace-nowrap text-ink-faint">
              [{d.phase}] line {d.span.line}:{d.span.col}
            </span>
          </p>
          {d.rule && (
            <p className="mt-0.5 flex items-start gap-1.5 text-sm text-ink-muted">
              <ScrollText aria-hidden className="mt-1 size-3.5 shrink-0" />
              {d.rule}
            </p>
          )}
          {d.hint && (
            <p className="mt-0.5 flex items-start gap-1.5 text-sm text-ink-muted">
              <Lightbulb aria-hidden className="mt-1 size-3.5 shrink-0" />
              {d.hint}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}

function DiagnosticsPanel({ onJump }: { onJump: (span: SourceSpan) => void }) {
  const compilation = useCompilationStore((s) => s.compilation);
  const compileError = useCompilationStore((s) => s.compileError);

  const errors = compilation?.diagnostics.filter((d) => d.severity === 'error').length ?? 0;
  const warnings = (compilation?.diagnostics.length ?? 0) - errors;

  return (
    <section aria-labelledby="diagnostics-heading" className="section">
      {/* The region's accessible name is the title ALONE — the counts live in
          the meta slot beside it, so "Diagnostics" never drifts. */}
      <div className="section-head">
        <h2 id="diagnostics-heading" className="section-title">
          Diagnostics
        </h2>
        {compilation && compilation.diagnostics.length > 0 && (
          <span className="section-meta">
            {errors > 0 && (
              <span className="text-err">
                {errors} error{errors === 1 ? '' : 's'}
              </span>
            )}
            {errors > 0 && warnings > 0 && <span> · </span>}
            {warnings > 0 && (
              <span className="text-warn">
                {warnings} warning{warnings === 1 ? '' : 's'}
              </span>
            )}
          </span>
        )}
      </div>
      <div role="status" className="flex flex-col gap-3">
        {compileError && (
          <p className="border-l-2 border-err pl-3 text-sm leading-relaxed text-err">
            Compiler crashed: {compileError}
          </p>
        )}
        {!compilation && !compileError && (
          <p className="prose-note">Nothing compiled yet.</p>
        )}
        {compilation && compilation.diagnostics.length === 0 && (
          <p className="prose-note flex items-baseline gap-2">
            <StatusIcon status="ok" className="translate-y-0.5" />
            No diagnostics.
          </p>
        )}
        {compilation?.diagnostics.map((d, i) => (
          <DiagnosticCard key={i} d={d} onJump={onJump} />
        ))}
      </div>
    </section>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function OverviewRoute() {
  const { theme } = useTheme();
  const source = useCompilationStore((s) => s.source);
  const setSource = useCompilationStore((s) => s.setSource);
  const compiling = useCompilationStore((s) => s.compiling);
  const compile = useCompilationStore((s) => s.compile);

  const editorRef = useRef<EditorView | null>(null);

  const jumpToSpan = useCallback((span: SourceSpan) => {
    const view = editorRef.current;
    if (!view) return;
    const docLen = view.state.doc.length;
    const from = Math.min(span.start, docLen);
    const to = Math.min(span.end, docLen);
    view.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    });
    view.focus();
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-450 flex-1 flex-col px-3 py-4 sm:px-5">
      {/* The one band above the content: the wordmark, and nothing else.
          docs/EDITORIAL.md budgets a page subtitle at zero words. */}
      <header className="pb-5">
        <h1 className="page-title">Compiler Virtual Lab</h1>
      </header>

      <div className="grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-2">
        {/* editor column */}
        <section aria-label="Your C program" className="flex min-w-0 flex-col">
          <StaleBanner />

          <div className="flex items-baseline justify-between gap-3 pb-2">
            <h2 className="section-title">Your program</h2>
            <span className="section-meta">editable · or start from an example</span>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3">
            <ExamplePicker />
            <span className="hidden flex-1 sm:block" />
            <button
              type="button"
              onClick={() => void compile()}
              disabled={compiling}
              className="flex h-11 flex-1 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-sm bg-accent px-5 text-sm font-semibold text-on-accent transition-colors duration-[var(--dur-fast)] hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            >
              {compiling ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Hammer aria-hidden className="size-4" />
              )}
              {compiling ? 'Compiling…' : 'Compile'}
            </button>
          </div>

          <div className="framed overflow-hidden bg-code">
            <CodeMirror
              value={source}
              onChange={setSource}
              theme={theme}
              extensions={[cpp()]}
              height="30rem"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                bracketMatching: true,
                autocompletion: false,
              }}
              onCreateEditor={(view) => {
                editorRef.current = view;
              }}
              aria-label="C source code"
            />
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            {/*
              WCAG 2.1.2 stays on screen: inside the editor Tab indents rather
              than moving focus, so the way OUT cannot hide behind a disclosure.
            */}
            <p className="text-ink-faint">
              <kbd className="font-mono text-xs text-ink">Esc</kbd> then{' '}
              <kbd className="font-mono text-xs text-ink">Tab</kbd> leaves the editor.
            </p>
            {/* Reference material, one interaction away. */}
            <details className="min-w-0 text-ink-faint">
              <summary className="w-fit cursor-pointer font-mono text-2xs tracking-[0.08em] text-ink-muted uppercase hover:text-ink">
                C subset
              </summary>
              <p className="prose-note mt-1 text-sm">
                int, float, char, void, arrays, pointers, functions, if, while, for. Compiling
                is always explicit.
              </p>
            </details>
          </div>
        </section>

        {/* diagnostics column */}
        <div className="flex min-w-0 flex-col">
          <DiagnosticsPanel onJump={jumpToSpan} />
        </div>
      </div>

      <PipelineDiagram />
    </div>
  );
}
