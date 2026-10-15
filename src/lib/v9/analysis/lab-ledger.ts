// ============================================================
// STANDARD LAB BET-BY-BET LEDGER (v9.10 audit P0)
// Records every analysed match and eligible flag bet using
// prediction-time information only; reconciles aggregate P/L.
// ============================================================
import type { Outcome } from '../atlas-types';

export interface LedgerRow {
  file: string;
  line: number;
  fixture: string;
  div: string;
  date: string;
  home: string;
  away: string;
  odds: { h: number; d: number; a: number };
  probs: Record<Outcome, number>;
  pick: Outcome;
  pickOdds: number;
  pickEv: number;
  pickHit: boolean;
  pickPL: number;
  flagKey: string | null;
  flagOdds: number | null;
  flagEv: number | null;
  band: 'lo' | 'mid' | 'hi' | null;
  guardStake: number;
  flagHit: boolean | null;
  flagRawPL: number;
  flagGuardedPL: number;
  runAt: string;
}

export function guardedStakeFromEv(ev: number, odds: number): number {
  if (!(ev > 0) || !(odds > 1)) return 0;
  if (ev > 0.06) return 0;
  return odds < 1.5 ? 0.5 : 1;
}

export function bandOf(ev: number): 'lo' | 'mid' | 'hi' {
  return ev > 0.06 ? 'hi' : ev > 0.03 ? 'mid' : 'lo';
}

export interface LedgerTotals {
  rows: number;
  pickBets: number; pickHits: number; pickPL: number;
  flags: number; flagHits: number; flagRawPL: number; flagGuardedPL: number;
  bands: Record<'lo' | 'mid' | 'hi', { n: number; hits: number; rawPL: number; guardedPL: number }>;
  zeroGuard: number;
}

export function reconcileLedger(rows: LedgerRow[]): LedgerTotals {
  const t: LedgerTotals = {
    rows: rows.length,
    pickBets: 0, pickHits: 0, pickPL: 0,
    flags: 0, flagHits: 0, flagRawPL: 0, flagGuardedPL: 0,
    bands: { lo: { n: 0, hits: 0, rawPL: 0, guardedPL: 0 }, mid: { n: 0, hits: 0, rawPL: 0, guardedPL: 0 }, hi: { n: 0, hits: 0, rawPL: 0, guardedPL: 0 } },
    zeroGuard: 0,
  };
  for (const r of rows) {
    t.pickBets++; t.pickHits += r.pickHit ? 1 : 0; t.pickPL += r.pickPL;
    if (r.flagKey === null) continue;
    t.flags++;
    const hit = r.flagHit === true;
    t.flagHits += hit ? 1 : 0;
    t.flagRawPL += r.flagRawPL;
    t.flagGuardedPL += r.flagGuardedPL;
    if (r.band) {
      const b = t.bands[r.band];
      b.n++; b.hits += hit ? 1 : 0; b.rawPL += r.flagRawPL; b.guardedPL += r.flagGuardedPL;
    }
    if (r.guardStake <= 0) t.zeroGuard++;
  }
  return t;
}

const LS_LEDGER = 'atlas_v9_stdlab_ledger';
export function loadLedger(): LedgerRow[] {
  try { const s = localStorage.getItem(LS_LEDGER); return s ? (JSON.parse(s) as LedgerRow[]) : []; } catch { return []; }
}
export function appendLedger(rows: LedgerRow[]): void {
  try { localStorage.setItem(LS_LEDGER, JSON.stringify([...loadLedger(), ...rows].slice(-20000))); } catch { /* full */ }
}
export function clearLedger(): void { try { localStorage.removeItem(LS_LEDGER); } catch { /* ignore */ } }

export function ledgerToCsv(rows: LedgerRow[]): string {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = 'file,line,fixture,div,date,home,away,oddsH,oddsD,oddsA,pHome,pDraw,pAway,pick,pickOdds,pickEv,pickHit,pickPL,flagKey,flagOdds,flagEv,band,guardStake,flagHit,flagRawPL,flagGuardedPL,runAt';
  const body = rows.map((r) => [
    r.file, r.line, r.fixture, r.div, r.date, r.home, r.away, r.odds.h, r.odds.d, r.odds.a,
    r.probs.home, r.probs.draw, r.probs.away, r.pick, r.pickOdds, r.pickEv, r.pickHit, r.pickPL,
    r.flagKey ?? '', r.flagOdds ?? '', r.flagEv ?? '', r.band ?? '', r.guardStake, r.flagHit ?? '', r.flagRawPL, r.flagGuardedPL, r.runAt,
  ].map(esc).join(','));
  return [head, ...body].join('\n');
}