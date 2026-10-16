// ============================================================
// Benchmark comparison models (research-only).
// Documented implementation differences:
//  - market-devig: margin-stripped odds (shared stripMargin;
//    tuple [h,d,a] converted to Record<Outcome, number>).
//  - poisson-naive: fixed league-average lambdas, rho = 0.
//  - dc-independent: INDEPENDENT re-implementation of the DC tau
//    grid (cross-checks the shared math kernel); lambdas from an
//    O(1) research mapping of devigged margins; rho = -0.13.
//  - elo-baseline: margin-aware Elo -> simple 3-way mapping
//    (pDraw fixed 0.26). A baseline, not a candidate.
//  - atlas-frozen-v9.10: READ-ONLY control wrapping the
//    production Standard engine. Never mutated, never tuned.
// ============================================================
import type { Match, Outcome } from '../../atlas-types';
import { stripMargin } from '../../math/calibration';
import { ELO_INIT, eloExpected, eloUpdateStep } from '../pipeline';
import type { HistMatch } from '../pipeline';
import { atlasAnalyseV9 } from '../../engines/standard';

export interface BenchModel {
  name: string;
  predict: (m: HistMatch) => Record<Outcome, number>;
  observe: (m: HistMatch) => void;
}

const norm = (p: Record<Outcome, number>): Record<Outcome, number> => {
  const f = { home: Math.max(1e-6, p.home), draw: Math.max(1e-6, p.draw), away: Math.max(1e-6, p.away) };
  const z = f.home + f.draw + f.away;
  return { home: f.home / z, draw: f.draw / z, away: f.away / z };
};

// stripMargin returns a [home, draw, away] tuple — convert explicitly.
const devigProbs = (h: number, d: number, a: number): Record<Outcome, number> => {
  const t = stripMargin(h, d, a).probs;
  return { home: t[0], draw: t[1], away: t[2] };
};

function logFact(k: number): number { let s = 0; for (let i = 2; i <= k; i++) s += Math.log(i); return s; }

// Independent DC tau grid (0..9 x 0..9), renormalized.
export function dcGrid(lh: number, la: number, rho: number): Record<Outcome, number> {
  const pois = (k: number, l: number) => Math.exp(-l + k * Math.log(l) - logFact(k));
  let pH = 0, pD = 0, pA = 0, z = 0;
  for (let x = 0; x <= 9; x++) for (let y = 0; y <= 9; y++) {
    let tau = 1;
    if (x === 0 && y === 0) tau = 1 - lh * la * rho;
    else if (x === 0 && y === 1) tau = 1 + lh * rho;
    else if (x === 1 && y === 0) tau = 1 + la * rho;
    else if (x === 1 && y === 1) tau = 1 - rho;
    const p = tau * pois(x, lh) * pois(y, la);
    z += p;
    if (x > y) pH += p; else if (x === y) pD += p; else pA += p;
  }
  return { home: pH / z, draw: pD / z, away: pA / z };
}

export function marketDevig(): BenchModel {
  return { name: 'market-devig', predict: (m) => devigProbs(m.h, m.d, m.a), observe: () => undefined };
}

export function poissonNaive(): BenchModel {
  return { name: 'poisson-naive', predict: () => dcGrid(1.35, 1.05, 0), observe: () => undefined };
}

export function dcIndependent(): BenchModel {
  return {
    name: 'dc-independent',
    predict: (m) => {
      const p = devigProbs(m.h, m.d, m.a);
      const gap = p.home - p.away;
      const lh = Math.min(3.5, Math.max(0.2, 1.35 + 0.9 * gap));
      const la = Math.min(3.5, Math.max(0.2, 1.35 - 0.9 * gap));
      return dcGrid(lh, la, -0.13);
    },
    observe: () => undefined,
  };
}

export function eloModel(): BenchModel {
  let elo: Record<string, number> = {};
  return {
    name: 'elo-baseline',
    predict: (m) => {
      const e = eloExpected(elo[m.home] ?? ELO_INIT, elo[m.away] ?? ELO_INIT);
      const pDraw = 0.26;
      return norm({ home: (1 - pDraw) * e, draw: pDraw, away: (1 - pDraw) * (1 - e) });
    },
    observe: (m) => { elo = eloUpdateStep(elo, m.home, m.away, m.hg, m.ag); },
  };
}

export function atlasFrozen(): BenchModel {
  return {
    name: 'atlas-frozen-v9.10',
    predict: (m) => {
      const match = {
        id: m.id, home: m.home, away: m.away, league: m.league, country: '', kickoff: '',
        h: String(m.h), d: String(m.d), a: String(m.a), gameType: 'standard', userOdds: {},
      } as Match;
      return { ...atlasAnalyseV9(match, 0.10).probs };
    },
    observe: () => undefined,
  };
}