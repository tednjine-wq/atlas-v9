import { describe, expect, it } from 'vitest';
import { runResearchPipeline } from './pipeline';
import type { HistMatch } from './pipeline';
import { mulberry32 } from '../math/poisson';

const DAY = 86400000;

// Deterministic synthetic history: 6 teams, 3 seasons, double
// round-robin, strength-biased scores, odds derived from truth.
function syntheticHistory(seed = 7): HistMatch[] {
  const rng = mulberry32(seed);
  const teams = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
  const strength: Record<string, number> = { T1: 1.6, T2: 1.4, T3: 1.2, T4: 1.0, T5: 0.9, T6: 0.8 };
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
        date += DAY;
      }
    }
  }
  return out.sort((x, y) => x.date - y.date);
}

const T1 = Date.parse('2023-08-01T00:00:00Z');
const T2 = Date.parse('2024-08-01T00:00:00Z');
const CUTOFFS = [T1, T2];

const corruptAfter = (ms: HistMatch[], t: number): HistMatch[] =>
  ms.map((m) => (m.date > t ? { ...m, hg: m.ag, ag: m.hg } : m));

describe('test_no_look_ahead (full research pipeline)', () => {
  const clean = syntheticHistory();
  const corrupt = corruptAfter(clean, T1);
  const sClean = runResearchPipeline(clean, CUTOFFS);
  const sCorrupt = runResearchPipeline(corrupt, CUTOFFS);

  it('predictions at or before the cutoff are bit-identical under future corruption', () => {
    expect(sCorrupt[0].predictions).toEqual(sClean[0].predictions);
  });

  it('Elo ratings and C1 state at the cutoff are unchanged by future corruption', () => {
    expect(sCorrupt[0].elo).toEqual(sClean[0].elo);
    expect(sCorrupt[0].c1).toEqual(sClean[0].c1);
  });

  it('the test is non-vacuous: post-cutoff state DOES change under corruption', () => {
    expect(sCorrupt[1].c1).not.toEqual(sClean[1].c1);
    expect(sCorrupt[1].elo).not.toEqual(sClean[1].elo);
  });

  it('replay determinism: identical data and config reproduce identical snapshots', () => {
    expect(runResearchPipeline(clean, CUTOFFS)).toEqual(sClean);
  });
});