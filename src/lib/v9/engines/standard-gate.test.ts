import { describe, expect, it } from 'vitest';
import { atlasAnalyseV9 } from './standard';
import type { Match } from '../atlas-types';

const m = (h: string, d: string, a: string) => ({
  id: 'g1', home: 'H', away: 'A', league: 'E0', country: 'England', gameType: 'standard',
  h, d, a, userOdds: {}, kickoff: '2026-10-20T15:00:00Z',
} as Match);

const maxEv = (r: ReturnType<typeof atlasAnalyseV9>) => Math.max(...r.portfolio.map((p) => p.ev));

describe('§A EV-gate boundaries (Standard selection path)', () => {
  const match = m('2.10', '3.40', '3.60');

  it('negative best EV never passes the gate, even at phi = 0', () => {
    const r = atlasAnalyseV9(m('1.05', '15.0', '25.0'), 0);
    expect(maxEv(r)).toBeLessThan(0.02);
    if (maxEv(r) < 0) expect(r.thresholdPass).toBe(false);
  });

  it('thresholdPass flips exactly at bestEv >= phi across a phi sweep', () => {
    for (const phi of [0, 0.01, 0.02, 0.05, 0.08, 0.1, 0.15, 0.25, 0.5]) {
      const r = atlasAnalyseV9(match, phi);
      expect(r.thresholdPass).toBe(maxEv(r) >= phi);
      expect(r.verdict).toBe(r.thresholdPass ? 'BET' : 'NO-BET');
    }
  });

  it('EV exactly at phi passes (>= semantics)', () => {
    const ev = maxEv(atlasAnalyseV9(match, 0.1));
    expect(atlasAnalyseV9(match, ev).thresholdPass).toBe(true);
  });

  it('phi one epsilon above best EV fails', () => {
    const ev = maxEv(atlasAnalyseV9(match, 0.1));
    expect(atlasAnalyseV9(match, ev + 1e-9).thresholdPass).toBe(false);
  });

  it('worked example: phi selects, Kelly stakes — decisions stay separate', () => {
    const phi = 0.05;
    const r = atlasAnalyseV9(match, phi);
    const odds: Record<string, number> = { home: 2.1, draw: 3.4, away: 3.6 };
    for (const row of r.portfolio) {
      const o = odds[row.outcome];
      expect(row.ev).toBeCloseTo(r.probs[row.outcome] * o - 1, 9);          // EV definition
      if (row.ev <= 0) { expect(row.kelly).toBe(0); expect(row.stake).toBe(0); } // staking gate
      else expect(row.kelly).toBeCloseTo(Math.min(row.ev / (o - 1), 0.25), 9);   // Kelly cap
    }
    expect(r.thresholdPass).toBe(maxEv(r) >= phi);                          // selection gate only
  });
});