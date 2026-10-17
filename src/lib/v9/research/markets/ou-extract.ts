// ============================================================
// Over/Under probability extraction from the Dixon-Coles score
// matrix — RESEARCH ONLY (R10-mkt).
// Imports pure, stateless math only (math/dixon-coles,
// math/calibration): the identical kernel the frozen engine's
// score matrix uses. NO engines, NO store, NO production ledger.
// Half-integer lines only (2.5): no push mass, over+under = 1.
// ============================================================
import { buildScoreMatrix } from '../../math/dixon-coles';
import { calibrateLambda } from '../../math/calibration';

export interface OuProbs { over: number; under: number; truncMass: number; }

// Direct enumeration over raw (unnormalized) DC cells: P(total > line).
export function overFromRaw(raw: number[][], sum: number, line: number): number {
  let acc = 0;
  for (let i = 0; i < raw.length; i++)
    for (let j = 0; j < raw[i].length; j++)
      if (i + j > line) acc += raw[i][j];
  return acc / sum;
}

// Complement enumeration (used by identity tests): P(total <= line).
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

// ATLAS Over 2.5 probability from 1X2 entry odds, via the SAME pure
// pipeline as the frozen engine (calibrateLambda grid search ->
// DC score matrix, rho = -0.13). Returns null on invalid odds.
export function atlasOver25(h: number, d: number, a: number, rho = -0.13): OuProbs | null {
  if (!(h > 1 && d > 1 && a > 1)) return null;
  const cal = calibrateLambda(h, d, a, rho, undefined);
  const sm = buildScoreMatrix(cal.lambdaH, cal.lambdaA, rho);
  return ouProbs(sm.raw, sm.sum, 2.5);
}

// Truncation / tail-mass audit across the production lambda range:
// reports the minimum retained grid mass (1 - truncMass).
export function tailAudit(rho = -0.13): { minSum: number; worstLambda: [number, number] } {
  let minSum = 1; let worst: [number, number] = [0, 0];
  for (let lh = 0.3; lh <= 3.51; lh += 0.1)
    for (let la = 0.2; la <= 3.51; la += 0.1) {
      const sm = buildScoreMatrix(+lh.toFixed(2), +la.toFixed(2), rho);
      if (sm.sum < minSum) { minSum = sm.sum; worst = [+lh.toFixed(2), +la.toFixed(2)]; }
    }
  return { minSum, worstLambda: worst };
}

export function settleOu(hg: number, ag: number, line = 2.5): 'over' | 'under' {
  return hg + ag > line ? 'over' : 'under';
}