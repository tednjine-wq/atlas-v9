import { describe, expect, it } from 'vitest';
import { adaptiveSimulate, buildSampler, samplerOutcomeProbs, simulateParlay } from './adaptive-mc';

const L = { lH: 1.6, lA: 1.2, rho: -0.13 };
const truth = samplerOutcomeProbs(buildSampler(L.lH, L.lA, L.rho));

function coverage(outcome: 'home' | 'draw' | 'away', seeds = 120): number {
  let covered = 0;
  for (let s = 0; s < seeds; s++) {
    const r = adaptiveSimulate(L.lH, L.lA, L.rho, { seed: 700 + s, minPairs: 400, maxPairs: 2000 });
    if (Math.abs(r.probs[outcome] - truth[outcome]) <= r.ci95[outcome]) covered++;
  }
  return covered / seeds;
}

describe('§H pair-mean CI: coverage, bias, stability', () => {
  it('home CI covers the true probability ~95% of seeds', () => {
    const c = coverage('home');
    expect(c).toBeGreaterThan(0.86);
    expect(c).toBeLessThan(0.99);
  });
  it('draw CI covers the true probability ~95% of seeds', () => {
    const c = coverage('draw');
    expect(c).toBeGreaterThan(0.86);
    expect(c).toBeLessThan(0.99);
  });
  it('estimator is unbiased across seeds', () => {
    let sum = 0; const S = 60;
    for (let s = 0; s < S; s++) sum += adaptiveSimulate(L.lH, L.lA, L.rho, { seed: s, minPairs: 1000, maxPairs: 4000 }).probs.home;
    expect(Math.abs(sum / S - truth.home)).toBeLessThan(0.01);
  });
  it('CI half-width shrinks with simulation count', () => {
    const half = (mp: number) => {
      let s = 0;
      for (let k = 0; k < 25; k++) s += adaptiveSimulate(L.lH, L.lA, L.rho, { seed: k, minPairs: mp, maxPairs: mp }).ci95.home;
      return s / 25;
    };
    expect(half(4000)).toBeLessThan(half(400) * 0.6);
  });
  it('rho stays within-match: leg-1 marginal invariant to leg-2 rho', () => {
    const leg1 = { lH: 1.8, lA: 0.9, rho: -0.13, pick: 'home' as const };
    const a = simulateParlay([leg1, { lH: 1.1, lA: 1.4, rho: -0.08, pick: 'away' }], 20000, 5);
    const b = simulateParlay([leg1, { lH: 1.1, lA: 1.4, rho: -0.35, pick: 'away' }], 20000, 5);
    expect(Math.abs(a.legProbs[0] - b.legProbs[0])).toBeLessThan(0.01);
    expect(Math.abs(a.legProbs[0] - samplerOutcomeProbs(buildSampler(leg1.lH, leg1.lA, leg1.rho)).home)).toBeLessThan(0.01);
  });
});