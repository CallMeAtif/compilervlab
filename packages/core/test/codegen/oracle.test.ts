/**
 * Whole-phase correctness oracle: for a spread of small C programs, the value
 * the emitted x86-64 subset computes (interp/asm.ts, §8.2.1) must equal the
 * value the (optimized) TAC denotes (interp/tac.ts). Any disagreement is a
 * code-generation bug — this is the check that catches addressing-mode and
 * register-assignment mistakes that individual unit assertions miss.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../../src/compile.js';
import { runTac } from '../../src/interp/tac.js';
import { runAsm } from '../../src/interp/asm.js';

const cases: Array<[string, string]> = [
  ['char array', `int main(){char c[6];int i;i=0;while(i<6){c[i]=i+65;i=i+1;}return c[3];}`],
  ['float array', `int main(){float f[4];int i;i=0;while(i<4){f[i]=1.5;i=i+1;}if(f[3]>1.4){if(f[3]<1.6){return 7;}}return 0;}`],
  ['float param+return', `float half(float x){return x/2.0;} int main(){float r;r=half(9.0);if(r>4.4){if(r<4.6){return 3;}}return 0;}`],
  ['many float args', `float s(float a,float b,float c){return a+b+c;} int main(){float r;r=s(1.0,2.0,3.0);if(r>5.9){if(r<6.1){return 4;}}return 0;}`],
  ['pointer to an element', `int main(){int a[5];int*p;int i;i=0;while(i<5){a[i]=i*3;i=i+1;}p=&a[2];return *p;}`],
  ['nested calls + array', `int g(int a[],int n){int s;int i;s=0;i=0;while(i<n){s=s+a[i];i=i+1;}return s;} int f(){int b[3];b[0]=1;b[1]=2;b[2]=3;return g(b,3);} int main(){return f()+f();}`],
  ['global array + scalar', `int gg[4]; int hh; int main(){int i;hh=99;i=0;while(i<4){gg[i]=i+1;i=i+1;}return gg[3]*10+hh;}`],
  ['float across two calls', `float d(float x){return x*2.0;} int main(){float a;float b;float c;a=1.0;b=2.0;c=a+d(3.0)+b+d(4.0);if(c>16.9){if(c<17.1){return 5;}}return 0;}`],
  ['float mixed with int', `int main(){float f;int n;n=7;f=n;f=f+0.5;if(f>7.4){if(f<7.6){return 6;}}return 0;}`],
  ['spill + array', `int main(){int a[4];int t1;int t2;int t3;int t4;int t5;int t6;int t7;int t8;int t9;int t10;
    t1=1;t2=2;t3=3;t4=4;t5=5;t6=6;t7=7;t8=8;t9=9;t10=10;
    a[0]=t1+t2;a[1]=t3+t4;a[2]=t5+t6;a[3]=t7+t8;
    return a[0]+a[1]+a[2]+a[3]+t9+t10;}`],
];

describe('TAC interpreter as the codegen oracle', () => {
  for (const [name, src] of cases) {
    it(name, () => {
      const c = compile(src);
      expect(c.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
      const tac = runTac(c.optimized!.output);
      const asm = runAsm(c.asm!);
      expect([name, asm.error]).toEqual([name, null]);
      expect([name, asm.returnValue]).toEqual([name, tac.returnValue]);
    });
  }
});
