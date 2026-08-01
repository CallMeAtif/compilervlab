/** What every syntax view receives from the page shell. */
import type { Grammar } from '@lab/core/grammar/grammar.js';
import type { UseStepperOptions } from '../../../lib/useStepper';
import type { GrammarId } from './grammars';
import type { AlgoId } from './algorithms';

export interface ViewContext {
  grammarId: GrammarId;
  grammar: Grammar;
  /** G′ = G augmented with S′ → S; the LR traces number productions in it. */
  augmented: Grammar;
  leftRecursive: readonly string[];
  /** Deep-link cursor restore + write-back, shared by every view. */
  stepperOptions: UseStepperOptions;
  /**
   * The sentence to parse: whitespace-separated terminal names for the study
   * grammars, C source for `c-subset` / `c-subset-ll`. Empty when nothing has
   * been compiled yet.
   */
  source: string;
  /** Terminal names of `source` (study grammars only; '' for the C grammars). */
  sourceTerminals: readonly string[];
  /** Switch the page to another algorithm (used by the educational empty states). */
  selectAlgo: (algo: AlgoId) => void;
}
