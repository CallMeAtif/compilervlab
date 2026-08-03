/**
 * `/about` — a different job from `/`, so a different shape.
 *
 * `/` is a demo. This is a piece of writing with evidence in the margin: an
 * editorial two-column reading layout set in Source Serif, with every load-
 * bearing claim annotated by a mono margin note carrying the number, the file
 * or the Dragon Book section it comes from. No feature grid, no icons.
 *
 * What motion is doing here, and why each piece earns its place:
 *   • a reading-progress rule under the header — a long essay should say how
 *     long, and it is drawn where the eye already is;
 *   • marginalia that arrive FROM the margin as their movement enters, so the
 *     evidence reads as being attached to the claim rather than laid out with
 *     it;
 *   • figures that count up, because a number that lands is a number that gets
 *     read;
 *   • one three-dimensional figure: the LALR merge, 553 points collapsing into
 *     147 cores as you scroll past the paragraph that claims it.
 *
 * Every figure asserted here was checked against the repository:
 *   611 unit tests (vitest, 45 files) · 32 browser tests (playwright, 11 files)
 *   147 LALR(1) states merged from 553 canonical LR(1) states, 86 productions
 *   1 conflict: state 138 on `else`, resolved by shift (§4.8.2)
 *   52 traces · 26 trace kinds · 261,309 recorded steps · 59 cited sections ·
 *   0 steps without a citation  (docs/TEXTBOOK-MAP.md, generated from the code)
 */
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { motion, useScroll } from 'motion/react';
import { SiteHeader } from '../../components/site/SiteHeader';
import { SiteFooter } from '../../components/site/SiteFooter';
import { Reveal } from '../../components/site/Reveal';
import { Artifact } from '../../components/site/primitives';
import { MergeFigure } from '../../components/site/about/MergeFigure';
import { Counter, Decode, SplitWords, useInView } from '../../components/site/motion/text';
import { usePrefersReducedMotion } from '../../components/site/usePrefersReducedMotion';
import { DANGLING_ELSE } from '../../components/site/max-program';

/**
 * A claim's evidence, arriving from the margin it lives in. On wide screens the
 * note is genuinely in the right margin, so entering from the right is the
 * direction it came from rather than an effect chosen for variety.
 */
