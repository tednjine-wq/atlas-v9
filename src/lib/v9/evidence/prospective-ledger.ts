// ============================================================
// Prospective evidence ledger — append-only, hash-chained,
// deterministic export. No update/delete API by design.
// R9: write validation with explicit reject events, void
// status events, observable counters (duplicates / rejects /
// write-errors) so nothing fails silently.
// Browser: localStorage. Node/tests: in-memory fallback.
// ============================================================
import type { GameType, Outcome } from '../atlas-types';

export const LEDGER_SCHEMA = 3;
export const GUARD_POLICY_VERSION = 'guard-v9.10-part94';
export const MODEL_VERSION = 'atlas-v9.10';

export type EventType = 'prediction' | 'skip' | 'settlement' | 'closing' | 'backfill' | 'reject' | 'void';

export interface ProspectiveEvent {
  v: number; type: EventType; at: number; eventId: string;
  prevHash: string; hash: string;
  predictionId?: string; matchId?: string; label?: string;
  league?: string | null; kickoff?: string | null;
  gameType?: GameType; pick?: Outcome; probs?: Record<Outcome, number>;
  entryOdds?: Record<Outcome, number> | null; oddsSource?: string; oddsAt?: number | null;
  phi?: number; ev?: number | null; guardStake?: number; guardReason?: string; stakeUnits?: number;
  modelVersion?: string; guardPolicyVersion?: string;
  result?: Outcome; resolvedAt?: number | null;
  closingOdds?: number | null; closingSource?: string | null; clv?: number | null;
  status?: 'settled' | 'void' | 'missing' | string;
  rejectedType?: EventType; reason?: string; backfilled?: boolean;
}

const LS_KEY = 'atlas_v9_prospective_ledger';
let memory: ProspectiveEvent[] = [];
const hasLS = () => typeof localStorage !== 'undefined';

export function loadEvents(): ProspectiveEvent[] {
  if (!hasLS()) return [...memory];
  try { const s = localStorage.getItem(LS_KEY); return s ? (JSON.parse(s) as ProspectiveEvent[]) : []; }
  catch { return []; }
}

function fnv(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

const OUTS: Outcome[] = ['home', 'draw', 'away'];
function validProbs(p?: Record<Outcome, number>): boolean {
  if (!p) return false;
  let s = 0;
  for (const k of OUTS) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return false;
    s += v;
  }
  return Math.abs(s - 1) < 1e-6;
}

function validate(e: ProspectiveEvent): string | null {
  switch (e.type) {
    case 'prediction':
    case 'backfill':
      if (!e.predictionId) return 'missing predictionId';
      if (!validProbs(e.probs)) return 'missing or invalid probs';
      if (!e.gameType || !e.pick) return 'missing gameType or pick';
      return null;
    case 'settlement':
      if (!e.predictionId) return 'missing predictionId';
      if (!e.result) return 'missing result';
      return null;
    case 'closing':
      if (!e.predictionId) return 'missing predictionId';
      if (!(e.closingOdds! > 1)) return 'closingOdds not > 1';
      return null;
    case 'void':
    case 'reject':
    case 'skip':
      return e.reason ? null : 'missing reason';
    default:
      return 'unknown event type';
  }
}

const counters = { duplicates: 0, rejects: 0, writeErrors: 0 };
export function getLedgerCounters() { return { ...counters }; }

function writeRaw(payload: ProspectiveEvent): ProspectiveEvent {
  const all = loadEvents();
  payload.prevHash = all.length ? all[all.length - 1].hash : 'genesis';
  payload.hash = fnv(payload.prevHash + JSON.stringify({ ...payload, hash: '' }));
  if (all.some((x) => x.eventId === payload.eventId)) { counters.duplicates++; return payload; }
  all.push(payload);
  if (hasLS()) { try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { counters.writeErrors++; } }
  else memory = all;
  return payload;
}

export function appendEvent(e: Omit<ProspectiveEvent, 'v' | 'prevHash' | 'hash'>): ProspectiveEvent {
  const base = { ...e, v: LEDGER_SCHEMA } as ProspectiveEvent;
  const problem = validate(base);
  if (problem) {
    counters.rejects++;
    return writeRaw({
      v: LEDGER_SCHEMA, type: 'reject', at: base.at,
      eventId: `reject:${base.eventId}:${counters.rejects}`,
      prevHash: '', hash: '', rejectedType: base.type, reason: problem, predictionId: base.predictionId,
    });
  }
  if (base.type === 'settlement' && !base.status) base.status = 'settled';
  return writeRaw(base);
}

export function appendVoid(predictionId: string, reason: string, at = Date.now()): ProspectiveEvent {
  return appendEvent({ type: 'void', at, eventId: `void:${predictionId}`, predictionId, reason, status: 'void' });
}

export function verifyChain(events: ProspectiveEvent[]): { ok: boolean; brokenAt: number } {
  for (let i = 0; i < events.length; i++) {
    const expectPrev = i === 0 ? 'genesis' : events[i - 1].hash;
    if (events[i].prevHash !== expectPrev) return { ok: false, brokenAt: i };
    const recomputed = fnv(events[i].prevHash + JSON.stringify({ ...events[i], hash: '' }));
    if (recomputed !== events[i].hash) return { ok: false, brokenAt: i };
  }
  return { ok: true, brokenAt: -1 };
}

export function exportJson(events: ProspectiveEvent[]): string {
  return JSON.stringify({ schema: LEDGER_SCHEMA, exportedAt: 'reproducible', events }, null, 2);
}

export function eventsToCsv(events: ProspectiveEvent[]): string {
  const cols: (keyof ProspectiveEvent)[] = ['v', 'type', 'at', 'eventId', 'prevHash', 'hash', 'predictionId', 'matchId', 'label', 'league', 'kickoff', 'gameType', 'pick', 'entryOdds', 'oddsSource', 'phi', 'ev', 'guardStake', 'guardReason', 'stakeUnits', 'modelVersion', 'guardPolicyVersion', 'result', 'resolvedAt', 'closingOdds', 'closingSource', 'clv', 'status', 'rejectedType', 'reason', 'backfilled'];
  const esc = (x: unknown) => { const s = typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...events.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
}