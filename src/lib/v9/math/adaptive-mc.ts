// ============================================================
// Adaptive Monte Carlo — v9.10 review rewrite (§B, §H)
//   • CDF-inverse sampling (v8.7, ~100x faster than naive)
//   • §B FIX: parlay legs use INDEPENDENT per-leg RNG streams;
//     antithetic variates (u, 1-u) apply WITHIN each leg across
//     the two replicates of a pair — never across legs.
//     Joint slip probability = product of leg probabilities.
//   • §H FIX: confidence intervals use the pair-mean (batch)
//     estimator, valid under antithetic pairing; sequential
//     stopping checks the paired CI half-width.
//   • RULE 5 PRESERVED: MC is a cross-check, NEVER replaces grid model
// ============================================================
import { dcTau } from './dixon-coles';
import { poisson, mulberry32 } from './poisson';
import type { Outcome, SimResult, DisagreementLevel, SimRecommendation } from '../atlas-types';

export interface Sampler { cdf: Float64Array; scores: Uint8Array; } // scores = i*10+j

export function buildSampler(lH: number, lA: number, rho: number): Sampler {
  const cdf = new Float64Array(100);
  const scores = new Uint8Array(100);
  let acc = 0, idx = 0;
  for (let i = 0; i < 10; i++) {
    const pi = poisson(i, lH);
    for (let j = 0; j < 10; j++) {
      acc += dcTau(i, j, lH, lA, rho) * pi * poisson(j, lA);
      cdf[idx] = acc;
      scores[idx] = i * 10 + j;
      idx++;
    }
  }
  for (let k = 0; k < 100; k++) cdf[k] /= acc; // normalize final value to exactly 1
  return { cdf, scores };
}

function sample(s: Sampler, u: number): number {
  let lo = 0, hi = 99;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (s.cdf[mid] < u) lo = mid + 1; else hi = mid;
  }
  return s.scores[lo];
}

// §H: pair-based (batch-mean) CI half-width — valid under antithetic pairing.
export function pairMeanCiHalf(pairSums: ArrayLike<number>, z = 1.96): { p: number; half: number } {
  const n = pairSums.length;
  if (n < 2) return { p: NaN, half: NaN };
  let sum = 0;
  for (let i = 0; i < n; i++) sum += pairSums[i] / 2;
  const p = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) { const m = pairSums[i] / 2 - p; ss += m * m; }
  return { p, half: z * Math.sqrt(ss / (n - 1) / n) };
}

// Test/debug helper: exact 1X2 marginals recovered from a sampler's CDF.
export function samplerOutcomeProbs(s: Sampler): Record<Outcome, number> {
  const out: Record<Outcome, number> = { home: 0, draw: 0, away: 0 };
  let prev = 0;
  for (let k = 0; k < s.cdf.length; k++) {
    const p = s.cdf[k] - prev;
    prev = s.cdf[k];
    const i = (s.scores[k] / 10) | 0;
    const j = s.scores[k] % 10;
    out[i > j ? 'home' : i === j ? 'draw' : 'away'] += p;
  }
  return out;
}

export interface AdaptiveMCOptions {
  minPairs?: number;   // default 1000 (=2k draws)
  maxPairs?: number;   // default 10000 (=20k draws)
  tol?: number;        // paired-CI half-width target, default 0.008
  seed?: number;
  gridProbs?: Record<Outcome, number>;
  gridPick?: Outcome;
}

