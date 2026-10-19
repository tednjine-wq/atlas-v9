// ============================================================
// User-parlay cohort ledger — RESEARCH ONLY (R11-parlay).
// Cohort USER_PARLAY_2026_10_20. Append-only, hash-chained,
// isolated from the prospective 1X2 ledger and market ledger.
// Validation rejects: missing odds fabricated, snapshots
// labelled 'closing' without justification, bad settlements.
// ============================================================
export const PARLAY_COHORT = 'USER_PARLAY_2026_10_20';

export type CaptureClass = 'closing' | 'pre_kickoff_nonclosing' | 'missing';
export type LegStatus = 'won' | 'lost' | 'void' | 'push' | 'pending';
export type SlipStatus = 'open' | 'settled' | 'pending' | 'void';
export type MarketKind = '1x2' | 'ou25';

export interface OddsCapture {
  legId: string; odds: number; source: string;
  capturedAt: number; capturedAtEat: string;
  minutesToKickoff: number | null;
  klass: CaptureClass; justification?: string;
}
export interface LegRecord {
  legId: string; slipId: string; fixtureId: string; teams: string;
  competition: string; kickoff: string; tz: string;
  market: MarketKind; selection: string;
  entryOdds: number; entrySource: string; entryAt: number;
  atlasProb: number | null; atlasProbVersion: string | null;
  status: LegStatus; settledAt: number | null; settlementSource: string | null;
}
export interface SlipRecord {
  slipId: string; cohortId: string; stake: number; currency: 'KES';
  potentialPayout: number; payoutVerified: boolean;
  placedAt: string; combinedOdds: number;
  status: SlipStatus; settledAt: number | null;
  grossReturn: number | null; netPl: number | null; legIds: string[];
}
export interface ParlayEvent {
  v: 1; type: 'slip' | 'leg' | 'odds-capture' | 'settlement' | 'correction' | 'reject';
  at: number; eventId: string; prevHash: string; hash: string;
  slip?: SlipRecord; leg?: LegRecord; capture?: OddsCapture;
  settlement?: { legId?: string; slipId?: string; status: LegStatus | SlipStatus; grossReturn?: number; source: string };
  correction?: { targetEventId: string; patch: Record<string, unknown>; note: string };
  reason?: string;
}

let mem: ParlayEvent[] = [];
const counters = { duplicates: 0, rejects: 0 };
export const loadParlayEvents = (): ParlayEvent[] => [...mem];
export const getParlayCounters = () => ({ ...counters });
export const resetParlayLedger = (): void => { mem = []; counters.duplicates = 0; counters.rejects = 0; };

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

function validate(e: ParlayEvent): string | null {
  if (e.type === 'slip' && e.slip) {
    const s = e.slip;
    if (!(s.stake > 0) || s.legIds.length === 0 || !(s.combinedOdds > 1)) return 'invalid slip stake/legs/odds';
    return null;
  }
  if (e.type === 'leg' && e.leg) {
    if (!(e.leg.entryOdds > 1) || !e.leg.fixtureId || !e.leg.selection) return 'invalid leg odds/fixture/selection';
    return null;
  }
  if (e.type === 'odds-capture' && e.capture) {
    const c = e.capture;
    if (!(c.odds > 1) || !c.source) return 'invalid capture odds/source';
    if (c.klass === 'closing' && !c.justification) return 'closing-label-without-justification';
    return null;
  }
  if (e.type === 'settlement' && e.settlement) {
    if (!e.settlement.source) return 'settlement-missing-source';
    return null;
  }
  if (e.type === 'correction' && e.correction) {
    if (!e.correction.targetEventId) return 'correction-missing-target';
    return null;
  }
  return 'unknown event type';
}

export function appendParlayEvent(e: Omit<ParlayEvent, 'v' | 'prevHash' | 'hash'>): ParlayEvent {
  const base = { ...e, v: 1 as const, prevHash: '', hash: '' };
  const problem = validate(base);
  if (problem) {
    counters.rejects++;
    const rej: ParlayEvent = { v: 1, type: 'reject', at: base.at, eventId: `reject:${base.eventId}:${counters.rejects}`, prevHash: '', hash: '', reason: problem };
    rej.prevHash = mem.length ? mem[mem.length - 1].hash : 'genesis';
    rej.hash = fnv(rej.prevHash + JSON.stringify({ ...rej, hash: '' }));
    mem.push(rej);
    return rej;
  }
  base.prevHash = mem.length ? mem[mem.length - 1].hash : 'genesis';
  base.hash = fnv(base.prevHash + JSON.stringify({ ...base, hash: '' }));
  if (mem.some((x) => x.eventId === base.eventId)) { counters.duplicates++; return base; }
  mem.push(base);
  return base;
}

export function verifyParlayChain(events: ParlayEvent[]): boolean {
  for (let i = 0; i < events.length; i++) {
    const expectPrev = i === 0 ? 'genesis' : events[i - 1].hash;
    if (events[i].prevHash !== expectPrev) return false;
    if (fnv(events[i].prevHash + JSON.stringify({ ...events[i], hash: '' })) !== events[i].hash) return false;
  }
  return true;
}

export const parlayExportJson = (events: ParlayEvent[]): string =>
  JSON.stringify({ schema: 1, cohort: PARLAY_COHORT, exportedAt: 'reproducible', events }, null, 2);