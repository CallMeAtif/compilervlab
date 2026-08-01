import * as RadixTooltip from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

/** App-wide tooltip provider (mount once, near the root). */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RadixTooltip.Provider delayDuration={250}>{children}</RadixTooltip.Provider>;
}

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="overlay-panel z-50 max-w-xs rounded-md px-3 py-1.5 text-xs leading-relaxed text-ink"
        >
          {content}
          <RadixTooltip.Arrow className="fill-line-strong" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
