/**
 * Small presentational parts shared by the /ir panes.
 *
 * Editorial rules (docs/EDITORIAL.md §0): a panel gets a LABEL, not a
 * paragraph. Anything that explains a shape vocabulary — a tree key, the
 * difference between the three representations of §6.2 — is reference material
 * and lives behind this disclosure, one interaction away.
 */
import type { ReactNode } from 'react';
import { clsx } from 'clsx';
import { ChevronRight } from 'lucide-react';

export function Reveal({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    // Native `<details>`: keyboard-operable and announced as a disclosure
    // without a line of script, and it collapses to a single mono word that
    // fits in a `.section-head` beside the title — so closed it costs no band.
    <details className={clsx('group min-w-0', className)}>
      <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1 rounded-sm font-mono text-2xs text-ink-faint transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 transition-transform duration-[var(--dur-fast)] group-open:rotate-90 motion-reduce:transition-none"
        />
        {label}
      </summary>
      <div className="pt-1.5 pb-1">{children}</div>
    </details>
  );
}
