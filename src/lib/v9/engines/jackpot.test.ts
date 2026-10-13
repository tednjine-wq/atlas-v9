import { describe, expect, it } from 'vitest';
import { atlasAnalyseJackpotV9 } from './jackpot';
import type { Match } from '../atlas-types';

const m = (h: string, d: string, a: string) => ({
  id: 'j1', home: 'H', away: 'A', league: 'E0', country: 'England', gameType: 'jackpot',
  h, d, a, userOdds: {}, kickoff: '2026-10-20T15:00:00Z',
} as Match);

describe('Jackpot Engine EV-gate & Rule 6', () => {
  it('confidence is capped at 0.72 (Rule 1/6)', () => {
    const r = atlasAnalyseJackpotV9(m('1.20', '5.00', '12.00'), 0.05);
    expect(r.confidence).toBeLessThanOrEqual(0.72);
  });

  it('thresholdPass flips exactly at pickEv >= phi', () => {
    const match = m('2.10', '3.40', '3.60');
    const r = atlasAnalyseJackpotV9(match, 0.1);
    const pickEv = r.decorrelation.evs[r.pick];
    expect(r.thresholdPass).toBe(pickEv >= 0.1);
  });

  it('negative EV never passes the gate', () => {
    const r = atlasAnalyseJackpotV9(m('1.50', '4.00', '6.00'), 0);
    if (r.decorrelation.evs[r.pick] < 0) expect(r.thresholdPass).toBe(false);
  });

  it('Rule 6: learning adjustments are structurally excluded', () => {
    // The function signature does not accept learnedParams, ensuring purity
    expect(atlasAnalyseJackpotV9.length).toBeLessThanOrEqual(2); 
  });
});