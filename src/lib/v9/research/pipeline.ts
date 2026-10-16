// ============================================================
// Research pipeline: chronological Elo + C1 + prediction
// snapshots at explicit cutoffs. Pure function of (data,
// cutoffs) so the no-look-ahead property is testable.
// Imports pure math only; NEVER engines/store/staking.
// ============================================================
import type { Outcome } from '../atlas-types';
import { buildScoreMatrix, outcomeProbs } from '../math/dixon-coles';
import { calibrateLambda } from '../math/calibration';
import { C1_DEFAULTS, applyC1Mult, c1Evaluate, c1InitialState, finalMultFor } from './c1-recalibration';
import type { C1Config, C1Obs, C1State } from './c1-recalibration';

export interface HistMatch {
  id: string; date: number; league: string; home: string; away: string;
  hg: number; ag: number; h: number; d: number; a: number;
}
export interface ResearchPrediction {
  matchId: string; date: number;
  baseProbs: Record<Outcome, number>; probs: Record<Outcome, number>;
}
export interface PipelineSnapshot {
  cutoff: number;
  elo: Record<string, number>;
  c1: C1State;
  predictions: ResearchPrediction[];
}

export const ELO_INIT = 1500, ELO_K = 20, ELO_HFA = 60, WINDOW_MS = 7 * 86400000;

export function eloExpected(rh: number, ra: number): number {
  return 1 / (1 + Math.pow(10, -(rh + ELO_HFA - ra) / 400));
}

// Margin-aware K (documented simple variant): gd>=3 x1.5, gd==2 x1.25.
export function eloUpdateStep(elo: Record<string, number>, home: string, away: string, hg: number, ag: number): Record<string, number> {
  const rh = elo[home] ?? ELO_INIT, ra = elo[away] ?? ELO_INIT;
  const e = eloExpected(rh, ra);
  const s = hg > ag ? 1 : hg === ag ? 0.5 : 0;
  const gd = Math.abs(hg - ag);
  const kEff = ELO_K * (gd >= 3 ? 1.5 : gd === 2 ? 1.25 : 1);
  const next = { ...elo };
  next[home] = rh + kEff * (s - e);
  next[away] = ra + kEff * ((1 - s) - (1 - e));
  return next;
}

// Market-anchored DC grid + small documented Elo tilt (10% of the
// Elo-home-expectation gap). Research blend, not production behaviour.
export function baseProbs(m: HistMatch, elo: Record<string, number>, rho: number): Record<Outcome, number> {
  const cal = calibrateLambda(m.h, m.d, m.a, rho, undefined);
  const sm = buildScoreMatrix(cal.lambdaH, cal.lambdaA, rho);
  const grid = outcomeProbs(sm.raw, sm.sum);
  const e = eloExpected(elo[m.home] ?? ELO_INIT, elo[m.away] ?? ELO_INIT);
  const tilt = 0.10 * (e - 0.5);
  const raw = { home: grid.home + tilt, draw: grid.draw, away: grid.away - tilt };
  const floored = { home: Math.max(0.02, raw.home), draw: Math.max(0.02, raw.draw), away: Math.max(0.02, raw.away) };
  const z = floored.home + floored.draw + floored.away;
  return { home: floored.home / z, draw: floored.draw / z, away: floored.away / z };
}

export function runResearchPipeline(matches: HistMatch[], cutoffs: number[], cfg: C1Config = C1_DEFAULTS, rho = -0.13): PipelineSnapshot[] {
  const sorted = [...matches].sort((x, y) => x.date - y.date || x.id.localeCompare(y.id));
  let elo: Record<string, number> = {};
  let c1: C1State = c1InitialState();
  const obs: C1Obs[] = [];
  const snaps: PipelineSnapshot[] = [];
  const ascending = [...cutoffs].sort((a, b) => a - b);
  let ci = 0;

  const snapshotAt = (t: number) => {
    const step = c1Evaluate(c1, obs, t, cfg, t);
    c1 = step.state;
    const predictions: ResearchPrediction[] = sorted
      .filter((x) => x.date > t && x.date <= t + WINDOW_MS)
      .map((x) => {
        const bp = baseProbs(x, elo, rho);
        return { matchId: x.id, date: x.date, baseProbs: bp, probs: applyC1Mult(bp, finalMultFor(c1, x.league)).probs };
      });
    snaps.push({ cutoff: t, elo: { ...elo }, c1, predictions });
  };

  for (const m of sorted) {
    while (ci < ascending.length && ascending[ci] < m.date) { snapshotAt(ascending[ci]); ci++; }
    const bp = baseProbs(m, elo, rho);
    const outcome: Outcome = m.hg > m.ag ? 'home' : m.hg === m.ag ? 'draw' : 'away';
    obs.push({ id: m.id, outcome, probs: bp, resolvedAt: m.date, league: m.league });
    elo = eloUpdateStep(elo, m.home, m.away, m.hg, m.ag);
  }
  while (ci < ascending.length) { snapshotAt(ascending[ci]); ci++; }
  return snaps;
}