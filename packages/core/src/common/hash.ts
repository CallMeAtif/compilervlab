/**
 * FNV-1a 32-bit — the project's one hashing primitive. Used for Compilation ids
 * (deep-link stability: same source ⇒ same id) and for structural memo keys.
 * Deterministic, dependency-free, and identical to the app-side helper.
 */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
