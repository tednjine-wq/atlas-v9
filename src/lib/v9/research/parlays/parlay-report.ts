// ============================================================
// Cohort report builder (R11-parlay, v2 R12): folds correction
// and settlement events over the append-only history (base
// records are never mutated). Descriptive only, separate from
// all registered 1X2 reports.
// ============================================================
import type { LegRecord, LegStatus, OddsCapture, ParlayEvent, SlipRecord } from './parlay-ledger';
import { clvSummary } from './parlay-clv';
import { maxDrawdown, reconcileSlip, slipHitRate, slipStatusFromLegs } from './parlay-settle';

export function buildParlayReport(events: ParlayEvent[]) {
  const slipBase = new Map<string, SlipRecord>();
  const slipOrder: string[] = [];
  const legBase = new Map<string, LegRecord>();
  for (const e of events) {
    if (e.type === 'slip' && e.slip && !slipBase.has(e.slip.slipId)) { slipBase.set(e.slip.slipId, { ...e.slip }); slipOrder.push(e.slip.slipId); }
    if (e.type === 'leg' && e.leg && !legBase.has(e.leg.legId)) legBase.set(e.leg.legId, { ...e.leg });
  }
  for (const e of events) {
    if (e.type !== 'correction' || !e.correction) continue;
    const slipId = e.correction.targetEventId.replace('slip:', '');
    const legId = e.correction.targetEventId.replace('leg:', '');
    if (slipBase.has(slipId)) Object.assign(slipBase.get(slipId)!, e.correction.patch);
    if (legBase.has(legId)) Object.assign(legBase.get(legId)!, e.correction.patch);
  }
  const legStatus = new Map<string, { status: LegStatus; at: number; source: string }>();
  const slipSettle = new Map<string, { at: number; grossReturn: number | null }>();
  for (const e of events) {
    if (e.type !== 'settlement' || !e.settlement) continue;
    const s = e.settlement;
    if (s.legId) legStatus.set(s.legId, { status: s.status as LegStatus, at: e.at, source: s.source });
    if (s.slipId) slipSettle.set(s.slipId, { at: e.at, grossReturn: s.grossReturn ?? null });
  }
  const slips = slipOrder.map((id) => {
    const s = slipBase.get(id)!;
    const st = slipSettle.get(s.slipId);
    return { ...s, settledAt: st ? st.at : s.settledAt, grossReturn: st ? st.grossReturn : s.grossReturn };
  });
  const legs = [...legBase.values()].map((l) => {
    const st = legStatus.get(l.legId);
    return st ? { ...l, status: st.status, settledAt: st.at, settlementSource: st.source } : { ...l };
  });
  const captures = events.filter((e) => e.type === 'odds-capture' && e.capture).map((e) => e.capture!);
  const capByLeg = new Map<string, OddsCapture>();
  for (const c of captures) if (c.klass === 'closing') capByLeg.set(c.legId, c);

  const legsBySlip = new Map<string, typeof legs>();
  for (const l of legs) { const arr = legsBySlip.get(l.slipId) ?? []; arr.push(l); legsBySlip.set(l.slipId, arr); }

  const settledSlips: { slipId: string; placedAt: string; status: 'settled' | 'void'; won: boolean; netPl: number; settledAt: number }[] = [];
  for (const s of slips) {
    const sl = legsBySlip.get(s.slipId) ?? [];
    const status = slipStatusFromLegs(sl.map((l) => l.status));
    if (status === 'settled' || status === 'void') {
      const rec = reconcileSlip(s, sl);
      settledSlips.push({ slipId: s.slipId, placedAt: s.placedAt, status, won: (rec.netPl ?? 0) > 0, netPl: rec.netPl ?? 0, settledAt: s.settledAt ?? 0 });
    }
  }
  settledSlips.sort((a, b) => a.settledAt - b.settledAt || a.placedAt.localeCompare(b.placedAt));
  const hit = slipHitRate(settledSlips);
  const dd = maxDrawdown(settledSlips.map((s) => s.netPl));
  const clv = clvSummary(legs.map((l) => ({ entryOdds: l.entryOdds, capture: capByLeg.get(l.legId) ?? null })));
  const aliasOf = (s: SlipRecord) => (s as unknown as Record<string, unknown>).betikaBetId as string | undefined;

  return {
    cohort: 'USER_PARLAY_2026_10_20',
    label: 'DESCRIPTIVE/EXPLORATORY - five slips, no inferential claims',
    slips: {
      total: slips.length, settled: settledSlips.filter((s) => s.status === 'settled').length,
      void: settledSlips.filter((s) => s.status === 'void').length, pending: slips.length - settledSlips.length,
      detail: settledSlips.map((s) => ({ slip: s.slipId, betika: aliasOf(slipBase.get(s.slipId)!), netPl: s.netPl, won: s.won })),
    },
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