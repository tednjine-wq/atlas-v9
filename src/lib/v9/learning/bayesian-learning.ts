// ============================================================
// Bayesian Learning Engine v9.1 — adds CLV capture fields.
// Outcome-specific Beta posteriors + exponential time decay.
// RULES: split sets, PARAMS_VERSION=4, min 5 resolved,
// jackpot never receives adjustments (Rule 6).
// ============================================================
import { PARAMS_VERSION, MIN_RECALIBRATION_RESULTS } from '../atlas-types';
import type { Outcome, GameType } from '../atlas-types';

export interface PredictionRecord {
  id: string; matchId: string; gameType: GameType;
  pick: Outcome; confidence: number; probs: Record<Outcome, number>;
  sofTriggered: boolean; margin: number; timestamp: number;
  entryOdds?: Record<Outcome, number>;  // v9.1: odds at prediction time
  closingOdds?: number;                 // v9.1: odds when result logged
  clv?: number;                         // v9.1: entry/closing - 1 on pick
  result?: Outcome; resolvedAt?: number;
}

interface BetaParams { alpha: number; beta: number; }

export interface LearnedParams {
  version: number;
  totalPredictions: number;
  totalResolved: number;
  posteriors: Record<Outcome, BetaParams>;
  drawBoost: number;
  sofThreshold: number;
  rhoAdjust: number;
  upsetWeight: number;
  hitRates: Record<Outcome, number> & { overall: number };
  recentHitRate: number;
  trend: 'improving' | 'declining' | 'stable';
  leagueDrawBoost: Record<string, number>;
  leagueUpsetFreq: Record<string, number>;
}

const DECAY = 0.06;

export const defaultParams = (): LearnedParams => ({
  version: PARAMS_VERSION, totalPredictions: 0, totalResolved: 0,
  posteriors: {
    home: { alpha: 1, beta: 1 }, draw: { alpha: 1, beta: 1 }, away: { alpha: 1, beta: 1 },
  },
  drawBoost: 0, sofThreshold: 0.08, rhoAdjust: 0, upsetWeight: 0,
  hitRates: { home: 0, draw: 0, away: 0, overall: 0 },
  recentHitRate: 0, trend: 'stable', leagueDrawBoost: {}, leagueUpsetFreq: {},
});

export function recalibrate(
  params: LearnedParams, predictions: PredictionRecord[], gameType: GameType,
): { params: LearnedParams; message: string } {
  const resolved = predictions
    .filter((p) => p.gameType === gameType && p.result !== undefined)
    .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));

  if (resolved.length < MIN_RECALIBRATION_RESULTS)
    return { params, message: `Insufficient data: ${resolved.length}/${MIN_RECALIBRATION_RESULTS} resolved` };

  const fresh = defaultParams();
  fresh.totalPredictions = predictions.filter((p) => p.gameType === gameType).length;
  fresh.totalResolved = resolved.length;
  fresh.leagueDrawBoost = { ...params.leagueDrawBoost };
  fresh.leagueUpsetFreq = { ...params.leagueUpsetFreq };

  let hits = 0;
  const outcomeHits: Record<Outcome, number> = { home: 0, draw: 0, away: 0 };
  const outcomeSeen: Record<Outcome, number> = { home: 0, draw: 0, away: 0 };

  resolved.forEach((p, idx) => {
    const age = resolved.length - 1 - idx;
    const w = Math.exp(-DECAY * age);
    const actual = p.result!;
    const hit = p.pick === actual;
    if (hit) { hits++; fresh.posteriors[actual].alpha += w; }
    else fresh.posteriors[p.pick].beta += w;
    outcomeSeen[actual]++;
    if (hit) outcomeHits[actual]++;
  });

  const drawPost = fresh.posteriors.draw;
  const drawSurprise = drawPost.alpha / (drawPost.alpha + drawPost.beta) - 0.30;
  fresh.drawBoost = Math.min(Math.max(drawSurprise, 0) * 0.25, 0.04);

  const awayPost = fresh.posteriors.away;
  const upsetSurprise = awayPost.alpha / (awayPost.alpha + awayPost.beta) - 0.28;
  fresh.upsetWeight = Math.min(Math.max(upsetSurprise, 0) * 0.2, 0.03);

  const sofPicks = resolved.filter((p) => p.sofTriggered);
  if (sofPicks.length >= 5) {
    const sofHit = sofPicks.filter((p) => p.pick === p.result).length / sofPicks.length;
    fresh.sofThreshold = Math.min(Math.max(0.08 - (sofHit - 0.5) * 0.02, 0.05), 0.12);
  } else fresh.sofThreshold = params.sofThreshold;

  const tight = resolved.filter((p) => p.margin < 0.15);
  if (tight.length >= 5) {
    const tightHit = tight.filter((p) => p.pick === p.result).length / tight.length;
    fresh.rhoAdjust = tightHit < 0.3 ? -0.01 : tightHit > 0.5 ? 0.01 : 0;
  }

  fresh.hitRates = {
    home: outcomeSeen.home ? outcomeHits.home / outcomeSeen.home : 0,
    draw: outcomeSeen.draw ? outcomeHits.draw / outcomeSeen.draw : 0,
    away: outcomeSeen.away ? outcomeHits.away / outcomeSeen.away : 0,
    overall: hits / resolved.length,
  };
  const recent = resolved.slice(-Math.min(50, resolved.length));
  fresh.recentHitRate = recent.filter((p) => p.pick === p.result).length / recent.length;
  const older = resolved.slice(0, Math.max(0, resolved.length - 50));
  const olderRate = older.length
    ? older.filter((p) => p.pick === p.result).length / older.length : fresh.recentHitRate;
  fresh.trend = fresh.recentHitRate > olderRate + 0.03 ? 'improving'
    : fresh.recentHitRate < olderRate - 0.03 ? 'declining' : 'stable';

  return { params: fresh, message: `Recalibration evaluated on (no-op: production Jackpot engine frozen under Rule 6) ${resolved.length} results (beta-binomial, decay=${DECAY})` };
}

export function applyLearnedAdjustments(
  dcH: number, dcD: number, dcA: number,
  league: string, params: LearnedParams, simConfMultiplier = 1.0,
): [number, number, number] {
  let h = dcH, d = dcD, a = dcA;
  const boost = params.drawBoost + (params.leagueDrawBoost[league] ?? 0);
  if (boost > 0) { d += boost; const f = boost / (h + a); h -= h * f; a -= a * f; }
  const uw = params.upsetWeight;
  if (uw > 0) { a += uw; const f = uw / (h + d); h -= h * f; d -= d * f; }
  const s = h + d + a; h /= s; d /= s; a /= s;
  if (simConfMultiplier !== 1.0) {
    const U = 1 / 3;
    h = U + (h - U) * simConfMultiplier;
    d = U + (d - U) * simConfMultiplier;
    a = U + (a - U) * simConfMultiplier;
  }
  return [h, d, a];
}
