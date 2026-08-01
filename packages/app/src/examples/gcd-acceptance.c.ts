/** The acceptance sample from SPEC.md: a function with a loop and if/else. */
export const gcdAcceptanceSource = `// Acceptance sample: function + while loop + if/else.
// Computes gcd(48, 36) = 12 by Euclid's algorithm.

int gcd(int a, int b) {
    while (b != 0) {
        int t;
        t = a % b;
        a = b;
        b = t;
    }
    return a;
}

int main() {
    int x = 48;
    int y = 36;
    if (x < y) {
        int tmp;
        tmp = x;
        x = y;
        y = tmp;
    } else {
        x = x + 0;   // keep the else branch non-empty
    }
    return gcd(x, y);
}
`;
