# Design system — Compiler Virtual Lab

Two files own every visual decision:

| file | holds |
| --- | --- |
| `theme.css` | the raw tokens, once per theme (`:root` and `.dark`) |
| `index.css` | the Tailwind bridge (`@theme inline`), base rules, and the handful of component classes utilities cannot express |

Nothing outside these two files may introduce a colour, a shadow or a duration.
Phase routes compose Tailwind utilities that resolve to these tokens, plus their
own namespaced pattern CSS (`routes/lex/lex.css`, `routes/codegen/codegen.css`).

---

## 1. Identity

A precise, calm, technical **teaching instrument**: a well-set textbook that
happens to be a developer tool. Chrome recedes; artifacts (tables, automata,
TAC, x86-64) get the contrast budget. Density is high on purpose — the whole
point is to show a real ACTION/GOTO table, not a cartoon of one — so legibility
is defended by type, alignment and whitespace rather than by showing less.

The page is **paper**: a warm off-white sheet, warm near-black ink, hairline
rules. Regions are separated by a rule and 2 rem of space, never by stacking a
lighter card on a darker canvas. The **one cool hue in the system is the
accent**, which is what makes it legible as "the current step" against a
status vocabulary (amber / red / green) that owns the whole warm range. The
structural rules this implies are in [`docs/EDITORIAL.md`](../../../../docs/EDITORIAL.md);
the primitives that express them (`.section`, `.section-head`, `.section-title`,
`.subsection-title`, `.state-title`, `.group-label`, `.page-title`,
`.prose-note`, `.framed`, `.rule`) live in `index.css`.

---

## 2. Colour semantics

The same six-word vocabulary in all six phases. **Every one of these is carried
by a shape or a word as well as a hue**, so the app survives greyscale printing,
colour-vision deficiency and a projector with bad gamma.

| meaning | tokens | non-colour signifier |
| --- | --- | --- |
| **current** — the thing this step is about | `accent`, `accent-soft`, `on-accent` | double ring (`.elk-node.is-current`, TidyTree), inset 1.5px ring (table cell), inset left bar (menu row), inset bottom bar (selected tab) |
| **visited / already derived** | `raised` + `ink-faint` | filled dot on tree nodes, recessive weight |
| **not yet derived** (progressive reveal) | same tokens at `opacity: .25` | position is reserved, so nothing moves when it appears; dashed edges in `codegen.css` |
| **ok** — accepted, valid, added, clean | `ok`, `ok-soft`, `on-ok` | `CircleCheck` glyph, `+` glyph in diffs, double-ring accepting states |
| **warn** — stale, spilled, changed, truncated | `warn`, `warn-soft`, `on-warn` | `Clock`/`TriangleAlert` glyph, `~` glyph, **dashed** border, hatched fill |
| **err** — error, conflict, removed | `err`, `err-soft`, `on-err` | `OctagonAlert`/`CircleAlert` glyph, `−` glyph, 45° hatch (`.cell-conflict`), strikethrough, the literal word "Error:" |

Structure tokens:

| token | job |
| --- | --- |
| `line` | content separator: card edges, table rules. Deliberately low contrast. |
| `line-strong` | emphasised separator, dashed empty-state outlines, graph strokes. |
| `control` | **the outline of an interactive control**, held at ≥ 3:1 on every surface it sits on (WCAG 1.4.11). A button, select, switch or input must use `border-control`; `border-line` alone leaves it unidentifiable, because `surface` and `canvas` differ by only 1.04:1. |
| `canvas` / `surface` / `raised` | page → card → header/chip/hover. |

---

## 3. Measured contrast

Computed with the WCAG 2.x relative-luminance formula against the literal token
values in `theme.css`. Worst case over `surface`, `canvas` and `raised` unless
stated.

