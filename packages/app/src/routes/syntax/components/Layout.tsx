/**
 * The page layout every syntax view uses: TWO columns — the artifact and the
 * step panel — stacking vertically under lg.
 *
 * The grammar rail used to be a permanent third column of reference material
 * (docs/EDITORIAL.md §0: "max TWO columns of content"). It now rides above the
 * artifact as a disclosure, so the default view is artifact + trace and the
 * productions are one interaction away.
 *
 * Columns are separated by a hairline and generous gutters rather than by card
 * edges (rule 1), and the inner columns carry NO gap — the regions inside them
 * are `.section`s, which space themselves 2rem apart.
 */
import type { ReactNode } from 'react';

export function ViewGrid({
  rail,
  main,
  panel,
}: {
  rail: ReactNode;
  main: ReactNode;
  panel: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_23rem] lg:gap-x-10 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="flex min-w-0 flex-col">
        {rail}
        {main}
      </div>
      {/* The trace column is the quietest thing on the page: a rule marks it
          off on wide screens, nothing else. */}
      <div className="min-w-0 lg:border-l lg:border-line lg:pl-10">{panel}</div>
    </div>
  );
}
