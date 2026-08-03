/**
 * The stage set for the scroll-driven pipeline, derived — never invented — from
 * `max-program.ts`.
 *
 * Everything here is a POSITION or a CORRESPONDENCE computed from artifacts the
 * repository's own `compile()` produced. No listing is retyped, no count is
 * asserted by hand. If a number in `max-program.ts` changes, every position in
 * this file moves with it.
 *
 * Three correspondences do real work, and all three are facts about `max.c`:
 *
 *   token → (line, col)   where the lexeme physically sits in the source, found
 *                         by scanning `SOURCE` for the lexemes in scan order.
 *   AST node → token      the token each node was built from, so the parse tree
 *                         is literally assembled out of the cubes the scanner
 *                         produced. Ten tokens (punctuation and type keywords)
 *                         are consumed by productions rather than kept as
 *                         nodes; those cubes leave the frame, which is what
 *                         actually happens to them.
 *   AST node → quadruple  the quad each subtree flattened into, so the collapse
 *                         from tree to three-address code lands where it should.
 *
 * World units: the camera frames roughly x ∈ [-6, 6], y ∈ [-4, 4].
 */
import { ASM_HERO, AST_NODES, BLOCKS, QUADS, SOURCE, SOURCE_LINES, TOKENS } from '../max-program';

// ── Source placement ─────────────────────────────────────────────────────────

export interface TokenPlacement {
  /** 1-based line in `SOURCE_LINES`. */
  readonly line: number;
  /** 1-based column. Agrees with `SYMBOL_TABLE` for `max`, `a` and `b`. */
  readonly col: number;
  /** Absolute index of the character AFTER the lexeme, for typing sync. */
  readonly endOffset: number;
}

/**
 * Walk `SOURCE` once, finding each lexeme at or after the cursor. Because the
 * tokens are in scan order this is exact, and it degrades to "next occurrence"
 * rather than throwing if the listing is ever regenerated with different
 * spacing — a public page must not white-screen over a layout detail.
 */
export const TOKEN_PLACEMENTS: readonly TokenPlacement[] = (() => {
  const out: TokenPlacement[] = [];
  let cursor = 0;
  for (const token of TOKENS) {
    const at = SOURCE.indexOf(token.lexeme, cursor);
    const start = at < 0 ? cursor : at;
    const before = SOURCE.slice(0, start);
    const nl = before.lastIndexOf('\n');
    out.push({
      line: before.split('\n').length,
      col: start - nl,
      endOffset: start + token.lexeme.length,
    });
    cursor = start + token.lexeme.length;
  }
  return out;
})();

/** Fraction of `SOURCE` that must be typed before token `i` exists. */
export const TOKEN_TYPED_FRACTION: readonly number[] = TOKEN_PLACEMENTS.map(
  (p) => p.endOffset / SOURCE.length,
);

/**
 * Character cell used to lay the source out in 3D. Exported because the type
 * has to be SET on this grid, not merely positioned on it: a lexeme's glyph run
 * is `lexeme.length * CHAR_W` wide by definition of a monospace listing, and a
 * label drawn any narrower turns `int max(int a, int b) {` into loose words
 * with phantom gaps where the source has none.
 */
export const CHAR_W = 0.235;
const LINE_H = 0.66;
const LONGEST_LINE = Math.max(...SOURCE_LINES.map((l) => l.length));

/** Width of the source listing in world units, for fitting it to a frame. */
export const SOURCE_EXTENT_X = LONGEST_LINE * CHAR_W;
const SRC_ORIGIN_X = -((LONGEST_LINE - 1) * CHAR_W) / 2;
const SRC_ORIGIN_Y = ((SOURCE_LINES.length - 1) * LINE_H) / 2;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });

/** Where a token sits while it is still text on the page. */
export const TOKEN_SOURCE_POS: readonly Vec3[] = TOKEN_PLACEMENTS.map((p, i) => {
  const width = TOKENS[i]!.lexeme.length;
  // Centre the cube over the run of characters it covers.
  const centreCol = p.col - 1 + (width - 1) / 2;
  return v3(SRC_ORIGIN_X + centreCol * CHAR_W, SRC_ORIGIN_Y - (p.line - 1) * LINE_H, 0);
});

