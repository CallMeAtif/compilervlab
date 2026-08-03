/**
 * THE RIG — one C function, physically transformed, with scroll as the clock.
 *
 * This file builds the whole scene graph once and then drives every object from
 * a single scalar: `s ∈ [0, 7]`, the scroll position expressed in phases.
 *
 *   s ∈ [0,1)  SOURCE     `max.c` types itself; each lexeme materialises where
 *                         it actually sits in the file.
 *   s ∈ [1,2)  LEX        the text inflates into 23 token cubes, scatters, and
 *                         settles into scan order.
 *   s ∈ [2,3)  SYNTAX     13 of those cubes fly up into the parse tree they
 *                         were reduced into; the other 10 — punctuation and the
 *                         `int` keywords, which productions consume rather than
 *                         keep — leave the frame.
 *   s ∈ [3,4)  SEMANTIC   the tree takes its types; annotations attach.
 *   s ∈ [4,5)  IR         the tree collapses into six quadruple slabs.
 *   s ∈ [5,6)  OPT        slabs sort into four basic blocks wired as a CFG, and
 *                         six passes sweep through it.
 *   s ∈ [6,7]  CODEGEN    blocks compact and the x86-64 plates fly out, tinted
 *                         by the register the instruction holds.
 *
 * There is no keyframe track and no animation library here: every transform is
 * a closed-form function of `s`, so scrubbing backwards, jumping with the
 * keyboard, or landing mid-page from a deep link all produce the same frame.
 * Damping is applied only to the pointer and the camera, where a spring reads
 * as physicality rather than as lag.
 *
 * Nothing in the scene is invented — see program-geometry.ts, which derives
 * every position from artifacts in max-program.ts.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  type PerspectiveCamera,
} from 'three';
import { ASM_HERO, AST_NODES, BLOCKS, QUADS, TOKENS } from '../max-program';
import {
  ASM_FROM_BLOCK,
  ASM_PLATE_SIZE,
  ASM_POS,
  ASM_TINT,
  AST_EDGES,
  CHAR_W,
  AST_POS,
  AST_SIZE,
  CFG_EDGES,
  CFG_NODE_POS,
  NODE_QUAD,
  NODE_TOKEN,
  QUAD_BLOCK,
  QUAD_IR_POS,
  QUAD_OPT_POS,
  QUAD_OPT_SIZE,
  QUAD_SIZE,
  SOURCE_EXTENT_X,
  TOKEN_ROW_POS,
  TOKEN_SCATTER,
  TOKEN_SIZE,
  TOKEN_SOURCE_POS,
  TOKEN_TYPED_FRACTION,
  TYPE_ANNOTATIONS,
  tokenRow,
  type Vec3,
} from './program-geometry';
import { EMPTY_RECT, type Atlas, type LabelSpec } from './atlas';
import type { ScenePalette } from './palette';

// ── Small maths ──────────────────────────────────────────────────────────────

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Smoothstep. Every stage transition uses it, so the whole piece shares a curve. */
const ease = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
/** Ramp between two thresholds — "fade in from a to b". */
const band = (t: number, a: number, b: number): number => ease((t - a) / (b - a));
const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * Math.min(dt, 0.1)));

// ── Label helpers ────────────────────────────────────────────────────────────

interface Label {
  readonly mesh: Mesh;
  readonly material: MeshBasicMaterial;
  readonly aspect: number;
  /** Sets height in world units; width follows the glyph run. */
  size(height: number): void;
  /** Sets the width of the INKED run in world units; height follows. */
  fitWidth(width: number): void;
}

function makeLabel(atlas: Atlas, key: string, texture = atlas.texture): Label {
  const rect = atlas.rects.get(key) ?? EMPTY_RECT;
  const geometry = new PlaneGeometry(1, 1);
  const uv = geometry.attributes.uv as BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, lerp(rect.u0, rect.u1, uv.getX(i)), lerp(rect.v0, rect.v1, uv.getY(i)));
  }
  uv.needsUpdate = true;

  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    opacity: 0,
  });
  const mesh = new Mesh(geometry, material);
  mesh.renderOrder = 2;
  mesh.frustumCulled = false;

  return {
    mesh,
    material,
    aspect: rect.aspect,
    size(height: number) {
      mesh.scale.set(height * rect.aspect, height, 1);
    },
    fitWidth(width: number) {
      const height = width / rect.inkAspect;
      mesh.scale.set(height * rect.aspect, height, 1);
    },
  };
}

/** The complete label inventory, so the atlas is packed in one pass. */
export function labelSpecs(): LabelSpec[] {
  const specs: LabelSpec[] = [];
  TOKENS.forEach((t, i) => {
    specs.push({ key: `lex:${i}`, text: t.lexeme, weight: 600 });
    specs.push({ key: `cls:${i}`, text: tokenClass(i) });
  });
  AST_NODES.forEach((n, i) => {
    specs.push({ key: `kind:${i}`, text: n.kind, weight: 600 });
    if (n.detail) specs.push({ key: `detail:${i}`, text: n.detail });
  });
  TYPE_ANNOTATIONS.forEach((a, i) => {
    specs.push({ key: `type:${i}`, text: `: ${a.text}` });
  });
  QUADS.forEach((q) => {
    specs.push({ key: `quad:${q.index}`, text: `${q.index}   ${q.text}` });
  });
  BLOCKS.forEach((b) => {
    specs.push({ key: `block:${b.id}`, text: b.id, weight: 600 });
  });
  specs.push({ key: 'cfg:entry', text: 'entry' });
  specs.push({ key: 'cfg:exit', text: 'exit' });
  ASM_HERO.forEach((line, i) => {
    specs.push({ key: `asm:${i}`, text: line.text });
  });
  return specs;
}

