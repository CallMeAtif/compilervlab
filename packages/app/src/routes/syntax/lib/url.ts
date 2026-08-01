/**
 * Deep-link state for /syntax.
 *
 * Everything — ?algo=, ?step= and the phase-specific ?grammar=, ?stage=,
 * ?table=, ?view= — goes through the shared lib/urlState.ts helper, which
 * accepts arbitrary phase params. Merged patches, `replace: true` so Back
 * leaves the page rather than the step.
 */
import { useCallback } from 'react';
import { usePhaseUrlState } from '../../../lib/urlState';
import { DEFAULT_GRAMMAR, isGrammarId, type GrammarId } from './grammars';
import {
  resolveAlgo,
  type AlgoId,
  type Lr1View,
  type LrTableChoice,
  type TransformStage,
} from './algorithms';

export interface SyntaxUrlState {
  grammar: GrammarId;
  algo: AlgoId;
  step: number | null;
  stage: TransformStage;
  table: LrTableChoice;
  lr1View: Lr1View;
}

export interface SyntaxUrlPatch {
  grammar?: GrammarId;
  algo?: AlgoId;
  step?: number | null;
  stage?: TransformStage;
  table?: LrTableChoice;
  lr1View?: Lr1View;
}

export function useSyntaxUrl(): SyntaxUrlState & {
  set: (patch: SyntaxUrlPatch) => void;
} {
  const {
    algo: rawAlgo,
    step,
    param,
    setPhaseParams,
    setPhaseParamsNow,
  } = usePhaseUrlState();

  const rawGrammar = param('grammar');
  const grammar: GrammarId = isGrammarId(rawGrammar) ? rawGrammar : DEFAULT_GRAMMAR;
  const stage: TransformStage =
    param('stage') === 'left-factor' ? 'left-factor' : 'eliminate-left-recursion';
  const table: LrTableChoice = param('table') === 'slr' ? 'slr' : 'lalr';
  const lr1View: Lr1View = param('view') === 'table' ? 'table' : 'items';

  const set = useCallback(
    (patch: SyntaxUrlPatch) => {
      const selection = {
        ...(patch.grammar !== undefined ? { grammar: patch.grammar } : {}),
        ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
        ...(patch.table !== undefined ? { table: patch.table } : {}),
        ...(patch.lr1View !== undefined ? { view: patch.lr1View } : {}),
        ...(patch.algo !== undefined ? { algo: patch.algo } : {}),
        ...('step' in patch ? { step: patch.step ?? null } : {}),
      };
      if (Object.keys(selection).length === 0) return;
      // A selection change (grammar / algorithm / sub-view) is click-driven and
      // must land now; a bare step write is continuous and stays debounced.
      const clickDriven =
        patch.grammar !== undefined ||
        patch.stage !== undefined ||
        patch.table !== undefined ||
        patch.lr1View !== undefined ||
        patch.algo !== undefined;
      if (clickDriven) setPhaseParamsNow(selection);
      else setPhaseParams(selection);
    },
    [setPhaseParams, setPhaseParamsNow],
  );

  return { grammar, algo: resolveAlgo(rawAlgo), step, stage, table, lr1View, set };
}
