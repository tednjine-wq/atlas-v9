import { describe, expect, it } from 'vitest';
import { 
  splitChronologically, 
  evaluateMarketBaseline, 
  evaluateIndependentModel, 
  evaluateHybridModel 
} from './backtester';
import type { PredictionRecord } from '../learning/bayesian-learning';

const mockRecords: PredictionRecord[] = Array.from({ length: 100 }, (_, i) => ({
  id: String(i),
  home: 'A', away: 'B', league: 'E0',
  h: 2.0, d: 3.4, a: 3.6,
  probs: { home: 0.5, draw: 0.25, away: 0.25 },
  pick: 'home',
  result: i % 3 === 0 ? 'home' : i % 3 === 1 ? 'draw' : 'away',
  timestamp: Date.now() + i * 1000,
} as unknown as PredictionRecord));

describe('§F Chronological Splitting', () => {
  it('splits records into train/val/test without overlap', () => {
    const split = splitChronologically(mockRecords, 0.6, 0.2);
    expect(split.train.length).toBe(60);
    expect(split.val.length).toBe(20);
    expect(split.test.length).toBe(20);
    expect(split.train[59].id).toBe('59');
    expect(split.val[0].id).toBe('60');
    expect(split.test[0].id).toBe('80');
  });
});

describe('§G 3-Way Model Comparison', () => {
  it('evaluates market baseline using stripped odds', () => {
    const m = evaluateMarketBaseline(mockRecords);
    expect(m.n).toBe(100);
    expect(m.brier).toBeGreaterThan(0);
  });
  
  it('evaluates independent model using fixed lambda', () => {
    const m = evaluateIndependentModel(mockRecords);
    expect(m.n).toBe(100);
    expect(m.brier).toBeGreaterThan(0);
  });
  
  it('evaluates hybrid model using stored probs', () => {
    const m = evaluateHybridModel(mockRecords);
    expect(m.n).toBe(100);
    expect(m.accuracy).toBeCloseTo(0.34, 1); // ~1/3 hit rate for mock data
  });
});