/**
 * THE PIPELINE — the front door of `/`, and the thing the page is remembered by.
 *
 * Scroll is the compiler. One tall section pins a WebGL stage while the reader
 * advances `max.c` through all seven states of the pipeline; the panel beside
 * the stage changes with it, carrying the artifact that phase actually
 * produced. Nothing here is a video and nothing loops: scrubbing back runs the
 * compiler backwards, because every transform is a pure function of scroll.
 *
 * Four things it refuses to get wrong:
 *
 *  1. `prefers-reduced-motion` gets a composed, static, complete page — all
 *     seven artifacts stacked and readable, no pinning, no typing, no canvas.
 *     Not a degraded version: the same information, at rest.
 *  2. No WebGL (old GPU, blocklisted driver, headless) falls back to the 2D
 *     `<Transform>` figure that has always been here, not to an empty box.
 *  3. The three.js chunk is lazy and mounted after first paint, so the headline
 *     is on screen before a byte of it is fetched, and the six lab routes never
 *     download it at all.
 *  4. Everything in the pinned panels also exists in static form further down
 *     the page, so a reader who never triggers a single animation — or who
 *     tabs straight through — loses nothing. Off-screen panels are `inert`,
 *     which keeps them out of the tab order and the accessibility tree rather
 *     than leaving invisible links to catch focus.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { motion, useMotionValueEvent, useScroll, useTransform } from 'motion/react';
import { SOURCE } from '../max-program';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';
import { useTheme } from '../../../lib/theme';
import { Transform } from '../Transform';
import { MagneticCta } from '../motion/MagneticCta';
import { SplitWords } from '../motion/text';
import { STAGES } from './stages';

const Scene = lazy(() => import('./Scene'));

const PHASES = STAGES.length; // 7

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Can this browser actually give us a context? Asked once, cached. */
let webglMemo: boolean | null = null;
function webglAvailable(): boolean {
  if (webglMemo !== null) return webglMemo;
  try {
    const canvas = document.createElement('canvas');
    webglMemo = Boolean(
      window.WebGLRenderingContext && (canvas.getContext('webgl2') || canvas.getContext('webgl')),
    );
  } catch {
    webglMemo = false;
  }
  return webglMemo;
}

// ── The hero copy, which is also phase zero ──────────────────────────────────

function HeroCopy() {
  return (
    <>
      <p className="site-eyebrow">SPCC · K J Somaiya Institute of Technology</p>
      <h1 className="site-display mt-4 max-w-[14ch]">
        <SplitWords text="A compiler that shows its work." delay={120} stagger={55} />
      </h1>
      <p className="site-lede animate-slide-up mt-5" style={{ animationDelay: '420ms', opacity: 0 }}>
        Write C, press Compile, and step through all six phases — tokens, an LALR(1) parse, scopes
        and types, quadruples, a control-flow graph, x86-64. Every step cites the Dragon Book.
      </p>
      <div
        className="animate-slide-up mt-7 flex flex-wrap items-center gap-3"
        style={{ animationDelay: '520ms', opacity: 0 }}
      >
        <MagneticCta to="/lab">Launch the lab</MagneticCta>
        <MagneticCta to="/about" variant="secondary">
          What this lab is
        </MagneticCta>
      </div>
      <p
        className="animate-fade-in mt-4 font-mono text-2xs text-ink-faint"
        style={{ animationDelay: '620ms', animationFillMode: 'both' }}
      >
        Sign in with a @somaiya.edu account · scroll to compile
      </p>
    </>
  );
}

// ── Reduced motion / no WebGL ────────────────────────────────────────────────

/**
 * The composed end-state. Every phase, every artifact, in order, at rest — the
 * page a reader gets when they have told the OS they do not want motion.
 */
