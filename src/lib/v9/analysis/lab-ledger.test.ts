import { describe, expect, it } from 'vitest';
import { bandOf, guardedStakeFromEv, reconcileLedger } from './lab-ledger';
import type { LedgerRow } from './lab-ledger';

const row = (over: Partial<LedgerRow>): LedgerRow => ({
  file: 'E0.csv', line: 2, fixture: '2024-08-01|A|B|E0', div: 'E0', date: '2024-08-01',
  home: 'A', away: 'B', odds: { h: 2.0, d: 3.4, a: 3.6 },
  probs: { home: 0.5, draw: 0.25, away: 0.25 }, pick: 'home', pickOdds: 2.0, pickEv: 0.0,
  pickHit: true, pickPL: 1.0,
  flagKey: null, flagOdds: null, flagEv: null, band: null, guardStake: 0,
  flagHit: null, flagRawPL: 0, flagGuardedPL: 0, runAt: '2026-10-14T00:00:00Z',
  ...over,
});

describe('guard decisions use prediction-time info only', () => {
  it('stake from (ev, odds) alone', () => {
    expect(guardedStakeFromEv(0.02, 2.0)).toBe(1);
    expect(guardedStakeFromEv(0.02, 1.4)).toBe(0.5);
    expect(guardedStakeFromEv(0.08, 2.0)).toBe(0);
    expect(guardedStakeFromEv(-0.01, 2.0)).toBe(0);
  });
  it('bands match the production EV cuts', () => {
    expect(bandOf(0.01)).toBe('lo');
    expect(bandOf(0.04)).toBe('mid');
    expect(bandOf(0.09)).toBe('hi');
  });
});

describe('ledger reconciliation', () => {
  it('sums raw and guarded P/L exactly', () => {
    const rows = [
      row({ flagKey: 'over25', flagOdds: 1.9, flagEv: 0.02, band: 'lo', guardStake: 1, flagHit: true, flagRawPL: 0.9, flagGuardedPL: 0.9 }),
      row({ flagKey: 'bttsYes', flagOdds: 1.4, flagEv: 0.04, band: 'mid', guardStake: 0.5, flagHit: false, flagRawPL: -1, flagGuardedPL: -0.5 }),
      row({ flagKey: 'over15', flagOdds: 2.2, flagEv: 0.08, band: 'hi', guardStake: 0, flagHit: true, flagRawPL: 1.2, flagGuardedPL: 0 }),
    ];
    const t = reconcileLedger(rows);
    expect(t.flags).toBe(3);
    expect(t.flagRawPL).toBeCloseTo(1.1, 9);
    expect(t.flagGuardedPL).toBeCloseTo(0.4, 9);
    expect(t.bands.hi.guardedPL).toBe(0);
    expect(t.zeroGuard).toBe(1);
    expect(t.pickPL).toBeCloseTo(3.0, 9);
  });
});