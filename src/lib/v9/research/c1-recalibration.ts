// ============================================================
// C1 evidence-weighted recalibration — RESEARCH ONLY.
// Isolated: no imports from engines, store, staking or learning.
// Pure + deterministic (no Date.now, no RNG). See A1-A7 notes.
// ============================================================
import type { Outcome } from '../atlas-types';

export const OUTCOMES: Outcome[] = ['home', 'draw', 'away'];

export interface C1Obs {
  id: string;
  outcome: Outcome;
  probs: Record<Outcome, number>;
  resolvedAt: number;
  league?: string;
  late?: boolean;
}

export interface C1Config {
  a0: number; mu: Record<Outcome, number>; n0: number;
  bounds: [number, number]; floor: number; tol: number;
  leagueN0: number; leagueCap: number; icc: number; clusterSize: number;
}

export const C1_DEFAULTS: C1Config = {
  a0: 25, mu: { home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, n0: 50,
  bounds: [0.9, 1.15], floor: 30, tol: 1e-9,
  leagueN0: 50, leagueCap: 50, icc: 0.05, clusterSize: 5,
};

export interface C1UpdateLog {
  at: number; cutoff: number; scope: string; n: number;
  duplicatesDropped: number; invalidDropped: number;
  counts: Record<Outcome, number>; sumPred: Record<Outcome, number>;
  posterior: Record<Outcome, number>; rawMult: Record<Outcome, number>;
  shrunkMult: Record<Outcome, number>; clippedMult: Record<Outcome, number>;
  applied: boolean; reason: string; version: number;
}

export interface C1State {
  version: number;
  mult: Record<Outcome, number>;
  leagueMult: Record<string, Record<Outcome, number>>;
  log: C1UpdateLog[];
}

export function c1InitialState(): C1State {
  return { version: 0, mult: { home: 1, draw: 1, away: 1 }, leagueMult: {}, log: [] };
}

const ones = (): Record<Outcome, number> => ({ home: 1, draw: 1, away: 1 });

function validObs(o: C1Obs): boolean {
  if (!o || typeof o.id !== 'string' || !o.id) return false;
  if (!Number.isFinite(o.resolvedAt)) return false;
  const p = o.probs;
  if (!p) return false;
  let s = 0;
  for (const k of OUTCOMES) {
    const v = p[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) return false;
    s += v;
  }
  return Math.abs(s - 1) < 1e-6;
}

export function eligibleObs(obs: C1Obs[], cutoff: number): { elig: C1Obs[]; duplicates: number; invalid: number } {
  const seen = new Set<string>();
  let duplicates = 0, invalid = 0;
  const elig: C1Obs[] = [];
  for (const o of obs) {
    if (!validObs(o)) { invalid++; continue; }
    if (o.late === true || o.resolvedAt > cutoff) continue;
    if (seen.has(o.id)) { duplicates++; continue; }
    seen.add(o.id);
    elig.push(o);
  }
  return { elig, duplicates, invalid };
}

interface MultResult {
  counts: Record<Outcome, number>; sumPred: Record<Outcome, number>;
  posterior: Record<Outcome, number>; rawMult: Record<Outcome, number>;
  shrunkMult: Record<Outcome, number>; clippedMult: Record<Outcome, number>;
  ok: boolean; reason: string;
}

function computeMults(elig: C1Obs[], cfg: C1Config, center: Record<Outcome, number>, nEff: number, n0: number): MultResult {
  const counts = { ...ones(), home: 0, draw: 0, away: 0 };
  const sumPred = { home: 0, draw: 0, away: 0 };
  for (const o of elig) { counts[o.outcome]++; for (const k of OUTCOMES) sumPred[k] += o.probs[k]; }
  const n = elig.length;
  const posterior = ones(), rawMult = { ...center }, shrunkMult = { ...center }, clippedMult = { ...center };
  if (n === 0) return { counts, sumPred, posterior, rawMult, shrunkMult, clippedMult, ok: false, reason: 'no eligible observations' };
  const w = nEff / (nEff + n0);
  let ok = true, reason = '';
  for (const k of OUTCOMES) {
    const meanPred = sumPred[k] / n;
    const f = (counts[k] + cfg.a0 * cfg.mu[k]) / (n + cfg.a0);
    posterior[k] = f;
    if (!(meanPred > 0) || !Number.isFinite(meanPred) || !Number.isFinite(f)) {
      ok = false; reason = reason || `invalid denominator for ${k}`; continue;
    }
    const mstar = f / meanPred;
    const shrunk = center[k] + w * (mstar - center[k]);
    rawMult[k] = mstar; shrunkMult[k] = shrunk;
    clippedMult[k] = Math.min(cfg.bounds[1], Math.max(cfg.bounds[0], shrunk));
  }
  return { counts, sumPred, posterior, rawMult, shrunkMult, clippedMult, ok, reason };
}

export function c1Evaluate(state: C1State, obs: C1Obs[], cutoff: number, cfg: C1Config, at: number): { state: C1State; entry: C1UpdateLog } {
  const { elig, duplicates, invalid } = eligibleObs(obs, cutoff);
  const n = elig.length;
  const g = computeMults(elig, cfg, ones(), n, cfg.n0);
  let applied = false, reason = g.reason, newMult = state.mult, version = state.version;
  if (g.ok && n >= cfg.floor) {
    const material = OUTCOMES.some((k) => Math.abs(g.clippedMult[k] - state.mult[k]) > cfg.tol);
    if (material) { newMult = { ...g.clippedMult }; applied = true; version = state.version + 1; }
    else reason = 'change within tolerance';
  } else if (g.ok) reason = `below evidence floor (${n} < ${cfg.floor})`;
  const entry: C1UpdateLog = {
    at, cutoff, scope: 'global', n, duplicatesDropped: duplicates, invalidDropped: invalid,
    counts: g.counts, sumPred: g.sumPred, posterior: g.posterior,
    rawMult: g.rawMult, shrunkMult: g.shrunkMult, clippedMult: g.clippedMult,
    applied, reason, version,
  };
  const leagueMult = { ...state.leagueMult };
  const extra: C1UpdateLog[] = [];
  const leagues = Array.from(new Set(elig.map((o) => o.league ?? 'unknown')));
  for (const lg of leagues) {
    const lObs = elig.filter((o) => (o.league ?? 'unknown') === lg);
    const nEff = Math.min(cfg.leagueCap, lObs.length / (1 + (cfg.clusterSize - 1) * cfg.icc));
    const l = computeMults(lObs, cfg, newMult, nEff, cfg.leagueN0);
    const prev = leagueMult[lg] ?? { ...newMult };
    let lm = prev, lApplied = false, lReason = l.reason;
    if (l.ok && lObs.length >= cfg.floor) {
      if (OUTCOMES.some((k) => Math.abs(l.clippedMult[k] - prev[k]) > cfg.tol)) { lm = { ...l.clippedMult }; lApplied = true; }
      else lReason = 'change within tolerance';
    } else if (l.ok) lReason = `below evidence floor (${lObs.length} < ${cfg.floor})`;
    leagueMult[lg] = lm;
    extra.push({ at, cutoff, scope: lg, n: lObs.length, duplicatesDropped: 0, invalidDropped: 0, counts: l.counts, sumPred: l.sumPred, posterior: l.posterior, rawMult: l.rawMult, shrunkMult: l.shrunkMult, clippedMult: l.clippedMult, applied: lApplied, reason: lReason, version });
  }
  return { state: { version, mult: newMult, leagueMult, log: [...state.log, entry, ...extra] }, entry };
}

// League multipliers are shrunk toward the global multiplier, so they
// REPLACE (not multiply) the global multiplier when present.
export function finalMultFor(state: C1State, league?: string): Record<Outcome, number> {
  return league && state.leagueMult[league] ? state.leagueMult[league] : state.mult;
}

export function applyC1Mult(probs: Record<Outcome, number>, mult: Record<Outcome, number>): { probs: Record<Outcome, number>; z: number } {
  const out = { home: 0, draw: 0, away: 0 };
  let z = 0;
  for (const k of OUTCOMES) { out[k] = probs[k] * mult[k]; z += out[k]; }
  if (!(z > 0) || !Number.isFinite(z)) return { probs: { ...probs }, z: 0 };
  for (const k of OUTCOMES) out[k] /= z;
  return { probs: out, z };
}