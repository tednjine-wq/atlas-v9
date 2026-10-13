// ============================================================
// Dixon-Coles tau + score matrix (v9.10 §J: tail-mass measured)
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
  raw: Float64Array;          // flat size*size, unsorted, row i col j
  sum: number;                // sum before normalization (1 - tailMass)
  tailMass: number;           // §J: omitted probability beyond truncation
  size: number;               // matrix dimension (10 default, adaptive)
}

export function buildScoreMatrix(lH: number, lA: number, rho: number, size = 10): ScoreMatrixResult {
  const raw = new Float64Array(size * size);
  let sum = 0;
  for (let i = 0; i < size; i++) {
    const pi = poisson(i, lH);
    for (let j = 0; j < size; j++) {
      const p = dcTau(i, j, lH, lA, rho) * pi * poisson(j, lA);
      raw[i * size + j] = p;
      sum += p;
    }
  }
  const tailMass = Math.max(0, 1 - sum);
  const matrix: ScoreEntry[] = [];
  for (let i = 0; i < size; i++)
    for (let j = 0; j < size; j++)
      matrix.push({ s: `${i}:${j}`, i, j, p: raw[i * size + j] / sum });
  matrix.sort((a, b) => b.p - a.p);
  return { matrix, raw, sum, tailMass, size };
}

export function outcomeProbs(raw: Float64Array, sum: number, size = 10): Record<Outcome, number> {
  let h = 0, d = 0, a = 0;
  for (let i = 0; i < size; i++)
    for (let j = 0; j < size; j++) {
      const p = raw[i * size + j] / sum;
      if (i > j) h += p; else if (i === j) d += p; else a += p;
    }
  return { home: h, draw: d, away: a };
}