/**
 * LL-family syntax analysis — single import surface.
 * Re-exports every event union, UI state, reducer, initial state, run
 * function and raw result type of the LL modules, plus the combined event
 * union for UI plumbing.
 */
export type {
  SymbolSets,
  FirstFollowResult,
  FirstFollowState,
  FirstFollowEvent,
} from './first-follow.js';
export {
  firstFollowSteps,
  firstFollowReducer,
  initialFirstFollowState,
  firstOfString,
  firstFollow,
  runFirstFollow,
} from './first-follow.js';

export type {
  LL1Entry,
  LL1Table,
  LL1Conflict,
  LL1Resolution,
  LL1ResolutionRule,
  LL1TableResult,
  LL1TableState,
  LL1TableEvent,
} from './ll1-table.js';
export {
  ll1TableSteps,
  ll1TableReducer,
  initialLL1TableState,
  ll1Lookup,
  ll1Resolve,
  ll1RowExpected,
  ll1Table,
  runLL1Table,
} from './ll1-table.js';

export type {
  LL1ParseTreeNode,
  LL1MoveRow,
  LL1ParseError,
  LL1ParseState,
  LL1ParseResult,
  LL1ParseEvent,
} from './ll1-parse.js';
export {
  ll1ParseSteps,
  ll1ParseReducer,
  ll1ParseLimits,
  initialLL1ParseState,
  runLL1Parse,
} from './ll1-parse.js';

export type { RDNode, RDError, RDState, RDResult, RDEvent } from './recursive-descent.js';
export {
  recursiveDescentSteps,
  rdReducer,
  initialRDState,
  runRecursiveDescent,
} from './recursive-descent.js';

export type { GProd, TransformState, TransformEvent, LLReadyCGrammar } from './transforms.js';
export {
  eliminateLeftRecursionSteps,
  leftFactorSteps,
  eliminateLeftRecursion,
  leftFactor,
  transformReducer,
  initialTransformState,
  projectTransformResult,
  runEliminateLeftRecursion,
  runLeftFactor,
  llReadyCGrammar,
} from './transforms.js';

import type { FirstFollowEvent } from './first-follow.js';
import type { LL1TableEvent } from './ll1-table.js';
import type { LL1ParseEvent } from './ll1-parse.js';
import type { RDEvent } from './recursive-descent.js';
import type { TransformEvent } from './transforms.js';

/** Every event any LL-family algorithm can emit. */
export type LLEvent =
  | FirstFollowEvent
  | LL1TableEvent
  | LL1ParseEvent
  | RDEvent
  | TransformEvent;
