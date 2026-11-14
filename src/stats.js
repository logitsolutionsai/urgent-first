// Evaluation maths. See references/evaluation.md for the formulas and worked examples.

export const Z95 = 1.959963984540054;

/** Wilson score interval for a binomial proportion x/n. Returns {p, lower, upper}. */
export function wilson(x, n, z = Z95) {
  if (n === 0) return { p: null, lower: null, upper: null };
  const p = x / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  // At x = 0 or x = n the bound is exactly 0 or 1; avoid floating-point residue.
  return { p, lower: x === 0 ? 0 : Math.max(0, centre - half), upper: x === n ? 1 : Math.min(1, centre + half) };
}

/**
 * Kendall's tau-b between two equally long arrays of numbers (ties allowed in either).
 * tau_b = (C - D) / sqrt((n0 - n1) (n0 - n2)), n0 = n(n-1)/2, n1/n2 = tied pairs in x/y.
 */
export function kendallTauB(x, y) {
  const n = x.length;
  if (n !== y.length) throw new Error('kendallTauB: arrays differ in length');
  let concordant = 0;
  let discordant = 0;
  let tiesX = 0;
  let tiesY = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = Math.sign(x[i] - x[j]);
      const dy = Math.sign(y[i] - y[j]);
      if (dx === 0 && dy === 0) {
        tiesX++;
        tiesY++;
      } else if (dx === 0) tiesX++;
      else if (dy === 0) tiesY++;
      else if (dx === dy) concordant++;
      else discordant++;
    }
  }
  const n0 = (n * (n - 1)) / 2;
  const denom = Math.sqrt((n0 - tiesX) * (n0 - tiesY));
  if (denom === 0) return null;
  return (concordant - discordant) / denom;
}

export function round(v, digits = 3) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

export function pct(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  return `${(v * 100).toFixed(digits)}%`;
}