| pair | light | dark | required |
| --- | --- | --- | --- |
| `ink` on surface / canvas / raised | 15.52 / 14.22 / 13.35 | 14.25 / 15.03 / 12.90 | 4.5 |
| `ink-muted` on surface / canvas / raised | 8.03 / 7.36 / 6.91 | 6.84 / 7.21 / 6.19 | 4.5 |
| `ink-faint` on surface / canvas / raised | 6.85 / 6.27 / 5.89 | 5.76 / 6.07 / 5.21 | 4.5 |
| `accent` on surface / raised / accent-soft | 5.40 / 4.65 / 4.80 | 7.06 / 6.39 / 5.90 | 4.5 (also the "current" ring, ≥ 3) |
| `on-accent` on `accent` | 5.72 | 7.48 | 4.5 |
| `ok` on `ok-soft` / surface | 5.54 / 6.19 | 7.17 / 8.04 | 4.5 |
| `warn` on `warn-soft` / surface | 5.13 / 5.58 | 7.09 / 8.01 | 4.5 |
| `err` on `err-soft` / surface | 5.52 / 6.20 | 6.68 / 7.20 | 4.5 |
| `on-err` on `err` (count badge) | 6.57 | 7.63 | 4.5 |
| `control` on surface / canvas / raised | 4.89 / 4.48 / 4.21 | 3.84 / 4.05 / 3.48 | 3.0 |
| `ink` on `*-soft` and `code-bg` | ≥ 13.78 | ≥ 11.91 | 4.5 |
| `ink-muted` on `accent-soft` | 7.13 | 5.71 | 4.5 |

Known and intentional exceptions:

* `line` is **below** 3:1 against surface in both themes (2.7 / 2.2 for
  `line-strong`; `line` itself is far lower). It is a content separator only;
  it is never the sole indicator of a control or a state. Use `control` when
  it is.
* `ink-faint` is **not rated** on `accent-soft`. Use `ink-muted` inside
  accent-soft fills — it is measured above and passes in both themes.

