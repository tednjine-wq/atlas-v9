// ============================================================
// PATH B gate analysis (protocol H4) — RESEARCH ONLY.
// Tests whether ATLAS's deviations from devigged market prices
// carry repeatable outcome information. Pre-specified single
// shrinkage lambda = 0.5 (no grid fishing); paired Brier diff
// with normal-approx CI; chronological, pre-kickoff info only.
// ============================================================
import type { Outcome } from '../atlas-types';
import { stripMargin } from '../math/calibration';

export const RESIDUAL_LAMBDA = 0.5;

export interface ResidualRow {
  predictionId: string; date: number; league?: string; gameType?: string;
  probs: Record<Outcome, number>; devig: Record<Outcome, number>;
  outcome: Outcome;
}

export function devigOf(h: number, d: number, a: number): Record<Outcome, number> {
  const t = stripMargin(h, d, a).probs;
  return { home: t[0], draw: t[1], away: t[2] };
}

export function blend(devig: Record<Outcome, number>, probs: Record<Outcome, number>, lambda: number): Record<Outcome, number> {
  const out = { home: 0, draw: 0, away: 0 };
  let z = 0;
  for (const k of ['home', 'draw', 'away'] as Outcome[]) {
    out[k] = devig[k] + lambda * (probs[k] - devig[k]);
    z += out[k];
  }
  for (const k of ['home', 'draw', 'away'] as Outcome[]) out[k] /= z;
  return out;
}

export function pairedBrierDiff(rows: ResidualRow[], lambda = RESIDUAL_LAMBDA): { n: number; mean: number; lo: number; hi: number } {
  const diffs = rows.map((r) => {
    const b = (p: Record<Outcome, number>) =>
      (p.home - (r.outcome === 'home' ? 1 : 0)) ** 2 +
      (p.draw - (r.outcome === 'draw' ? 1 : 0)) ** 2 +
      (p.away - (r.outcome === 'away' ? 1 : 0)) ** 2;
    return b(blend(r.devig, r.probs, lambda)) - b(r.devig); // negative = residual helps
  });
  const n = diffs.length;
  if (!n) return { n: 0, mean: 0, lo: 0, hi: 0 };
  const mean = diffs.reduce((a, x) => a + x, 0) / n;
  const varr = diffs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1);
  const h = (1.96 * Math.sqrt(varr)) / Math.sqrt(n);
  return { n, mean, lo: mean - h, hi: mean + h };
}