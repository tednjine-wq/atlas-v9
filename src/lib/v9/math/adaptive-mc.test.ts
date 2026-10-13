import { describe, expect, it } from 'vitest';
import { simulateParlay, buildSampler, samplerOutcomeProbs, pairMeanCiHalf } from './adaptive-mc';

const LEG = { lH: 1.7, lA: 1.1, rho: -0.13 };
const exact = (l: { lH: number; lA: number; rho: number }, pick: 'home' | 'draw' | 'away') =>
  samplerOutcomeProbs(buildSampler(l.lH, l.lA, l.rho))[pick];

describe('§B parlay independence', () => {
  it('single leg agrees with input probability', () => {
    const p = exact(LEG, 'home');
    const r = simulateParlay([{ ...LEG, pick: 'home' }], 20000, 7);
    expect(Math.abs(r.legProbs[0] - p)).toBeLessThan(0.01);
  });
  it('two independent legs: allCorrect ≈ p1*p2', () => {
    const l1 = { ...LEG, pick: 'home' as const };
    const l2 = { lH: 0.9, lA: 2.1, rho: -0.08, pick: 'away' as const };
    const p1 = exact(l1, 'home');
    const p2 = exact(l2, 'away');
    const r = simulateParlay([l1, l2], 30000, 11);
    expect(Math.abs(r.allCorrect - p1 * p2)).toBeLessThan(0.01);
    expect(Math.abs(r.legProbs[0] - p1)).toBeLessThan(0.01);
    expect(Math.abs(r.legProbs[1] - p2)).toBeLessThan(0.01);
  });
  it('multi-leg slip: joint ≈ product of leg probabilities', () => {
    const legs = [
      { lH: 1.8, lA: 0.8, rho: -0.13, pick: 'home' as const },
      { lH: 1.2, lA: 1.4, rho: -0.08, pick: 'draw' as const },
      { lH: 0.7, lA: 2.3, rho: -0.13, pick: 'away' as const },
    ];
    const prod = legs.map((l) => exact(l, l.pick)).reduce((a, b) => a * b, 1);
    const r = simulateParlay(legs, 30000, 23);
    expect(Math.abs(r.allCorrect - prod)).toBeLessThan(0.01);
  });
  it('antithetic pairing does not bias the estimate', () => {
    const p = exact(LEG, 'home');
    const means = Array.from({ length: 12 }, (_, s) => simulateParlay([{ ...LEG, pick: 'home' }], 8000, 100 + s).legProbs[0]);
    const avg = means.reduce((a, b) => a + b, 0) / means.length;
    expect(Math.abs(avg - p)).toBeLessThan(0.01);
  });
  it('handles degenerate p≈1 legs without NaN', () => {
    const r = simulateParlay([{ lH: 0, lA: 0, rho: -0.13, pick: 'draw' }, { ...LEG, pick: 'home' }], 2000, 5);
    expect(Number.isFinite(r.allCorrect)).toBe(true);
    expect(r.legProbs.every((x) => Number.isFinite(x))).toBe(true);
    expect(r.legProbs[0]).toBeCloseTo(1, 1);
  });
});

describe('§H pair-based CI helper', () => {
  it('zero-variance pairs give zero half-width (p=0 and p=1 edges)', () => {
    expect(pairMeanCiHalf(new Float64Array(50)).half).toBe(0);
    expect(pairMeanCiHalf(new Float64Array(50).fill(2)).half).toBe(0);
  });
  it('matches hand-computed pair CI', () => {
    const { p, half } = pairMeanCiHalf(Float64Array.from([2, 0, 2, 0, 2, 0]));
    expect(p).toBeCloseTo(0.5, 9);
    expect(half).toBeCloseTo(1.96 * Math.sqrt(0.3 / 6), 9);
  });
  it('n<2 returns NaN instead of crashing', () => {
    expect(Number.isNaN(pairMeanCiHalf(Float64Array.from([1])).half)).toBe(true);
  });
});