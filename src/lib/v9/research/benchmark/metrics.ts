// ============================================================
// Proper scoring rules for 1X2. RPS ordering convention:
// home > draw > away, cumulative from the home end:
// RPS = (1/(K-1)) * sum_{i=1}^{K-1} (CDFpred(i) - CDFobs(i))^2.
// Uncertainty: normal-approx CIs on per-match scores;
// Wilson-style normal CI for accuracy.
// ============================================================
import type { Outcome } from '../../atlas-types';

export const ORDER: Outcome[] = ['home', 'draw', 'away'];

export interface ScoredMatch { id: string; date: number; probs: Record<Outcome, number>; outcome: Outcome; }

export function argmax(p: Record<Outcome, number>): Outcome {
  return ORDER.reduce((best, k) => (p[k] > p[best] ? k : best), ORDER[0]);
}

export function brier(p: Record<Outcome, number>, o: Outcome): number {
  let s = 0;
  for (const k of ORDER) s += (p[k] - (k === o ? 1 : 0)) ** 2;
  return s;
}

export function logLoss(p: Record<Outcome, number>, o: Outcome): number {
  return -Math.log(Math.max(p[o], 1e-9));
}

export function rps(p: Record<Outcome, number>, o: Outcome): number {
  let cp = 0, co = 0, s = 0;
  for (let i = 0; i < ORDER.length - 1; i++) {
    cp += p[ORDER[i]];
    if (o === ORDER[i]) co += 1;
    s += (cp - co) ** 2;
  }
  return s / (ORDER.length - 1);
}

export interface Band { lo: number; hi: number; n: number; meanPred: number; meanObs: number; }

// Reliability binned by the predicted probability of the model's
// argmax outcome; observed = argmax == actual (documented choice).
export function calibrationBands(scored: ScoredMatch[], edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0]): Band[] {
  const bands: Band[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i], hi = edges[i + 1];
    const inBand = scored.filter((s) => {
      const pk = s.probs[argmax(s.probs)];
      return pk >= lo && (pk < hi || (hi === 1 && pk <= 1));
    });
    const n = inBand.length;
    bands.push({
      lo, hi, n,
      meanPred: n ? inBand.reduce((a, s) => a + s.probs[argmax(s.probs)], 0) / n : 0,
      meanObs: n ? inBand.filter((s) => argmax(s.probs) === s.outcome).length / n : 0,
    });
  }
  return bands;
}

export function binomialCi(hits: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const p = hits / n;
  const h = z * Math.sqrt((p * (1 - p)) / n);
  return [Math.max(0, p - h), Math.min(1, p + h)];
}

export function meanCi(values: number[], z = 1.96): { mean: number; lo: number; hi: number } {
  const n = values.length;
  if (!n) return { mean: 0, lo: 0, hi: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const varr = values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, n - 1);
  const h = (z * Math.sqrt(varr)) / Math.sqrt(n);
  return { mean, lo: mean - h, hi: mean + h };
}

export interface ModelReport {
  model: string; n: number;
  brier: number; brierCi: { lo: number; hi: number };
  logLoss: number; logLossCi: { lo: number; hi: number };
  rps: number; accuracy: number; accCi: [number, number];
  calibration: Band[];
}

export function evaluateModel(model: string, scored: ScoredMatch[]): ModelReport {
  const bs = scored.map((s) => brier(s.probs, s.outcome));
  const ls = scored.map((s) => logLoss(s.probs, s.outcome));
  const rs = scored.map((s) => rps(s.probs, s.outcome));
  const hits = scored.filter((s) => argmax(s.probs) === s.outcome).length;
  const bCi = meanCi(bs), lCi = meanCi(ls);
  return {
    model, n: scored.length,
    brier: bCi.mean, brierCi: { lo: bCi.lo, hi: bCi.hi },
    logLoss: lCi.mean, logLossCi: { lo: lCi.lo, hi: lCi.hi },
    rps: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0,
    accuracy: scored.length ? hits / scored.length : 0,
    accCi: binomialCi(hits, scored.length),
    calibration: calibrationBands(scored),
  };
}