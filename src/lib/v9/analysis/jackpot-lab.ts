// ============================================================
// JACKPOT LAB v9.5 — round-level (true ticket) validation.
// v9.5: rounds grouped by the slip's calendar date (first token),
// so each row is a real 13-17 leg jackpot ticket.
// Engine logic: argmax pick, SOF flag only (v9.4). Rule 1 sweep kept.
// ============================================================
import { calibrateLambda } from '../math/calibration';
import { buildScoreMatrix, outcomeProbs } from '../math/dixon-coles';
import type { Outcome } from '../atlas-types';

export interface HistoryRow {
  date: string; home: string; away: string;
  h: number; d: number; a: number;
  result?: 'H' | 'D' | 'A';
}

export function parseHistory(text: string): HistoryRow[] {
  const rows: HistoryRow[] = [];
  for (const line of text.split(/\n/)) {
    const p = line.split('|').map((x) => x.trim());
    if (p.length < 6) continue;
    const h = parseFloat(p[3]), d = parseFloat(p[4]), a = parseFloat(p[5]);
    if (!(h > 1 && d > 1 && a > 1)) continue;
    const res = (p[6] ?? '').toUpperCase();
    rows.push({
      date: p[0], home: p[1], away: p[2], h, d, a,
      result: res === 'H' || res === 'D' || res === 'A' ? (res as 'H' | 'D' | 'A') : undefined,
    });
  }
  return rows;
}

const toOutcome = (r: 'H' | 'D' | 'A'): Outcome => (r === 'H' ? 'home' : r === 'D' ? 'draw' : 'away');

function probsAt(r: HistoryRow, rho: number) {
  const cal = calibrateLambda(r.h, r.d, r.a, rho);
  const { raw, sum } = buildScoreMatrix(cal.lambdaH, cal.lambdaA, rho);
  const p = outcomeProbs(raw, sum);
  const sof = Math.abs(p.home - p.away) < 0.06 || (r.d < r.h && r.d < r.a);
  let pick: Outcome = 'home';
  if (p.draw >= p.home && p.draw >= p.away) pick = 'draw';
  if (p.away > p.home && p.away > p.draw) pick = 'away';
  return { p, pick, sof };
}

export interface RhoPoint { rho: number; brier: number; hitRate: number; }
export interface RoundReport {
  round: string; legs: number; resolved: number; hits: number;
  predAllHit: number; actualAllHit: boolean | null;
}
export interface LabReport {
  total: number; resolved: number;
  hits: number; hitRate: number; brier: number; logLoss: number;
  drawRate: number;
  sofTriggers: number; sofResolved: number; sofHits: number; sofDraws: number;
  pickDist: { home: number; draw: number; away: number };
  rhoTable: RhoPoint[]; bestRho: number; currentRhoBrier: number;
  rounds: RoundReport[];
}

export function runJackpotLab(rows: HistoryRow[]): LabReport {
  const RHO = -0.08;
  const resolvedRows = rows.filter((r) => r.result);
  let hits = 0, brier = 0, logLoss = 0, draws = 0;
  let sofT = 0, sofR = 0, sofH = 0, sofD = 0;
  const pickDist = { home: 0, draw: 0, away: 0 };

  for (const r of rows) {
    const { p, pick, sof } = probsAt(r, RHO);
    pickDist[pick]++;
    if (sof) sofT++;
    if (!r.result) continue;
    const o = toOutcome(r.result);
    if (sof) { sofR++; if (pick === o) sofH++; if (o === 'draw') sofD++; }
    hits += pick === o ? 1 : 0;
    draws += o === 'draw' ? 1 : 0;
    for (const k of ['home', 'draw', 'away'] as Outcome[])
      brier += (p[k] - (k === o ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(p[o], 1e-9));
  }
  const resolved = resolvedRows.length;

  const rhoTable: RhoPoint[] = [];
  for (let rho = -0.20; rho <= 0.001; rho += 0.04) {
    let b = 0, h = 0;
    for (const r of resolvedRows) {
      const { p, pick } = probsAt(r, rho);
      const o = toOutcome(r.result!);
      for (const k of ['home', 'draw', 'away'] as Outcome[])
        b += (p[k] - (k === o ? 1 : 0)) ** 2;
      h += pick === o ? 1 : 0;
    }
    rhoTable.push({
      rho: Math.round(rho * 100) / 100,
      brier: resolved ? b / resolved : 0,
      hitRate: resolved ? h / resolved : 0,
    });
  }
  const best = [...rhoTable].sort((x, y) => x.brier - y.brier)[0];

  // v9.5: group by calendar date = the actual jackpot ticket
  const byRound = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const key = r.date.split(' ')[0];
    const arr = byRound.get(key) ?? [];
    arr.push(r);
    byRound.set(key, arr);
  }
  const rounds: RoundReport[] = [...byRound.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([round, rs]) => {
      const res = rs.filter((x) => x.result);
      let pred = 1, hh = 0;
      for (const x of res) {
        const { p, pick } = probsAt(x, RHO);
        pred *= p[pick];
        hh += pick === toOutcome(x.result!) ? 1 : 0;
      }
      return {
        round, legs: rs.length, resolved: res.length, hits: hh, predAllHit: pred,
        actualAllHit: res.length === rs.length && res.length > 0 ? hh === res.length : null,
      };
    });

  return {
    total: rows.length, resolved,
    hits, hitRate: resolved ? hits / resolved : 0,
    brier: resolved ? brier / resolved : 0,
    logLoss: resolved ? logLoss / resolved : 0,
    drawRate: resolved ? draws / resolved : 0,
    sofTriggers: sofT, sofResolved: sofR, sofHits: sofH, sofDraws: sofD,
    pickDist, rhoTable,
    bestRho: best?.rho ?? RHO,
    currentRhoBrier: rhoTable.find((x) => x.rho === RHO)?.brier ?? 0,
    rounds,
  };
}
