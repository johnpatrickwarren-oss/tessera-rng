/**
 * Deterministic seeded PRNG (Numerical Recipes LCG) + helpers.
 *
 * The whole pipeline is replay-clean (spec AC-9), so all randomness flows through
 * an explicit seed here. Date.now()/Math.random() are never used in product code.
 */

export interface Rng {
  /** next float in [0, 1) */
  next(): number;
  /** next standard-normal draw (Box–Muller) */
  gaussian(): number;
  /** next integer in [0, n) */
  int(n: number): number;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9; // avoid the LCG fixed point at 0
  const nextU32 = (): number => {
    s = ((s * 1664525) + 1013904223) >>> 0;
    return s;
  };
  let spare: number | null = null;
  return {
    next: () => nextU32() / 0x100000000,
    int: (n: number) => Math.floor((nextU32() / 0x100000000) * n),
    gaussian(): number {
      if (spare !== null) {
        const v = spare;
        spare = null;
        return v;
      }
      // Box–Muller; guard u1 away from 0 so log is finite.
      const u1 = Math.max(nextU32() / 0x100000000, 1e-12);
      const u2 = nextU32() / 0x100000000;
      const mag = Math.sqrt(-2 * Math.log(u1));
      spare = mag * Math.sin(2 * Math.PI * u2);
      return mag * Math.cos(2 * Math.PI * u2);
    },
  };
}
