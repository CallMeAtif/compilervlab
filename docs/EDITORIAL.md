# Editorial redesign — the rules every view follows

## 0. Voice and density (READ THIS FIRST — it overrides everything below)

The first pass at this design failed for two reasons: too much chrome before any content, and
too much prose explaining itself. Both are now hard limits, not preferences.

**Word budgets. These are ceilings, not targets.**

| Element | Max | Rule |
|---|---|---|
| Page subtitle | **0 words** | Delete it. The title and the visible content say what the page is. |
| Panel / section title | 4 words | A label, not a sentence. "FIRST sets", not "Where the computation is". |
| Standing explanation in a panel | **0 words** | Explanation belongs in the step prose, which changes as you step. |
| Step prose (ExplainCard) | 25 words | One sentence about *this* step. |
| Empty state | 8 words | "Press play to begin." Not a paragraph. |
| Footnote / caveat | 15 words, and only if a reader would be wrong without it | |

**Voice.** Short declaratives. No em-dash asides. No "the proof that…", no "each one a
recorded…", no restating what the reader can see. Never explain the explanation. If a sentence
begins by justifying why a panel exists, delete the sentence. Prefer a noun to a clause: "4
passes" beats "this computation took four passes to converge".

**Density.** A reader should reach real content within ~200px of the page top.
- ONE band of chrome above the content, not seven. Merge the running head into the title line.
- Max TWO columns of content. Reference material (grammar rails, production lists, legends)
  collapses behind a toggle — it is not a permanent third column.
- Secondary controls (speed, micro-steps, jump-to) live behind one affordance, not spread across
  the panel. Transport (prev / play / next / reset) and the step counter are the only controls
  visible by default.
- If a thing is on screen and the reader is not using it right now, it should be one interaction
  away instead.

**The test:** delete every sentence you are not sure earns its place, then look again. If the
page still teaches, the sentence was decoration. This app is used by someone who wants to watch
an algorithm run, not read an essay about it.


The lab is a **well-set textbook that happens to be a developer tool**. The visual system is
paper, ink, rules and whitespace. Read this before changing any view.

## The five rules

1. **Rules, not boxes.** A titled region is a `.section`: a serif title, a hairline under it, air
   below. It is *not* a rounded rectangle with a border and a fill. Replace every
   `rounded-lg border border-line bg-surface p-4` wrapper with `.section` + `.section-head`.
   A border is earned, not default — only `.framed` (graphs, code listings, anything that
   scrolls) and `.overlay-panel` (popover, select, dialog) may have one.

2. **Hierarchy comes from type, not from chrome.** Serif for prose and titles, mono for every
   artifact (tables, automata labels, TAC, assembly, citations). That contrast is the hierarchy.
   Use `.page-title` once per page, `.section-title` per region, `.prose-note` for explanation.
   Never make something bigger *and* boxed *and* coloured to say "this matters" — pick one.

3. **One accent.** Oxblood (terracotta in dark) means **the current thing** — the step's focus.
   Nothing else uses it. Status keeps its own vocabulary (`ok` / `warn` / `err`) and every
   emphasis carries a shape as well as a colour, so it survives greyscale.

4. **One sheet, neutral stock.** `--surface` is the sheet everything sits on. Do not stack a
   lighter card on a darker canvas to separate content — separate it with a rule and 2rem of
   space. `--raised` is for genuinely interactive chrome (hover, chips), not for grouping.

   The stock is **neutral slate — deliberately NOT warm paper.** An earlier revision of this
   file called for a cream/oxblood palette; it was tested and **rejected as fatiguing**, and
   must not be reintroduced. Surfaces and ink carry no colour cast, dark is the default and the
   tuned-first theme, the dark canvas is never pure `#000` (halation), and dark text is never
   pure `#fff`. Tokens in `styles/theme.css` are the authority — if this document and the
   tokens ever disagree about hue, **the tokens win.**

5. **Density is earned by whitespace.** These views are information-dense by nature; the fix is
   generous vertical rhythm between regions (2rem) and tight, tabular alignment inside them —
   not shrinking type. Nothing below `--text-2xs` may form a sentence.

## Available primitives (styles/index.css)

| Class | Use |
|---|---|
| `.section` | a titled region (2rem apart from its siblings) |
| `.section-head` | title row: serif title + mono meta, hairline under |
| `.section-title` | the serif title |
| `.section-meta` | mono metadata beside a title (counts, passes) |
| `.page-title` | the page's opening statement, once per route |
| `.prose-note` | explanatory serif prose, measure-limited to 68ch |
| `.framed` | opt-in border for a contained/scrolling artifact |
| `.rule` | standalone hairline separator |
| `.artifact-scroll` | wide artifact scrolls in its own box, never widens the page |

## Type

- **Source Serif 4** (`--font-serif`, also `font-sans`) — prose, titles, explanations.
- **JetBrains Mono** (`--font-mono`) — all data: tables, grammar productions, item sets, TAC,
  assembly, citations, counters. Tabular figures on, ligatures off (`->`, `!=`, `&&` are
  characters being taught).
- Scale unchanged: `text-code` 13 listings · `text-xs` 12 dense grids · `text-2xs` 11 chips and
  citations · `text-3xs` 10 counters only.

Both fonts are **bundled** (`@fontsource-variable/*`). Never add a CDN font link — the app must
run with no network.

## What "done" looks like on a page

- One `.page-title`, then a `.prose-note` of one or two sentences saying what this phase does.
- Regions separated by rules and space; no nested bordered cards anywhere.
- The artifact (table / graph / listing) is the visually heaviest thing on screen — chrome
  recedes.
- Controls read as text with a rule or a soft fill for the active one, not as a wall of
  equal-weight buttons.
- Empty and error states are quiet prose, not loud boxes.
- Verify in **both** themes; the warmth is the identity in each.
