// ============================================================
// OU 2.5 chronological research runner (R10-mkt).
// Paired per-match comparison: ATLAS-derived Over 2.5 (score
// matrix) vs devigged B365 entry prices, on identical fixtures.
// Closing prices (BbAv) used ONLY for CLV, never as inputs.
// Missing odds excluded + counted, never imputed.
// ============================================================
import { binomialCi, meanCi } from '../benchmark/metrics';
import { atlasOver25, settleOu } from './ou-extract';
import { devigTwo } from './ou-data';
import type { OuMatch } from './ou-data';
import { appendMarketEvent, loadMarketEvents, resetMarketLedger } from './market-ledger';

export interface OuRow {
  id: string; date: number; league: string;
  atlasOver: number; marketOver: number;
  entryOverOdd: number; entryUnderOdd: number;
  closeOver: number | null;
  outcome: 'over' | 'under';
}
export interface OuRecon {
  total: number; burnIn: number; afterCutoff: number;
  missingOuOdds: number; invalid1x2: number; eligible: number;
}
export interface OuBand { lo: number; hi: number; n: number; meanPred: number; meanObs: number; }
export interface OuResult {
  rows: OuRow[]; recon: OuRecon; n: number;
  dBrier: { mean: number; lo: number; hi: number };
  dLogLoss: { mean: number; lo: number; hi: number };
  atlas: { brier: number; ll: number; acc: number; accCi: [number, number] };
  market: { brier: number; ll: number; acc: number; accCi: [number, number] };
  calibration: OuBand[];
  betting: { roi: number; pl: number; maxDrawdown: number; clv: number | null; clvN: number } | null;
  ledgerEvents: number;
}

const brierBin = (p: number, y: number) => (p - y) ** 2 + ((1 - p) - (1 - y)) ** 2;
const llBin = (p: number, y: number) => -Math.log(Math.max(y === 1 ? p : 1 - p, 1e-9));

export function runOu25(matches: OuMatch[], cutoffs: number[]): OuResult {
  resetMarketLedger();
  const sorted = [...matches].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
  const c = [...cutoffs].sort((a, b) => a - b);
  const recon: OuRecon = { total: sorted.length, burnIn: 0, afterCutoff: 0, missingOuOdds: 0, invalid1x2: 0, eligible: 0 };

  const rows: OuRow[] = [];
  for (const m of sorted) {
    if (m.date <= c[0]) { recon.burnIn++; continue; }
    recon.afterCutoff++;
    if (!(m.h > 1 && m.d > 1 && m.a > 1)) { recon.invalid1x2++; continue; }
    if (!(m.ouOpenOver && m.ouOpenUnder)) { recon.missingOuOdds++; continue; }
    const atlas = atlasOver25(m.h, m.d, m.a);
    if (!atlas) { recon.invalid1x2++; continue; }
    const marketOver = devigTwo(m.ouOpenOver, m.ouOpenUnder);
    const outcome = settleOu(m.hg, m.ag);
    const closeOver = m.ouCloseOver && m.ouCloseUnder ? devigTwo(m.ouCloseOver, m.ouCloseUnder) : null;
    rows.push({
      id: m.id, date: m.date, league: m.league,
      atlasOver: atlas.over, marketOver,
      entryOverOdd: m.ouOpenOver, entryUnderOdd: m.ouOpenUnder,
      closeOver, outcome,
    });
    appendMarketEvent({ type: 'ou25-row', at: m.date, eventId: `ou25:${m.id}`, matchId: m.id, atlasOver: atlas.over, marketOver, outcome });
  }
  recon.eligible = rows.length;
  const n = rows.length;
  const y = (r: OuRow) => (r.outcome === 'over' ? 1 : 0);
  const dBs = rows.map((r) => brierBin(r.atlasOver, y(r)) - brierBin(r.marketOver, y(r)));
  const dLs = rows.map((r) => llBin(r.atlasOver, y(r)) - llBin(r.marketOver, y(r)));
  const aB = rows.map((r) => brierBin(r.atlasOver, y(r)));
  const mB = rows.map((r) => brierBin(r.marketOver, y(r)));
  const aL = rows.map((r) => llBin(r.atlasOver, y(r)));
  const mL = rows.map((r) => llBin(r.marketOver, y(r)));
  const aHits = rows.filter((r) => (r.atlasOver >= 0.5) === (y(r) === 1)).length;
  const mHits = rows.filter((r) => (r.marketOver >= 0.5) === (y(r) === 1)).length;

  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
  const calibration: OuBand[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inB = rows.filter((r) => r.atlasOver >= edges[i] && (r.atlasOver < edges[i + 1] || (edges[i + 1] === 1 && r.atlasOver <= 1)));
    calibration.push({
      lo: edges[i], hi: edges[i + 1], n: inB.length,
      meanPred: inB.length ? inB.reduce((s, r) => s + r.atlasOver, 0) / inB.length : 0,
      meanObs: inB.length ? inB.reduce((s, r) => s + y(r), 0) / inB.length : 0,
    });
  }

  let betting: OuResult['betting'] = null;
  if (n > 0) {
    let pl = 0, peak = 0, maxDD = 0, clvSum = 0, clvN = 0;
    for (const r of rows) {
      const selOver = r.atlasOver >= 0.5;
      const entryOdd = selOver ? r.entryOverOdd : r.entryUnderOdd;
      const win = selOver === (y(r) === 1);
      pl += win ? entryOdd - 1 : -1;
      peak = Math.max(peak, pl); maxDD = Math.max(maxDD, peak - pl);
      if (r.closeOver !== null) {
        const closeOdd = selOver ? r.closeOver : 1 / (1 - r.closeOver);
        clvSum += entryOdd / closeOdd - 1; clvN++;
      }
    }
    betting = { roi: pl / n, pl, maxDrawdown: maxDD, clv: clvN ? clvSum / clvN : null, clvN };
  }

  return {
    rows, recon, n,
    dBrier: meanCi(dBs), dLogLoss: meanCi(dLs),
    atlas: { brier: meanCi(aB).mean, ll: meanCi(aL).mean, acc: n ? aHits / n : 0, accCi: binomialCi(aHits, n) },
    market: { brier: meanCi(mB).mean, ll: meanCi(mL).mean, acc: n ? mHits / n : 0, accCi: binomialCi(mHits, n) },
    calibration, betting, ledgerEvents: loadMarketEvents().length,
  };
}