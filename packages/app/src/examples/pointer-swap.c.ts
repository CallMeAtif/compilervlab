export const pointerSwapSource = `// Pointers: address-of, dereference, and a classic swap.

void swap(int *p, int *q) {
    int t;
    t = *p;
    *p = *q;
    *q = t;
}

int main() {
    int x = 3;
    int y = 9;
    swap(&x, &y);
    return x - y;   // 9 - 3 = 6
}
`;
