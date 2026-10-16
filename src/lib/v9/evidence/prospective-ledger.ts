// ============================================================
// Prospective evidence ledger — append-only, hash-chained,
// deterministic export. No update/delete API by design.
// Browser: localStorage. Node/tests: in-memory fallback.
// ============================================================
import type { GameType, Outcome } from '../atlas-types';

export const LEDGER_SCHEMA = 2;
export const GUARD_POLICY_VERSION = 'guard-v9.10-part94';
export const MODEL_VERSION = 'atlas-v9.10';

export type EventType = 'prediction' | 'skip' | 'settlement' | 'closing' | 'backfill';

export interface ProspectiveEvent {
  v: number; type: EventType; at: number; eventId: string;
  prevHash: string; hash: string;
  predictionId?: string; matchId?: string; label?: string;
  league?: string | null; kickoff?: string | null;
  gameType?: GameType; pick?: Outcome; probs?: Record<Outcome, number>;
  entryOdds?: Record<Outcome, number> | null; oddsSource?: string; oddsAt?: number | null;
  phi?: number; ev?: number | null; guardStake?: number; guardReason?: string; stakeUnits?: number;
  modelVersion?: string; guardPolicyVersion?: string;
  result?: Outcome; resolvedAt?: number;
  closingOdds?: number | null; closingSource?: string | null; clv?: number | null;
  reason?: string; backfilled?: boolean;
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

export function appendEvent(e: Omit<ProspectiveEvent, 'v' | 'prevHash' | 'hash'>): ProspectiveEvent {
  const all = loadEvents();
  const prevHash = all.length ? all[all.length - 1].hash : 'genesis';
  const payload: ProspectiveEvent = { ...e, v: LEDGER_SCHEMA, prevHash, hash: '' } as ProspectiveEvent;
  payload.hash = fnv(prevHash + JSON.stringify({ ...payload, hash: '' }));
  if (all.some((x) => x.eventId === payload.eventId)) return payload; // duplicate-safe no-op
  all.push(payload);
  if (hasLS()) { try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch { /* full */ } }
  else memory = all;
  return payload;
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
  const cols: (keyof ProspectiveEvent)[] = ['v', 'type', 'at', 'eventId', 'prevHash', 'hash', 'predictionId', 'matchId', 'label', 'league', 'kickoff', 'gameType', 'pick', 'entryOdds', 'oddsSource', 'phi', 'ev', 'guardStake', 'guardReason', 'stakeUnits', 'modelVersion', 'guardPolicyVersion', 'result', 'resolvedAt', 'closingOdds', 'closingSource', 'clv', 'reason', 'backfilled'];
  const esc = (x: unknown) => { const s = typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [cols.join(','), ...events.map((e) => cols.map((c) => esc(e[c])).join(','))].join('\n');
}