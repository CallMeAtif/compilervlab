/**
 * Reingold–Tilford tidy tree (d3-hierarchy) rendered as SVG — for parse trees,
 * ASTs and call trees. Same policy as ElkGraph: layout depends only on
 * structure + collapse state; highlights are emphasis-only. Shape signifiers:
 * current node = double ring, visited node = filled dot, collapsed node = "+"
 * badge with child count.
 */
import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';
import { clsx } from 'clsx';
import { useFullscreen } from '../../lib/useFullscreen';
import { FullscreenChrome } from './FullscreenChrome';

export interface TidyTreeNode {
  id: string;
  label: string;
  kind?: string;
  children?: TidyTreeNode[];
}

export interface TidyTreeProps {
  root: TidyTreeNode;
  currentIds?: ReadonlySet<string> | readonly string[];
  visitedIds?: ReadonlySet<string> | readonly string[];
  collapsible?: boolean;
  /**
   * Rendered as a bar along the bottom ONLY in fullscreen — same contract as
   * ElkGraph. Fullscreen hides the trace panel, so pass the phase's step
   * controls here to keep the tree steppable while it fills the screen.
   */
  controls?: ReactNode;
  className?: string;
}

const EMPTY_SET: ReadonlySet<string> = new Set();
function toSet(v?: ReadonlySet<string> | readonly string[]): ReadonlySet<string> {
  if (!v) return EMPTY_SET;
  return v instanceof Set ? v : new Set(v);
}

const NODE_W = 96;
const NODE_H = 64;
const R = 15;

