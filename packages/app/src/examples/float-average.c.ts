export const floatAverageSource = `// float arithmetic with implicit int -> float widening (Dragon Book 6.5.2).

float average(int a[], int n) {
    float total = 0.0;
    int i;
    for (i = 0; i < n; i = i + 1) {
        total = total + a[i];   // a[i] is widened int -> float
    }
    return total / n;           // n widened too
}

int main() {
    int scores[4];
    scores[0] = 70;
    scores[1] = 82;
    scores[2] = 91;
    scores[3] = 65;
    if (average(scores, 4) > 75.0) {
        return 1;
    } else {
        return 0;
    }
}
`;
