// ============================================================
// Cohort report builder (R11-parlay) — descriptive only,
// separate from all registered 1X2 reports.
// ============================================================
import type { OddsCapture, ParlayEvent } from './parlay-ledger';
import { clvSummary } from './parlay-clv';
import { maxDrawdown, reconcileSlip, slipHitRate, slipStatusFromLegs } from './parlay-settle';

export function buildParlayReport(events: ParlayEvent[]) {
  const slips = events.filter((e) => e.type === 'slip' && e.slip).map((e) => e.slip!);
  const legs = events.filter((e) => e.type === 'leg' && e.leg).map((e) => e.leg!);
  const captures = events.filter((e) => e.type === 'odds-capture' && e.capture).map((e) => e.capture!);
  const capByLeg = new Map<string, OddsCapture>();
  for (const c of captures) if (c.klass === 'closing') capByLeg.set(c.legId, c);

  const legsBySlip = new Map<string, typeof legs>();
  for (const l of legs) { const arr = legsBySlip.get(l.slipId) ?? []; arr.push(l); legsBySlip.set(l.slipId, arr); }

  const settledSlips: { status: 'settled' | 'void'; won: boolean; netPl: number; settledAt: number }[] = [];
  for (const s of slips) {
    const sl = legsBySlip.get(s.slipId) ?? [];
    const status = slipStatusFromLegs(sl.map((l) => l.status));
    if (status === 'settled' || status === 'void') {
      const rec = reconcileSlip(s, sl);
      settledSlips.push({ status, won: (rec.netPl ?? 0) > 0, netPl: rec.netPl ?? 0, settledAt: s.settledAt ?? 0 });
    }
  }
  settledSlips.sort((a, b) => a.settledAt - b.settledAt);
  const hit = slipHitRate(settledSlips);
  const dd = maxDrawdown(settledSlips.map((s) => s.netPl));
  const clv = clvSummary(legs.map((l) => ({ entryOdds: l.entryOdds, capture: capByLeg.get(l.legId) ?? null })));

  return {
    cohort: 'USER_PARLAY_2026_10_20',
    label: 'DESCRIPTIVE/EXPLORATORY - four slips, no inferential claims',
    slips: { total: slips.length, settled: settledSlips.filter((s) => s.status === 'settled').length, void: settledSlips.filter((s) => s.status === 'void').length, pending: slips.length - settledSlips.length },
    legs: {
      total: legs.length,
      won: legs.filter((l) => l.status === 'won').length, lost: legs.filter((l) => l.status === 'lost').length,
      void: legs.filter((l) => l.status === 'void').length, push: legs.filter((l) => l.status === 'push').length,
      pending: legs.filter((l) => l.status === 'pending').length,
    },
    hitRate: hit, netPl: settledSlips.reduce((a, s) => a + s.netPl, 0), drawdown: dd, clv,
    coverage: {
      legs: legs.length,
      closingCaptures: captures.filter((c) => c.klass === 'closing').length,
      nonClosingSnapshots: captures.filter((c) => c.klass === 'pre_kickoff_nonclosing').length,
      missingClosing: legs.length - captures.filter((c) => c.klass === 'closing').length,
      atlasProbsAvailable: legs.filter((l) => l.atlasProb !== null).length,
    },
  };
}