Re-measure after any token edit; the two-line formula is in
[WCAG 2.2 §Relative luminance](https://www.w3.org/TR/WCAG22/#dfn-relative-luminance).

---

## 4. Type

Two ladders on one rhythm. Prose is **Source Serif 4**; **every artifact is
JetBrains Mono** — token tables, automata labels, ACTION/GOTO cells, TAC,
x86-64. That contrast IS the hierarchy: a serif sentence explaining a monospace
table needs no box drawn around it. Both faces are bundled
(`@fontsource-variable/*`); the app must run with no network, so a CDN font link
is never acceptable.

Headings come from component classes, not from utilities, so the six routes
cannot drift apart:

| class | size | used for |
| --- | --- | --- |
| `.page-title` | 24–30 px | the route's opening statement. **Once per route.** |
| `.state-title` | 22 px | an empty / blocked / error view's opening line |
| `.section-title` | 17 px | a titled region (`.section-head` draws its rule) |
| `.subsection-title` | 15 px | a pane inside a region |
| `.group-label` | 11 px mono caps | caption over a cluster of controls |

| utility | size | used for |
| --- | --- | --- |
| body (`<body>`) | 15 px / 1.55 | prose, step explanations |
| `text-sm` | 14 px | secondary prose, control labels |
| `text-code` | 13 px | mono listings: asm, TAC, source strips |
| `text-xs` | 12 px | dense mono grids: ACTION/GOTO, symbol tables |
| `text-2xs` | 11 px | chips, citations, cell annotations, summaries |
| `text-3xs` | 10 px | counters and badges **only** — never a sentence |

`text-2xs` and `text-3xs` exist so the ~160 `text-[11px]` / `text-[10px]`
literals in the phase views have one place to change.

Two global rules make mono trustworthy for teaching:

* `font-variant-numeric: tabular-nums` everywhere — a step counter or a state
  number never changes width as it advances, so nothing reflows.
* `font-variant-ligatures: none` + `'liga' 0, 'calt' 0` on `code`, `pre`,
  `.font-mono` and `.cm-editor`. `->`, `!=`, `&&` and `<=` are *tokens being
  taught*; a font that fuses them into one glyph makes the token stream
  disagree with the source it came from.

---

## 5. Spacing, radius, elevation

* **4 px rhythm.** Gaps and padding come from `gap-1 … gap-6` / `p-2 … p-5`.
  The 2 px half-steps (`gap-1.5`, `p-2.5`, `py-1.5`) are allowed inside dense
  chips and table rows and nowhere else.
* **Section rhythm:** 2 rem between titled regions — that is `.section +
  .section`, not a utility. `py-4` page padding (`px-3`, `sm:px-5`), identical
  on all seven routes.
* **Icon sizes:** `size-3.5` (14) inline with text, `size-4` (16) default,
  `size-5` (20) inside 44 px controls and page headings. No other sizes.
* **Radius:** `rounded` (4) inside rows, `rounded-md` (6) on controls,
  `rounded-lg` (8) on cards and panels, `rounded-full` on chips and status pills.
* **Elevation — exactly two levels.** Flat is the page itself: a `.section`
  with a rule under its title and 2 rem to its neighbour. A border is *earned*,
  not default — only `.framed` (a scrolling or genuinely contained artifact:
  graphs, code listings, wide tables) and `.overlay-panel` (tooltip, popover,
  select, dialog) may draw one, and `.overlay-panel` is the *only* thing in the
  app that casts a shadow. A shadow therefore always means "this floats above
  the page". In dark mode `.overlay-panel` also gets a brighter edge, because a
  shadow on a near-black canvas conveys nothing.
* **Active controls have one skin.** A tab row that shares a hairline marks its
  selection with `border-b-2 border-accent` + `font-semibold`; a free-standing
  chip cluster marks it with `bg-accent-soft` + `shadow-[inset_0_-2px_0_var(--accent)]`.
  Both are weight **plus a rule**, so the selection survives greyscale. There is
  no third treatment.

---

## 6. Motion

| token | value | used for |
| --- | --- | --- |
| `--dur-fast` | 110 ms | hover / press / focus echo |
| `--dur` | 170 ms | emphasis moves (current node, edge, cell) |
| `--ease` / `ease-emphasis` | `cubic-bezier(.2,0,0,1)` | everything |

Rules:

1. **Only colour, shadow, opacity and transform animate.** Layout is computed
   once — ELK and d3-hierarchy run on structure alone — and never animated
   (`docs/PLAN.md` layout-stability rule). Stepping must never move a node.
2. Nothing exceeds 200 ms. There are no entrance choreographies; the only
   `animation` in the app is the compile spinner.
3. `prefers-reduced-motion: reduce` collapses every transition, delay and
   animation to 0.01 ms. The rule lives in `@layer base` with `!important`,
   which is what lets it reach @xyflow, CodeMirror and Radix — all three ship
   **unlayered** stylesheets, and an `!important` declaration inside a cascade
   layer outranks unlayered `!important`.

---

## 7. Accessibility invariants

* One focus ring: `2px solid var(--ring)` at `2px` offset, on `:focus-visible`
  only. It must never set `border-radius` — that reshapes the focused element
  itself. Containers that clip (`overflow-*`) need ≥ 4 px of padding so the
  ring survives.
* Interactive targets are **44 × 44** (`size-11` / `h-11`). Two documented
  exceptions, both 24 × 24 (WCAG 2.2 SC 2.5.8 minimum, "essential" clause):
  the scrubber's section tick-marks and the per-row justification button in
  `DiffView` — in both cases the target's position or the row height is
  determined by the trace, not by us.
* No meaning from colour alone — see the signifier column in §2.
* Every step-through view announces through one polite live region in
  `StepControls`. It deliberately freezes during playback: at 4× a per-step
  message queues faster than a screen reader can speak it.
* Tab order follows reading order. Where that conflicted with painting order
  (scrubber ticks) the DOM was reordered, not `tabindex`.

---

## 8. Responsive

* Breakpoints: `sm` 640 (padding, inline wordmark), `lg` 1024 (the
  `[visualization | TracePanel]` split, and the top bar collapsing to two rows),
  `xl` 1280 (the pipeline diagram turns horizontal).
* The `[visualization | TracePanel]` split is `grid gap-4 lg:grid-cols-[…]`;
  below `lg` it is one column, visualization first.
* **A wide artifact scrolls inside its own box, never the page.** Use
  `.artifact-scroll` (or `overflow-auto` + a definite height) on ACTION/GOTO
  tables, asm listings and CFGs; give every flex/grid child that contains one a
  `min-w-0`, otherwise it refuses to shrink and pushes the page sideways.
* Controls stay outside scroll regions: the top-bar theme toggle sits beside the
  phase rail, not inside it, so it is reachable at 375 px.
