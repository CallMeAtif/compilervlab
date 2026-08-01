/**
 * Test fixture: every spec in this directory runs with a console guard.
 *
 * Requirement 7 of the smoke suite — the browser console must stay clean for
 * the whole test. Anything React logs through `console.error` (key warnings,
 * act() noise, invalid-prop warnings) and any uncaught exception or unhandled
 * promise rejection fails the test that produced it.
 */
import { test as base, expect, type ConsoleMessage } from '@playwright/test';

/**
 * The ONLY tolerated console-error patterns.
 *
 * Keep genuine application errors OUT of this list. Each entry needs a comment
 * saying why it cannot be an app bug.
 */
const ALLOWED_CONSOLE_ERRORS: readonly RegExp[] = [
  // EMPTY ON PURPOSE — as of this suite the app logs nothing at all during the
  // whole tour (no React key warnings, no act() noise, no failed requests: the
  // headless browser does not even probe for the missing favicon). Anything
  // added here needs a comment justifying why it cannot be an app bug; a
  // genuine application error must be fixed, not allowlisted.
];

function describe(msg: ConsoleMessage): string {
  const loc = msg.location();
  const where = loc.url ? ` (${loc.url}:${loc.lineNumber})` : '';
  return `console.${msg.type()}: ${msg.text()}${where}`;
}

export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];

      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        if (ALLOWED_CONSOLE_ERRORS.some((p) => p.test(msg.text()))) return;
        errors.push(describe(msg));
      });
      // Uncaught exceptions and unhandled promise rejections.
      page.on('pageerror', (err) => {
        errors.push(`pageerror: ${err.message}`);
      });

      await use();

      expect(
        errors,
        'the browser console must be free of errors and unhandled rejections',
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
