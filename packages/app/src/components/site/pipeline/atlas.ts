/**
 * Text in the scene, without fetching a font.
 *
 * The obvious choice — drei's `<Text>` — is out: troika-three-text downloads a
 * Roboto woff from fonts.gstatic.com by default, and this app is required to
 * run with no network at all (PLAN.md; every face is bundled via @fontsource).
 * So labels are drawn ONCE into a 2D canvas atlas using the same bundled
 * JetBrains Mono the listings use, and each label is a plane with baked UVs
 * into that atlas.
 *
 * Two consequences worth stating:
 *  • Glyphs are painted WHITE. Colour comes from the material tint, so the
 *    atlas is theme-independent and never has to be rebuilt when the toggle
 *    flips — and a label can animate its colour per-object for free.
 *  • One texture for the whole scene, so ~90 labels cost one upload.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace, Texture } from 'three';

export interface LabelSpec {
  readonly key: string;
  readonly text: string;
  /** 400 for listings, 600 for the few labels that carry emphasis. */
  readonly weight?: number;
}

export interface LabelRect {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
  /** width / height of the drawn cell, so a plane can be sized without stretch. */
  readonly aspect: number;
  /**
   * Aspect of the INKED glyph run alone, i.e. the cell minus its horizontal
   * padding. A caller that needs the glyphs to be a particular width in world
   * units — the source listing, whose lexemes must land on the same monospace
   * grid the column positions were computed from — divides by this rather than
   * by `aspect`, which would count the transparent padding as type.
   */
  readonly inkAspect: number;
}

export interface Atlas {
  readonly texture: Texture;
  readonly rects: ReadonlyMap<string, LabelRect>;
  dispose(): void;
}

const FONT_STACK =
  '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const FONT_PX = 44;
const CELL_H = 60;
const PAD_X = 6;
const ATLAS_W = 1024;

/** Empty stand-in so a caller never has to branch on "atlas not ready yet". */
export const EMPTY_RECT: LabelRect = { u0: 0, v0: 0, u1: 0, v1: 0, aspect: 1, inkAspect: 1 };

export function buildAtlas(specs: readonly LabelSpec[]): Atlas {
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) throw new Error('2D canvas unavailable');

  // Measure first so the atlas height is exact rather than guessed.
  const cells = specs.map((spec) => {
    measure.font = `${spec.weight ?? 400} ${FONT_PX}px ${FONT_STACK}`;
    const w = Math.ceil(measure.measureText(spec.text).width) + PAD_X * 2;
    return { spec, w: Math.min(w, ATLAS_W) };
  });

  let x = 0;
  let y = 0;
  const placed = cells.map((cell) => {
    if (x + cell.w > ATLAS_W) {
      x = 0;
      y += CELL_H;
    }
    const at = { ...cell, x, y };
    x += cell.w;
    return at;
  });
  const height = y + CELL_H;

  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_W;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';

  const rects = new Map<string, LabelRect>();
  for (const cell of placed) {
    ctx.font = `${cell.spec.weight ?? 400} ${FONT_PX}px ${FONT_STACK}`;
    ctx.fillText(cell.spec.text, cell.x + PAD_X, cell.y + CELL_H / 2, cell.w - PAD_X * 2);
    rects.set(cell.spec.key, {
      u0: cell.x / ATLAS_W,
      // Canvas y grows downward, texture v grows upward.
      v0: 1 - (cell.y + CELL_H) / height,
      u1: (cell.x + cell.w) / ATLAS_W,
      v1: 1 - cell.y / height,
      aspect: cell.w / CELL_H,
      inkAspect: Math.max(1e-3, (cell.w - PAD_X * 2) / CELL_H),
    });
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  return {
    texture,
    rects,
    dispose() {
      texture.dispose();
    },
  };
}

/**
 * Wait for the bundled mono face before measuring, or every label is measured
 * in the fallback metrics and comes out the wrong width. Bounded, because a
 * browser that never resolves `fonts.ready` must not leave a blank canvas.
 */
export async function fontsSettled(timeoutMs = 2500): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  await Promise.race([
    document.fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}
