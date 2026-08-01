export type {
  Json,
  SourceSpan,
  IrRef,
  Citation,
  StepLevel,
  StepMeta,
  StepRecord,
  Reducer,
  Steps,
  Trace,
  RecordOptions,
  Recorded,
} from './trace.js';
export { record } from './record.js';
export { checkTraceInvariants, deepEqual } from './invariants.js';
export type { InvariantViolation } from './invariants.js';
export { serializeTrace, traceFromSerialized } from './record.js';
export type { SerializedTrace } from './record.js';
