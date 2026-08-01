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

/** A working skeleton to type over — the point of the editor is your own code,
 *  so the list opens with a blank start rather than someone else's program. */
export const BLANK_SOURCE = `int main() {
    int x;
    x = 0;
    return x;
}
`;

export const EXAMPLES: readonly ExampleProgram[] = [
  {
    id: 'blank',
    name: 'Blank — write your own',
    description: 'A minimal main() to type over.',
    source: BLANK_SOURCE,
  },
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

/** Not a program: the id the picker reports once the editor no longer matches
 *  any bundled example, so the UI never claims you are on one when you are not. */
export const CUSTOM_ID = 'custom';

export function exampleById(id: string): ExampleProgram | undefined {
  return EXAMPLES.find((e) => e.id === id);
}

/** The example whose source is exactly this text, if any. */
export function exampleBySource(source: string): ExampleProgram | undefined {
  return EXAMPLES.find((e) => e.source === source);
}
