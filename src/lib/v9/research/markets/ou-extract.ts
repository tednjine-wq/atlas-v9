// ============================================================
// Over/Under probability extraction — RESEARCH ONLY (R10-mkt).
// Uses a research-owned tau-corrected DC grid (dcGridMatrix),
// proven numerically equivalent to the production score matrix
// by the draw-partition equivalence test in ou25.test.ts.
// Over/Under sums are symmetric in (home,away) goals, so they
// are invariant to grid orientation conventions.
// Imports pure math only: math/calibration (lambda source).
// Half-integer lines only (2.5): no push mass, over+under = 1
// exactly after normalization by grid sum (truncation-safe).
// ============================================================
import { calibrateLambda } from '../../math/calibration';

export interface OuProbs { over: number; under: number; truncMass: number; }
export interface DcGrid { raw: number[][]; sum: number; }

function logFact(k: number): number { let s = 0; for (let i = 2; i <= k; i++) s += Math.log(i); return s; }

// tau-corrected bivariate Poisson grid, 0..9 per team (unnormalized).
export function dcGridMatrix(lh: number, la: number, rho: number): DcGrid {
  const pois = (k: number, l: number) => Math.exp(-l + k * Math.log(l) - logFact(k));
  const raw: number[][] = [];
  let sum = 0;
  for (let y = 0; y <= 9; y++) {
    const row: number[] = [];
    for (let x = 0; x <= 9; x++) {
      let tau = 1;
      if (x === 0 && y === 0) tau = 1 - lh * la * rho;
      else if (x === 0 && y === 1) tau = 1 + lh * rho;
      else if (x === 1 && y === 0) tau = 1 + la * rho;
      else if (x === 1 && y === 1) tau = 1 - rho;
      const p = tau * pois(x, lh) * pois(y, la);
      row.push(p); sum += p;
    }
    raw.push(row);
  }
  return { raw, sum };
}

// Direct enumeration: P(total goals > line) over raw cells.
export function overFromRaw(raw: number[][], sum: number, line: number): number {
  let acc = 0;
  for (let i = 0; i < raw.length; i++)
    for (let j = 0; j < raw[i].length; j++)
      if (i + j > line) acc += raw[i][j];
  return acc / sum;
}

// Complement enumeration (identity tests): P(total <= line).
export function underFromRaw(raw: number[][], sum: number, line: number): number {
  let acc = 0;
  for (let i = 0; i < raw.length; i++)
    for (let j = 0; j < raw[i].length; j++)
      if (i + j <= line) acc += raw[i][j];
  return acc / sum;
}

export function ouProbs(raw: number[][], sum: number, line = 2.5): OuProbs {
  const over = overFromRaw(raw, sum, line);
  return { over, under: 1 - over, truncMass: Math.max(0, 1 - sum) };
}

// ATLAS Over 2.5 from 1X2 entry odds: same lambda source as the
// frozen engine (calibrateLambda grid search), rho = -0.13.
export function atlasOver25(h: number, d: number, a: number, rho = -0.13): OuProbs | null {
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const cal = calibrateLambda(h, d, a, rho, undefined);
  const g = dcGridMatrix(cal.lambdaH, cal.lambdaA, rho);
  return ouProbs(g.raw, g.sum, 2.5);
}

// Truncation / tail-mass audit over the lambda range: 10x10 grid
// retains >= ~0.9934 at worst (lambda 3.5/3.5); test bound 0.99; OU probs normalize by sum.
export function tailAudit(rho = -0.13): { minSum: number; worstLambda: [number, number] } {
  let minSum = 1; let worst: [number, number] = [0, 0];
  for (let lh = 0.3; lh <= 3.51; lh += 0.1)
    for (let la = 0.2; la <= 3.51; la += 0.1) {
      const g = dcGridMatrix(+lh.toFixed(2), +la.toFixed(2), rho);
      if (g.sum < minSum) { minSum = g.sum; worst = [+lh.toFixed(2), +la.toFixed(2)]; }
    }
  return { minSum, worstLambda: worst };
}

export function settleOu(hg: number, ag: number, line = 2.5): 'over' | 'under' {
  return hg + ag > line ? 'over' : 'under';
}