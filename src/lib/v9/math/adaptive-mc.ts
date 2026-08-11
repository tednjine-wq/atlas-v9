// ============================================================
// Adaptive Monte Carlo — v9.0 upgrade over fixed 10k:
//  • CDF-inverse sampling (v8.7, ~100x faster than naive)
//  • ANTITHETIC VARIATES: sample u and 1-u as pairs → ~3x variance reduction
//  • SEQUENTIAL STOPPING: start 2k draws, extend to 20k only if
//    CI half-width > tolerance (PEMC-inspired, arXiv 2024)
//  • RULE 5 PRESERVED: MC is a cross-check, NEVER replaces grid model
// ============================================================
import { dcTau } from './dixon-coles';
import { poisson, mulberry32 } from './poisson';
import type { Outcome, SimResult, DisagreementLevel, SimRecommendation } from '../atlas-types';

interface Sampler { cdf: Float64Array; scores: Uint8Array; } // scores = i*10+j

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

export interface AdaptiveMCOptions {
  minPairs?: number;    // default 1000 (=2k draws)
  maxPairs?: number;    // default 10000 (=20k draws)
  tol?: number;         // CI half-width target, default 0.008
  seed?: number;
  gridProbs?: Record<Outcome, number>;
  gridPick?: Outcome;
}

export function adaptiveSimulate(lH: number, lA: number, rho: number, opts: AdaptiveMCOptions = {}): SimResult {
  const minPairs = opts.minPairs ?? 1000;
  const maxPairs = opts.maxPairs ?? 10000;
  const tol = opts.tol ?? 0.008;
  const rng = mulberry32(opts.seed ?? 1337);
  const smp = buildSampler(lH, lA, rho);

  let cH = 0, cD = 0, cA = 0, gSum = 0, gSq = 0;
  const scoreCount = new Float64Array(100);
  let total = 0;

  const batch = (nPairs: number) => {
    for (let n = 0; n < nPairs; n++) {
      const u = rng();
      for (const uu of [u, 1 - u]) {          // antithetic pair
        const code = sample(smp, Math.min(uu, 0.999999));
        const i = (code / 10) | 0, j = code % 10;
        if (i > j) cH++; else if (i === j) cD++; else cA++;
        const g = i + j;
        gSum += g; gSq += g * g;
        scoreCount[code]++;
      }
    }
    total += nPairs * 2;
  };

  batch(minPairs);

  // sequential stopping: check CI on max-variance outcome
  const ciHalf = (c: number) => 1.96 * Math.sqrt(Math.max((c / total) * (1 - c / total) / total, 1e-12));
  while (total < maxPairs * 2 && Math.max(ciHalf(cH), ciHalf(cD), ciHalf(cA)) > tol) {
    batch(minPairs);
  }

  const probs = { home: cH / total, draw: cD / total, away: cA / total };
  const ci95 = { home: ciHalf(cH), draw: ciHalf(cD), away: ciHalf(cA) };
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

// Parlay simulation (v8.7 spec, antithetic-enhanced)
export function simulateParlay(
  legs: { lH: number; lA: number; rho: number; pick: Outcome }[],
  nPairs = 5000, seed = 42,
) {
  const rng = mulberry32(seed);
  const samplers = legs.map((l) => buildSampler(l.lH, l.lA, l.rho));
  const legHits = legs.map(() => 0);
  let allHit = 0;
  const dist = new Float64Array(legs.length + 1);
  const total = nPairs * 2;

  for (let n = 0; n < nPairs; n++) {
    const u = rng();
    for (const uu of [u, 1 - u]) {
      let correct = 0;
      legs.forEach((leg, k) => {
        const code = sample(samplers[k], Math.min(uu, 0.999999));
        const i = (code / 10) | 0, j = code % 10;
        const res: Outcome = i > j ? 'home' : i === j ? 'draw' : 'away';
        if (res === leg.pick) { legHits[k]++; correct++; }
      });
      if (correct === legs.length) allHit++;
      dist[correct]++;
    }
  }
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
