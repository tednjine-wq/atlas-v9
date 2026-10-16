// ============================================================
// Benchmark datasets. Provenance: SYNTHETIC seeded generator
// (mulberry32) for reproducible research; real-data loader for
// football-data.co.uk CSVs provided but NO real data bundled.
// ============================================================
import { mulberry32 } from '../math/poisson';
import type { HistMatch } from './pipeline';

const DAY = 86400000;

export function syntheticHistory(seed = 7): HistMatch[] {
  const rng = mulberry32(seed);
  const teams = ['T1', 'T2', 'T3', 'T4'];
  const strength: Record<string, number> = { T1: 1.6, T2: 1.3, T3: 1.1, T4: 0.85 };
  const out: HistMatch[] = [];
  let date = Date.parse('2022-08-01T15:00:00Z');
  let idx = 0;
  for (let season = 0; season < 3; season++) {
    for (let leg = 0; leg < 2; leg++) {
      for (const h of teams) for (const a of teams) {
        if (h === a) continue;
        const lh = strength[h] * 1.15, la = strength[a] * 0.9;
        const hg = Math.min(5, Math.floor(rng() * (lh + 1)));
        const ag = Math.min(5, Math.floor(rng() * (la + 1)));
        const ph = 1 / (1.6 + Math.abs(la - lh) + 1), pd = 0.26, pa = 1 / (1.9 + Math.abs(lh - la) + 1);
        const z = ph + pd + pa;
        out.push({
          id: `m${idx++}`, date, league: 'SYN', home: h, away: a, hg, ag,
          h: +((1.05 * z) / ph).toFixed(2), d: +((1.05 * z) / pd).toFixed(2), a: +((1.05 * z) / pa).toFixed(2),
        });
        date += 10 * DAY;
      }
    }
  }
  return out.sort((x, y) => x.date - y.date);
}

// football-data.co.uk style CSV loader (documented provenance path).
export function loadCsvMatches(text: string, source: string): HistMatch[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const hs = lines[0].split(',');
  const col = (n: string) => hs.indexOf(n);
  const iD = col('Date'), iDiv = col('Div'), iH = col('HomeTeam'), iA = col('AwayTeam');
  const iHG = col('FTHG'), iAG = col('FTAG');
  const iOh = col('B365H'), iOd = col('B365D'), iOa = col('B365A');
  const parseDate = (s: string): number => {
    const p = s.trim().split('/');
    if (p.length !== 3) return NaN;
    let y = +p[2];
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return Date.UTC(y, +p[1] - 1, +p[0], 15);
  };
  const out: HistMatch[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const h = parseFloat(c[iOh]), d = parseFloat(c[iOd]), a = parseFloat(c[iOa]);
    const hg = parseInt(c[iHG], 10), ag = parseInt(c[iAG], 10);
    const date = parseDate(c[iD] ?? '');
    if (!(h > 1 && d > 1 && a > 1) || !(hg >= 0) || !(ag >= 0) || !Number.isFinite(date)) continue;
    out.push({
      id: `${source}-${i}`, date, league: (c[iDiv] ?? '??').trim(),
      home: (c[iH] ?? '').trim(), away: (c[iA] ?? '').trim(), hg, ag, h, d, a,
    });
  }
  return out.sort((x, y) => x.date - y.date);
}