/** Cube footprint: as wide as the lexeme, so the shape carries the length. */
export const TOKEN_SIZE: readonly Vec3[] = TOKENS.map((t) =>
  v3(Math.max(0.42, t.lexeme.length * CHAR_W + 0.2), 0.46, 0.46),
);

// ── The settled token row ────────────────────────────────────────────────────

/**
 * After the scatter the cubes settle into reading order. One row of 23 would be
 * six metres of monospace, so they WRAP at a run width — the same thing
 * `/lab/lex` does with the token stream.
 *
 * Parameterised by that width because narrow viewports must re-flow this row,
 * not squash it. The cubes are as wide as their lexemes and the type inside
 * them is set on the same grid, so scaling the x axis (which is the right
 * answer for the tidy tree and the CFG) would slide 23 boxes into each other
 * and print `intmax(int a,int b)`.
 */
export function tokenRow(maxRun: number): readonly Vec3[] {
  const GAP = 0.16;
  const MAX_RUN = maxRun;
  const rows: number[][] = [[]];
  const widths = TOKEN_SIZE.map((s) => s.x);
  let run = 0;
  for (let i = 0; i < TOKENS.length; i++) {
    const w = widths[i]!;
    if (run > 0 && run + GAP + w > MAX_RUN) {
      rows.push([]);
      run = 0;
    }
    rows[rows.length - 1]!.push(i);
    run += (run > 0 ? GAP : 0) + w;
  }

  const out: Vec3[] = new Array(TOKENS.length);
  const rowH = 0.78;
  const top = ((rows.length - 1) * rowH) / 2;
  rows.forEach((row, r) => {
    const total = row.reduce((acc, i, k) => acc + widths[i]! + (k > 0 ? GAP : 0), 0);
    let x = -total / 2;
    for (const i of row) {
      out[i] = v3(x + widths[i]! / 2, top - r * rowH, 0);
      x += widths[i]! + GAP;
    }
  });
  return out;
}

/** The row at the width a wide stage gives it. */
export const TOKEN_ROW_POS: readonly Vec3[] = tokenRow(7.4);

/**
 * Deterministic scatter direction — a hash of the index, not `Math.random()`,
 * so the scene is the same on every load and on every machine (the lab's whole
 * determinism argument would be silly to break in its own shop window).
 */
export const TOKEN_SCATTER: readonly Vec3[] = TOKENS.map((_, i) => {
  const a = Math.sin(i * 12.9898) * 43758.5453;
  const b = Math.sin(i * 78.233) * 12345.6789;
  const c = Math.sin(i * 39.425) * 24634.6345;
  const fr = (n: number) => n - Math.floor(n);
  return v3((fr(a) - 0.5) * 2, (fr(b) - 0.5) * 2, fr(c) * 0.9 + 0.15);
});

// ── The parse tree ───────────────────────────────────────────────────────────

/**
 * `AST_NODES` is a depth-tagged pre-order walk, so the parent of a node is the
 * most recent node one level shallower.
 */
export const AST_PARENT: readonly number[] = (() => {
  const parents: number[] = [];
  const openAt: number[] = [];
  AST_NODES.forEach((n, i) => {
    parents[i] = n.depth === 0 ? -1 : (openAt[n.depth - 1] ?? -1);
    openAt[n.depth] = i;
  });
  return parents;
})();

/**
 * Box-drawing gutters for the AST printed as text, computed once from the depth
 * sequence: a node gets `├─` when a sibling follows it and `└─` when it is the
 * last, and each ancestor that still has siblings below leaves a `│` behind.
 * Shared, so the listing on `/` and the panel in the pipeline are the same tree.
 */
export const AST_PREFIXES: readonly string[] = (() => {
  const hasLaterSibling = (index: number): boolean => {
    const depth = AST_NODES[index]!.depth;
    for (let j = index + 1; j < AST_NODES.length; j++) {
      const d = AST_NODES[j]!.depth;
      if (d < depth) return false;
      if (d === depth) return true;
    }
    return false;
  };
  const nearestAncestorAt = (index: number, depth: number): number => {
    for (let j = index - 1; j >= 0; j--) if (AST_NODES[j]!.depth === depth) return j;
    return -1;
  };

  return AST_NODES.map((node, i) => {
    if (node.depth === 0) return '';
    let gutter = '';
    for (let d = 1; d < node.depth; d++) {
      const ancestor = nearestAncestorAt(i, d);
      gutter += ancestor >= 0 && hasLaterSibling(ancestor) ? '│  ' : '   ';
    }
    return gutter + (hasLaterSibling(i) ? '├─ ' : '└─ ');
  });
})();

