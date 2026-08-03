/**
 * A call to action with weight.
 *
 * The button leans toward the pointer and springs back when it leaves — a real
 * spring from `motion`, not a transition, so flicking across it overshoots and
 * settles the way a physical object would. The pull is small (6px at the edge)
 * because a control that runs away from the cursor is a joke, not an interface.
 *
 * It degrades to exactly the existing `<Cta>`: no pointer (touch, keyboard) and
 * `prefers-reduced-motion` both leave it perfectly still, and the hit target,
 * focus ring and semantics are untouched — it is still one `<Link>`.
 */
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { clsx } from 'clsx';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { usePrefersReducedMotion } from '../usePrefersReducedMotion';

interface MagneticCtaProps {
  to: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
}

const SPRING = { stiffness: 260, damping: 18, mass: 0.6 };

export function MagneticCta({ to, children, variant = 'primary', className }: MagneticCtaProps) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLAnchorElement | null>(null);
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const x = useSpring(px, SPRING);
  const y = useSpring(py, SPRING);
  // The label trails the button very slightly, which is what makes it read as
  // a solid object being pulled rather than a texture sliding.
  const labelX = useTransform(x, (v) => v * 0.35);
  const labelY = useTransform(y, (v) => v * 0.35);

  const onMove = (e: React.PointerEvent<HTMLAnchorElement>) => {
    if (reduced || e.pointerType !== 'mouse') return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    px.set(((e.clientX - rect.left) / rect.width - 0.5) * 12);
    py.set(((e.clientY - rect.top) / rect.height - 0.5) * 8);
  };

  const rest = () => {
    px.set(0);
    py.set(0);
  };

  return (
    <motion.div style={{ x, y }} className="inline-flex">
      <Link
        ref={ref}
        to={to}
        onPointerMove={onMove}
        onPointerLeave={rest}
        onBlur={rest}
        className={clsx(
          'group relative inline-flex min-h-11 items-center justify-center overflow-hidden rounded-xs px-5 font-inter text-sm font-semibold transition-colors duration-[var(--dur-fast)]',
          variant === 'primary'
            ? 'bg-somaiya text-on-somaiya hover:bg-somaiya-dark'
            : 'border border-control text-ink hover:border-ink-faint hover:bg-raised',
          className,
        )}
      >
        {/* A sheen that crosses once on hover. Transform only; it never paints
            over the label's contrast because it sits under it at low alpha. */}
        <span aria-hidden className="site-cta-sheen" />
        <motion.span style={reduced ? undefined : { x: labelX, y: labelY }} className="relative">
          {children}
        </motion.span>
      </Link>
    </motion.div>
  );
}