function Note({ children }: { children: React.ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const [ref, seen] = useInView<HTMLDListElement>();
  return (
    <dl ref={ref} className={clsx('site-note', seen && !reduced && 'site-note-in')}>
      {children}
    </dl>
  );
}

function Fact({ value, source }: { value: string; source: string }) {
  return (
    <>
      <dt>{value}</dt>
      <dd className="mb-2 text-ink-faint last:mb-0">{source}</dd>
    </>
  );
}

/**
 * One movement of the essay: prose on the left at reading measure, its evidence
 * pinned in the right margin on wide screens and stacked beneath on narrow.
 */
function Movement({
  eyebrow,
  heading,
  children,
  note,
}: {
  eyebrow: string;
  heading: string;
  children: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <Reveal
      as="section"
      // Prose and note travel TOGETHER, centred on the page. Stretching them to
      // the container's full width put a canyon between the paragraph and the
      // note that annotates it; packing them left put the same canyon outside.
      // The pair is sized to its own content (34rem measure + gap + 20rem note)
      // and the leftover falls evenly in both margins.
      className="mx-auto grid w-full max-w-[64rem] gap-x-12 gap-y-5 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)]"
    >
      <div className="min-w-0">
        <p className="site-eyebrow">{eyebrow}</p>
        <h2 className="site-heading mt-3">{heading}</h2>
        <div className="site-prose mt-4">{children}</div>
      </div>
      {/* Capped so the note stays a note and never becomes a second column of
          prose; it sits directly beside the paragraph it annotates. */}
      <div className="lg:w-full lg:max-w-[24rem] lg:pt-14">{note}</div>
    </Reveal>
  );
}

/** One measured figure, on a rule. The number counts up when it is reached. */
function Figure({
  value,
  unit,
  label,
  accent = false,
}: {
  value: number;
  unit?: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="site-figure">
      <p className={clsx('site-figure-value', accent && 'text-somaiya-strong')}>
        <Counter to={value} />
        {unit ? <span className="text-[0.5em] tracking-[0.1em]"> {unit}</span> : null}
      </p>
      <p className="mt-1.5 font-mono text-2xs leading-snug text-ink-faint">{label}</p>
    </div>
  );
}

export default function AboutRoute() {
  const { scrollYProgress } = useScroll();

  return (
    <div className="flex min-h-dvh flex-col bg-canvas font-inter">
      <SiteHeader />

      {/* Reading progress. A hairline, directly under the one chrome band, so
          it reads as part of the header rather than as a widget. */}
      <motion.div
        aria-hidden
        style={{ scaleX: scrollYProgress }}
        className="sticky top-[3.4rem] z-30 h-px origin-left bg-somaiya sm:top-[3.75rem]"
      />

      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {/* ── Standfirst ───────────────────────────────────────────────────
            The outer container is the site's `max-w-[84rem]` measure, the same one
            the header and footer use, so the page has ONE left edge from the
            institute mark down to the colophon. The essay's own measure lives
            on the inner block: 34rem of prose plus a 13rem note column, left-
            aligned in that container with the slack falling in the outer
            margin, which is where an editorial page puts it. */}
        {/* The hero is TWO columns above `lg`: the essay opens on the left at
            its 34rem measure, and the evidence stands beside it rather than
            waiting below the fold. The numbers used to sit in a full-width band
            under a hero that left the right 45% of the screen empty — the claim
            and the proof of the claim were a scroll apart for no reason. */}
        <section className="mx-auto max-w-[84rem] px-4 pt-12 pb-12 sm:px-6 sm:pt-20 sm:pb-16">
          <div className="mx-auto grid w-full max-w-[64rem] gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,34rem)_minmax(0,1fr)] lg:items-start">
            <div className="min-w-0">
              <p
                className="site-eyebrow animate-fade-in"
                style={{ animationDelay: '0ms', animationFillMode: 'both' }}
              >
                About · Compiler Virtual Lab
              </p>

              <h1 className="site-display mt-5 max-w-[17ch]">
                <SplitWords text="A textbook you can run." delay={90} stagger={60} />
              </h1>

              <div
                className="site-prose site-dropcap animate-slide-up mt-7"
                style={{ animationDelay: '420ms', opacity: 0 }}
              >
                <p>
                  Compiler theory is taught as a sequence of algorithms on a page and then examined
                  as a sequence of algorithms on a page. This lab exists because the algorithms are
                  not hard to watch — they are only hard to imagine. So it runs them: a real
                  compiler for a subset of C, built from the Dragon Book, that stops after every
                  step and shows you the table, the automaton or the graph as it stood at that
                  moment.
                </p>
                <p>
                  It was written for the Systems Programming &amp; Compiler Construction course at K
                  J Somaiya Institute of Technology, and it is deliberately not a simulation. What
                  you step through is the same compiler that produced the assembly.
                </p>
              </div>
            </div>

            {/* Five numbers, all checked against the repository. They sit with
                the opening claim because they are what it spends the next
                thousand words earning. */}
            <Reveal className="min-w-0 border-t border-line pt-8 lg:mt-2">
              <p className="site-eyebrow">By the numbers</p>
              <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 lg:grid-cols-2">
                <Figure value={147} label="LALR(1) states, merged by core" />
                <Figure value={553} label="canonical LR(1) states before the merge" />
                <Figure value={611} label="unit tests, 45 files" />
                <Figure value={261309} label="recorded steps across 52 traces" />
                <Figure value={0} label="steps without a citation" accent />
              </dl>
            </Reveal>
          </div>
        </section>

        {/* ── The essay ────────────────────────────────────────────────── */}
        <div className="mx-auto mt-16 flex max-w-[84rem] flex-col gap-16 px-4 sm:mt-20 sm:gap-20 sm:px-6">
          <Movement
            eyebrow="Provenance"
            heading="Every algorithm comes from the book"
            note={
              <Note>
                <Fact value="59 sections" source="distinct Dragon Book sections cited" />
                <Fact value="261,309 steps" source="recorded across 52 traces" />
                <Fact value="0 steps" source="without a citation" />
                <Fact value="docs/TEXTBOOK-MAP.md" source="generated from the code, not by hand" />
              </Note>
            }
          >
            <p>
              The reference is <em>Compilers: Principles, Techniques, &amp; Tools</em> (Aho, Lam,
              Sethi &amp; Ullman, 2nd edition). Every recorded step in the lab carries a mandatory
              citation into it — a section, and usually an algorithm or figure number — and a step
              that cannot be cited is treated as a bug rather than a shortcut.
            </p>
            <p>
              Because the citations live in the code, the map between the lab and the book is
              generated rather than written: a script builds every trace the compiler can produce,
              reads the citation off each step, and prints what it found. Documentation made that
              way cannot drift away from what the software does.
            </p>
          </Movement>

          <Movement
            eyebrow="Fidelity"
            heading="The parser is a real LALR(1) machine"
            note={
              <Note>
                <Fact value="86 productions" source="C-subset grammar" />
                <Fact value="553 → 147" source="canonical LR(1) states merged by core" />
                <Fact value="1 conflict" source="state 138, on `else`" />
                <Fact value="§4.8.2" source="shift, the conventional resolution" />
              </Note>
            }
          >
            <p>
              Nothing here is hand-written to look like a parse. The pipeline parser is generated by
              this repository's own table constructor from the C-subset grammar: it builds the
              canonical LR(1) collection, merges states that share a core while unioning their
              lookaheads, and hands the resulting table to an LR driver.
            </p>
            <p>
              Exactly one conflict survives the merge, and it is the famous one. The grammar is
              ambiguous about which <code>if</code> an <code>else</code> belongs to, so the table
              has both a shift and a reduce in that cell. The constructor resolves it by shifting
              and records why — and if any <em>other</em> conflict ever appears, the build fails
              rather than quietly picking a winner.
            </p>
          </Movement>

          {/* The merge, at scale. This one is a FIGURE, not prose: it is
              centred on the page and given more room than the 34rem measure,
              because 553 points at reading width read as a smudge. */}
          <Reveal className="mx-auto w-full max-w-[64rem]">
            <MergeFigure />
          </Reveal>

          {/* The conflict itself, in the constructor's own words. The two items
              decode as they arrive: this is a table cell being resolved, which
              is exactly the moment a scramble-to-resolve is describing. */}
          <Reveal className="mx-auto w-full max-w-[64rem]">
            <Artifact caption="pipelineTables().resolutions[0] · shift/reduce · resolved">
              <div className="text-ink-faint">
                state {DANGLING_ELSE.state} · on '{DANGLING_ELSE.symbol}' · {DANGLING_ELSE.kind}
              </div>
              <div className="artifact-scroll mt-3">
                <div className="whitespace-pre text-ink-muted">
                  <Decode text={DANGLING_ELSE.reduce.item} />
                  {'   '}
                  {DANGLING_ELSE.reduce.action}
                </div>
                <div className="mt-1 whitespace-pre text-ink">
                  <Decode text={DANGLING_ELSE.shift.item} delay={160} />
                  {'   '}
                  <span className="text-somaiya-strong">{DANGLING_ELSE.shift.action} ← taken</span>
                </div>
              </div>
              <p className="site-body mt-3 max-w-[62ch] text-2xs">{DANGLING_ELSE.reason}</p>
            </Artifact>
          </Reveal>

          <Movement
            eyebrow="Evidence"
            heading="It is checked against the book's own tables"
            note={
              <Note>
                <Fact value="611 unit tests" source="vitest, 45 files" />
                <Fact value="32 browser tests" source="playwright, production build" />
                <Fact
                  value="Fig 4.17 · 4.31 · 4.37"
                  source="FIRST/FOLLOW, LR(0) items, SLR table"
                />
                <Fact value="Fig 4.38 · 4.41–4.43" source="LR driver, LR(1) items, LALR merge" />
              </Note>
            }
          >
            <p>
              A visualization that is merely plausible is worse than none, so the algorithms are
              pinned to goldens taken from the textbook: where the book prints a table, the lab
              reproduces that table exactly, and a test fails if a cell moves.
            </p>
            <p>
              Above those sit unit tests on every phase and a browser suite that drives a production
              build through all six routes — compiling, stepping, deep-linking and switching themes
              — with the console asserted clean throughout.
            </p>
          </Movement>

          <Movement
            eyebrow="How it runs"
            heading="No server, no upload, no setup"
            note={
              <Note>
                <Fact value="Web Worker" source="the compiler never touches the UI thread" />
                <Fact
                  value="deterministic"
                  source="same source → same trace → stable ?step= links"
                />
                <Fact value="offline fonts" source="bundled, never fetched from a CDN" />
                <Fact value="@somaiya.edu" source="the only accounts accepted" />
              </Note>
            }
          >
            <p>
              The whole compiler is TypeScript running in your browser, on a Web Worker so a
              hundred-thousand-step trace never freezes the page. Your source is never uploaded;
              there is no backend to upload it to.
            </p>
            <p>
              Runs are deterministic — no clocks, no randomness — which is what makes a step number
              in the URL mean the same thing tomorrow, and what lets you send a classmate a link to
              the exact moment a table cell was filled. Sign-in exists only to keep the lab to the
              course: accounts are restricted to <code>@somaiya.edu</code>.
            </p>
          </Movement>

          <Movement
            eyebrow="Scope"
            heading="What it covers"
            note={
              <Note>
                <Fact value="26 trace kinds" source="52 traces across the six phases" />
                <Fact value="C subset" source="docs/c-subset.md" />
                <Fact value="x86-64" source="AT&T syntax, 64-bit int and char" />
              </Note>
            }
          >
            <p>
              Six phases, each with its own route. Lexical analysis goes from a regular expression
              to an NFA, a DFA and a minimized DFA before running the scanner on your source. Syntax
              analysis covers FIRST and FOLLOW sets, LL(1) tables, recursive descent, left-recursion
              removal, LR(0) items, SLR, canonical LR(1) and the LALR merge.
            </p>
            <p>
              Semantic analysis builds scopes, resolves names and inserts widening conversions.
              Intermediate code generation produces quadruples with backpatching. Optimization
              partitions blocks, builds the control-flow graph and runs six passes over it. Code
              generation selects instructions and colours an interference graph to assign registers,
              spilling when the colours run out.
            </p>
          </Movement>

          {/* No closing pitch here. The footer already ends both public pages
              with the same heading, the same sentence and the same primary
              action; a second one directly above it was the page asking twice.
              The one link this page owes a reader that the footer does not
              carry is the way back to the demo. */}
          <Reveal className="mx-auto w-full max-w-[64rem] border-t border-line pt-4">
            <Link
              to="/"
              className="inline-flex min-h-11 items-center font-mono text-2xs tracking-[0.12em] text-ink-muted uppercase underline decoration-line-strong underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:text-somaiya-strong hover:decoration-somaiya-strong"
            >
              See the pipeline
            </Link>
          </Reveal>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
