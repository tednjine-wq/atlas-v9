import { describe, expect, it } from 'vitest';
import {
  splitChronologically,
  evaluateMarketBaseline,
  evaluateIndependentModel,
  evaluateHybridModel,
} from './backtester';
import type { PredictionRecord } from '../learning/bayesian-learning';

const mk = (n: number, withOdds: boolean): PredictionRecord[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i), home: 'A', away: 'B', league: 'E0',
    probs: { home: 0.5, draw: 0.25, away: 0.25 }, pick: 'home',
    result: i % 3 === 0 ? 'home' : i % 3 === 1 ? 'draw' : 'away',
    timestamp: 1000 + i,
    ...(withOdds ? { entryOdds: { home: 2.0, draw: 3.4, away: 3.6 } } : {}),
  })) as unknown as PredictionRecord[];

describe('§F chronological splitting', () => {
  it('splits records into train/val/test without overlap', () => {
    const s = splitChronologically(mk(100, false), 0.6, 0.2);
    expect(s.train.length).toBe(60);
    expect(s.val.length).toBe(20);
    expect(s.test.length).toBe(20);
    expect(s.val[0].id).toBe('60');
    expect(s.test[0].id).toBe('80');
  });
});

describe('§G three-way comparison', () => {
  it('market baseline reads entryOdds (v9.1 schema) and computes ROI', () => {
    const m = evaluateMarketBaseline(mk(40, true));
    expect(m.n).toBe(40);
    expect(m.nBets).toBe(40);
    expect(Number.isFinite(m.roi)).toBe(true);
    expect(Number.isFinite(m.pl)).toBe(true);
  });
  it('market baseline returns n/a metrics when no odds exist', () => {
    const m = evaluateMarketBaseline(mk(40, false));
    expect(m.n).toBe(0);
    expect(m.nBets).toBe(0);
  });
  it('independent model evaluates without market input', () => {
    const m = evaluateIndependentModel(mk(40, false));
    expect(m.n).toBe(40);
    expect(m.brier).toBeGreaterThan(0);
  });
  it('hybrid model uses stored probs', () => {
    const m = evaluateHybridModel(mk(40, true));
    expect(m.n).toBe(40);
    expect(m.accuracy).toBeCloseTo(1 / 3, 1);
  });
});