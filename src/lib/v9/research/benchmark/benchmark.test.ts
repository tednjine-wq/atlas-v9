import { describe, expect, it } from 'vitest';
import { runBenchmark, resultsToJson } from './harness';
import { atlasFrozen, dcIndependent, eloModel, marketDevig, poissonNaive } from './models';
import { rps } from './metrics';
import { syntheticHistory } from '../datasets';
import type { Outcome } from '../../atlas-types';

const T1 = Date.parse('2023-08-01T00:00:00Z');
const T2 = Date.parse('2024-07-01T00:00:00Z');
const CFG = { cutoffs: [T1, T2], label: 'synthetic-r2' };
const PROV = 'synthetic: mulberry32(7), 4 teams x 3 seasons, 10-day spacing, odds derived from generating probs';
const MODELS = () => [marketDevig(), poissonNaive(), dcIndependent(), eloModel(), atlasFrozen()];

describe('benchmark harness (research; synthetic success != real improvement)', () => {
  const data = syntheticHistory();
  const res = runBenchmark(data, MODELS(), CFG, PROV);

  it('scores every post-burn-in match exactly once per model with finite metrics', () => {
    const scoredTotal = res.windows.reduce((a, w) => a + w.scored['market-devig'].length, 0);
    expect(scoredTotal).toBe(data.length - res.burnIn);
    for (const r of res.overall) {
      expect(r.n).toBe(scoredTotal);
      expect(Number.isFinite(r.brier)).toBe(true);
      expect(Number.isFinite(r.logLoss)).toBe(true);
      expect(r.rps).toBeGreaterThanOrEqual(0);
      expect(r.rps).toBeLessThanOrEqual(1);
    }
  });

  it('RPS is 0 for perfect forecasts and 1 for maximally wrong', () => {
    const perfect = { home: 1, draw: 0, away: 0 } as Record<Outcome, number>;
    expect(rps(perfect, 'home')).toBe(0);
    expect(rps(perfect, 'away')).toBe(1);
  });

  it('sanity: market-devig beats naive Poisson on synthetic log-loss (not proof)', () => {
    const dev = res.overall.find((r) => r.model === 'market-devig')!;
    const nai = res.overall.find((r) => r.model === 'poisson-naive')!;
    expect(dev.logLoss).toBeLessThan(nai.logLoss);
  });

  it('reproducibility: identical inputs produce byte-identical JSON', () => {
    expect(resultsToJson(runBenchmark(data, MODELS(), CFG, PROV))).toBe(resultsToJson(res));
  });

  it('no look-ahead: corrupting results from D onward leaves pre-D predictions untouched', () => {
    const D = T1 + 30 * 86400000;
    const corrupt = data.map((m) => (m.date >= D ? { ...m, hg: m.ag + 1, ag: m.hg } : m));
    const res2 = runBenchmark(corrupt, MODELS(), CFG, PROV);
    for (const mo of ['market-devig', 'poisson-naive', 'dc-independent', 'elo-baseline', 'atlas-frozen-v9.10']) {
      const before = res.windows[0].scored[mo].filter((s) => s.date < D);
      const before2 = res2.windows[0].scored[mo].filter((s) => s.date < D);
      expect(before2).toEqual(before);
    }
    const eloAfter = res.windows[0].scored['elo-baseline'].filter((s) => s.date >= D);
    const eloAfter2 = res2.windows[0].scored['elo-baseline'].filter((s) => s.date >= D);
    expect(eloAfter2).not.toEqual(eloAfter); // non-vacuous for the stateful model
  });
});