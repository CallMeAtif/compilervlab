/**
 * The 3D scene's colours come from the SAME place every other pixel on the site
 * gets them: the custom properties in styles/theme.css, read off the document
 * at runtime. Nothing here is a literal.
 *
 * That means the toggle in the header re-themes the WebGL scene for free — the
 * rig calls `readPalette()` again when `useTheme()` changes and every material
 * is re-tinted from the new token values.
 */
import { Color } from 'three';

export interface ScenePalette {
  readonly dark: boolean;
  readonly canvas: Color;
  readonly surface: Color;
  readonly raised: Color;
  readonly code: Color;
  readonly line: Color;
  readonly lineStrong: Color;
  readonly ink: Color;
  readonly inkMuted: Color;
  readonly inkFaint: Color;
  readonly accent: Color;
  readonly accentStrong: Color;
  readonly somaiya: Color;
  readonly somaiyaStrong: Color;
  readonly ok: Color;
  readonly warn: Color;
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): Color {
  const raw = styles.getPropertyValue(name).trim();
  const color = new Color();
  try {
    color.setStyle(raw || fallback);
  } catch {
    color.setStyle(fallback);
  }
  return color;
}

/** Snapshot the token palette for whichever theme is on `<html>` right now. */
export function readPalette(): ScenePalette {
  const root = document.documentElement;
  const dark = root.classList.contains('dark');
  const s = getComputedStyle(root);
  return {
    dark,
    canvas: readVar(s, '--canvas', dark ? '#0f1216' : '#f4f6f8'),
    surface: readVar(s, '--surface', dark ? '#151920' : '#fcfdfe'),
    raised: readVar(s, '--raised', dark ? '#1d222b' : '#eaedf2'),
    code: readVar(s, '--code-bg', dark ? '#0c0f13' : '#f1f4f7'),
    line: readVar(s, '--line', dark ? '#272d38' : '#dfe3ea'),
    lineStrong: readVar(s, '--line-strong', dark ? '#4b5566' : '#a5adba'),
    ink: readVar(s, '--ink', dark ? '#e4e8ef' : '#1b1f26'),
    inkMuted: readVar(s, '--ink-muted', dark ? '#a1aab8' : '#4f5763'),
    inkFaint: readVar(s, '--ink-faint', dark ? '#929cac' : '#5a626f'),
    accent: readVar(s, '--accent', dark ? '#7ba3f2' : '#2f5fd0'),
    accentStrong: readVar(s, '--accent-strong', dark ? '#9dbcff' : '#244aa4'),
    somaiya: readVar(s, '--somaiya', dark ? '#c0392b' : '#8B0000'),
    somaiyaStrong: readVar(s, '--somaiya-strong', dark ? '#d4574a' : '#6b0000'),
    ok: readVar(s, '--ok', dark ? '#7cbd8d' : '#256a39'),
    warn: readVar(s, '--warn', dark ? '#d3a765' : '#8a5a12'),
  };
}