/**
 * The class the scanner labels a token with. For a keyword or punctuator the
 * class IS the lexeme, which would print the same word twice, so those two
 * families are named — the same rule the hero figure has always used.
 */
function tokenClass(i: number): string {
  const t = TOKENS[i]!;
  if (t.type !== t.lexeme) return t.type;
  return /^[a-z]+$/.test(t.type) ? 'keyword' : 'punct';
}

// ── The rig ──────────────────────────────────────────────────────────────────

export interface RigFrame {
  /** Scroll position in phases, 0 … 7. */
  s: number;
  /** Fraction of `SOURCE` typed so far, 0 … 1. */
  typed: number;
  /** Pointer in the stage, −1 … 1 on each axis. */
  pointerX: number;
  pointerY: number;
  /** Seconds since mount, and since the last frame. */
  time: number;
  dt: number;
  /** Widen the framing on small viewports instead of squashing the scene. */
  zoomOut: number;
  /** Raise the whole scene, so a phone's panel does not sit on top of it. */
  lift: number;
  /** True when the reader asked for reduced motion: hold the composed state. */
  reduced: boolean;
}

interface TokenObj {
  group: Group;
  box: Mesh;
  boxMat: MeshStandardMaterial;
  edges: LineSegments;
  edgeMat: LineBasicMaterial;
  lexeme: Label;
  cls: Label;
  kind: Label | null;
  detail: Label | null;
  node: number;
}

interface SlabObj {
  group: Group;
  box: Mesh;
  boxMat: MeshStandardMaterial;
  edges: LineSegments;
  edgeMat: LineBasicMaterial;
  label: Label;
}

interface PlateObj {
  group: Group;
  box: Mesh;
  boxMat: MeshStandardMaterial;
  edges: LineSegments;
  edgeMat: LineBasicMaterial;
  label: Label;
  tint: 'a' | 'b' | 'none';
  from: Vec3;
}

export interface Rig {
  readonly root: Group;
  applyPalette(palette: ScenePalette): void;
  update(frame: RigFrame, camera: PerspectiveCamera): void;
  dispose(): void;
}

const UNIT_BOX = new BoxGeometry(1, 1, 1);
const UNIT_EDGES = new EdgesGeometry(UNIT_BOX);

/**
 * Height of a parse-tree node's kind label. One value for the whole tree, so
 * `Ident` and `CompoundStmt` are set at the same size and the tree reads as a
 * diagram rather than as thirteen differently-scaled captions. Checked against
 * the widest kind: `CompoundStmt` runs 1.43 world units at this height, inside
 * a 1.72-unit node.
 */
const NODE_LABEL_H = 0.27;

function setPos(o: { position: { set(x: number, y: number, z: number): void } }, v: Vec3): void {
  o.position.set(v.x, v.y, v.z);
}

/**
 * `spread` narrows the layout's HORIZONTAL reach for narrow viewports. It is
 * not a squash: cube sizes, type and depth are untouched, so what changes is
 * the tidy-tree's sibling gap and the CFG's column separation — exactly the
 * two numbers a responsive graph layout is supposed to change. Passing it at
 * build time keeps the static geometry (block frames, CFG edges) correct.
 */
