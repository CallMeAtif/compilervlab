/** Deliberately ill-typed program: exercises the semantic-error path. */
export const typeErrorSource = `// Deliberate errors: watch the Semantic stage stop and explain each one.

int main() {
    int n = 5;
    int *p = &n;
    float f = 2.5;

    n = p + f;        // ERROR: cannot add 'int*' and 'float'
    missing = n + 1;  // ERROR: use of undeclared identifier 'missing'

    return n;
}
`;
