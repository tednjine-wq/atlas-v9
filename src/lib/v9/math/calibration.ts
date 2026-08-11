// ============================================================
// Lambda calibration v9.6 — two-phase grid search (§3.3) +
// hybrid prior blending (v9) + NEW multi-market WLS blend (§8).
// Multi-market adds DC / O1.5 / O2.5 / BTTS implied probs to the
// error metric so λ reflects the book's GOALS prices too —
// fixing the systematic BTTS-Yes bias seen in the 11/08 review.
// Standard engine only; jackpot stays 1X2-pure (Rule 6).
// ============================================================
import { buildScoreMatrix, outcomeProbs } from './dixon-coles';
import type { CalibrationResult, HybridCalibration, TeamStrengthPrior } from '../atlas-types';

export function stripMargin(h: number, d: number, a: number): { probs: [number, number, number]; margin: number } {
  const ih = 1 / h, id = 1 / d, ia = 1 / a;
  const s = ih + id + ia;
  return { probs: [ih / s, id / s, ia / s], margin: s - 1 };
}

export interface ExtraMarketProbs {
  p1X?: number; pX2?: number; pO15?: number; pO25?: number; pBTTS?: number;
  count: number;
}

function modelAt(lH: number, lA: number, rho: number) {
  const sm = buildScoreMatrix(lH, lA, rho);
  const p = outcomeProbs(sm.raw, sm.sum);
  let le1 = 0, le2 = 0, btts = 0;
  for (const e of sm.matrix) {
    const t = e.i + e.j;
    if (t <= 1) le1 += e.p;
    if (t <= 2) le2 += e.p;
    if (e.i > 0 && e.j > 0) btts += e.p;
  }
  return { pH: p.home, pD: p.draw, pA: p.away, o15: 1 - le1, o25: 1 - le2, btts };
}

function targetWithPrior(probs: [number, number, number], margin: number, prior?: TeamStrengthPrior) {
  let target = probs;
  let hybrid: HybridCalibration = {
    source: 'market-only', marketProbs: probs, priorProbs: null,
    blendedProbs: probs, marketPrecision: 1 / Math.max(margin, 0.01), priorPrecision: 0,
  };
  if (prior && prior.confidence > 0) {
    const wm = 1 / Math.max(margin, 0.01);
    const wp = Math.min(prior.confidence, 8);
    const pp: [number, number, number] = [prior.pHome, prior.pDraw, prior.pAway];
    const b = probs.map((p, i) => (p * wm + pp[i] * wp) / (wm + wp)) as [number, number, number];
    const s = b[0] + b[1] + b[2];
    target = [b[0] / s, b[1] / s, b[2] / s];
    hybrid = { source: 'hybrid', marketProbs: probs, priorProbs: pp, blendedProbs: target, marketPrecision: wm, priorPrecision: wp };
  }
  return { target, hybrid };
}

function gridSearch(err: (lH: number, lA: number) => number) {
  let bH = 1.2, bA = 1.0, bE = Infinity;
  for (let lH = 0.3; lH <= 3.01; lH += 0.1)
    for (let lA = 0.2; lA <= 2.51; lA += 0.1) {
      const e = err(lH, lA);
      if (e < bE) { bE = e; bH = lH; bA = lA; }
    }
  for (let lH = Math.max(0.2, bH - 0.1); lH <= bH + 0.11; lH += 0.01)
    for (let lA = Math.max(0.1, bA - 0.1); lA <= bA + 0.11; lA += 0.01) {
      const e = err(lH, lA);
      if (e < bE) { bE = e; bH = lH; bA = lA; }
    }
  return { lambdaH: Math.round(bH * 100) / 100, lambdaA: Math.round(bA * 100) / 100, sse: bE };
}

export function calibrateLambda(h: number, d: number, a: number, rho: number, prior?: TeamStrengthPrior): CalibrationResult {
  const { probs, margin } = stripMargin(h, d, a);
  const { target, hybrid } = targetWithPrior(probs, margin, prior);
  const res = gridSearch((lH, lA) => {
    const m = modelAt(lH, lA, rho);
    return (m.pH - target[0]) ** 2 + (m.pD - target[1]) ** 2 + (m.pA - target[2]) ** 2;
  });
  return { ...res, hybrid };
}

// v9.6 §8 — weighted least squares across all available markets
export function calibrateLambdaMultiMarket(
  h: number, d: number, a: number, rho: number,
  extra: ExtraMarketProbs, prior?: TeamStrengthPrior,
): CalibrationResult {
  const { probs, margin } = stripMargin(h, d, a);
  const { target, hybrid } = targetWithPrior(probs, margin, prior);
  const wDC = 0.5, wG = 0.9, wB = 0.9;
  const res = gridSearch((lH, lA) => {
    const m = modelAt(lH, lA, rho);
    let e = (m.pH - target[0]) ** 2 + (m.pD - target[1]) ** 2 + (m.pA - target[2]) ** 2;
    if (extra.p1X !== undefined) e += wDC * (m.pH + m.pD - extra.p1X) ** 2;
    if (extra.pX2 !== undefined) e += wDC * (m.pD + m.pA - extra.pX2) ** 2;
    if (extra.pO15 !== undefined) e += wG * (m.o15 - extra.pO15) ** 2;
    if (extra.pO25 !== undefined) e += wG * (m.o25 - extra.pO25) ** 2;
    if (extra.pBTTS !== undefined) e += wB * (m.btts - extra.pBTTS) ** 2;
    return e;
  });
  return { ...res, hybrid, mmMarkets: extra.count };
}
