import { describe, expect, it } from 'vitest';
import { appendParlayEvent, loadParlayEvents, resetParlayLedger, verifyParlayChain } from './parlay-ledger';
import { seedParlayCohort } from './parlay-cohort-seed';
import { buildParlayReport } from './parlay-report';

const BATCH = Date.parse('2026-10-21T12:00:00+03:00'); // documented batch proxy; bookmaker settle times not captured
const SRC = 'betika-slip-screenshot-2026-10-21';

const LEG_SETTLE: Array<[string, 'won' | 'lost', string]> = [
  ['KOL8UA-L1', 'won', '0:1'], ['KOL8UA-L2', 'won', '2:0'], ['KOL8UA-L3', 'won', '0:1'],
  ['KH0BBA-L1', 'lost', '2:6'], ['KH0BBA-L2', 'won', '2:1'], ['KH0BBA-L3', 'won', '4:1'],
  ['KSK4AA-L1', 'lost', '1:3'], ['KSK4AA-L2', 'lost', '1:1'], ['KSK4AA-L3', 'lost', '1:1'],
  ['KN1EJA-L1', 'won', '1:0'], ['KN1EJA-L2', 'won', '2:1'], ['KN1EJA-L3', 'won', '4:1'],
  ['KN1EJA-L4', 'won', '0:1'], ['KN1EJA-L5', 'won', '2:0'], ['KN1EJA-L6', 'won', '0:1'],
  ['KN1EJA-L7', 'won', '1:0'], ['KN1EJA-L8', 'lost', '1:3'], ['KN1EJA-L9', 'lost', '1:1'], ['KN1EJA-L10', 'lost', '1:1'],
  ['K5N6WB-L1', 'lost', '2:6'], ['K5N6WB-L2', 'won', '2:1'], ['K5N6WB-L3', 'won', '4:1'],
];

function applyCorrectionsAndNewSlip(): void {
  appendParlayEvent({ type: 'correction', at: BATCH, eventId: 'corr:alias-KOL8UA', correction: { targetEventId: 'slip:KOL8UA', patch: { betikaBetId: 'KQLBUA', stake: 10, potentialPayout: 24.8, payoutVerified: true, combinedOdds: 2.48, placedAt: '2026-10-19T11:05:00+03:00' }, note: '21 Oct screenshot re-read: stake 10, payout 24.8, Betika id KQLBUA' } });
  appendParlayEvent({ type: 'correction', at: BATCH, eventId: 'corr:alias-KH0BBA', correction: { targetEventId: 'slip:KH0BBA', patch: { betikaBetId: 'KHG65A', stake: 10, potentialPayout: 100.9, payoutVerified: true, placedAt: '2026-10-19T11:03:00+03:00' }, note: '21 Oct screenshot re-read: stake 10, Betika id KHG65A' } });
  appendParlayEvent({ type: 'correction', at: BATCH, eventId: 'corr:alias-KSK4AA', correction: { targetEventId: 'slip:KSK4AA', patch: { betikaBetId: 'K8K4AA', stake: 10, potentialPayout: 39.5, payoutVerified: true, combinedOdds: 3.95, placedAt: '2026-10-19T11:07:00+03:00' }, note: '21 Oct screenshot re-read: stake 10, payout 39.5, Betika id K8K4AA' } });
  appendParlayEvent({ type: 'correction', at: BATCH, eventId: 'corr:leg-KOL8UA-L2', correction: { targetEventId: 'leg:KOL8UA-L2', patch: { entryOdds: 1.2 }, note: 'slip screen shows Dewa entry 1.20' } });
  appendParlayEvent({ type: 'correction', at: BATCH, eventId: 'corr:leg-KN1EJA-L5', correction: { targetEventId: 'leg:KN1EJA-L5', patch: { entryOdds: 1.2 }, note: 'slip screen shows Dewa entry 1.20' } });
  appendParlayEvent({
    type: 'slip', at: Date.parse('2026-10-20T15:32:00+03:00'), eventId: 'slip:K5N6WB',
    slip: { slipId: 'K5N6WB', cohortId: 'USER_PARLAY_2026_10_20', stake: 10, currency: 'KES', potentialPayout: 85.7, payoutVerified: true, placedAt: '2026-10-20T15:32:00+03:00', combinedOdds: 8.57, status: 'open', settledAt: null, grossReturn: null, netPl: null, legIds: ['K5N6WB-L1', 'K5N6WB-L2', 'K5N6WB-L3'] },
  });
  const newLegs: Array<[string, string, string, '1x2' | 'ou25', string, number]> = [
    ['K5N6WB-L1', '93750', 'FC United vs Altrincham', '1x2', 'draw', 3.95],
    ['K5N6WB-L2', '81382', 'Luton vs Barnsley', '1x2', 'home', 1.41],
    ['K5N6WB-L3', '41978', 'Huddersfield vs Peterborough', '1x2', 'home', 1.54],
  ];
  for (const [legId, fixtureId, teams, market, selection, odds] of newLegs) {
    appendParlayEvent({
      type: 'leg', at: Date.parse('2026-10-20T15:32:00+03:00'), eventId: `leg:${legId}`,
      leg: { legId, slipId: 'K5N6WB', fixtureId, teams, competition: 'England (see curation map)', kickoff: '2026-10-20T21:45:00+03:00', tz: 'EAT', market, selection, entryOdds: odds, entrySource: 'betika-slip-screenshot', entryAt: Date.parse('2026-10-20T15:32:00+03:00'), atlasProb: null, atlasProbVersion: null, status: 'pending', settledAt: null, settlementSource: null },
    });
  }
}