function StaticPipeline({ withFigure }: { withFigure: boolean }) {
  return (
    <section className="mx-auto max-w-[84rem] px-4 pt-12 pb-8 sm:px-6 sm:pt-20">
      <HeroCopy />

      {withFigure && (
        <div className="mt-10 sm:mt-14">
          <Transform />
        </div>
      )}

      <ol className="site-spine mt-14 flex flex-col gap-12 sm:mt-16">
        {STAGES.map((stage, i) => (
          <li key={stage.id} className="grid gap-x-6 lg:grid-cols-[2.25rem_minmax(0,1fr)]">
            <div className="hidden lg:block">
              <span className="site-ordinal">{String(i).padStart(2, '0')}</span>
            </div>
            <div className="min-w-0">
              <div className="site-eyebrow flex flex-wrap items-baseline gap-x-3">
                <span className="lg:hidden">{String(i).padStart(2, '0')}</span>
                <span className="text-ink-muted">{stage.rail}</span>
                <span aria-hidden className="hidden h-px flex-1 bg-line sm:block" />
                <span>{stage.cite}</span>
              </div>
              <h2 className="site-heading mt-3">{stage.heading}</h2>
              <div className="site-body mt-2 max-w-[54ch]">{stage.blurb}</div>
              <figure className="site-well mt-4 overflow-hidden">
                <div className="artifact-scroll px-4 py-3">
                  {stage.artifact({ typed: 1, active: false })}
                </div>
                <figcaption className="border-t border-line px-4 py-1.5 font-mono text-2xs text-ink-faint">
                  {stage.caption}
                </figcaption>
              </figure>
              {stage.href && (
                <Link
                  to={stage.href}
                  className="mt-2 inline-flex min-h-11 items-center font-mono text-2xs tracking-[0.12em] text-ink-muted uppercase underline decoration-line-strong underline-offset-4 hover:text-somaiya-strong"
                >
                  Step through {stage.rail.toLowerCase()}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── The pinned stage ─────────────────────────────────────────────────────────

function StageFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="site-scan h-32 w-32 rounded-xs border border-line" aria-hidden />
    </div>
  );
}

export function Pipeline() {
  const reduced = usePrefersReducedMotion();
  const { theme } = useTheme();

  const sectionRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const progressRef = useRef(0);
  const typedRef = useRef(0);
  const loadTypedRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });

  const [phase, setPhase] = useState(0);
  const [typedProgress, setTypedProgress] = useState(0);
  const [heroGone, setHeroGone] = useState(false);
  const [mountScene, setMountScene] = useState(false);
  const [active, setActive] = useState(true);
  const [webgl, setWebgl] = useState(true);
  /** Below `lg` the panel sits ON the stage; the scene needs to know. */
  const [overlaid, setOverlaid] = useState(false);

  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end end'],
  });

  const heroOpacity = useTransform(scrollYProgress, [0, 0.055], [1, 0]);
  const heroY = useTransform(scrollYProgress, [0, 0.055], [0, -56]);
  const heroBlur = useTransform(scrollYProgress, [0, 0.055], ['blur(0px)', 'blur(6px)']);

  /**
   * Source typing is whichever is further along: the load run, or the scroll.
   *
   * The React state here re-renders the panel column, so it is only allowed to
   * change while phase zero is on screen. Past that the caret is at the end of
   * the file and stays there, and a scroll event through the other six phases
   * costs no React work at all — the scene reads `typedRef` on its own frame.
   */
  const syncTyped = useCallback((phaseZero: number) => {
    const next = Math.max(loadTypedRef.current, clamp01(phaseZero / 0.72));
    typedRef.current = next;
    setTypedProgress((prev) => (Math.abs(prev - next) > 0.004 ? next : prev));
  }, []);

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const s = clamp01(v) * PHASES;
    progressRef.current = s;
    const next = Math.min(PHASES - 1, Math.floor(s));
    setPhase((p) => (p === next ? p : next));
    setHeroGone((was) => {
      const gone = s > 0.5;
      return was === gone ? was : gone;
    });
    if (s < 1.2) syncTyped(Math.min(1, s));
  });

  // `max.c` writes itself once on arrival, then hands the caret to the scroll.
  useEffect(() => {
    if (reduced) {
      loadTypedRef.current = 1;
      syncTyped(0);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = clamp01((now - t0 - 380) / 2200);
      loadTypedRef.current = p;
      syncTyped(Math.min(1, progressRef.current));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, syncTyped]);

  // Paint the headline first; fetch three.js after.
  useEffect(() => {
    if (reduced) return;
    setWebgl(webglAvailable());
    const id = window.setTimeout(() => setMountScene(true), 120);
    return () => window.clearTimeout(id);
  }, [reduced]);

  // The same breakpoint the layout uses, as live state — the scene lifts itself
  // clear of the panel only when the panel is actually on top of it.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(max-width: 1023.98px)');
    setOverlaid(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setOverlaid(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Stop rendering entirely when the stage is off screen or the tab is hidden.
  useEffect(() => {
    if (reduced) return;
    const el = sectionRef.current;
    if (!el) return;
    let visible = !document.hidden;
    let onScreen = true;
    const settle = () => setActive(visible && onScreen);

    const io =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(
            (entries) => {
              for (const e of entries) onScreen = e.isIntersecting;
              settle();
            },
            { rootMargin: '120px' },
          );
    io?.observe(el);

    const onVisibility = () => {
      visible = !document.hidden;
      settle();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [reduced]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerRef.current.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
  }, []);

  const onPointerLeave = useCallback(() => {
    pointerRef.current.x = 0;
    pointerRef.current.y = 0;
  }, []);

  if (reduced) return <StaticPipeline withFigure={false} />;
  if (!webgl) return <StaticPipeline withFigure />;

  const stage = STAGES[phase]!;

  return (
    <>
      <section
        ref={sectionRef}
        aria-label="How max.c is compiled"
        className="site-pipeline relative"
        style={{ height: `${(PHASES + 1) * 100}svh` }}
      >
        <div className="sticky top-0 h-[100svh] overflow-hidden">
          {/* ── The stage ───────────────────────────────────────────────── */}
          <div
            ref={stageRef}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            // `lg:right-14` keeps the stage clear of the phase rail, which sits
            // in that gutter. Without it the CFG's right-hand block ran under
            // the rail's label at 1440.
            //
            // The left edge starts where the panel ENDS, not at an arbitrary
            // 45%: the camera's vertical FOV is fixed, so a wider canvas shows
            // more of the scene at the SAME model size. At 45% the parse tree's
            // right-hand branch was cut off while ~220px sat empty between the
            // panel and the stage — the window was the problem, not the scene.
            className="absolute inset-0 top-14 lg:top-0 lg:right-14 lg:left-[34%] xl:left-[32%]"
          >
            {mountScene && (
              <Suspense fallback={<StageFallback />}>
                <Scene
                  progress={progressRef}
                  typed={typedRef}
                  pointer={pointerRef}
                  active={active}
                  overlaid={overlaid}
                  theme={theme}
                  reduced={reduced}
                />
              </Suspense>
            )}
          </div>

          {/* ── Progress ─────────────────────────────────────────────────── */}
          <motion.div
            aria-hidden
            style={{ scaleX: scrollYProgress }}
            className="absolute inset-x-0 top-0 z-20 h-px origin-left bg-somaiya"
          />

          {/* ── Hero, which is also phase zero ───────────────────────────── */}
          <motion.div
            style={{ opacity: heroOpacity, y: heroY, filter: heroBlur }}
            inert={heroGone}
            className={clsx(
              // Below `lg` the stage is full-bleed and the headline would be
              // set over the token cubes, so the hero carries the canvas colour
              // with it and dissolves to reveal the scene. At `lg` the stage is
              // inset to the right and the two never overlap.
              // Set from the TOP, not centred. Dead-centring inside a
              // full-height pinned stage left ~290px of nothing between the
              // header and the headline on a tall window, and the gap grew with
              // the viewport. A vh-proportional top offset keeps the same
              // relationship at every height.
              'pointer-events-none absolute inset-0 z-10 flex items-start bg-canvas pt-[9vh] lg:bg-transparent lg:pt-[11vh]',
              heroGone && 'invisible',
            )}
          >
            <div className="mx-auto w-full max-w-[84rem] px-4 sm:px-6">
              <div className="pointer-events-auto max-w-[36rem] lg:max-w-[30rem]">
                <HeroCopy />
              </div>
            </div>
          </motion.div>

          {/* ── The advancing panel ──────────────────────────────────────── */}
          <div
            className={clsx(
              // Stay full-width and let the inner `max-w-[84rem]` place the panel on
              // the SAME column as the header, footer and hero. `lg:inset-x-auto`
              // collapsed the wrapper to its content, so its static position put
              // the card hard against the viewport edge — metres from the text
              // column it belongs to on a wide screen.
              'pointer-events-none absolute inset-x-0 bottom-0 z-10 transition-opacity duration-500 lg:top-1/2 lg:bottom-auto lg:-translate-y-1/2',
              heroGone ? 'opacity-100' : 'opacity-0',
            )}
          >
            <div className="mx-auto w-full max-w-[84rem] px-4 sm:px-6">
              <div className="pointer-events-auto relative mb-4 lg:mb-0 lg:w-[24rem] xl:w-[26rem]">
                {STAGES.map((s, i) => (
                  <section
                    key={s.id}
                    aria-label={s.rail}
                    inert={i !== phase}
                    className={clsx('site-panel', i === phase ? 'site-panel-in' : 'site-panel-out')}
                  >
                    <div className="site-eyebrow flex items-baseline gap-3">
                      <span className="text-somaiya-strong">
                        {String(i).padStart(2, '0')} / {String(PHASES - 1).padStart(2, '0')}
                      </span>
                      <span className="text-ink-muted">{s.rail}</span>
                      <span aria-hidden className="h-px flex-1 bg-line" />
                      <span>{s.cite}</span>
                    </div>
                    <h2 className="site-heading mt-2.5">{s.heading}</h2>
                    <p className="site-body mt-2 max-w-[46ch]">{s.blurb}</p>

                    {/* The artifact is the show on wide screens. On a phone the
                        stage owns the height, and the same listing is a scroll
                        away in the static index below. */}
                    <div className="mt-3 hidden sm:block">
                      <div className="site-well artifact-scroll max-h-[15rem] px-3.5 py-2.5">
                        {i === phase ? s.artifact({ typed: typedProgress, active: true }) : null}
                      </div>
                      <p className="mt-1.5 font-mono text-2xs text-ink-faint">{s.caption}</p>
                    </div>

                    {s.href && (
                      <Link
                        to={s.href}
                        className="mt-2 inline-flex min-h-11 items-center font-mono text-2xs tracking-[0.12em] text-ink-muted uppercase underline decoration-line-strong underline-offset-4 transition-colors duration-[var(--dur-fast)] hover:text-somaiya-strong hover:decoration-somaiya-strong"
                      >
                        Step through {s.rail.toLowerCase()}
                      </Link>
                    )}
                  </section>
                ))}
              </div>
            </div>
          </div>

          {/* ── The rail ─────────────────────────────────────────────────── */}
          <ol
            aria-hidden
            className={clsx(
              'absolute top-1/2 right-3 z-10 hidden -translate-y-1/2 flex-col gap-2 transition-opacity duration-500 lg:flex',
              heroGone ? 'opacity-100' : 'opacity-0',
            )}
          >
            {STAGES.map((s, i) => (
              <li
                key={s.id}
                className={clsx(
                  'flex items-center justify-end gap-2 font-mono text-2xs tracking-[0.14em] uppercase transition-colors duration-[var(--dur)]',
                  i === phase ? 'text-somaiya-strong' : 'text-ink-faint/60',
                )}
              >
                <span className={i === phase ? '' : 'opacity-0'}>{s.rail}</span>
                <span
                  className={clsx(
                    'h-px transition-all duration-[var(--dur)]',
                    i === phase ? 'w-6 bg-somaiya' : 'w-3 bg-line-strong',
                  )}
                />
              </li>
            ))}
          </ol>

          {/* No phone rail: the panel's own eyebrow already reads
              "03 / 06 SEMANTIC", and a second copy of it was both a repeat and
              the one thing on a 375px screen the parse tree kept colliding
              with. The rail is a wide-screen affordance only. */}
        </div>
      </section>

      {/* Screen-reader and no-JS safety net: the source, in full, in the flow. */}
      <p className="sr-only">
        The program being compiled above is: {SOURCE.replace(/\n/g, ' ')}
      </p>
    </>
  );
}
