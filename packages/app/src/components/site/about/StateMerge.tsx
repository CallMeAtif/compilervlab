/**
 * `/about`'s own moment in three dimensions: the LALR merge, at scale.
 *
 * The essay claims the parser is a real LALR(1) machine — that the constructor
 * builds the canonical LR(1) collection and then merges states that share a
 * core. Those are two numbers in `GRAMMAR_FACTS`, and two numbers in a sentence
 * are easy to skim past. So the figure draws them: 553 points, one per
 * canonical LR(1) state, collapsing as you scroll into the 147 cores they merge
 * onto. The point for state 138 stays crimson and stays out — it is the one
 * cell where a conflict survives the merge, and `DANGLING_ELSE` says so.
 *
 * What is asserted here is exactly what the repository knows: 553, 147, and
 * that state 138 is the conflict. WHICH canonical state merges onto which core
 * is not in `max-program.ts`, so the figure never claims a particular pairing —
 * it shows the counts collapsing, and the caption says that is what it shows.
 *
 * Shares the `three` chunk with the pipeline on `/`, so a reader who arrived
 * from the front page has already paid for it.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  type PerspectiveCamera,
} from 'three';
import { DANGLING_ELSE, GRAMMAR_FACTS } from '../max-program';
import { readPalette } from '../pipeline/palette';
import type { Theme } from '../../../lib/theme';

const CANONICAL = GRAMMAR_FACTS.canonicalLr1States; // 553
const CORES = GRAMMAR_FACTS.lalrStates; // 147
const CONFLICT = DANGLING_ELSE.state; // 138

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const ease = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** Fibonacci sphere — even coverage without clumping, and deterministic. */
function spherePoint(i: number, total: number, radius: number): [number, number, number] {
  const y = 1 - (i / Math.max(1, total - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = i * 2.399963229728653;
  return [Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius];
}

interface CloudProps {
  progress: React.RefObject<number>;
  pointer: React.RefObject<{ x: number; y: number }>;
  theme: Theme;
}

function Cloud({ progress, pointer, theme }: CloudProps) {
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;

  const { geometry, coreGeometry, scattered, targets, conflictIndex } = useMemo(() => {
    const scattered = new Float32Array(CANONICAL * 3);
    const targets = new Float32Array(CANONICAL * 3);
    const coreCentres = new Float32Array(CORES * 3);

    for (let c = 0; c < CORES; c++) {
      const [x, y, z] = spherePoint(c, CORES, 1.5);
      coreCentres.set([x, y, z], c * 3);
    }

    for (let i = 0; i < CANONICAL; i++) {
      const [x, y, z] = spherePoint(i, CANONICAL, 3.25);
      // A deterministic wobble so the outer shell reads as a cloud, not a ball.
      const w = Math.sin(i * 12.9898) * 0.5 + Math.sin(i * 4.1) * 0.22;
      scattered.set([x * (1 + w * 0.14), y * (1 + w * 0.1), z * (1 + w * 0.14)], i * 3);
      const core = i % CORES;
      targets.set(
        [coreCentres[core * 3]!, coreCentres[core * 3 + 1]!, coreCentres[core * 3 + 2]!],
        i * 3,
      );
    }

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(scattered), 3));
    const coreGeometry = new BufferGeometry();
    coreGeometry.setAttribute('position', new BufferAttribute(coreCentres, 3));

    return { geometry, coreGeometry, scattered, targets, conflictIndex: CONFLICT };
  }, []);

  const cloudMat = useMemo(
    () =>
      new PointsMaterial({
        size: 0.07,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    [],
  );
  const coreMat = useMemo(
    () =>
      new PointsMaterial({
        size: 0.15,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    [],
  );
  const conflictMat = useMemo(
    () =>
      new PointsMaterial({ size: 0.2, sizeAttenuation: true, transparent: true, depthWrite: false }),
    [],
  );

  const conflictGeometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(new Float32Array(3), 3));
    return g;
  }, []);

  useEffect(() => {
    const p = readPalette();
    cloudMat.color.copy(p.inkFaint);
    coreMat.color.copy(p.accent);
    conflictMat.color.copy(p.somaiya);
  }, [theme, cloudMat, coreMat, conflictMat]);

  useEffect(
    () => () => {
      geometry.dispose();
      coreGeometry.dispose();
      conflictGeometry.dispose();
      cloudMat.dispose();
      coreMat.dispose();
      conflictMat.dispose();
    },
    [geometry, coreGeometry, conflictGeometry, cloudMat, coreMat, conflictMat],
  );

  const spin = useRef(0);
  const px = useRef(0);
  const py = useRef(0);
  const cloudRef = useRef<Points | null>(null);
  const coreRef = useRef<Points | null>(null);
  const conflictRef = useRef<Points | null>(null);

  useFrame((_, dt) => {
    const t = ease(progress.current ?? 0);
    const attr = geometry.attributes.position as BufferAttribute;
    const arr = attr.array as Float32Array;
    for (let i = 0; i < CANONICAL; i++) {
      // The conflicting state never merges: it is the one the constructor had
      // to resolve by hand, so it stays where a reader can point at it.
      const k = i === conflictIndex ? Math.min(t, 0.18) : t;
      for (let a = 0; a < 3; a++) {
        const j = i * 3 + a;
        arr[j] = scattered[j]! + (targets[j]! - scattered[j]!) * k;
      }
    }
    attr.needsUpdate = true;

    const conflictAttr = conflictGeometry.attributes.position as BufferAttribute;
    (conflictAttr.array as Float32Array).set([
      arr[conflictIndex * 3]!,
      arr[conflictIndex * 3 + 1]!,
      arr[conflictIndex * 3 + 2]!,
    ]);
    conflictAttr.needsUpdate = true;

    coreMat.opacity = ease((t - 0.55) / 0.45) * 0.85;
    cloudMat.opacity = 0.85 - t * 0.25;
    conflictMat.opacity = ease((t - 0.25) / 0.35);

    spin.current += dt * 0.16;
    px.current += ((pointer.current?.x ?? 0) - px.current) * Math.min(1, dt * 3);
    py.current += ((pointer.current?.y ?? 0) - py.current) * Math.min(1, dt * 3);
    for (const ref of [cloudRef, coreRef, conflictRef]) {
      const o = ref.current;
      if (!o) continue;
      o.rotation.y = spin.current + px.current * 0.4;
      o.rotation.x = -py.current * 0.3;
    }

    // Fit the CURRENT extent to the box, not the widest one it ever has. The
    // cloud starts at radius 3.25 and ends on a 1.5-radius core shell, so a
    // camera parked for the scattered state leaves the merged state as a small
    // dim knot in the middle of a large empty well — which is the state a
    // reader spends the whole caption looking at. Framing follows the collapse,
    // so the result is as large on screen as the thing it came from.
    const halfTan = Math.tan((camera.fov * Math.PI) / 360);
    const aspect = Math.max(0.3, size.width / Math.max(1, size.height));
    // A pure function of `t`, like everything else in this project's scroll
    // work: re-entering the figure after scrolling away lands on the right
    // frame instead of playing a dolly the reader did not ask for.
    const extent = 3.6 - t * 1.55;
    camera.position.z = Math.max(extent / halfTan, extent / (halfTan * aspect));
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <points ref={cloudRef} geometry={geometry} material={cloudMat} frustumCulled={false} />
      <points ref={coreRef} geometry={coreGeometry} material={coreMat} frustumCulled={false} />
      <points
        ref={conflictRef}
        geometry={conflictGeometry}
        material={conflictMat}
        frustumCulled={false}
      />
    </>
  );
}

export interface StateMergeProps {
  progress: React.RefObject<number>;
  pointer: React.RefObject<{ x: number; y: number }>;
  active: boolean;
  theme: Theme;
}

export default function StateMerge({ progress, pointer, active, theme }: StateMergeProps) {
  return (
    <Canvas
      frameloop={active ? 'always' : 'never'}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      camera={{ fov: 40, position: [0, 0, 9], near: 0.1, far: 60 }}
      style={{ position: 'absolute', inset: 0 }}
      aria-hidden
    >
      <Cloud progress={progress} pointer={pointer} theme={theme} />
    </Canvas>
  );
}
