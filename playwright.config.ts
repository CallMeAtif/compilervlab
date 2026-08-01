/**
 * Playwright browser smoke suite (Gate D).
 *
 * Runs against a PRODUCTION build served by `vite preview` — the same bundle,
 * worker chunking and code-splitting a reader gets — because the breakages this
 * suite exists to catch (a blank page, a dead control, a worker that never
 * answers) are exactly the ones a dev server papers over.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 4173);
// `vite preview` defaults to the hostname `localhost`, which macOS resolves to
// the IPv6 loopback only — Playwright's own reachability probe and the browser
// then disagree about which socket that name means. Pin both ends to IPv4.
const HOST = '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: './packages/app/e2e',
  // Failure artifacts land inside node_modules (already git-ignored) so a test
  // run never leaves untracked files in the tree for the next agent to wonder
  // about. `npx playwright show-trace <path>` still works.
  outputDir: 'node_modules/.cache/playwright-results',
  // Traces are big (LR(1) item sets, elk layouts); give real work room to land.
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: 0, // a flake here is a bug in the suite or the app; do not hide it
  workers: process.env['CI'] ? 2 : 4,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    // The app picks its initial theme from the OS preference; pin it so the
    // theme test starts from a known side.
    colorScheme: 'light',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Wide enough that nothing the assertions look for is behind a
        // responsive breakpoint (the phase panes stack below lg).
        viewport: { width: 1600, height: 1100 },
      },
    },
  ],
  webServer: {
    command: `pnpm --filter app preview --host ${HOST} --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
