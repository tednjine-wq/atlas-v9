// ============================================================
// Dixon-Coles tau + score matrix (v8.7 exact, v8.4 rho-consistency fix baked in)
// ============================================================
import { poisson } from './poisson';
import type { ScoreEntry, Outcome } from '../atlas-types';

export function dcTau(i: number, j: number, lH: number, lA: number, rho: number): number {
  if (i === 0 && j === 0) return 1 - lH * lA * rho;
  if (i === 0 && j === 1) return 1 + lH * rho;
  if (i === 1 && j === 0) return 1 + lA * rho;
  if (i === 1 && j === 1) return 1 - rho;
  return 1;
}

export interface ScoreMatrixResult {
  matrix: ScoreEntry[];       // sorted by p desc
  raw: Float64Array;          // flat 10x10, unsorted, row i col j
  sum: number;
}

export function buildScoreMatrix(lH: number, lA: number, rho: number): ScoreMatrixResult {
  const raw = new Float64Array(100);
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const pi = poisson(i, lH);
    for (let j = 0; j < 10; j++) {
      const p = dcTau(i, j, lH, lA, rho) * pi * poisson(j, lA);
      raw[i * 10 + j] = p;
      sum += p;
    }
  }
  const matrix: ScoreEntry[] = [];
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++)
      matrix.push({ s: `${i}:${j}`, i, j, p: raw[i * 10 + j] / sum });
  matrix.sort((a, b) => b.p - a.p);
  return { matrix, raw, sum };
}

export function outcomeProbs(raw: Float64Array, sum: number): Record<Outcome, number> {
  let h = 0, d = 0, a = 0;
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 10; j++) {
      const p = raw[i * 10 + j] / sum;
      if (i > j) h += p; else if (i === j) d += p; else a += p;
    }
  return { home: h, draw: d, away: a };
}
