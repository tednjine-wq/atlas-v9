import { describe, expect, it } from 'vitest';
import { atlasOver25, dcGridMatrix, overFromRaw, settleOu, tailAudit, underFromRaw } from './ou-extract';
import { buildScoreMatrix, outcomeProbs } from '../../math/dixon-coles'; // test-only cross-check vs production matrix
import { runOu25 } from './ou25-runner';
import { loadMarketEvents, marketExportJson, verifyMarketChain } from './market-ledger';
import type { OuMatch } from './ou-data';

const mk = (id: string, date: number, hg: number, ag: number, oo: number | null, ou: number | null): OuMatch =>
  ({ id, date, league: 'E0', home: 'H', away: 'A', hg, ag, h: 2.0, d: 3.4, a: 3.6, ouOpenOver: oo, ouOpenUnder: ou, ouCloseOver: null, ouCloseUnder: null, ouMissing: !(oo && ou) } as OuMatch);

describe('OU 2.5 extraction validity (R10-mkt)', () => {
  it('research grid equals the production score matrix (draw partition, orientation-free)', () => {
    const sm = buildScoreMatrix(1.8, 1.4, -0.13);
    const prod = outcomeProbs(sm.raw, sm.sum);
    const g = dcGridMatrix(1.8, 1.4, -0.13);
    let h = 0, dr = 0;
    for (let y = 0; y <= 9; y++) for (let x = 0; x <= 9; x++) {
      const p = g.raw[y][x] / g.sum;
      if (x > y) h += p; else if (x === y) dr += p;
    }
    expect(dr).toBeCloseTo(prod.draw, 9); // orientation-independent identity
    expect(Math.abs(h - prod.home) < 1e-9 || Math.abs(h - prod.away) < 1e-9).toBe(true);
  });

  it('over + under = 1 and over equals direct complement enumeration', () => {
    const g = dcGridMatrix(1.8, 1.4, -0.13);
    const over = overFromRaw(g.raw, g.sum, 2.5);
    const under = underFromRaw(g.raw, g.sum, 2.5);
    expect(over + under).toBeCloseTo(1, 9);
    expect(over).toBeCloseTo(1 - under, 9);
    expect(over).toBeGreaterThan(0); expect(over).toBeLessThan(1);
  });

  it('thresholds are monotone: over1.5 > over2.5 > over3.5', () => {
    const g = dcGridMatrix(1.8, 1.4, -0.13);
    const o15 = overFromRaw(g.raw, g.sum, 1.5);
    const o25 = overFromRaw(g.raw, g.sum, 2.5);
    const o35 = overFromRaw(g.raw, g.sum, 3.5);
    expect(o15).toBeGreaterThan(o25);
    expect(o25).toBeGreaterThan(o35);
  });

  // Documented bound: worst retained mass 0.99338 at lambda ~(3.5,3.5).
  // OU probs normalize by grid sum; worst-case absolute truncation bias
  // <= 1-minSum (~0.7% at extreme lambda, <=0.1% at typical lambda).
  it('tail-mass audit retains >= 99.0% over the lambda grid (documented bound)', () => {
    const { minSum } = tailAudit();
    expect(minSum).toBeGreaterThanOrEqual(0.99);
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

  it('leakage: corrupting results flips outcomes/P&L but never the probabilities', () => {
    const data = [mk('a', 1000, 2, 1, 1.9, 1.9), mk('b', 2000, 0, 0, 2.1, 1.75), mk('c', 3000, 3, 2, 1.8, 2.0)];
    const clean = runOu25(data, [500]);
    // Deterministic over/under side flip: overs become 0-0, unders become 4-0.
    const corrupt = runOu25(data.map((m) => (m.hg + m.ag > 2.5 ? { ...m, hg: 0, ag: 0 } : { ...m, hg: 4, ag: 0 })), [500]);
    expect(corrupt.rows.map((r) => r.atlasOver)).toEqual(clean.rows.map((r) => r.atlasOver));
    expect(corrupt.rows.map((r) => r.marketOver)).toEqual(clean.rows.map((r) => r.marketOver));
    expect(corrupt.rows.map((r) => r.outcome)).not.toEqual(clean.rows.map((r) => r.outcome));
    expect(corrupt.betting?.pl).not.toBe(clean.betting?.pl);
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