export function buildRig(atlas: Atlas, spread = 1): Rig {
  const root = new Group();
  /** Horizontal position, narrowed. Never applied to a SIZE. */
  const sx = (x: number): number => x * spread;
  /**
   * The frame's horizontal budget in world units — the same number the camera's
   * zoom-out is solved for in Scene.tsx. Two layouts have to RE-FLOW inside it
   * rather than be scaled by `spread`, because their spacing is type and type
   * does not scale on one axis: the source listing (a monospace grid) and the
   * settled token row (cubes cut to their lexemes).
   */
  const budget = 9 * spread;
  const rowPos = spread < 1 ? tokenRow(Math.max(3, budget - 0.6)) : TOKEN_ROW_POS;
  /**
   * The source phase is the CLOSEST the camera ever gets (CAM_Z[0] = 9.4 against
   * the 11 the zoom-out is solved for), so it has about 85% of the nominal
   * budget to work in. Fitting the listing to that is a UNIFORM scale — every
   * column, every line and the type itself — which is a zoom, and leaves the
   * monospace grid intact. Comes out at 1 on any wide stage.
   */
  const srcFit = Math.min(1, (budget * 0.85) / SOURCE_EXTENT_X);
  const cfgAt = (id: string): Vec3 => {
    const p = CFG_NODE_POS[id]!;
    return { x: sx(p.x), y: p.y, z: p.z };
  };
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(t: T): T => {
    disposables.push(t);
    return t;
  };

  // ── Token cubes (also: the parse tree's nodes) ────────────────────────────
  const tokens: TokenObj[] = TOKENS.map((_, i) => {
    const group = new Group();
    const boxMat = track(
      new MeshStandardMaterial({ roughness: 0.55, metalness: 0.12, transparent: true, opacity: 0 }),
    );
    const box = new Mesh(UNIT_BOX, boxMat);
    const edgeMat = track(new LineBasicMaterial({ transparent: true, opacity: 0 }));
    const edges = new LineSegments(UNIT_EDGES, edgeMat);
    edges.renderOrder = 1;

    const node = NODE_TOKEN.indexOf(i);
    const lexeme = makeLabel(atlas, `lex:${i}`);
    const cls = makeLabel(atlas, `cls:${i}`);
    const kind = node >= 0 ? makeLabel(atlas, `kind:${node}`) : null;
    const detail = node >= 0 && AST_NODES[node]!.detail ? makeLabel(atlas, `detail:${node}`) : null;

    group.add(box, edges, lexeme.mesh, cls.mesh);
    if (kind) group.add(kind.mesh);
    if (detail) group.add(detail.mesh);
    root.add(group);
    disposables.push(lexeme.mesh.geometry, cls.mesh.geometry, lexeme.material, cls.material);
    if (kind) disposables.push(kind.mesh.geometry, kind.material);
    if (detail) disposables.push(detail.mesh.geometry, detail.material);

    return { group, box, boxMat, edges, edgeMat, lexeme, cls, kind, detail, node };
  });

  // ── Nodes with no token of their own ──────────────────────────────────────
  /**
   * `Program` is the accept action, not a symbol: no token was reduced into it,
   * so no cube can fly up and become it. It still has to EXIST — it is the root
   * of the tree the parser built and the top of the listing beside the stage —
   * so it is built here and enters from above as the parse completes.
   */
  const phantoms = AST_NODES.map((node, i) => (NODE_TOKEN[i]! >= 0 ? null : { node, index: i }))
    .filter((p): p is { node: (typeof AST_NODES)[number]; index: number } => p !== null)
    .map(({ index }) => {
      const group = new Group();
      const boxMat = track(
        new MeshStandardMaterial({
          roughness: 0.55,
          metalness: 0.12,
          transparent: true,
          opacity: 0,
        }),
      );
      const box = new Mesh(UNIT_BOX, boxMat);
      const edgeMat = track(new LineBasicMaterial({ transparent: true, opacity: 0 }));
      const edges = new LineSegments(UNIT_EDGES, edgeMat);
      const kind = makeLabel(atlas, `kind:${index}`);
      group.add(box, edges, kind.mesh);
      group.visible = false;
      root.add(group);
      disposables.push(kind.mesh.geometry, kind.material);
      return { group, box, boxMat, edges, edgeMat, kind, index };
    });

  /** AST node index → the group standing at that node, whatever produced it. */
  const byNode: (Group | undefined)[] = AST_NODES.map(() => undefined);
  for (const t of tokens) if (t.node >= 0) byNode[t.node] = t.group;
  for (const p of phantoms) byNode[p.index] = p.group;

  // ── Parse-tree edges ──────────────────────────────────────────────────────
  const treeEdgeGeom = track(new BufferGeometry());
  const treeEdgePos = new Float32Array(AST_EDGES.length * 6);
  treeEdgeGeom.setAttribute('position', new BufferAttribute(treeEdgePos, 3));
  const treeEdgeMat = track(new LineBasicMaterial({ transparent: true, opacity: 0 }));
  const treeEdges = new LineSegments(treeEdgeGeom, treeEdgeMat);
  treeEdges.frustumCulled = false;
  root.add(treeEdges);

  // ── Type annotations ──────────────────────────────────────────────────────
  const typeLabels = TYPE_ANNOTATIONS.map((a, i) => {
    const label = makeLabel(atlas, `type:${i}`);
    root.add(label.mesh);
    disposables.push(label.mesh.geometry, label.material);
    return { label, node: a.node };
  });

  // ── Quadruple slabs ───────────────────────────────────────────────────────
  const slabs: SlabObj[] = QUADS.map((q) => {
    const group = new Group();
    const boxMat = track(
      new MeshStandardMaterial({ roughness: 0.6, metalness: 0.08, transparent: true, opacity: 0 }),
    );
    const box = new Mesh(UNIT_BOX, boxMat);
    const edgeMat = track(new LineBasicMaterial({ transparent: true, opacity: 0 }));
    const edges = new LineSegments(UNIT_EDGES, edgeMat);
    const label = makeLabel(atlas, `quad:${q.index}`);
    group.add(box, edges, label.mesh);
    group.visible = false;
    root.add(group);
    disposables.push(label.mesh.geometry, label.material);
    return { group, box, boxMat, edges, edgeMat, label };
  });

  // ── Basic-block frames ────────────────────────────────────────────────────
  const blockFrames = BLOCKS.map((b) => {
    const count = QUAD_BLOCK.filter((id) => id === b.id).length;
    const mat = track(new LineBasicMaterial({ transparent: true, opacity: 0 }));
    const frame = new LineSegments(UNIT_EDGES, mat);
    frame.scale.set(QUAD_OPT_SIZE.x + 0.42, count * 0.42 + 0.34, QUAD_OPT_SIZE.z + 0.3);
    const at = cfgAt(b.id);
    setPos(frame, at);
    const label = makeLabel(atlas, `block:${b.id}`);
    label.size(0.26);
    // Sat OVER the frame's top-left corner, not outside its left edge: outside,
    // the leftmost block's label ran off the canvas at 1440 and `B1` rendered
    // as `1`. Inside the frame's own horizontal extent it cannot.
    setPos(label.mesh, {
      x: at.x - (QUAD_OPT_SIZE.x + 0.42) / 2 + (0.26 * label.aspect) / 2,
      y: at.y + (count * 0.42 + 0.34) / 2 + 0.24,
      z: at.z,
    });
    root.add(frame, label.mesh);
    disposables.push(label.mesh.geometry, label.material);
    return { frame, mat, label };
  });

  const terminals = (['entry', 'exit'] as const).map((id) => {
    const mat = track(new LineBasicMaterial({ transparent: true, opacity: 0 }));
    const ring = new LineSegments(UNIT_EDGES, mat);
    ring.scale.set(1.15, 0.42, 0.3);
    setPos(ring, cfgAt(id));
    const label = makeLabel(atlas, `cfg:${id}`);
    setPos(label.mesh, cfgAt(id));
    label.mesh.position.z += 0.2;
    label.size(0.2);
    root.add(ring, label.mesh);
    disposables.push(label.mesh.geometry, label.material);
    return { mat, label };
  });

  // ── CFG edges ─────────────────────────────────────────────────────────────
  const cfgGeom = track(new BufferGeometry());
  {
    const pos = new Float32Array(CFG_EDGES.length * 6);
    CFG_EDGES.forEach(([from, to], i) => {
      const a = cfgAt(from);
      const b = cfgAt(to);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      // Stop short of each node so the line reads as an arc between boxes.
      const inset = 0.42;
      pos.set(
        [
          a.x + (dx / len) * inset,
          a.y + (dy / len) * inset,
          a.z,
          b.x - (dx / len) * inset,
          b.y - (dy / len) * inset,
          b.z,
        ],
        i * 6,
      );
    });
    cfgGeom.setAttribute('position', new BufferAttribute(pos, 3));
  }
  const cfgMat = track(new LineBasicMaterial({ transparent: true, opacity: 0 }));
  const cfgEdges = new LineSegments(cfgGeom, cfgMat);
  cfgEdges.frustumCulled = false;
  root.add(cfgEdges);

  // ── The optimizer's sweep ─────────────────────────────────────────────────
  const sweepGeom = track(new PlaneGeometry(7.4, 0.09));
  const sweepMat = track(
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, toneMapped: false }),
  );
  const sweep = new Mesh(sweepGeom, sweepMat);
  sweep.renderOrder = 3;
  sweep.frustumCulled = false;
  root.add(sweep);

  // ── x86-64 plates ─────────────────────────────────────────────────────────
  const plates: PlateObj[] = ASM_HERO.map((_, i) => {
    const group = new Group();
    const boxMat = track(
      new MeshStandardMaterial({ roughness: 0.5, metalness: 0.2, transparent: true, opacity: 0 }),
    );
    const box = new Mesh(UNIT_BOX, boxMat);
    box.scale.set(ASM_PLATE_SIZE.x, ASM_PLATE_SIZE.y, ASM_PLATE_SIZE.z);
    const edgeMat = track(new LineBasicMaterial({ transparent: true, opacity: 0 }));
    const edges = new LineSegments(UNIT_EDGES, edgeMat);
    edges.scale.copy(box.scale);
    const label = makeLabel(atlas, `asm:${i}`);
    label.size(0.24);
    label.mesh.position.set(
      -ASM_PLATE_SIZE.x / 2 + 0.16 + (0.24 * label.aspect) / 2,
      0,
      ASM_PLATE_SIZE.z / 2 + 0.02,
    );
    group.add(box, edges, label.mesh);
    group.visible = false;
    root.add(group);
    disposables.push(label.mesh.geometry, label.material);
    return {
      group,
      box,
      boxMat,
      edges,
      edgeMat,
      label,
      tint: ASM_TINT[i]!,
      from: cfgAt(ASM_FROM_BLOCK[i]!),
    };
  });

  // ── Palette ───────────────────────────────────────────────────────────────
  let palette: ScenePalette | null = null;
  const cubeFace = new Color();
  const cubeEdge = new Color();
  const activeEdge = new Color();

  function applyPalette(next: ScenePalette): void {
    palette = next;
    // `raised` in BOTH themes: it is lighter than the canvas in dark and darker
    // than it in light, so a cube separates from the page either way. `surface`
    // in light sits inside a point of the canvas and the cubes vanished.
    cubeFace.copy(next.raised);
    cubeEdge.copy(next.lineStrong);
    activeEdge.copy(next.somaiya);

    for (const t of tokens) {
      t.boxMat.color.copy(cubeFace);
      t.boxMat.emissive.copy(next.dark ? next.canvas : next.raised);
      t.boxMat.emissiveIntensity = next.dark ? 0.3 : 0.1;
      t.edgeMat.color.copy(cubeEdge);
      t.lexeme.material.color.copy(next.ink);
      t.cls.material.color.copy(next.inkFaint);
      t.kind?.material.color.copy(next.ink);
      t.detail?.material.color.copy(next.inkMuted);
    }
    for (const p of phantoms) {
      p.boxMat.color.copy(cubeFace);
      p.boxMat.emissive.copy(next.dark ? next.canvas : next.raised);
      p.boxMat.emissiveIntensity = next.dark ? 0.3 : 0.1;
      p.edgeMat.color.copy(cubeEdge);
      p.kind.material.color.copy(next.ink);
    }
    treeEdgeMat.color.copy(next.lineStrong);
    for (const t of typeLabels) t.label.material.color.copy(next.ok);
    for (const s of slabs) {
      s.boxMat.color.copy(next.dark ? next.code : next.raised);
      s.boxMat.emissive.copy(next.canvas);
      s.boxMat.emissiveIntensity = next.dark ? 0.35 : 0.05;
      s.edgeMat.color.copy(next.lineStrong);
      s.label.material.color.copy(next.ink);
    }
    for (const b of blockFrames) {
      b.mat.color.copy(next.accent);
      b.label.material.color.copy(next.accent);
    }
    for (const t of terminals) {
      t.mat.color.copy(next.inkFaint);
      t.label.material.color.copy(next.inkFaint);
    }
    cfgMat.color.copy(next.lineStrong);
    sweepMat.color.copy(next.somaiya);
    // Additive over a near-black canvas reads as a beam. Over the LIGHT canvas
    // it reads as a washed-out pink band, so light gets a plain composite.
    sweepMat.blending = next.dark ? AdditiveBlending : NormalBlending;
    sweepMat.needsUpdate = true;
    for (const p of plates) {
      p.boxMat.color.copy(
        p.tint === 'a' ? next.accent : p.tint === 'b' ? next.warn : next.dark ? next.raised : next.surface,
      );
      p.boxMat.emissive.copy(next.canvas);
      p.boxMat.emissiveIntensity = next.dark ? 0.25 : 0.05;
      p.edgeMat.color.copy(p.tint === 'none' ? next.lineStrong : next.ink);
      p.label.material.color.copy(
        p.tint === 'none' ? next.inkMuted : next.dark ? next.canvas : next.surface,
      );
    }
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  /** Camera distance per phase — each artifact gets the framing it needs. */
  const CAM_Z = [9.4, 10.8, 12.6, 12.6, 11.0, 13.4, 10.6];
  const CAM_Y = [0, 0, 0.1, 0.1, 0, 0.2, 0];

  let spin = 0;
  /** Damped amplitude of the left-right swing (see the rotation note below). */
  let swingAmp = 0;
  let pointerX = 0;
  let pointerY = 0;
  let camZ = CAM_Z[0]!;
  let camY = 0;

  function update(frame: RigFrame, camera: PerspectiveCamera): void {
    if (!palette) return;
    const { s, dt, time, typed } = frame;

    const tLex = clamp01(s - 1);
    const tSyn = clamp01(s - 2);
    const tSem = clamp01(s - 3);
    const tIr = clamp01(s - 4);
    const tOpt = clamp01(s - 5);
    const tCode = clamp01(s - 6);

    // ── Camera ──────────────────────────────────────────────────────────────
    const phase = Math.min(6, Math.max(0, Math.floor(s)));
    const local = ease(clamp01(s - phase));
    const targetZ = lerp(CAM_Z[phase]!, CAM_Z[Math.min(6, phase + 1)]!, local) * frame.zoomOut;
    const targetY = lerp(CAM_Y[phase]!, CAM_Y[Math.min(6, phase + 1)]!, local);
    if (frame.reduced) {
      camZ = targetZ;
      camY = targetY;
    } else {
      camZ = damp(camZ, targetZ, 5, dt);
      camY = damp(camY, targetY, 5, dt);
    }
    camera.position.set(0, camY, camZ);
    camera.lookAt(0, camY * 0.4, 0);
    root.position.y = frame.lift;

    // ── Pointer parallax + the tree's own slow turn ─────────────────────────
    if (frame.reduced) {
      pointerX = 0;
      pointerY = 0;
    } else {
      pointerX = damp(pointerX, frame.pointerX, 3.4, dt);
      pointerY = damp(pointerY, frame.pointerY, 3.4, dt);
    }
    // The tree turns while it is the subject. The angle ACCUMULATES, so the
    // weight can change without the scene snapping — and once the weight drops
    // (the CFG and the instruction listing are DIAGRAMS, and a diagram you are
    // meant to read must not be spinning) the same value is damped back to
    // square. Nothing ever jumps.
    // Squaring up begins with the COLLAPSE, not after it. The tree is an object
    // and turning it reads as depth; the quadruple stack that replaces it is a
    // numbered listing, and a listing read at an angle is a listing not read.
    const spinWeight = ease(band(s, 1.9, 2.4)) * (1 - ease(band(s, 4.05, 4.55)));
    if (!frame.reduced) {
      // SWING, never a full turn. An accumulating angle carried the tree all the
      // way round, which put node faces edge-on and then backwards — unreadable
      // for something you are meant to read. The phase advances at a constant
      // cadence and the OUTPUT is a sine, so the tree sways gently left-right
      // through about ±20°; the amplitude is damped in and out by the same
      // weight, so it still squares up for the CFG and the listing.
      spin += dt * 0.55;
      swingAmp = damp(swingAmp, spinWeight, 2.4, dt);
    }
    root.rotation.y = Math.sin(spin) * 0.34 * swingAmp + pointerX * 0.26;
    root.rotation.x = -pointerY * 0.16;
    const idle = frame.reduced ? 0 : 1;

    // ── Token cubes ─────────────────────────────────────────────────────────
    /**
     * The scatter is a BUMP that finishes early, not one that lasts the phase.
     * Both halves of "scatter, then settle into scan order" have to be legible,
     * and a sine over the whole of `tLex` only returns to zero at the instant
     * SYNTAX starts pulling the cubes into the tree — so the row was computed,
     * paid for, and never actually seen. Ending both curves at 0.72 leaves the
     * last quarter of the phase as a still, readable token stream, which is the
     * resting state every other phase already gets.
     */
    const lexBeat = clamp01(tLex / 0.72);
    const scatter = Math.sin(Math.PI * lexBeat);
    const lexSettle = ease(lexBeat);

    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      const src = TOKEN_SOURCE_POS[i]!;
      const row = rowPos[i]!;
      const sc = TOKEN_SCATTER[i]!;
      const size = TOKEN_SIZE[i]!;

      // Existence: a token exists once the characters that spell it are typed.
      const born = frame.reduced ? 1 : ease(clamp01((typed - TOKEN_TYPED_FRACTION[i]!) * 26 + 0.15));

      // NOT `sx()`: both endpoints are already laid out inside the frame's
      // budget, at their true widths. Narrowing here would print the source
      // with its characters on top of each other.
      let x = lerp(src.x * srcFit, row.x, lexSettle) + sc.x * scatter * 2.1;
      let y = lerp(src.y * srcFit, row.y, lexSettle) + sc.y * scatter * 1.5;
      let z = lerp(src.z, row.z, lexSettle) + sc.z * scatter * 2.6;

      let depth = lerp(0.07, size.z, ease(clamp01(tLex * 2.2)));
      let width = size.x;
      let height = size.y;
      let faceOpacity = ease(clamp01(tLex * 1.8)) * born;
      // Zero at rest: while `max.c` is being written it must look like TEXT.
      // The cube is what lexical analysis makes out of it, so the box arrives
      // with the scanner, not before it.
      let edgeOpacity = born * ease(clamp01(tLex * 2.2));
      let lexemeOpacity = born;
      let clsOpacity = born * band(tLex, 0.34, 0.7);
      let kindOpacity = 0;
      let detailOpacity = 0;

      if (t.node >= 0) {
        const ast = AST_POS[t.node]!;
        const astSize = AST_SIZE[t.node]!;
        const a = ease(tSyn);
        x = lerp(x, sx(ast.x), a);
        y = lerp(y, ast.y, a);
        z = lerp(z, ast.z, a);
        width = lerp(width, astSize.x, a);
        height = lerp(height, astSize.y, a);
        depth = lerp(depth, astSize.z, a);
        // The face swaps from the lexeme to the node it was reduced into.
        lexemeOpacity *= 1 - band(tSyn, 0.15, 0.5);
        clsOpacity *= 1 - band(tSyn, 0.1, 0.4);
        kindOpacity = band(tSyn, 0.35, 0.75);
        detailOpacity = band(tSyn, 0.45, 0.85) * 0.9;

        // Collapse into the quad this subtree flattened into.
        const quad = QUAD_IR_POS[NODE_QUAD[t.node]!]!;
        const c = ease(tIr);
        x = lerp(x, sx(quad.x), c);
        y = lerp(y, quad.y, c);
        z = lerp(z, quad.z, c);
        const shrink = 1 - band(tIr, 0.25, 0.75);
        width *= lerp(1, 0.4, ease(tIr));
        height *= shrink;
        depth *= shrink;
        const gone = 1 - band(tIr, 0.15, 0.6);
        faceOpacity *= gone;
        edgeOpacity *= gone;
        kindOpacity *= gone;
        detailOpacity *= gone;
      } else {
        // Consumed by a production: out of the frame, not into the tree.
        const a = ease(tSyn);
        x = lerp(x, sc.x * 9 + Math.sign(sc.x || 1) * 3, a);
        y = lerp(y, sc.y * 5.5, a);
        z = lerp(z, -7 - sc.z * 3, a);
        const gone = 1 - band(tSyn, 0.05, 0.55);
        faceOpacity *= gone;
        edgeOpacity *= gone;
        lexemeOpacity *= gone;
        clsOpacity *= gone;
      }

      const bob = idle * Math.sin(time * 0.6 + i * 0.7) * 0.018 * (1 - ease(tIr));
      t.group.position.set(x, y + bob, z);
      t.group.rotation.set(sc.y * scatter * 1.6, sc.x * scatter * 2.0, sc.z * scatter * 0.9);
      t.box.scale.set(width, height, depth);
      t.edges.scale.set(width, height, depth);

      t.boxMat.opacity = faceOpacity;
      t.edgeMat.opacity = edgeOpacity;
      // Crimson marks the transform happening NOW: the cube being cut out of
      // the text, and the node being typed. Nothing else in the scene uses it.
      const hot = Math.max(
        band(tLex, 0.0, 0.32) * (1 - band(tLex, 0.44, 0.72)),
        t.node >= 0 ? band(tSem, 0.1, 0.45) * (1 - band(tSem, 0.55, 0.95)) : 0,
      );
      t.edgeMat.color.copy(cubeEdge).lerp(activeEdge, hot);
      if (t.node >= 0 && palette) {
        // A typed node is tinted toward `ok`, not repainted in it: the type is
        // an annotation on the node, and the node is still the node.
        t.boxMat.color.copy(cubeFace).lerp(palette.ok, band(tSem, 0.3, 0.8) * 0.09);
      }

      // The lexeme is set ON the monospace grid its column position came from,
      // so while `max.c` is still text the line reads as `int max(int a, int b)
      // {` and not as loose words with gaps the source does not have. The cube
      // that grows around it is exactly this run plus 0.2 of padding, so the
      // same measurement is what makes the face look typeset rather than
      // rubber-stamped.
      t.lexeme.fitWidth(TOKENS[i]!.lexeme.length * CHAR_W * lerp(srcFit, 1, lexSettle));
      t.lexeme.material.opacity = lexemeOpacity;
      t.lexeme.mesh.position.set(0, 0, depth / 2 + 0.012);
      t.cls.size(0.2);
      t.cls.material.opacity = clsOpacity;
      t.cls.mesh.position.set(0, -height / 2 - 0.18, depth / 2);
      if (t.kind) {
        t.kind.size(NODE_LABEL_H);
        t.kind.material.opacity = kindOpacity;
        t.kind.mesh.position.set(0, 0, depth / 2 + 0.012);
      }
      if (t.detail) {
        t.detail.size(0.18);
        t.detail.material.opacity = detailOpacity;
        t.detail.mesh.position.set(0, -height / 2 - 0.17, depth / 2);
      }
      t.group.visible = faceOpacity > 0.004 || lexemeOpacity > 0.004 || kindOpacity > 0.004;
    }

    // ── Nodes with no token: they arrive with the reduction that made them ──
    for (const p of phantoms) {
      const target = AST_POS[p.index]!;
      const size = AST_SIZE[p.index]!;
      // Lands WITH the edges, not after them. The tree's edges fade in over
      // tSyn 0.3…0.8 and one of them ends here, so a node that was still
      // arriving at 0.95 left a line running off the top of the stage to
      // nothing for most of the phase — the exact frame a reader stops on.
      const a = ease(band(tSyn, 0.28, 0.78));
      const quad = QUAD_IR_POS[NODE_QUAD[p.index]!]!;
      const c = ease(tIr);
      const gone = 1 - band(tIr, 0.15, 0.6);
      const opacity = a * gone;
      p.group.visible = opacity > 0.004;
      if (!p.group.visible) continue;
      // It descends into place as the reduction completes, then collapses with
      // the rest of the tree into the quad the function frame became. The drop
      // is short enough to stay inside the frustum the whole way down: the
      // accept action arriving is the point, and a node that enters from off
      // screen is indistinguishable from one that faded in.
      const enterY = target.y + 1.4 * (1 - a);
      p.group.position.set(
        lerp(sx(target.x), sx(quad.x), c),
        lerp(enterY, quad.y, c),
        lerp(target.z, quad.z, c),
      );
      const shrink = 1 - band(tIr, 0.25, 0.75);
      p.box.scale.set(size.x * lerp(1, 0.4, ease(tIr)), size.y * shrink, size.z * shrink);
      p.edges.scale.copy(p.box.scale);
      p.boxMat.opacity = opacity;
      p.edgeMat.opacity = opacity;
      p.kind.size(NODE_LABEL_H);
      p.kind.material.opacity = opacity;
      p.kind.mesh.position.set(0, 0, p.box.scale.z / 2 + 0.012);
    }

    // ── Tree edges, drawn between the cubes' live positions ─────────────────
    const treeOpacity = band(tSyn, 0.3, 0.8) * (1 - band(tIr, 0.0, 0.5));
    treeEdgeMat.opacity = treeOpacity * 0.75;
    treeEdges.visible = treeOpacity > 0.004;
    if (treeEdges.visible) {
      AST_EDGES.forEach(([from, to], e) => {
        const a = byNode[from];
        const b = byNode[to];
        if (!a || !b) return;
        treeEdgePos.set(
          [a.position.x, a.position.y, a.position.z, b.position.x, b.position.y, b.position.z],
          e * 6,
        );
      });
      (treeEdgeGeom.attributes.position as BufferAttribute).needsUpdate = true;
    }

    // ── Type annotations ────────────────────────────────────────────────────
    const typeOpacity = band(tSem, 0.2, 0.7) * (1 - band(tIr, 0.0, 0.35));
    for (const t of typeLabels) {
      const host = byNode[t.node];
      const fallback = AST_POS[t.node]!;
      const anchor = host ? host.position : { x: sx(fallback.x), y: fallback.y, z: fallback.z };
      const w = AST_SIZE[t.node]!.x;
      t.label.size(0.17);
      t.label.mesh.position.set(
        anchor.x + w / 2 + (0.17 * t.label.aspect) / 2 + 0.1,
        anchor.y + 0.2,
        anchor.z + 0.25,
      );
      t.label.material.opacity = typeOpacity;
      t.label.mesh.visible = typeOpacity > 0.004;
    }

    // ── Quadruple slabs ─────────────────────────────────────────────────────
    const slabIn = band(tIr, 0.25, 0.7);
    const slabOut = 1 - band(tCode, 0.1, 0.55);
    const toBlocks = ease(band(tOpt, 0.1, 0.65));
    for (let i = 0; i < slabs.length; i++) {
      const slab = slabs[i]!;
      const irPos = QUAD_IR_POS[i]!;
      const optPos = QUAD_OPT_POS[i]!;
      const stagger = clamp01((tIr - 0.25 - i * 0.045) * 5);
      const opacity = slabIn * slabOut * ease(stagger);
      slab.group.visible = opacity > 0.004;
      if (!slab.group.visible) continue;

      const w = lerp(QUAD_SIZE.x, QUAD_OPT_SIZE.x, toBlocks);
      const h = lerp(QUAD_SIZE.y, QUAD_OPT_SIZE.y, toBlocks);
      const d = lerp(QUAD_SIZE.z, QUAD_OPT_SIZE.z, toBlocks);
      const compact = ease(band(tCode, 0.0, 0.5));
      slab.group.position.set(
        sx(lerp(irPos.x, optPos.x, toBlocks)) * (1 - compact),
        lerp(irPos.y, optPos.y, toBlocks) * (1 - compact * 0.6),
        lerp(irPos.z, optPos.z, toBlocks) - compact * 2,
      );
      slab.box.scale.set(w, h, d);
      slab.edges.scale.set(w, h, d);
      slab.boxMat.opacity = opacity * 0.92;
      slab.edgeMat.opacity = opacity;
      const labelH = lerp(0.28, 0.2, toBlocks);
      slab.label.size(labelH);
      slab.label.mesh.position.set(
        -w / 2 + 0.14 + (labelH * slab.label.aspect) / 2,
        0,
        d / 2 + 0.012,
      );
      slab.label.material.opacity = opacity;
      // The pass sweeping past a slab lights its edge.
      if (palette) {
        const near = 1 - Math.min(1, Math.abs(sweep.position.y - slab.group.position.y) / 0.5);
        slab.edgeMat.color.copy(palette.lineStrong).lerp(activeEdge, sweepMat.opacity * near * 2.2);
      }
    }

    // ── Blocks, terminals and CFG edges ─────────────────────────────────────
    const cfgOpacity = band(tOpt, 0.2, 0.6) * (1 - band(tCode, 0.05, 0.45));
    for (const b of blockFrames) {
      b.mat.opacity = cfgOpacity * 0.8;
      b.label.material.opacity = cfgOpacity;
      b.frame.visible = cfgOpacity > 0.004;
      b.label.mesh.visible = b.frame.visible;
    }
    for (const t of terminals) {
      t.mat.opacity = cfgOpacity * 0.55;
      t.label.material.opacity = cfgOpacity * 0.8;
    }
    cfgMat.opacity = cfgOpacity * 0.7;
    cfgEdges.visible = cfgOpacity > 0.004;

    // ── Six passes, in order, each one a sweep that changes nothing ──────────
    const passWindow = (tOpt - 0.22) / 0.66;
    if (passWindow > 0 && passWindow < 1 && !frame.reduced) {
      const pass = passWindow * 6;
      const within = pass - Math.floor(pass);
      sweep.position.set(0, lerp(3.6, -3.2, within), 0.6);
      sweepMat.opacity = Math.sin(Math.PI * within) * 0.45 * cfgOpacity;
      sweep.visible = true;
    } else {
      sweepMat.opacity = 0;
      sweep.visible = false;
    }

    // ── x86-64 plates ───────────────────────────────────────────────────────
    for (let i = 0; i < plates.length; i++) {
      const p = plates[i]!;
      const target = ASM_POS[i]!;
      const stagger = clamp01((tCode - 0.15 - i * 0.042) * 5);
      const a = ease(stagger);
      // Opacity LAGS position: a plate still in flight from its basic block is
      // barely there, and only resolves as it reaches its line. Fading it in on
      // the same curve as the move left ten half-opaque listings overlapping in
      // mid-air, which read as mud rather than as instruction selection.
      const opacity = ease(clamp01((stagger - 0.45) / 0.55));
      p.group.visible = opacity > 0.004;
      if (!p.group.visible) continue;
      p.group.position.set(
        lerp(p.from.x, target.x, a),
        lerp(p.from.y, target.y, a),
        lerp(p.from.z - 1.5, target.z, a),
      );
      p.group.rotation.y = (1 - a) * 0.9;
      p.boxMat.opacity = opacity * (p.tint === 'none' ? 0.85 : 1);
      p.edgeMat.opacity = opacity * 0.9;
      p.label.material.opacity = opacity;
    }
  }

  function dispose(): void {
    for (const d of disposables) d.dispose();
    root.clear();
  }

  return { root, applyPalette, update, dispose };
}