export const AST_CHILDREN: readonly (readonly number[])[] = (() => {
  const kids: number[][] = AST_NODES.map(() => []);
  AST_PARENT.forEach((p, i) => {
    if (p >= 0) kids[p]!.push(i);
  });
  return kids;
})();

/**
 * The token each node was built from. Hand-checked against `max.c` — this is a
 * fact about the parse, so it is written out rather than guessed:
 *
 *   FuncDef ← `max`        Param ← the parameter's identifier
 *   CompoundStmt ← `{`     IfStmt ← `if`      Binary ← `>`
 *   ReturnStmt ← its own `return`             Ident ← that occurrence
 *
 * `Program` has no token; it is the accept action, not a symbol.
 */
export const NODE_TOKEN: readonly number[] = [
  -1, // 0  Program
  1, //  1  FuncDef int max      → id `max`
  4, //  2  Param int a          → id `a`
  7, //  3  Param int b          → id `b`
  9, //  4  CompoundStmt         → `{`
  10, // 5  IfStmt               → `if`
  13, // 6  Binary >             → `>`
  12, // 7  Ident a              → `a` in the condition
  14, // 8  Ident b              → `b` in the condition
  16, // 9  ReturnStmt           → first `return`
  17, // 10 Ident a              → `a` in `return a`
  19, // 11 ReturnStmt           → second `return`
  20, // 12 Ident b              → `b` in `return b`
];

/** Tokens with no node of their own: punctuation and the `int` type keywords. */
export const UNPARSED_TOKENS: readonly number[] = TOKENS.map((_, i) => i).filter(
  (i) => !NODE_TOKEN.includes(i),
);

/**
 * Tidy layout: leaves take consecutive slots left to right, a parent sits over
 * the midpoint of its children, and depth becomes both height and distance —
 * the tree leans away from the camera as it descends, so rotating it reads as
 * depth rather than as a flat diagram spinning.
 */
export const AST_POS: readonly Vec3[] = (() => {
  const slot: number[] = new Array(AST_NODES.length).fill(0);
  let next = 0;
  const walk = (i: number): void => {
    const kids = AST_CHILDREN[i]!;
    if (kids.length === 0) {
      slot[i] = next++;
      return;
    }
    for (const k of kids) walk(k);
    slot[i] = (slot[kids[0]!]! + slot[kids[kids.length - 1]!]!) / 2;
  };
  walk(0);

  const leaves = next - 1;
  const maxDepth = Math.max(...AST_NODES.map((n) => n.depth));
  return AST_NODES.map((n, i) => {
    const x = (slot[i]! - leaves / 2) * 1.62;
    const y = (maxDepth / 2 - n.depth) * 1.12;
    const z = (maxDepth / 2 - n.depth) * 0.34;
    return v3(x, y, z);
  });
})();

/** Node cube footprint — wide enough for the longest kind label. */
export const AST_SIZE: readonly Vec3[] = AST_NODES.map((n) =>
  v3(Math.max(0.62, n.kind.length * 0.115 + 0.34), 0.44, 0.44),
);

/** The 12 parent→child edges, as flat index pairs. */
export const AST_EDGES: readonly (readonly [number, number])[] = AST_PARENT.map(
  (p, i) => [p, i] as const,
).filter(([p]) => p >= 0);

/**
 * Types the semantic phase attaches, taken from `SCOPES`. Only the three names
 * that HAVE a type are annotated; the tree's structural nodes are not typed by
 * this compiler and are not given a label they do not own.
 */
export const TYPE_ANNOTATIONS: readonly { node: number; text: string }[] = [
  { node: 1, text: 'int (int, int)' },
  { node: 2, text: 'int' },
  { node: 3, text: 'int' },
  { node: 7, text: 'int' },
  { node: 8, text: 'int' },
  { node: 10, text: 'int' },
  { node: 12, text: 'int' },
];

// ── Quadruples ───────────────────────────────────────────────────────────────

/**
 * Which quad each subtree flattened into. The condition and its operands become
 * quad 0 (`if a > b goto L1`); each `return` and its operand becomes its own
 * quad; the function frame collapses onto the entry quad.
 */
