/**
 * FNV-1a 32-bit — stable ids for compilations and structural memo keys.
 * Re-exported from @lab/core so the app and the compiler can never disagree
 * about a Compilation id (which is what makes deep links reproducible).
 *
 * Imported by SUBPATH, not from the `@lab/core` barrel: this module is pulled
 * in by UI code (ElkGraph's structural hash), and the barrel re-exports every
 * phase of the compiler, which would put the whole pipeline in the UI's import
 * graph. The compiler belongs in the worker chunk.
 */
export { fnv1a } from '@lab/core/common/hash.js';
