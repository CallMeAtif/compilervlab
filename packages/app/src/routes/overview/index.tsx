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

import { PipelineDiagram } from '../../components/PipelineDiagram';

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
