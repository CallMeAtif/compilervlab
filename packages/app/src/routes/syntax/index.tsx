/**
 * /syntax — the syntax-analysis bench.
 *
 * Two selectors drive everything, both in the URL: the GRAMMAR (?grammar=) and
 * the ALGORITHM (?algo=), plus ?step= and the algorithm-specific ?stage=,
 * ?table=, ?view=. Each algorithm replays exactly one worker trace; the page
 * owns the grammar (cheap) so the production rail is up before any trace lands.
 *
 * NOTE this route renders its own header instead of the shared
 * `components/PhasePage`: PhasePage draws an algorithm tab row from the seven
 * *planned* ids in lib/phases.tsx, and syntax has ten selectable algorithms
 * (the LL(1) table and the LL(1) parse are different traces, and so are the LR
 * item sets and the LR parse). The old ids (?algo=ll1, ?algo=lalr1, …) are
 * accepted as aliases.
 *
 * EDITORIAL (docs/EDITORIAL.md §0): ONE band of chrome above the content. Back
 * link, title, status and the grammar picker share one row; the algorithm rail
 * is the only nav; the citation is a marker, not a sentence. The page had seven
 * bands and three standing paragraphs before a reader reached a number.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import * as Select from '@radix-ui/react-select';
import { Link } from 'react-router-dom';
import { ArrowLeft, Check, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import { useCompilationStore, stageInfo } from '../../store/compilation';
import { phaseInfo } from '../../lib/phases';
import { STATUS_META, StatusIcon } from '../../components/StatusBadge';
import {
  ALGORITHMS,
  algoMeta,
  type AlgoId,
  type Lr1View as Lr1SubView,
  type LrTableChoice,
  type TransformStage,
} from './lib/algorithms';
import {
  GRAMMARS,
  augmentedFor,
  grammarFor,
  grammarMeta,
  leftRecursiveNonterminals,
  type GrammarId,
} from './lib/grammars';
import { useSyntaxUrl } from './lib/url';
import type { ViewContext } from './lib/view';
import { FirstFollowView } from './views/FirstFollowView';
import { Ll1TableView } from './views/Ll1TableView';
import { Ll1ParseView } from './views/Ll1ParseView';
import { RdView } from './views/RdView';
import { TransformsView } from './views/TransformsView';
import { Lr0View, Lr1View } from './views/ItemsView';
import { Lr1TableView, SlrView } from './views/TableTraceView';
import { LalrView } from './views/LalrView';
import { LrParseView } from './views/LrParseView';
import { UpstreamFailure } from './views/guards';

// ── Sentence input (study grammars) ─────────────────────────────────────────

function SentenceBar({
  grammarId,
  value,
  onCommit,
}: {
  grammarId: GrammarId;
  value: string;
  onCommit: (s: string) => void;
}) {
  const meta = grammarMeta(grammarId);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value, grammarId]);
  const dirty = draft.trim() !== value.trim();

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
      <label className="flex w-full max-w-2xl min-w-56 flex-1 flex-col gap-1">
        <span className="group-label">Sentence</span>
        <input
          type="text"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommit(draft.trim());
          }}
          onBlur={() => onCommit(draft.trim())}
          aria-label="Sentence to parse — whitespace-separated terminals"
          title="Whitespace-separated terminals"
          className="h-11 w-full rounded-sm border-b border-control bg-transparent px-1 font-mono text-code text-ink focus-visible:border-accent"
        />
      </label>
      <button
        type="button"
        onClick={() => onCommit(draft.trim())}
        disabled={!dirty}
        aria-label="Parse this sentence"
        className="h-11 cursor-pointer rounded-sm bg-accent px-3 text-xs font-semibold text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
        Parse
      </button>
      <button
        type="button"
        onClick={() => onCommit(meta.sample)}
        aria-label="Restore the textbook sentence"
        className="h-11 cursor-pointer rounded-sm px-2 text-xs font-semibold text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink hover:decoration-accent"
      >
        textbook example
      </button>
    </div>
  );
}

// ── Selectors ────────────────────────────────────────────────────────────────

function GrammarSelect({
  value,
  onChange,
}: {
  value: GrammarId;
  onChange: (id: GrammarId) => void;
}) {
  // The grammar's one-line description lives in the OPTION and in the trigger's
  // tooltip — never as standing body text under the picker.
  return (
    <Select.Root value={value} onValueChange={(v) => onChange(v as GrammarId)}>
      <Select.Trigger
        aria-label="Grammar"
        title={grammarMeta(value).blurb}
        className="flex h-11 min-w-56 cursor-pointer items-center justify-between gap-2 rounded-sm border-b border-control bg-transparent px-1 text-sm text-ink transition-colors hover:border-line-strong"
      >
        <Select.Value />
        <Select.Icon>
          <ChevronDown aria-hidden className="size-4 text-ink-faint" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content
          position="popper"
          sideOffset={4}
          className="overlay-panel z-50 max-w-md rounded-md p-1"
        >
          <Select.Viewport>
            {GRAMMARS.map((g) => (
              <Select.Item
                key={g.id}
                value={g.id}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm text-ink outline-none select-none data-[highlighted]:bg-accent-soft data-[highlighted]:shadow-[inset_2px_0_0_var(--accent)]"
              >
                <Select.ItemIndicator className="mt-0.5">
                  <Check aria-hidden className="size-3.5 text-accent" />
                </Select.ItemIndicator>
                <span className="flex min-w-0 flex-col">
                  <Select.ItemText>{g.label}</Select.ItemText>
                  <span className="text-xs text-ink-muted">{g.blurb}</span>
                </span>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

const FAMILY_LABEL: Record<string, string> = {
  grammar: 'Grammar',
  ll: 'Top-down (LL)',
  lr: 'Bottom-up (LR)',
};

/**
 * The ten algorithms, grouped by family, as ONE roving-tabindex tablist —
 * the same keyboard contract PhasePage gives the other five phases (WAI-ARIA
 * Authoring Practices): the rail is a single tab stop, Left/Right walk it in
 * visual order across family groups, Home/End jump to the ends, and focus
 * follows selection.
 */
