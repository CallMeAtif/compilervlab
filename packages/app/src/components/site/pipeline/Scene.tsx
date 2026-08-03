/**
 * The WebGL surface. Lazily imported, so `three` and `@react-three/fiber` are a
 * chunk that only `/` and `/about` ever fetch — the six lab routes never pay
 * for it.
 *
 * Everything expensive is guarded:
 *   • device pixel ratio capped at 1.75, antialias on, no shadows, no
 *     post-processing — the scene is ~160 draw calls of flat geometry.
 *   • `frameloop` switches to `never` when the stage scrolls off screen or the
 *     tab is hidden, so an idle page costs nothing.
 *   • the atlas is built after the bundled mono face has settled, so labels are
 *     measured in the face they are drawn in.
 *   • reduced motion holds the composed end-state and never animates.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { PerspectiveCamera } from 'three';
import { buildAtlas, fontsSettled, type Atlas } from './atlas';
import { buildRig, labelSpecs, type Rig } from './rig';
import { readPalette } from './palette';
import type { Theme } from '../../../lib/theme';

export interface SceneProps {
  /** Scroll position in phases, 0 … 7. Read every frame, never re-rendered. */
  progress: React.RefObject<number>;
  /** Fraction of `max.c` typed so far, 0 … 1. */
  typed: React.RefObject<number>;
  /** Pointer inside the stage, −1 … 1. */
  pointer: React.RefObject<{ x: number; y: number }>;
  /** False when the stage is off screen or the tab is hidden. */
  active: boolean;
  /**
   * True when the narrative panel sits ON the stage rather than beside it —
   * i.e. below `lg`. The scene lifts itself clear rather than being drawn under
   * a panel. This is a LAYOUT fact, so it comes from the layout, not from the
   * canvas size: at 1440 the canvas is only 792px wide and any breakpoint read
   * off it would call a desktop a phone.
   */
  overlaid: boolean;
  theme: Theme;
  reduced: boolean;
}

function Lights({ dark }: { dark: boolean }) {
  return (
    <>
      <ambientLight intensity={dark ? 1.35 : 2.1} />
      <directionalLight position={[4, 6, 8]} intensity={dark ? 2.1 : 1.6} />
      <directionalLight position={[-6, -2, 4]} intensity={dark ? 0.9 : 0.5} />
    </>
  );
}

function Stage({ progress, typed, pointer, theme, reduced, overlaid }: Omit<SceneProps, 'active'>) {
  const [atlas, setAtlas] = useState<Atlas | null>(null);
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const rigRef = useRef<Rig | null>(null);
  const specs = useMemo(() => labelSpecs(), []);

  useEffect(() => {
    let cancelled = false;
    void fontsSettled().then(() => {
      if (cancelled) return;
      try {
        setAtlas(buildAtlas(specs));
      } catch {
        // A browser without 2D canvas cannot draw labels; the geometry still
        // reads, so carry on rather than blanking the stage.
        setAtlas(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [specs]);

  /**
   * Narrow viewports get a NARROWER LAYOUT, not a smaller picture: the tidy
   * tree's sibling gap and the CFG's column separation close up, which is what
   * a responsive graph layout is for. Bucketed, so a resize does not rebuild
   * the rig on every pixel.
   */
  const spread = size.width < 620 ? 0.66 : 1;
  const rig = useMemo(() => (atlas ? buildRig(atlas, spread) : null), [atlas, spread]);
  rigRef.current = rig;

  useEffect(() => {
    return () => {
      rig?.dispose();
      atlas?.dispose();
    };
  }, [rig, atlas]);

  // Re-tint every material from the token values the theme just switched to.
  useEffect(() => {
    if (!rig) return;
    rig.applyPalette(readPalette());
  }, [rig, theme]);

  const start = useRef(performance.now());

  /**
   * Pull the camera back exactly far enough to hold the scene's bounding box,
   * derived from the frustum rather than guessed from a breakpoint: 9 world
   * units wide (narrowed by `spread`) by 7 tall, at the 42° vertical field the
   * camera is created with. On a phone that also lifts the content clear of the
   * panel sitting over the bottom of the stage.
   */
  const { zoomOut, lift } = useMemo(() => {
    const halfTan = Math.tan((42 * Math.PI) / 360);
    const aspect = Math.max(0.3, size.width / Math.max(1, size.height));
    const needForHeight = 7 / 2 / halfTan;
    const needForWidth = (9 * spread) / 2 / (halfTan * aspect);
    return {
      zoomOut: Math.min(2.2, Math.max(1, Math.max(needForHeight, needForWidth) / 11)),
      lift: overlaid ? 2 : 0,
    };
  }, [size.width, size.height, spread, overlaid]);

  useFrame((_, dt) => {
    const r = rigRef.current;
    if (!r) return;
    r.update(
      {
        s: progress.current ?? 0,
        typed: typed.current ?? 0,
        pointerX: pointer.current?.x ?? 0,
        pointerY: pointer.current?.y ?? 0,
        time: (performance.now() - start.current) / 1000,
        dt,
        zoomOut,
        lift,
        reduced,
      },
      camera,
    );
  });

  if (!rig) return null;
  return <primitive object={rig.root} />;
}

export default function Scene({ active, theme, reduced, ...rest }: SceneProps) {
  const dark = theme === 'dark';
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ fov: 42, position: [0, 0, 10], near: 0.1, far: 120 }}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden
    >
      <Lights dark={dark} />
      <Stage theme={theme} reduced={reduced} {...rest} />
    </Canvas>
  );
}