export function TidyTree({
  root,
  currentIds,
  visitedIds,
  collapsible = true,
  controls,
  className,
}: TidyTreeProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const fs = useFullscreen();

  const current = toSet(currentIds);
  const visited = toSet(visitedIds);

  const { nodes, links, viewBox } = useMemo(() => {
    const h = hierarchy<TidyTreeNode>(root, (d) =>
      collapsed.has(d.id) ? undefined : d.children,
    );
    const layout = tree<TidyTreeNode>().nodeSize([NODE_W, NODE_H]);
    const laid = layout(h);
    const all = laid.descendants();
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = 0;
    for (const n of all) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    const pad = 48;
    return {
      nodes: all,
      links: laid.links(),
      viewBox: `${minX - pad} ${-pad} ${maxX - minX + pad * 2} ${maxY + pad * 2}`,
    };
  }, [root, collapsed]);

  const toggle = (node: HierarchyPointNode<TidyTreeNode>) => {
    if (!collapsible) return;
    const hasHiddenChildren = collapsed.has(node.data.id);
    const hasChildren = (node.data.children?.length ?? 0) > 0;
    if (!hasChildren) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (hasHiddenChildren) next.delete(node.data.id);
      else next.add(node.data.id);
      return next;
    });
  };

  const onNodeKeyDown = (e: KeyboardEvent, node: HierarchyPointNode<TidyTreeNode>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle(node);
    }
  };

  return (
    // The fullscreen target is an OUTER wrapper, not the scroll box: an
    // absolutely-positioned control inside a scrolling element scrolls away with
    // the content. Fullscreen needs a real backdrop too (the API paints black
    // otherwise) and must fill the screen rather than keep the caller's max-h.
    <div
      ref={fs.ref}
      className={clsx('relative min-w-0', fs.isFullscreen && 'flex flex-col')}
      style={fs.isFullscreen ? { height: '100%', background: 'var(--surface)' } : undefined}
    >
      <div
        className={clsx(
          'framed artifact-scroll',
          // `flex-1 min-h-0` rather than a bottom pad: the tree scales to its
          // box, so the box has to be the screen MINUS the transport bar or the
          // deepest row of labels renders underneath it.
          fs.isFullscreen ? 'min-h-0 max-h-none flex-1' : className,
        )}
      >
        <svg
          viewBox={viewBox}
          role="tree"
          aria-label="Tree visualization"
          className="mx-auto block h-auto min-w-full"
          // Fullscreen is the whole point for a wide forest: let the SVG scale to
          // the box (preserveAspectRatio defaults to "meet") instead of staying
          // at its intrinsic size in the middle of an empty screen.
          style={fs.isFullscreen ? { width: '100%', height: '100%' } : { maxWidth: '100%' }}
        >
        {/* `--control`, not `--line-strong`: a link is a graphical object that
            carries meaning (WCAG 1.4.11 → 3:1). `--line-strong` measures 2.34:1
            on the sheet in dark and 2.22:1 in light — a deep parse tree drawn in
            it dissolves into the canvas. `--control` is the lightest token whose
            contract guarantees 3:1 on canvas/surface/raised (3.95 / 4.09). */}
        <g fill="none" stroke="var(--control)" strokeWidth={1.25}>
          {links.map((l) => (
            <path
              key={`${l.source.data.id}->${l.target.data.id}`}
              d={`M${l.source.x},${l.source.y + R} C${l.source.x},${(l.source.y + l.target.y) / 2} ${l.target.x},${(l.source.y + l.target.y) / 2} ${l.target.x},${l.target.y - R}`}
              className={clsx(
                current.has(l.target.data.id) && 'stroke-accent',
              )}
              strokeWidth={current.has(l.target.data.id) ? 2 : 1.25}
            />
          ))}
        </g>

        {nodes.map((n) => {
          const id = n.data.id;
          const isCurrent = current.has(id);
          const isVisited = visited.has(id);
          const childCount = n.data.children?.length ?? 0;
          const isCollapsed = collapsed.has(id);
          const interactive = collapsible && childCount > 0;
          return (
            <g
              key={id}
              transform={`translate(${n.x},${n.y})`}
              data-kind={n.data.kind}
              role="treeitem"
              aria-level={n.depth + 1}
              aria-label={[
                n.data.label,
                n.data.kind,
                isCurrent ? 'current' : isVisited ? 'visited' : undefined,
                isCollapsed && childCount > 0 ? `${childCount} children hidden` : undefined,
              ]
                .filter(Boolean)
                .join(', ')}
              aria-selected={isCurrent || undefined}
              aria-expanded={interactive ? !isCollapsed : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={() => toggle(n)}
              onKeyDown={(e) => onNodeKeyDown(e, n)}
              className={clsx(interactive && 'cursor-pointer outline-offset-4')}
              style={{
                transition: 'opacity var(--dur) var(--ease)',
              }}
            >
              {/* double ring = shape signifier for "current" */}
              {isCurrent && (
                <circle r={R + 4} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
              )}
              <circle
                r={R}
                fill={isCurrent ? 'var(--accent-soft)' : isVisited ? 'var(--raised)' : 'var(--surface)'}
                /* accent 7.0 · ink-faint 5.8 on raised · control 4.0 — all
                   above 3:1 in both themes, and still three distinct weights. */
                stroke={isCurrent ? 'var(--accent)' : isVisited ? 'var(--ink-faint)' : 'var(--control)'}
                strokeWidth={isCurrent ? 2 : 1.25}
              />
              {/* filled dot = visited signifier */}
              {isVisited && !isCurrent && <circle r={3} fill="var(--ink-faint)" />}
              <text
                y={R + 14}
                textAnchor="middle"
                fill="var(--ink)"
                style={{ font: '11px var(--font-mono)', fontVariantLigatures: 'none' }}
              >
                {n.data.label}
              </text>
              {isCollapsed && childCount > 0 && (
                <g transform={`translate(${R - 2},${-R + 2})`}>
                  <circle r={8} fill="var(--accent)" />
                  <text
                    textAnchor="middle"
                    dy={3}
                    fill="var(--on-accent)"
                    style={{ font: 'bold 9px var(--font-mono)' }}
                  >
                    +{childCount}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        </svg>
      </div>
      {/* Last child: the bar is in normal flow, so it must follow the tree it
          sits under. The toggle inside is absolute and unaffected by order. */}
      <FullscreenChrome fs={fs} label="tree" controls={controls} />
    </div>
  );
}
