// ============================================================
// Historical OU 2.5 odds ingestion (football-data.co.uk CSVs).
// Source definitions (documented, never imputed):
//   entry  = B365>2.5 / B365<2.5  (Bet365 pre-match prices)
//   close  = BbAv>2.5 / BbAv<2.5  (BetBrain average, close-ish;
//            EVALUATION/CLV ONLY — never a prediction input)
// Missing columns or blanks => null + ouMissing flag; rows with
// missing entry odds are excluded and counted, never zero-filled.
// ============================================================
import type { HistMatch } from '../pipeline';

export interface OuMatch extends HistMatch {
  ouOpenOver: number | null; ouOpenUnder: number | null;
  ouCloseOver: number | null; ouCloseUnder: number | null;
  ouMissing: boolean;
}

const num = (s: string | undefined): number | null => {
  const v = parseFloat(s ?? '');
  return Number.isFinite(v) && v > 1 ? v : null;
};

export function loadCsvMatchesWithOu(text: string, source: string): OuMatch[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const hs = lines[0].split(',');
  const col = (n: string) => hs.indexOf(n);
  const iD = col('Date'), iDiv = col('Div'), iH = col('HomeTeam'), iA = col('AwayTeam');
  const iHG = col('FTHG'), iAG = col('FTAG');
  const iOh = col('B365H'), iOd = col('B365D'), iOa = col('B365A');
  const iOO = col('B365>2.5'), iOU = col('B365<2.5');
  const iCO = col('BbAv>2.5'), iCU = col('BbAv<2.5');
  const parseDate = (s: string): number => {
    const p = s.trim().split('/');
    if (p.length !== 3) return NaN;
    let y = +p[2];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return Date.UTC(y, +p[1] - 1, +p[0], 15);
  };
  const out: OuMatch[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const h = parseFloat(c[iOh]), d = parseFloat(c[iOd]), a = parseFloat(c[iOa]);
    const hg = parseInt(c[iHG], 10), ag = parseInt(c[iAG], 10);
    const date = parseDate(c[iD] ?? '');
    if (!(h > 1 && d > 1 && a > 1) || !(hg >= 0) || !(ag >= 0) || !Number.isFinite(date)) continue;
    const ouOpenOver = num(c[iOO]), ouOpenUnder = num(c[iOU]);
    out.push({
      id: `${source}-${i}`, date, league: (c[iDiv] ?? '??').trim(),
      home: (c[iH] ?? '').trim(), away: (c[iA] ?? '').trim(), hg, ag, h, d, a,
      ouOpenOver, ouOpenUnder,
      ouCloseOver: num(c[iCO]), ouCloseUnder: num(c[iCU]),
      ouMissing: !(ouOpenOver && ouOpenUnder),
    });
  }
  return out.sort((x, y) => x.date - y.date);
}

// Proportional devig for a two-way market (documented method).
export function devigTwo(o: number, u: number): number {
  const io = 1 / o, iu = 1 / u;
  return io / (io + iu);
}