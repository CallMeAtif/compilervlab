/**
 * SiteFooter — the close of `/` and `/about`.
 *
 * Three things, in this order: the way in, who runs it, and what it runs on.
 * No newsletter, no social row, no repeated navigation — the header already
 * carries every link this site has.
 */
import { Cta } from './primitives';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line sm:mt-24">
      <div className="mx-auto max-w-[84rem] px-4 py-14 sm:px-6 sm:py-20">
        <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <h2 className="site-heading max-w-[18ch]">Open the lab and compile something.</h2>
            <p className="mt-3 max-w-[46ch] font-inter text-[0.9375rem] text-ink-muted">
              Sign in with a @somaiya.edu account. Nothing to install — the compiler is a Web Worker
              in your browser and your source never leaves the machine.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Cta to="/lab">Launch the lab</Cta>
            <Cta to="/signup" variant="secondary">
              Create an account
            </Cta>
          </div>
        </div>

        <hr className="my-10 border-0 border-t border-line sm:my-12" />

        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          <div className="font-inter text-sm text-ink-muted">
            <p className="font-serif text-base font-semibold text-ink">
              K J Somaiya Institute of Technology
            </p>
            <p className="mt-1">
              Somaiya Vidyavihar University · Vidyavihar (E), Mumbai 400 077, India
            </p>
            <p className="mt-1">
              Built for the Systems Programming &amp; Compiler Construction course.
            </p>
          </div>


        </div>
      </div>
    </footer>
  );
}
