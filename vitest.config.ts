import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/trace/test/**/*.test.ts',
      'packages/core/test/**/*.test.ts',
      // App-side integration guards that need no DOM (the worker trace registry).
      'packages/app/test/**/*.test.ts',
    ],
  },
});