export const NODE_QUAD: readonly number[] = [
  0, // Program
  0, // FuncDef
  0, // Param a
  0, // Param b
  0, // CompoundStmt
  0, // IfStmt
  0, // Binary >
  0, // Ident a
  0, // Ident b
  3, // ReturnStmt  → `return a`
  3, // Ident a
  5, // ReturnStmt  → `return b`
  5, // Ident b
];

export const QUAD_SIZE: Vec3 = v3(5.5, 0.54, 0.36);

/** The IR stack: six slabs, in emission order, top to bottom. */
export const QUAD_IR_POS: readonly Vec3[] = QUADS.map((q) =>
  v3(0, ((QUADS.length - 1) / 2 - q.index) * 0.74, 0),
);

// ── Control-flow graph ───────────────────────────────────────────────────────

/**
 * `BLOCKS` gives four blocks and five successor edges; the CFG the optimizer
 * built also has the entry edge, which is the sixth the caption counts.
 */
export const CFG_NODE_POS: Record<string, Vec3> = {
  entry: v3(0, 3.1, 0),
  B0: v3(0, 1.75, 0),
  B1: v3(-2.6, 0.25, 0),
  B2: v3(2.6, 0.25, 0),
  B3: v3(-2.6, -1.25, 0),
  exit: v3(0, -2.7, 0),
};

export const CFG_EDGES: readonly (readonly [string, string])[] = [
  ['entry', 'B0'],
  ...BLOCKS.flatMap((b) => b.to.map((t) => [b.id, t] as const)),
];

/** Quad index → block id, read off `BLOCKS[].quads` ("0", "1", "2–3", "4–5"). */
export const QUAD_BLOCK: readonly string[] = (() => {
  const out: string[] = new Array(QUADS.length).fill(BLOCKS[0]!.id);
  for (const b of BLOCKS) {
    const [lo, hi] = b.quads.split('–');
    const from = Number(lo);
    const to = hi === undefined ? from : Number(hi);
    for (let i = from; i <= to; i++) out[i] = b.id;
  }
  return out;
})();

/** Where each slab sits once its block has claimed it. */
export const QUAD_OPT_POS: readonly Vec3[] = (() => {
  const perBlock = new Map<string, number[]>();
  QUAD_BLOCK.forEach((id, i) => {
    const list = perBlock.get(id) ?? [];
    list.push(i);
    perBlock.set(id, list);
  });
  const out: Vec3[] = new Array(QUADS.length);
  for (const [id, quads] of perBlock) {
    const centre = CFG_NODE_POS[id]!;
    const top = ((quads.length - 1) * 0.42) / 2;
    quads.forEach((q, k) => {
      out[q] = v3(centre.x, centre.y + top - k * 0.42, centre.z);
    });
  }
  return out;
})();

/** The slab shrinks to block width once it is inside a block. */
export const QUAD_OPT_SIZE: Vec3 = v3(2.45, 0.4, 0.3);

// ── Code generation ──────────────────────────────────────────────────────────

/**
 * The ten hero instructions, tinted by the register they touch. The allocation
 * is `REGISTER_ASSIGNMENT`: `a → %rcx`, `b → %rbx`, nothing spilled — so a line
 * mentioning `%rcx` is carrying `a`, and the colour says which live range the
 * instruction belongs to. Lines touching neither are frame management.
 */
export type RegisterTint = 'a' | 'b' | 'none';

export const ASM_TINT: readonly RegisterTint[] = ASM_HERO.map((line) => {
  const rcx = line.text.includes('%rcx');
  const rbx = line.text.includes('%rbx');
  if (rcx && !rbx) return 'a';
  if (rbx && !rcx) return 'b';
  return 'none';
});

export const ASM_PLATE_SIZE: Vec3 = v3(5.2, 0.42, 0.26);

export const ASM_POS: readonly Vec3[] = ASM_HERO.map((_, i) =>
  v3(0, ((ASM_HERO.length - 1) / 2 - i) * 0.5, 0),
);

/**
 * Each instruction comes from a block: the prologue and the comparison belong
 * to `B0`, and the two jumps name the blocks they target. Used to fly the
 * plates out of the CFG rather than fading them in from nowhere.
 */
export const ASM_FROM_BLOCK: readonly string[] = ASM_HERO.map((line) => {
  if (line.text.includes('.Lmax_L1')) return 'B2';
  if (line.text.includes('.Lmax_L2')) return 'B1';
  return 'B0';
});
