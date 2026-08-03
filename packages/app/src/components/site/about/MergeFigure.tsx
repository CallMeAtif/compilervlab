/**
 * The frame around `/about`'s 3D moment: caption, scroll wiring, and the two
 * ways out.
 *
 *   reduced motion  → the composed state, in type. No canvas, no collapse: the
 *                     three numbers and what they mean, which is all the figure
 *                     was ever saying.
 *   no WebGL        → the same static block, rather than an empty well.
 *
 * The collapse is driven by the figure's own position in the viewport, so it
 * runs while you read the paragraph beside it and holds once it has passed.
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { useMotionValueEvent, useScroll } from 'motion/react';
import { DANGLING_ELSE, GRAMMAR_FACTS } from '../max-program';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';
import { useTheme } from '../../../lib/theme';
import { Counter } from '../motion/text';

const StateMerge = lazy(() => import('./StateMerge'));

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

function Legend() {
  return (
    <dl className="grid grid-cols-3 gap-x-4 gap-y-1 font-mono text-2xs">
      <div>
        <dt className="site-figure-value">
          <Counter to={GRAMMAR_FACTS.canonicalLr1States} />
        </dt>
        <dd className="mt-1 text-ink-faint">canonical LR(1) states</dd>
      </div>
      <div>
        <dt className="site-figure-value">
          <Counter to={GRAMMAR_FACTS.lalrStates} />
        </dt>
        <dd className="mt-1 text-ink-faint">cores after the merge</dd>
      </div>
      <div>
        <dt className="site-figure-value text-somaiya-strong">
          <Counter to={GRAMMAR_FACTS.conflicts} />
        </dt>
        <dd className="mt-1 text-ink-faint">conflict · state {DANGLING_ELSE.state}</dd>
      </div>
    </dl>
  );
}

export function MergeFigure() {
  const reduced = usePrefersReducedMotion();
  const { theme } = useTheme();
  const ref = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef(0);
  const pointerRef = useRef({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const [webgl, setWebgl] = useState(true);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  // The collapse happens across the middle of the figure's travel, so it is
  // finished by the time the figure is centred and you are reading the caption.
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    progressRef.current = Math.max(0, Math.min(1, (v - 0.32) / 0.36));
  });

  useEffect(() => {
    if (reduced) return;
    setWebgl(webglAvailable());
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) setActive(e.isIntersecting && !document.hidden);
    });
    io.observe(el);
    const onVis = () => setActive((a) => a && !document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [reduced]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointerRef.current.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
  }, []);

  const live = !reduced && webgl;

  return (
    // Fills whatever the caller gives it — the caller decides the measure. A
    // hard 49.5rem here pinned the figure to the left of its own centred block,
    // which read as off-centre rather than as a figure.
    <figure ref={ref} className="w-full">
      <div
        onPointerMove={live ? onPointerMove : undefined}
        onPointerLeave={() => {
          pointerRef.current.x = 0;
          pointerRef.current.y = 0;
        }}
        className="site-well relative overflow-hidden"
      >
        {live ? (
          <div className="relative h-[21rem] sm:h-[27rem] lg:h-[32rem]">
            <Suspense fallback={<div className="site-scan absolute inset-0" aria-hidden />}>
              <StateMerge
                progress={progressRef}
                pointer={pointerRef}
                active={active}
                theme={theme}
              />
            </Suspense>
          </div>
        ) : (
          <div className="px-4 py-8 sm:px-6">
            <p className="site-listing max-w-[46ch] text-ink-muted">
              The constructor builds {GRAMMAR_FACTS.canonicalLr1States} canonical LR(1) states and
              merges every group that shares a core, leaving {GRAMMAR_FACTS.lalrStates}. Exactly{' '}
              {GRAMMAR_FACTS.conflicts} conflict survives: state {DANGLING_ELSE.state}, on{' '}
              <code>{DANGLING_ELSE.symbol}</code>.
            </p>
          </div>
        )}

        <div className="border-t border-line px-4 py-3 sm:px-5">
          <Legend />
        </div>
      </div>

      <figcaption className="mt-2 font-mono text-2xs text-ink-faint">
        pipelineTables() on cGrammar() · one point per canonical state, collapsing onto the{' '}
        {GRAMMAR_FACTS.lalrStates} cores they merge into. The counts are the compiler's; which state
        lands on which core is not shown.
      </figcaption>
    </figure>
  );
}
