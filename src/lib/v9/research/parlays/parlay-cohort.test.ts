import { describe, expect, it, beforeEach } from 'vitest';
import { appendParlayEvent, loadParlayEvents, parlayExportJson, resetParlayLedger, verifyParlayChain } from './parlay-ledger';
import { maxDrawdown, reconcileSlip, settleLeg, slipHitRate, slipStatusFromLegs, voidAdjustedCombined } from './parlay-settle';
import { clvForLeg, clvSummary } from './parlay-clv';
import { sameMatchJoint, slipJointProb, standardProb1x2, standardProbSelection } from './parlay-joint';
import { seedParlayCohort } from './parlay-cohort-seed';
import { buildParlayReport } from './parlay-report';
import { loadEvents as loadPrimaryEvents } from '../../evidence/prospective-ledger';
import { loadMarketEvents } from '../markets/market-ledger';

const cap = (klass: 'closing' | 'pre_kickoff_nonclosing', odds: number, justification?: string) =>
  ({ legId: 'x', odds, source: 'test', capturedAt: 1, capturedAtEat: 't', minutesToKickoff: 10, klass, justification } as const);

describe('parlay cohort isolation and integrity (R11-parlay)', () => {
  beforeEach(() => resetParlayLedger());

  it('seeding the parlay cohort never touches primary 1X2 or market ledgers', () => {
    const beforePrimary = loadPrimaryEvents().length;
    const beforeMarket = loadMarketEvents().length;
    seedParlayCohort();
    expect(loadPrimaryEvents().length).toBe(beforePrimary);
    expect(loadMarketEvents().length).toBe(beforeMarket);
    const ev = loadParlayEvents();
    expect(ev.filter((e) => e.type === 'slip')).toHaveLength(4);
    expect(ev.filter((e) => e.type === 'leg')).toHaveLength(19);
    expect(verifyParlayChain(ev)).toBe(true);
  });

  it('Standard configuration: rho=-0.13 partition, never the Jackpot -0.08 partition', () => {
    const std = standardProb1x2(2.0, 3.4, 3.6)!;
    const jp = standardProb1x2(2.0, 3.4, 3.6, -0.08)!;
    expect(std.home + std.draw + std.away).toBeCloseTo(1, 9);
    expect(Math.abs(std.draw - jp.draw)).toBeGreaterThan(1e-6); // configs differ; Standard path used elsewhere
    expect(standardProb1x2(1, 3, 3)).toBeNull();
  });

  it('cross-match joint equals the product of leg probabilities (independence preserved)', () => {
    const a = { matchKey: 'm1', h: 2.0, d: 3.4, a: 3.6, market: '1x2' as const, selection: 'home' };
    const b = { matchKey: 'm2', h: 1.6, d: 3.8, a: 5.0, market: '1x2' as const, selection: 'away' };
    const joint = slipJointProb([a, b])!;
    expect(joint).toBeCloseTo(standardProbSelection(a)! * standardProbSelection(b)!, 12);
  });

  it('same-match selections use exact enumeration, not independence', () => {
    const sels = [{ market: '1x2' as const, selection: 'home' }, { market: 'ou25' as const, selection: 'over' }];
    const joint = sameMatchJoint(2.0, 3.4, 3.6, sels)!;
    const pH = standardProbSelection({ matchKey: 'm', h: 2.0, d: 3.4, a: 3.6, market: '1x2', selection: 'home' })!;
    const pO = standardProbSelection({ matchKey: 'm', h: 2.0, d: 3.4, a: 3.6, market: 'ou25', selection: 'over' })!;
    expect(joint).toBeLessThanOrEqual(Math.min(pH, pO));
    expect(Math.abs(joint - pH * pO)).toBeGreaterThan(1e-6); // correlated within match
  });

  it('missing or non-closing odds never produce fabricated CLV', () => {
    expect(clvForLeg(1.8, null)).toBeNull();
    expect(clvForLeg(1.8, cap('pre_kickoff_nonclosing', 1.7))).toBeNull();
    const s = clvSummary([{ entryOdds: 1.8, capture: null }, { entryOdds: 2.0, capture: cap('pre_kickoff_nonclosing', 1.9) }]);
    expect(s.eligible).toBe(0); expect(s.mean).toBeNull();
  });

  it('a snapshot cannot be labelled closing without justification (reject event)', () => {
    const out = appendParlayEvent({ type: 'odds-capture', at: 1, eventId: 'c1', capture: { legId: 'l', odds: 1.9, source: 'app-snapshot', capturedAt: 1, capturedAtEat: 't', minutesToKickoff: 300, klass: 'closing' } });
    expect(out.type).toBe('reject');
    expect(out.reason).toContain('closing');
  });

  it('settlement cases: won, lost, void, push, pending', () => {
    expect(settleLeg('1x2', 'home', 2, 1)).toBe('won');
    expect(settleLeg('1x2', 'draw', 2, 1)).toBe('lost');
    expect(settleLeg('ou25', 'over', 2, 1)).toBe('won');
    expect(settleLeg('ou25', 'under', 3, 0)).toBe('lost');
    expect(slipStatusFromLegs(['won', 'void'])).toBe('settled');
    expect(slipStatusFromLegs(['won', 'pending'])).toBe('pending');
    expect(slipStatusFromLegs(['void', 'push'])).toBe('void');
    expect(voidAdjustedCombined([{ entryOdds: 1.5, status: 'void' }, { entryOdds: 2.0, status: 'won' }])).toBe(2.0);
  });

  it('payout reconciliation: loss = -stake; win uses verified payout; pending = null', () => {
    const slip = { slipId: 's', cohortId: 'c', stake: 100, currency: 'KES' as const, potentialPayout: 300, payoutVerified: true, placedAt: 't', combinedOdds: 3.0, status: 'open' as const, settledAt: null, grossReturn: null, netPl: null, legIds: ['a'] };
    expect(reconcileSlip(slip, [{ entryOdds: 3.0, status: 'lost' }])).toEqual({ grossReturn: 0, netPl: -100, basis: 'losing-slip' });
    expect(reconcileSlip(slip, [{ entryOdds: 3.0, status: 'won' }])).toEqual({ grossReturn: 300, netPl: 200, basis: 'actual-payout-terms' });
    expect(reconcileSlip(slip, [{ entryOdds: 3.0, status: 'pending' }]).netPl).toBeNull();
    const unv = { ...slip, payoutVerified: false };
    expect(reconcileSlip(unv, [{ entryOdds: 3.0, status: 'won' }]).basis).toContain('fallback');
  });

  it('hit-rate denominator excludes voids; drawdown convention documented', () => {
    const hit = slipHitRate([{ status: 'settled', won: true }, { status: 'settled', won: false }, { status: 'void', won: false }]);
    expect(hit).toEqual({ won: 1, settled: 2, rate: 0.5, voids: 1 });
    const dd = maxDrawdown([-110, 154.9, -10]);
    expect(dd.value).toBeCloseTo(110, 9);
    expect(dd.convention).toContain('zero-baseline');
    expect(dd.n).toBe(3);
  });

  it('duplicate events no-op; corrections append without overwriting', () => {
    seedParlayCohort();
    const n = loadParlayEvents().length;
    appendParlayEvent({ type: 'leg', at: 1, eventId: 'leg:KOL8UA-L1', leg: { legId: 'dup', slipId: 'KOL8UA', fixtureId: 'x', teams: 'x', competition: 'x', kickoff: 'x', tz: 'EAT', market: '1x2', selection: 'home', entryOdds: 2, entrySource: 'x', entryAt: 1, atlasProb: null, atlasProbVersion: null, status: 'pending', settledAt: null, settlementSource: null } });
    expect(loadParlayEvents().length).toBe(n);
    appendParlayEvent({ type: 'correction', at: 2, eventId: 'corr:1', correction: { targetEventId: 'slip:KSK4AA', patch: { potentialPayout: 434.5 }, note: 'screenshot re-read' } });
    const ev = loadParlayEvents();
    expect(ev.some((e) => e.type === 'correction')).toBe(true);
    expect(ev.find((e) => e.eventId === 'slip:KSK4AA')!.slip!.potentialPayout).toBe(358.5); // original preserved
  });

  it('seeded cohort report: all pending, zero closing captures, no fabricated CLV or probs', () => {
    seedParlayCohort();
    const r = buildParlayReport(loadParlayEvents());
    expect(r.slips.pending).toBe(4);
    expect(r.legs.pending).toBe(19);
    expect(r.coverage.closingCaptures).toBe(0);
    expect(r.coverage.missingClosing).toBe(19);
    expect(r.coverage.atlasProbsAvailable).toBe(0);
    expect(r.clv.mean).toBeNull();
    expect(r.hitRate.rate).toBeNull();
    expect(parlayExportJson(loadParlayEvents()).length).toBeGreaterThan(0);
  });

  it('deterministic: re-seeding reproduces byte-identical export', () => {
    seedParlayCohort();
    const j1 = parlayExportJson(loadParlayEvents());
    resetParlayLedger();
    seedParlayCohort();
    expect(parlayExportJson(loadParlayEvents())).toBe(j1);
  });
});