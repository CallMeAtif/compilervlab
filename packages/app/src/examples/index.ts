import { gcdAcceptanceSource } from './gcd-acceptance.c';
import { arraySumSource } from './array-sum.c';
import { pointerSwapSource } from './pointer-swap.c';
import { floatAverageSource } from './float-average.c';
import { typeErrorSource } from './type-error.c';

export interface ExampleProgram {
  id: string;
  name: string;
  description: string;
  source: string;
}

export const EXAMPLES: readonly ExampleProgram[] = [
  {
    id: 'gcd-acceptance',
    name: 'gcd (acceptance sample)',
    description: 'Function + while loop + if/else — the end-to-end acceptance program.',
    source: gcdAcceptanceSource,
  },
  {
    id: 'array-sum',
    name: 'array sum',
    description: 'Array declaration, indexing, and a for loop.',
    source: arraySumSource,
  },
  {
    id: 'pointer-swap',
    name: 'pointer swap',
    description: 'Pointers: &, *, and swapping through them.',
    source: pointerSwapSource,
  },
  {
    id: 'float-average',
    name: 'float average',
    description: 'float arithmetic with implicit int-to-float widening.',
    source: floatAverageSource,
  },
  {
    id: 'type-error',
    name: 'type error (deliberate)',
    description: 'Ill-typed on purpose — demonstrates educational error reporting.',
    source: typeErrorSource,
  },
];

export const DEFAULT_EXAMPLE_ID = 'gcd-acceptance';

export function exampleById(id: string): ExampleProgram | undefined {
  return EXAMPLES.find((e) => e.id === id);
}
