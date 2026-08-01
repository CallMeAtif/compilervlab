import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Vendor chunking. The app has three heavy, independent vendor families, plus a
 * compiler that must never reach the UI thread:
 *
 *  - `react-vendor`  React + ReactDOM + the router — every route needs it, so
 *                    it is worth its own long-lived, cacheable chunk.
 *  - `codemirror`    the editor stack (view/state/language/lezer): the overview
 *                    editor and the CodeStrip mini views.
 *  - `reactflow`     @xyflow + its d3 dependencies — graph rendering only, so
 *                    only the phase routes that draw graphs fetch it.
 *  - `elkjs`         the layout engine (~1.5 MB). ElkGraph imports it
 *                    dynamically, so it is fetched with the first graph layout
 *                    and never blocks a route's first paint.
 *
 * Everything else (route code, the phase reducers imported by subpath from
 * @lab/core, the trace runtime) keeps Rollup's automatic per-route splitting,
 * so a route the user has not visited is not downloaded. The compiler itself is
 * only reachable from `worker/compile.worker.ts`, which Vite emits as its own
 * worker chunk.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;
  // pnpm ids look like …/node_modules/.pnpm/react@19…/node_modules/react/index.js
  const pkgPath = id.split('node_modules/').pop() ?? '';
  if (/^elkjs\//.test(pkgPath)) return 'elkjs';
  if (
    /^(@xyflow\/[^/]+|classcat|d3-(selection|zoom|drag|transition|interpolate|color|timer|dispatch|ease|path))\//.test(
      pkgPath,
    )
  ) {
    return 'reactflow';
  }
  if (
    /^(@codemirror\/[^/]+|@lezer\/[^/]+|@uiw\/[^/]+|codemirror|style-mod|w3c-keyname|crelt)\//.test(
      pkgPath,
    )
  ) {
    return 'codemirror';
  }
  if (/^(react|react-dom|react-is|scheduler|react-router|react-router-dom)\//.test(pkgPath)) {
    return 'react-vendor';
  }
  return undefined;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
  build: {
    rollupOptions: {
      output: { manualChunks: vendorChunk },
    },
  },
});
