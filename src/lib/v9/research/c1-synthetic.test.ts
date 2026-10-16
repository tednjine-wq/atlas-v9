import { describe, expect, it } from 'vitest';
import { C1_DEFAULTS, applyC1Mult, c1Evaluate, c1InitialState, finalMultFor } from './c1-recalibration';
import type { C1Obs } from './c1-recalibration';
import { mulberry32 } from '../math/poisson';
import type { Outcome } from '../atlas-types';

const P = (h: number, d: number, a: number): Record<Outcome, number> => ({ home: h, draw: d, away: a });
const stream = (n: number, pi: Record<Outcome, number>, p: Record<Outcome, number>, t0 = 1000): C1Obs[] => {
  const rng = mulberry32(11);
  const out: C1Obs[] = [];
  for (let i = 0; i < n; i++) {
    const u = rng();
    const outcome: Outcome = u < pi.home ? 'home' : u < pi.home + pi.draw ? 'draw' : 'away';
    out.push({ id: `o${i}`, outcome, probs: p, resolvedAt: t0 + i });
  }
  return out;
};
const eval1 = (obs: C1Obs[], cutoff = 1e12) => c1Evaluate(c1InitialState(), obs, cutoff, C1_DEFAULTS, cutoff);

describe('C1 synthetic suite (research acceptance, NOT proof of real improvement)', () => {
  it('S1 converges toward the calibration-correction ratio pi/mean(p)', () => {
    const pi = P(0.40, 0.30, 0.30), p = P(0.36, 0.30, 0.34);
    const { entry } = eval1(stream(20000, pi, p));
    const r = { home: pi.home / p.home, draw: pi.draw / p.draw, away: pi.away / p.away };
    for (const k of ['home', 'draw', 'away'] as Outcome[]) {
      expect(Math.abs(entry.shrunkMult[k] - r[k])).toBeLessThan(0.01);
      expect(entry.clippedMult[k]).toBe(entry.shrunkMult[k]); // inside bounds
    }
    expect(entry.applied).toBe(true);
  });

  it('S2 shrinkage factor at n=10 equals 1/6 exactly', () => {
    const p = P(0.5, 0.25, 0.25);
    const obs: C1Obs[] = [];
    for (let i = 0; i < 10; i++)
      obs.push({ id: `s${i}`, outcome: (i < 4 ? 'home' : i < 7 ? 'draw' : 'away') as Outcome, probs: p, resolvedAt: 100 + i });
    const { entry } = eval1(obs);
    const fHome = (4 + 25 / 3) / 35;
    const mstar = fHome / 0.5;
    expect(entry.shrunkMult.home).toBeCloseTo(1 + (10 / 60) * (mstar - 1), 12);
    expect(entry.applied).toBe(false); // below floor: formula logged, not applied
  });

  it('S3 adversarial all-draw stream clips to bounds and renormalizes valid probs', () => {
    const obs = stream(200, P(0, 1, 0), P(1 / 3, 1 / 3, 1 / 3));
    const { entry } = eval1(obs);
    expect(entry.clippedMult.draw).toBe(1.15);
    expect(entry.clippedMult.home).toBe(0.9);
    const { probs, z } = applyC1Mult(P(1 / 3, 1 / 3, 1 / 3), entry.clippedMult);
    expect(z).toBeGreaterThan(0);
    expect(probs.home + probs.draw + probs.away).toBeCloseTo(1, 9);
    for (const k of ['home', 'draw', 'away'] as Outcome[]) expect(probs[k]).toBeGreaterThanOrEqual(0);
  });

  it('S4 no update below the n=30 floor, evaluation still logged', () => {
    const { state, entry } = eval1(stream(29, P(0.4, 0.3, 0.3), P(1 / 3, 1 / 3, 1 / 3)));
    expect(entry.applied).toBe(false);
    expect(entry.reason).toContain('floor');
    expect(state.mult).toEqual({ home: 1, draw: 1, away: 1 });
    expect(state.log.length).toBe(1);
  });

  it('S5 chronology: post-cutoff and late observations are ineligible', () => {
    const p = P(1 / 3, 1 / 3, 1 / 3);
    const obs: C1Obs[] = [];
    for (let i = 0; i < 20; i++) obs.push({ id: `a${i}`, outcome: 'home', probs: p, resolvedAt: 1000 + i });
    for (let i = 0; i < 20; i++) obs.push({ id: `b${i}`, outcome: 'draw', probs: p, resolvedAt: 5000 + i });
    for (let i = 0; i < 5; i++) obs.push({ id: `c${i}`, outcome: 'away', probs: p, resolvedAt: 1000 + i, late: true });
    const { entry } = eval1(obs, 2000);
    expect(entry.n).toBe(20);
    expect(entry.counts.home).toBe(20);
  });

  it('S6 multiclass validity after extreme multipliers', () => {
    const { probs } = applyC1Mult(P(0.7, 0.2, 0.1), { home: 1.15, draw: 0.9, away: 0.9 });
    expect(probs.home + probs.draw + probs.away).toBeCloseTo(1, 9);
    for (const k of ['home', 'draw', 'away'] as Outcome[]) {
      expect(probs[k]).toBeGreaterThanOrEqual(0);
      expect(probs[k]).toBeLessThanOrEqual(1);
    }
  });

  it('S7a small league sample shrinks heavily toward the global centre', () => {
    const obs = stream(5, P(0, 1, 0), P(1 / 3, 1 / 3, 1 / 3)).map((o, i) => ({ ...o, league: 'L1', id: `l${i}` }));
    const { state } = eval1(obs);
    const lg = state.log.find((e) => e.scope === 'L1');
    expect(lg).toBeDefined();
    expect(lg!.applied).toBe(false); // below floor
    expect(lg!.shrunkMult.draw).toBeLessThan(1.2); // heavy shrink vs raw ~2.7
    expect(state.leagueMult.L1).toEqual(state.mult); // not applied
  });

  it('S7b large league sample applies with capped effective n', () => {
    const obs = stream(600, P(0.34, 0.33, 0.33), P(1 / 3, 1 / 3, 1 / 3)).map((o, i) => ({ ...o, league: 'L2', id: `g${i}` }));
    const { state } = eval1(obs);
    expect(state.leagueMult.L2).toBeDefined();
    const applied = state.log.find((e) => e.scope === 'L2' && e.applied);
    expect(applied).toBeDefined();
  });

  it('S8 league multipliers replace global via finalMultFor', () => {
    const obs = stream(600, P(0.34, 0.33, 0.33), P(1 / 3, 1 / 3, 1 / 3)).map((o, i) => ({ ...o, league: 'L3', id: `h${i}` }));
    const { state } = eval1(obs);
    expect(finalMultFor(state, 'L3')).toEqual(state.leagueMult.L3);
    expect(finalMultFor(state, 'NOPE')).toEqual(state.mult);
  });

  it('edge: zero mean-predicted denominator logs reason and skips that outcome', () => {
    const obs: C1Obs[] = [];
    for (let i = 0; i < 40; i++) obs.push({ id: `z${i}`, outcome: 'home', probs: P(0.5, 0, 0.5), resolvedAt: 100 + i });
    const { entry } = eval1(obs);
    expect(entry.applied).toBe(false);
    expect(entry.reason).toContain('denominator');
    expect(entry.shrunkMult.draw).toBe(1);
  });

  it('edge: invalid probs, duplicates and non-finite timestamps are counted and dropped', () => {
    const p = P(1 / 3, 1 / 3, 1 / 3);
    const obs: C1Obs[] = [
      { id: 'd1', outcome: 'home', probs: p, resolvedAt: 1 },
      { id: 'd1', outcome: 'draw', probs: p, resolvedAt: 2 },
      { id: 'bad1', outcome: 'home', probs: P(-0.2, 0.6, 0.6), resolvedAt: 3 },
      { id: 'bad2', outcome: 'home', probs: p, resolvedAt: NaN },
      { id: 'ok2', outcome: 'away', probs: p, resolvedAt: 4 },
    ];
    const { entry } = eval1(obs);
    expect(entry.n).toBe(2);
    expect(entry.duplicatesDropped).toBe(1);
    expect(entry.invalidDropped).toBe(2);
  });
});