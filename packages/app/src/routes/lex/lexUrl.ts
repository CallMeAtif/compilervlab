/**
 * Deep-link state for /lex.
 *
 * Four params, all restorable from a pasted URL:
 *   ?tab=    constructions | scan | tokens | errors
 *   ?algo=   thompson | subset | minimize | scan   (the shared PhasePage
 *            algorithm picker writes this too, so the two stay in sync)
 *   ?class=  id | intconst | floatconst            (which token class the
 *            constructions tab is building)
 *   ?step=   cursor into the current trace
 *
 * All four go through `usePhaseUrlState`: `?step=` with the debounced writer
 * (the stepper writes it continuously), the three *selection* params with the
 * immediate writer — which also flushes any step write still in flight, so a
 * stale cursor can never be re-applied to a freshly loaded trace.
 */
import { useCallback } from 'react';
import { usePhaseUrlState } from '../../lib/urlState';

export const LEX_TABS = ['constructions', 'scan', 'tokens', 'errors'] as const;
export type LexTab = (typeof LEX_TABS)[number];

/** The three chained sub-views of the constructions tab. */
export const LEX_STAGES = ['thompson', 'subset', 'minimize'] as const;
export type LexStage = (typeof LEX_STAGES)[number];

export const TOKEN_CLASS_IDS = ['id', 'intconst', 'floatconst'] as const;
export type TokenClassId = (typeof TOKEN_CLASS_IDS)[number];

/**
 * `intconst` (digit digit*) is the default class: it is the smallest complete
 * example of all three constructions, so the graphs and the Dtran table read
 * at textbook scale. `id` expands `letter` to 53 character alternatives and is
 * offered with an explicit cost warning.
 */
export const DEFAULT_TOKEN_CLASS: TokenClassId = 'intconst';

export interface LexUrlState {
  tab: LexTab;
  stage: LexStage;
  tokenClass: TokenClassId;
  /** Cursor from `?step=`, read once per mount by the trace views. */
  step: number | null;
  /** Immediate, merged, `replace`-mode write; always clears `?step=`. */
  select: (patch: { tab?: LexTab; stage?: LexStage; tokenClass?: TokenClassId }) => void;
}

export function useLexUrlState(): LexUrlState {
  const { algo, step, pick, pickOrNull, setPhaseParamsNow } = usePhaseUrlState();

  const stage = pickOrNull('algo', LEX_STAGES) ?? 'thompson';
  const tokenClass = pick('class', TOKEN_CLASS_IDS, DEFAULT_TOKEN_CLASS);
  // A bare ?algo=scan (from the shared phase picker) means "show me the
  // scanner", so it selects the scan tab when ?tab= says nothing.
  const tab = pickOrNull('tab', LEX_TABS) ?? (algo === 'scan' ? 'scan' : 'constructions');

  const select = useCallback<LexUrlState['select']>(
    (patch) => {
      const nextTab = patch.tab ?? tab;
      // A new selection means a new trace, so ?step= is cleared in the SAME
      // update — and the immediate writer flushes any step write still pending,
      // which would otherwise re-add it once its debounce elapsed.
      setPhaseParamsNow({
        ...(patch.tab !== undefined ? { tab: patch.tab } : {}),
        ...(patch.tokenClass !== undefined ? { class: patch.tokenClass } : {}),
        // Keep ?algo= meaningful for the shared phase picker on every tab.
        ...(patch.stage !== undefined
          ? { algo: patch.stage }
          : patch.tab !== undefined
            ? { algo: nextTab === 'constructions' ? stage : 'scan' }
            : {}),
        step: null,
      });
    },
    [setPhaseParamsNow, tab, stage],
  );

  return { tab, stage, tokenClass, step, select };
}
