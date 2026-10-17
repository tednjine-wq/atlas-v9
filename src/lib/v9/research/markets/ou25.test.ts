import { describe, expect, it } from 'vitest';
import { atlasOver25, overFromRaw, settleOu, tailAudit, underFromRaw } from './ou-extract';
import { buildScoreMatrix } from '../../math/dixon-coles';
import { runOu25 } from './ou25-runner';
import { loadMarketEvents, verifyMarketChain, marketExportJson } from './market-ledger';
import type { OuMatch } from './ou-data';

const mk = (id: string, date: number, hg: number, ag: number, oo: number | null, ou: number | null): OuMatch =>
  ({ id, date, league: 'E0', home: 'H', away: 'A', hg, ag, h: 2.0, d: 3.4, a: 3.6, ouOpenOver: oo, ouOpenUnder: ou, ouCloseOver: null, ouCloseUnder: null, ouMissing: !(oo && ou) } as OuMatch);

describe('OU 2.5 extraction validity (R10-mkt)', () => {
  it('over + under = 1 and over equals direct complement enumeration', () => {
    const sm = buildScoreMatrix(1.8, 1.4, -0.13);
    const over = overFromRaw(sm.raw, sm.sum, 2.5);
    const under = underFromRaw(sm.raw, sm.sum, 2.5);
    expect(over + under).toBeCloseTo(1, 9);
    expect(over).toBeCloseTo(1 - under, 9);
    expect(over).toBeGreaterThan(0); expect(over).toBeLessThan(1);
  });

  it('thresholds are monotone: over1.5 > over2.5 > over3.5', () => {
    const sm = buildScoreMatrix(1.8, 1.4, -0.13);
    const o15 = overFromRaw(sm.raw, sm.sum, 1.5);
    const o25 = overFromRaw(sm.raw, sm.sum, 2.5);
    const o35 = overFromRaw(sm.raw, sm.sum, 3.5);
    expect(o15).toBeGreaterThan(o25);
    expect(o25).toBeGreaterThan(o35);
  });

  it('tail-mass audit retains >= 99.9% of probability over the lambda grid', () => {
    const { minSum } = tailAudit();
    expect(minSum).toBeGreaterThanOrEqual(0.999);
  });

  it('settlement is deterministic and correct', () => {
    expect(settleOu(3, 0)).toBe('over');
    expect(settleOu(2, 1)).toBe('over');
    expect(settleOu(1, 1)).toBe('under');
    expect(settleOu(2, 0)).toBe('under');
    expect(settleOu(0, 3)).toBe('over');
  });

  it('missing OU odds are excluded and counted, never imputed', () => {
    const data = [mk('a', 1000, 2, 1, 1.9, 1.9), mk('b', 2000, 1, 1, null, null)];
    const res = runOu25(data, [500]);
    expect(res.recon.missingOuOdds).toBe(1);
    expect(res.n).toBe(1);
    expect(res.rows.every((r) => r.marketOver > 0 && r.marketOver < 1)).toBe(true);
  });

  it('leakage: corrupting results changes outcomes/P&L but never the probabilities', () => {
    const data = [mk('a', 1000, 2, 1, 1.9, 1.9), mk('b', 2000, 0, 0, 2.1, 1.75), mk('c', 3000, 3, 2, 1.8, 2.0)];
    const clean = runOu25(data, [500]);
    const corrupt = runOu25(data.map((m) => ({ ...m, hg: m.ag + 1, ag: m.hg })), [500]);
    expect(corrupt.rows.map((r) => r.atlasOver)).toEqual(clean.rows.map((r) => r.atlasOver));
    expect(corrupt.rows.map((r) => r.marketOver)).toEqual(clean.rows.map((r) => r.marketOver));
    expect(corrupt.rows.map((r) => r.outcome)).not.toEqual(clean.rows.map((r) => r.outcome));
  });

  it('reproducible: identical inputs give byte-identical exports and a valid chain', () => {
    const data = [mk('a', 1000, 2, 1, 1.9, 1.9), mk('b', 2000, 0, 0, 2.1, 1.75)];
    runOu25(data, [500]);
    const j1 = marketExportJson(loadMarketEvents());
    runOu25(data, [500]);
    expect(marketExportJson(loadMarketEvents())).toBe(j1);
    expect(verifyMarketChain(loadMarketEvents())).toBe(true);
    expect(atlasOver25(NaN, 3, 3)).toBeNull();
  });
});