export function adaptiveSimulate(lH: number, lA: number, rho: number, opts: AdaptiveMCOptions = {}): SimResult {
  const minPairs = opts.minPairs ?? 1000;
  const maxPairs = opts.maxPairs ?? 10000;
  const tol = opts.tol ?? 0.008;
  const rng = mulberry32(opts.seed ?? 0xC0FFEE);
  const sampler = buildSampler(lH, lA, rho);

  const cTot: Record<Outcome, number> = { home: 0, draw: 0, away: 0 };
  const pairSums: Record<Outcome, number[]> = { home: [], draw: [], away: [] };
  const scoreCount = new Float64Array(100);
  let total = 0, gSum = 0, gSq = 0;

  for (let pairs = 0; pairs < maxPairs; pairs++) {
    const u = rng();
    const sums: Record<Outcome, [number, number]> = { home: [0, 0], draw: [0, 0], away: [0, 0] };
    for (let rep = 0; rep < 2; rep++) {
      const uu = Math.min(rep === 0 ? u : 1 - u, 0.999999);
      const code = sample(sampler, uu);
      const i = (code / 10) | 0, j = code % 10;
      const res: Outcome = i > j ? 'home' : i === j ? 'draw' : 'away';
      cTot[res]++; sums[res][rep]++;
      const g = i + j; gSum += g; gSq += g * g;
      scoreCount[code]++;
      total++;
    }
    (Object.keys(sums) as Outcome[]).forEach((k) => pairSums[k].push(sums[k][0] + sums[k][1]));
    if (pairs + 1 >= minPairs && (pairs + 1) % 100 === 0) {
      const half = Math.max(
        pairMeanCiHalf(pairSums.home).half,
        pairMeanCiHalf(pairSums.draw).half,
        pairMeanCiHalf(pairSums.away).half,
      );
      if (half <= tol) break;
    }
  }

  const probs: Record<Outcome, number> = { home: cTot.home / total, draw: cTot.draw / total, away: cTot.away / total };
  const ci95: Record<Outcome, number> = {
    home: pairMeanCiHalf(pairSums.home).half,
    draw: pairMeanCiHalf(pairSums.draw).half,
    away: pairMeanCiHalf(pairSums.away).half,
  };
  const meanGoals = gSum / total;
  const sdGoals = Math.sqrt(Math.max(gSq / total - meanGoals * meanGoals, 0));

  const scoreFreq = Array.from(scoreCount)
    .map((c, code) => ({ s: `${(code / 10) | 0}:${code % 10}`, i: (code / 10) | 0, j: code % 10, p: c / total }))
    .sort((a, b) => b.p - a.p).slice(0, 10);

  // --- disagreement vs grid (v8.7 bands preserved) ---
  const deltas: Record<Outcome, number> = { home: 0, draw: 0, away: 0 };
  let maxDelta = 0;
  if (opts.gridProbs) {
    for (const k of ['home', 'draw', 'away'] as Outcome[]) {
      deltas[k] = probs[k] - opts.gridProbs[k];
      maxDelta = Math.max(maxDelta, Math.abs(deltas[k]));
    }
  }
  const disagreement: DisagreementLevel =
    maxDelta < 0.015 ? 'none' : maxDelta < 0.03 ? 'low' : maxDelta < 0.06 ? 'medium' : 'high';

  const simPick = (Object.entries(probs) as [Outcome, number][]).sort((a, b) => b[1] - a[1])[0][0];
  let recommendation: SimRecommendation = 'none';
  if (opts.gridPick && disagreement !== 'none') {
    if (simPick !== opts.gridPick && (disagreement === 'high' || disagreement === 'medium'))
      recommendation = 'flip_pick';
    else if (simPick === opts.gridPick && disagreement === 'high')
      recommendation = 'investigate';
    else recommendation = 'shrink_confidence';
  } else if (disagreement !== 'none') recommendation = 'shrink_confidence';

  const confMultiplier = disagreement === 'high' ? 0.93
    : disagreement === 'medium' ? 0.97
    : disagreement === 'low' ? 0.99 : 1.0;

  return {
    n: total, probs, ci95, meanGoals, sdGoals, scoreFreq,
    deltas, maxDelta, disagreement, recommendation, confMultiplier,
    convergedAt: total,
  };
}

// Parlay simulation (v9.10 §B: independent per-leg streams, antithetic within-leg)
export function simulateParlay(
  legs: { lH: number; lA: number; rho: number; pick: Outcome }[],
  nPairs = 5000,
  seed = 42,
) {
  const samplers = legs.map((l) => buildSampler(l.lH, l.lA, l.rho));
  const rngs = legs.map((_, k) => mulberry32((seed + k * 0x9e3779b9) >>> 0));
  const legHits = legs.map(() => 0);
  let allHit = 0;
  const dist = new Float64Array(legs.length + 1);

  for (let n = 0; n < nPairs; n++) {
    const us = rngs.map((r) => r());
    for (const flip of [0, 1]) {
      let correct = 0;
      legs.forEach((leg, k) => {
        const uu = Math.min(flip === 0 ? us[k] : 1 - us[k], 0.999999);
        const code = sample(samplers[k], uu);
        const i = (code / 10) | 0, j = code % 10;
        const res: Outcome = i > j ? 'home' : i === j ? 'draw' : 'away';
        if (res === leg.pick) { legHits[k]++; correct++; }
      });
      if (correct === legs.length) allHit++;
      dist[correct]++;
    }
  }
  const total = nPairs * 2;
  const cumulative: Record<number, number> = {};
  for (let x = Math.ceil(legs.length / 2); x <= legs.length; x++) {
    let acc = 0;
    for (let k = x; k <= legs.length; k++) acc += dist[k] / total;
    cumulative[x] = acc;
  }
  return {
    allCorrect: allHit / total,
    legProbs: legHits.map((h) => h / total),
    expectedCorrect: legHits.reduce((s, h) => s + h / total, 0),
    distribution: Array.from(dist).map((c) => c / total),
    cumulative,
  };
}