function applySettlements(): void {
  for (const [legId, status, ft] of LEG_SETTLE) {
    appendParlayEvent({ type: 'settlement', at: BATCH, eventId: `settle:${legId}`, settlement: { legId, status, source: `${SRC} ft=${ft}` } });
  }
  for (const slipId of ['KOL8UA', 'KH0BBA', 'KSK4AA', 'KN1EJA', 'K5N6WB']) {
    appendParlayEvent({ type: 'settlement', at: BATCH, eventId: `settle:slip:${slipId}`, settlement: { slipId, status: 'settled', grossReturn: slipId === 'KOL8UA' ? 24.8 : 0, source: SRC } });
  }
}

describe('parlay cohort settlement register 2026-10-21 (descriptive)', () => {
  it('folds corrections + settlements and reports the settled cohort', () => {
    resetParlayLedger();
    seedParlayCohort();
    applyCorrectionsAndNewSlip();
    applySettlements();
    const ev = loadParlayEvents();
    expect(verifyParlayChain(ev)).toBe(true);
    const r = buildParlayReport(ev);
    expect(r.slips.total).toBe(5);
    expect(r.slips.settled).toBe(5);
    expect(r.hitRate).toEqual({ won: 1, settled: 5, rate: 0.2, voids: 0 });
    expect(r.netPl).toBeCloseTo(-25.2, 9);
    expect(r.legs.won).toBe(14);
    expect(r.legs.lost).toBe(8);
    expect(r.legs.pending).toBe(0);
    expect(r.drawdown.value).toBeCloseTo(30.0, 9);
    expect(r.clv.eligible).toBe(0);
    expect(r.coverage.missingClosing).toBe(22);
    console.log(`\n=== USER PARLAY COHORT REPORT (settled 21 Oct) ===
slips: ${r.slips.detail.map((d) => `${d.slip}/${d.betika ?? '-'} ${d.won ? 'WON' : 'lost'} ${d.netPl >= 0 ? '+' : ''}${d.netPl.toFixed(1)}`).join(' | ')}
hitRate=${(r.hitRate.rate! * 100).toFixed(0)}% (1/5) legs=${r.legs.won}W/${r.legs.lost}L netPL=${r.netPl.toFixed(1)} KES maxDD=${r.drawdown.value.toFixed(1)} (${r.drawdown.convention})
CLV: eligible=${r.clv.eligible} missing=${r.clv.missing} -> UNAVAILABLE (no justified closing captures)
label: ${r.label}\n`);
  });

  it('prints the FT result register for primary-cohort settlement reference', () => {
    console.log(`\nFT RESULTS (20-21 Oct) for primary 1X2 ledger settlement:
93750 2:6 away | 81382 2:1 home | 41978 4:1 home | 71987 0:1 away | 82434 2:0 home
53663 0:1 away | 61337 1:0 home | 69212 1:3 away | 53800 1:1 draw | 82802 1:1 draw | 48941 1:0 home\n`);
    expect(LEG_SETTLE).toHaveLength(22);
  });
});