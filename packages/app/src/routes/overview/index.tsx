/**
 * '/' — the lab bench and the landing screen.
 *
 * Three bands, in the order a first-time visitor needs them:
 *   1. What this is + what to do first (three numbered steps).
 *   2. The bench: source editor + Compile, with diagnostics beside it.
 *   3. The pipeline: how the six phases connect, annotated with the REAL
 *      artifact counts of the compilation currently loaded (never a
 *      placeholder number — a stage with nothing compiled says so).
 */
import { useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { EditorView } from '@codemirror/view';
import * as Select from '@radix-ui/react-select';
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
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
import { STATUS_META, StatusIcon } from '../../components/StatusBadge';

// ── Stale banner ─────────────────────────────────────────────────────────────

function StaleBanner() {
  const stale = useCompilationStore((s) => s.stale);
  const compiling = useCompilationStore((s) => s.compiling);
  const compile = useCompilationStore((s) => s.compile);
  if (!stale) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-warn bg-warn-soft px-3 py-2 text-sm text-warn"
    >
      <Clock aria-hidden className="size-4 shrink-0" />
      <span className="min-w-40 flex-1">
        The source changed since the last compile — every phase view shows the previous
        program until you recompile.
      </span>
      <button
        type="button"
        onClick={() => void compile()}
        disabled={compiling}
        className="h-11 shrink-0 cursor-pointer rounded-md border border-warn px-3 text-xs font-semibold text-warn transition-colors duration-[var(--dur-fast)] hover:bg-warn/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Recompile now
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
        aria-label="Example program"
        className="flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-md border border-control bg-surface px-3 text-sm text-ink transition-colors duration-[var(--dur-fast)] hover:bg-raised sm:min-w-56 sm:flex-none"
      >
        <span className="truncate font-mono">{selected?.name ?? 'Choose an example'}</span>
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
                <p className="mt-0.5 text-xs text-ink-muted">{e.description}</p>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

// ── Intro ────────────────────────────────────────────────────────────────────

const STEPS: readonly { title: string; body: string }[] = [
  {
    title: 'Pick a program',
    body: 'Load one of the bundled examples or type your own C, right here in the editor.',
  },
  {
    title: 'Press Compile',
    body: 'One explicit run of the whole pipeline. Editing never recompiles behind your back.',
  },
  {
    title: 'Step through a phase',
    body: 'Open any stage below and replay its algorithm one recorded step at a time.',
  },
];

function Intro() {
  return (
    <section
      aria-labelledby="intro-heading"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4 lg:flex-row lg:items-start lg:gap-8 lg:p-5"
    >
      <div className="min-w-0 lg:max-w-md">
        <h1
          id="intro-heading"
          className="text-xl font-semibold tracking-tight text-ink sm:text-2xl"
        >
          Compiler Virtual Lab
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
          A C program, compiled in front of you. Six phases, each one a recorded trace you can
          play, pause and scrub — the tables, automata and instruction listings are the real
          ones this compiler used, not illustrations of them.
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-faint">
          <BookOpen aria-hidden className="size-3.5 shrink-0" />
          Every step cites its section, figure or algorithm in the Dragon Book (2nd ed.).
        </p>
      </div>

      <ol className="grid min-w-0 flex-1 gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex min-w-0 gap-2.5">
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full border border-accent bg-accent-soft font-mono text-2xs font-semibold text-ink"
            >
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{s.title}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                {s.body}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </section>
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

/** One short line per stage — what it does, in the diagram itself. */
const TAGLINE: Record<Phase, string> = {
  lex: 'Regex → NFA → DFA, then scan the source.',
  syntax: 'FIRST/FOLLOW, LL(1) and LR tables, live parse.',
  semantic: 'Scopes, symbol tables, type checking.',
  ir: 'Quadruples, triples, indirect triples.',
  opt: 'Basic blocks, dataflow, classic passes.',
  codegen: 'x86-64 selection, liveness, register colouring.',
};

/** The status vocabulary, stated once so the six phases never have to. */
function StatusLegend() {
  const order: readonly StageStatus[] = ['ok', 'errors', 'stale', 'pending'];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {order.map((s) => (
        <li key={s} className="flex items-center gap-1.5 text-2xs text-ink-muted">
          <StatusIcon status={s} />
          {STATUS_META[s].label}
        </li>
      ))}
    </ul>
  );
}

/**
 * The connector between two stages. This is what makes the row read as a
 * pipeline rather than as six unrelated cards: it names the artifact that
 * actually crosses the boundary, and draws the flow line it crosses on.
 */
function Handoff({ short, long }: { short: string; long: string }) {
  return (
    <span
      title={long}
      className="flex shrink-0 items-center gap-2 py-1 pl-3 xl:w-16 xl:flex-col xl:justify-center xl:gap-0.5 xl:py-0 xl:pl-0"
    >
      <span className="font-mono text-2xs whitespace-nowrap text-ink-muted">
        <span className="sr-only">produces </span>
        {short}
      </span>
      <ArrowDown aria-hidden className="size-3.5 text-line-strong xl:hidden" />
      <span aria-hidden className="hidden w-full items-center xl:flex">
        <span className="h-px flex-1 bg-line-strong" />
        <ArrowRight className="-ml-1.5 size-3.5 text-line-strong" />
      </span>
    </span>
  );
}

function PipelineDiagram() {
  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);
  return (
    <section
      aria-labelledby="pipeline-heading"
      className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2
            id="pipeline-heading"
            className="text-sm font-semibold tracking-tight text-ink"
          >
            The pipeline — C source in, x86-64 assembly out
          </h2>
          <p className="mt-0.5 text-xs text-ink-muted">
            Each stage consumes what the one before it produced. Open a stage to step through
            its algorithms; the line under each name is that stage's real output for the
            program currently compiled.
          </p>
        </div>
        <StatusLegend />
      </div>

      <ol className="flex flex-col xl:flex-row xl:items-stretch">
        {PHASES.map((p, i) => {
          const info = stageInfo(compilation, stale, p.phase, (c) => p.summary(c, pipeline));
          const meta = STATUS_META[info.status];
          const handoff = HANDOFF[p.phase];
          const Icon = p.icon;
          return (
            <li
              key={p.phase}
              className="flex min-w-0 flex-1 flex-col xl:flex-row xl:items-stretch"
            >
              <Link
                to={p.path}
                aria-label={`Phase ${i + 1} of ${PHASES.length}: ${p.title}. ${
                  info.summary ?? meta.label
                }`}
                className={clsx(
                  'flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg border p-3 transition-colors duration-[var(--dur-fast)]',
                  meta.chip,
                  'hover:border-accent hover:ring-2 hover:ring-accent',
                )}
              >
                <span className="flex items-center gap-1">
                  <span
                    aria-hidden
                    className="flex size-5 shrink-0 items-center justify-center rounded-full border border-current font-mono text-3xs font-semibold"
                  >
                    {i + 1}
                  </span>
                  <Icon aria-hidden className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                    {p.short}
                  </span>
                  <StatusIcon status={info.status} />
                </span>
                {/* The artifact count wraps rather than truncating — the whole
                    point of this line is the real number. */}
                <span
                  className={clsx('font-mono text-2xs break-words', meta.text)}
                  title={info.summary ?? meta.label}
                >
                  {info.summary ?? meta.label}
                </span>
                <span className="mt-auto pt-1 text-2xs leading-relaxed text-ink-muted">
                  {TAGLINE[p.phase]}
                </span>
              </Link>
              {handoff && <Handoff short={handoff.short} long={handoff.long} />}
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
      className={clsx(
        'w-full cursor-pointer rounded-lg border p-3 text-left transition-colors duration-[var(--dur-fast)]',
        isError
          ? 'border-err/60 bg-err-soft hover:border-err hover:ring-2 hover:ring-err'
          : 'border-dashed border-warn/70 bg-warn-soft hover:border-warn hover:ring-2 hover:ring-warn',
      )}
    >
      <div className="flex items-start gap-2">
        <CircleAlert
          aria-hidden
          className={clsx('mt-0.5 size-4 shrink-0', isError ? 'text-err' : 'text-warn')}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {/* severity as a word, not only as a colour */}
            <span className={clsx('font-semibold', isError ? 'text-err' : 'text-warn')}>
              {isError ? 'Error: ' : 'Warning: '}
            </span>
            {d.message}
            <span className="ml-2 font-mono text-2xs text-ink-muted">
              [{d.phase}] line {d.span.line}:{d.span.col}
            </span>
          </p>
          {d.rule && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-ink-muted">
              <ScrollText aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {d.rule}
            </p>
          )}
          {d.hint && (
            <p className="mt-1 flex items-start gap-1.5 text-xs text-ink-muted">
              <Lightbulb aria-hidden className="mt-0.5 size-3.5 shrink-0" />
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
    <section aria-labelledby="diagnostics-heading" className="flex flex-col gap-2">
      <h2
        id="diagnostics-heading"
        className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold tracking-tight text-ink"
      >
        Diagnostics
        {compilation && compilation.diagnostics.length > 0 && (
          <span className="font-mono text-xs font-normal">
            {errors > 0 && (
              <span className="text-err">
                {errors} error{errors === 1 ? '' : 's'}
              </span>
            )}
            {errors > 0 && warnings > 0 && <span className="text-ink-muted"> · </span>}
            {warnings > 0 && (
              <span className="text-warn">
                {warnings} warning{warnings === 1 ? '' : 's'}
              </span>
            )}
            <span className="text-ink-muted"> — click one to jump to it in the editor</span>
          </span>
        )}
      </h2>
      <div role="status" className="flex flex-col gap-2">
        {compileError && (
          <div className="rounded-lg border border-err bg-err-soft p-3 text-sm text-err">
            Compiler crashed: {compileError}
          </div>
        )}
        {!compilation && !compileError && (
          <p className="rounded-lg border border-dashed border-line-strong p-4 text-sm text-ink-muted">
            Nothing compiled yet. Press <span className="font-semibold text-ink">Compile</span>{' '}
            and any lexical, syntax, semantic or later-phase diagnostic will appear here — each
            one citing the rule that failed and where.
          </p>
        )}
        {compilation && compilation.diagnostics.length === 0 && (
          <p className="flex items-center gap-2 rounded-lg border border-ok/60 bg-ok-soft p-3 text-sm text-ok">
            <CircleCheck aria-hidden className="size-4 shrink-0" />
            No diagnostics — the program is well-formed through every implemented phase.
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
    <div className="mx-auto flex w-full max-w-450 flex-1 flex-col gap-4 px-3 py-4 sm:px-5">
      <Intro />
      <StaleBanner />

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-2">
        {/* editor column */}
        <section aria-labelledby="editor-heading" className="flex min-w-0 flex-col gap-2">
          <h2 id="editor-heading" className="sr-only">
            Source editor
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <ExamplePicker />
            <span className="hidden flex-1 sm:block" />
            <button
              type="button"
              onClick={() => void compile()}
              disabled={compiling}
              className="flex h-11 flex-1 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border border-accent bg-accent px-5 text-sm font-semibold text-on-accent transition-colors duration-[var(--dur-fast)] hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
            >
              {compiling ? (
                <Loader2 aria-hidden className="size-4 animate-spin" />
              ) : (
                <Hammer aria-hidden className="size-4" />
              )}
              {compiling ? 'Compiling…' : 'Compile'}
            </button>
          </div>

          <div className="overflow-hidden rounded-lg border border-line bg-code">
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
          <p className="text-xs text-ink-muted">
            C subset: int / float / char / void, arrays, pointers, functions, if / while / for.
            Compiling is always explicit — edits never recompile behind your back.
          </p>
        </section>

        {/* diagnostics column */}
        <div className="flex min-w-0 flex-col gap-4">
          <DiagnosticsPanel onJump={jumpToSpan} />
        </div>
      </div>

      <PipelineDiagram />
    </div>
  );
}
