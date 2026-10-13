import { describe, expect, it } from 'vitest';
import { atlasAnalyseV9 } from './standard';
import { defaultParams } from '../learning/bayesian-learning';
import type { Match } from '../atlas-types';

const baseMatch = {
  id: '1', home: 'A', away: 'B', league: 'E0', country: 'England', gameType: 'standard',
  h: '2.0', d: '3.4', a: '3.6', userOdds: {}, kickoff: '2026-10-13T15:00:00Z',
} as Match;

describe('§D confidence freshness', () => {
  it('confidence matches final probs[pick] after learning adjustments', () => {
    const boosted = { ...defaultParams(), drawBoost: 0.03, upsetWeight: 0.02 };
    const r = atlasAnalyseV9(baseMatch, 0.10, boosted);
    expect(Math.abs(r.confidence - r.probs[r.pick])).toBeLessThan(0.001);
  });
});

describe('§A φ as EV gate', () => {
  it('thresholdPass = true exactly when bestEv >= phi', () => {
    const r = atlasAnalyseV9({ ...baseMatch, h: '1.8', d: '3.5', a: '4.2' } as Match, 0.05);
    const bestEv = Math.max(...r.portfolio.map((p) => p.ev));
    expect(r.thresholdPass).toBe(bestEv >= 0.05);
  });
  it('verdict = NO-BET when bestEv < phi', () => {
    const r = atlasAnalyseV9({ ...baseMatch, h: '1.9', d: '3.4', a: '3.8' } as Match, 0.15);
    const bestEv = Math.max(...r.portfolio.map((p) => p.ev));
    if (bestEv < 0.15) expect(r.verdict).toBe('NO-BET');
  });
});