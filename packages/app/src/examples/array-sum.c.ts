export const arraySumSource = `// Arrays + for loop: fills data[i] = i*i, then sums it.

int sum(int a[], int n) {
    int total = 0;
    int i;
    for (i = 0; i < n; i = i + 1) {
        total = total + a[i];
    }
    return total;
}

int main() {
    int data[5];
    int i;
    for (i = 0; i < 5; i = i + 1) {
        data[i] = i * i;
    }
    return sum(data, 5);   // 0 + 1 + 4 + 9 + 16 = 30
}
`;
