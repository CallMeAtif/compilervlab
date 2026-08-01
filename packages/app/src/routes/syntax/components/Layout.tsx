/**
 * The page layout every syntax view uses: production rail + visualization on the
 * left, the step panel on the right, stacking vertically under lg.
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
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] 2xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div className="grid min-w-0 gap-4 xl:grid-cols-[15rem_minmax(0,1fr)] xl:items-start">
        {rail}
        <div className="flex min-w-0 flex-col gap-4">{main}</div>
      </div>
      <div className="min-w-0">{panel}</div>
    </div>
  );
}