function AlgorithmTabs({ value, onChange }: { value: AlgoId; onChange: (a: AlgoId) => void }) {
  const families = ['grammar', 'll', 'lr'] as const;
  const railRef = useRef<HTMLDivElement | null>(null);
  const refocus = useRef(false);

  // Visual order = family order, which is also the order ALGORITHMS is filtered
  // into below; deriving it once keeps the arrow keys and the DOM in step.
  const order = useMemo(
    () => families.flatMap((f) => ALGORITHMS.filter((a) => a.family === f).map((a) => a.id)),
    // `families` is a module-level constant tuple.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      const at = order.indexOf(value);
      if (at < 0) return;
      let next: number | null = null;
      if (e.key === 'ArrowRight') next = (at + 1) % order.length;
      else if (e.key === 'ArrowLeft') next = (at - 1 + order.length) % order.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = order.length - 1;
      if (next === null) return;
      e.preventDefault();
      const id = order[next];
      if (!id) return;
      refocus.current = true;
      onChange(id);
    },
    [order, value, onChange],
  );

  // Roving tabindex would otherwise strand focus on the tab that just lost it.
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    railRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  }, [value]);

  return (
    <div
      ref={railRef}
      role="tablist"
      aria-label="Syntax algorithms"
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      // ONE row. The three families keep their captions, set inline as mono
      // markers rather than stacked over the tabs — the caption line was a
      // second band of chrome for three words.
      className="-mb-px flex flex-wrap items-end gap-x-3 border-b border-line"
    >
      {families.map((f) => (
        <div key={f} role="presentation" className="flex flex-wrap items-end gap-x-1">
          <span aria-hidden className="group-label self-center pr-1">
            {FAMILY_LABEL[f]}
          </span>
          {ALGORITHMS.filter((a) => a.family === f).map((a) => {
            const selected = a.id === value;
            return (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                title={a.blurb}
                onClick={() => onChange(a.id)}
                className={clsx(
                  // Selected is marked by weight + an accent rule cut into the
                  // row's hairline, never by colour alone.
                  'flex h-11 cursor-pointer items-center px-2 text-sm whitespace-nowrap transition-colors duration-[var(--dur-fast)] sm:px-2.5',
                  selected
                    ? 'border-b-2 border-accent font-semibold text-ink'
                    : 'border-b-2 border-transparent text-ink-muted hover:border-line-strong hover:text-ink',
                )}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── The route ────────────────────────────────────────────────────────────────

export default function SyntaxPhaseRoute() {
  const url = useSyntaxUrl();
  const { grammar: grammarId, algo, stage, table, lr1View } = url;

  const compilation = useCompilationStore((s) => s.compilation);
  const stale = useCompilationStore((s) => s.stale);
  const pipeline = useCompilationStore((s) => s.pipelineInfo);
  const info = phaseInfo('syntax');
  const phaseStage = stageInfo(compilation, stale, 'syntax', (c) => info.summary(c, pipeline));
  const statusMeta = STATUS_META[phaseStage.status];
  const PhaseIcon = info.icon;

  const meta = algoMeta(algo);
  const gMeta = grammarMeta(grammarId);
  const grammar = useMemo(() => grammarFor(grammarId), [grammarId]);
  const augmented = useMemo(() => augmentedFor(grammarId), [grammarId]);
  const leftRecursive = useMemo(() => leftRecursiveNonterminals(grammar), [grammar]);

  // Sentences for the study grammars; the C grammars parse the compiled source.
  const [sentences, setSentences] = useState<Record<string, string>>(() =>
    Object.fromEntries(GRAMMARS.map((g) => [g.id, g.sample])),
  );
  const sentence = sentences[grammarId] ?? gMeta.sample;
  const source = gMeta.input === 'c' ? (compilation?.source ?? '') : sentence;
  const sourceTerminals = useMemo(
    () => (gMeta.input === 'c' ? [] : sentence.split(/\s+/u).filter((s) => s.length > 0)),
    [gMeta.input, sentence],
  );

  // ?step= restore: captured once, then reset to 0 whenever the selection changes.
  // `url.set` is re-created every render, so it is reached through a ref — the
  // view context (and therefore every memo inside the views) must stay stable.
  const setUrl = useRef(url.set);
  setUrl.current = url.set;
  const [initialStep, setInitialStep] = useState(url.step ?? 0);
  const onIndexChange = useCallback((i: number) => setUrl.current({ step: i }), []);
  const stepperOptions = useMemo(
    () => ({ initialIndex: initialStep, onIndexChange }),
    [initialStep, onIndexChange],
  );

  const reselect = useCallback((patch: Parameters<typeof url.set>[0]) => {
    setInitialStep(0);
    setUrl.current({ ...patch, step: null });
  }, []);

  const selectAlgo = useCallback((a: AlgoId) => reselect({ algo: a }), [reselect]);

  const ctx: ViewContext = useMemo(
    () => ({
      grammarId,
      grammar,
      augmented,
      leftRecursive,
      stepperOptions,
      source,
      sourceTerminals,
      selectAlgo,
    }),
    [grammarId, grammar, augmented, leftRecursive, stepperOptions, source, sourceTerminals, selectAlgo],
  );

  const viewKey = `${grammarId}|${algo}|${stage}|${table}|${lr1View}|${source}`;

  return (
    <div className="mx-auto flex w-full max-w-450 flex-1 flex-col px-3 py-4 sm:px-5">
      {/* ONE band: back link, title, status and the grammar picker on one row,
          the algorithm rail (the only nav on this page) under it, the citation
          as a marker. No subtitle, no grammar blurb, no algorithm lecture. */}
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <Link
            to="/"
            className="-ml-1 flex h-8 items-center gap-1 self-center rounded-sm px-1 font-mono text-2xs tracking-[0.1em] text-ink-muted uppercase transition-colors hover:text-ink"
          >
            <ArrowLeft aria-hidden className="size-3.5" />
            Overview
          </Link>
          <h1 className="page-title flex items-baseline gap-2.5">
            <PhaseIcon
              aria-hidden
              className="size-5 shrink-0 translate-y-0.5 text-ink-faint"
              strokeWidth={1.75}
            />
            {info.title}
          </h1>
          <span className={clsx('flex items-center gap-1.5 font-mono text-2xs', statusMeta.text)}>
            <StatusIcon status={phaseStage.status} className="size-3" />
            {statusMeta.label}
            {phaseStage.summary && (
              <>
                <span aria-hidden className="text-ink-faint">
                  ·
                </span>
                <span className="text-ink-muted">{phaseStage.summary}</span>
              </>
            )}
          </span>
          <span aria-hidden className="text-ink-faint">·</span>
          <span className="section-meta">{meta.cite}</span>
          <span aria-hidden className="hidden flex-1 sm:block" />
          <GrammarSelect value={grammarId} onChange={(id) => reselect({ grammar: id })} />
        </div>

        <AlgorithmTabs value={algo} onChange={selectAlgo} />

        {meta.needsInput && gMeta.input === 'terminals' && (
          <SentenceBar
            grammarId={grammarId}
            value={sentence}
            onCommit={(s) => {
              setInitialStep(0);
              url.set({ step: null });
              setSentences((prev) => ({ ...prev, [grammarId]: s }));
            }}
          />
        )}
      </header>

      {meta.needsInput && gMeta.input === 'c' && (
        <div className="mt-6">
          <UpstreamFailure />
        </div>
      )}

      {/* No rule here: the algorithm row's own hairline is the separator, and
          two of them 24px apart with nothing between is a rhythm bug. */}
      <div key={viewKey} className="mt-6 flex-1">

        {algo === 'first-follow' && <FirstFollowView {...ctx} />}
        {algo === 'transforms' && (
          <TransformsView ctx={ctx} stage={stage} onStage={(s: TransformStage) => reselect({ stage: s })} />
        )}
        {algo === 'll1-table' && <Ll1TableView {...ctx} />}
        {algo === 'll1-parse' && <Ll1ParseView {...ctx} />}
        {algo === 'rd' && <RdView {...ctx} />}
        {algo === 'lr0' && <Lr0View {...ctx} />}
        {algo === 'slr' && <SlrView {...ctx} />}
        {algo === 'lr1' && lr1View === 'items' && (
          <Lr1View ctx={ctx} subView={lr1View} onSubView={(v: Lr1SubView) => reselect({ lr1View: v })} />
        )}
        {algo === 'lr1' && lr1View === 'table' && (
          <Lr1TableView ctx={ctx} subView={lr1View} onSubView={(v: Lr1SubView) => reselect({ lr1View: v })} />
        )}
        {algo === 'lalr' && <LalrView {...ctx} />}
        {algo === 'lr-parse' && (
          <LrParseView ctx={ctx} table={table} onTable={(t: LrTableChoice) => reselect({ table: t })} />
        )}
      </div>
    </div>
  );
}
