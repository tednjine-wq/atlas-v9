// ============================================================
// Research-only market ledger (R10-mkt). Append-only, hash-
// chained, in-memory + deterministic export. Completely separate
// from the production prospective ledger and its tap; no browser
// persistence required (artifacts are committed report JSON).
// ============================================================
export interface MarketLedgerEvent {
  v: 1; type: 'ou25-row' | 'reject'; at: number; eventId: string;
  prevHash: string; hash: string;
  matchId?: string; atlasOver?: number; marketOver?: number;
  outcome?: 'over' | 'under'; reason?: string;
}

let mem: MarketLedgerEvent[] = [];

export function loadMarketEvents(): MarketLedgerEvent[] { return [...mem]; }
export function resetMarketLedger(): void { mem = []; }

function fnv(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export function appendMarketEvent(e: Omit<MarketLedgerEvent, 'v' | 'prevHash' | 'hash'>): MarketLedgerEvent {
  const payload = { ...e, v: 1 as const, prevHash: '', hash: '' };
  payload.prevHash = mem.length ? mem[mem.length - 1].hash : 'genesis';
  payload.hash = fnv(payload.prevHash + JSON.stringify({ ...payload, hash: '' }));
  if (mem.some((x) => x.eventId === payload.eventId)) return payload; // duplicate-safe
  mem.push(payload);
  return payload;
}

export function verifyMarketChain(events: MarketLedgerEvent[]): boolean {
  for (let i = 0; i < events.length; i++) {
    const expectPrev = i === 0 ? 'genesis' : events[i - 1].hash;
    if (events[i].prevHash !== expectPrev) return false;
    if (fnv(events[i].prevHash + JSON.stringify({ ...events[i], hash: '' })) !== events[i].hash) return false;
  }
  return true;
}

export function marketExportJson(events: MarketLedgerEvent[]): string {
  return JSON.stringify({ schema: 1, exportedAt: 'reproducible', events }, null, 2);
}