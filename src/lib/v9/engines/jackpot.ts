// ============================================================
// JACKPOT ENGINE v9.4 — parlay-max, rho = -0.08 (RULE 1)
// v9.4 EVIDENCE TUNE (364-game backtest): pick = argmax(dc)
// ALWAYS. SOF is now an INFORMATION FLAG only (tight-game badge
// + secondary pick); the v8.7 draw override cost ~12pts of hit
// rate and multiplicatively reduced ticket probability (§3.5).
// RULE 6 preserved: no learning adjustments, no decorr override.
// Confidence cap 72% preserved (§3.5).
// ============================================================
import { DC_RHO_JACKPOT, DC_RHO_STANDARD } from '../atlas-types';
import type { Match, Outcome, AtlasJackpotAnalysis, DecorrelationResult, Verdict } from '../atlas-types';
import { calibrateLambda, stripMargin } from '../math/calibration';
import { buildScoreMatrix, outcomeProbs } from '../math/dixon-coles';
import { adaptiveSimulate } from '../math/adaptive-mc';

export function atlasAnalyseJackpotV9(match: Match, phi = 0.10): AtlasJackpotAnalysis {
  const h = parseFloat(match.h), d = parseFloat(match.d), a = parseFloat(match.a);
  if (!(h > 1 && d > 1 && a > 1)) throw new Error('Invalid 1X2 odds');
  const { probs: bookProbs, margin } = stripMargin(h, d, a);
  const cal = calibrateLambda(h, d, a, DC_RHO_JACKPOT, match.prior);
  const { matrix, raw, sum } = buildScoreMatrix(cal.lambdaH, cal.lambdaA, DC_RHO_JACKPOT);
  const dc = outcomeProbs(raw, sum);

  const std = buildScoreMatrix(cal.lambdaH, cal.lambdaA, DC_RHO_STANDARD);
  const dcStd = outcomeProbs(std.raw, std.sum);
  const homeBias = dcStd.home - dc.home;
  const tightGame = Math.abs(dc.home - dc.away) < 0.08;

  const sorted = (Object.entries(dc) as [Outcome, number][]).sort((x, y) => y[1] - x[1]);
  // v9.4: parlay-optimal pick is the max-probability outcome, always
  const pick: Outcome = sorted[0][0];
  const secondaryPick: Outcome = sorted[1][0];
  // v9.4: SOF = information flag only (tight game / draw-shortest)
  const sofTriggered = Math.abs(dc.home - dc.away) < 0.06 || (d < h && d < a);

  const edges: Record<Outcome, number> = {
    home: dc.home - bookProbs[0], draw: dc.draw - bookProbs[1], away: dc.away - bookProbs[2],
  };
  const evs: Record<Outcome, number> = {
    home: dc.home * h - 1, draw: dc.draw * d - 1, away: dc.away * a - 1,
  };
  const spots = (Object.keys(edges) as Outcome[])
    .filter((o) => edges[o] > 0 && evs[o] > 0)
    .sort((x, y) => edges[y] - edges[x]);
  const maxEdge = Math.max(...Object.values(edges), 0);
  const skippedDecorrOverride = spots[0] && spots[0] !== pick && Math.min(100, maxEdge * 500) >= 15
    ? { wouldFlipTo: spots[0], evLost: evs[spots[0]] } : null;

  const sim = adaptiveSimulate(cal.lambdaH, cal.lambdaA, DC_RHO_JACKPOT, { gridProbs: dc, gridPick: pick });
  const confidence = Math.min(dc[pick], 0.72);

  const decorrelation: DecorrelationResult = {
    score: Math.min(100, maxEdge * 500),
    edges, evs, spotted: spots[0] ?? null, hasRealSpot: spots.length > 0, maxEdge,
  };

  const thresholdPass = Math.abs(dc[pick] - 0.5) >= phi;
  const verdict: Verdict = thresholdPass ? 'BET' : 'NO-BET';

  return {
    pick, confidence,
    probs: dc, dcProbs: dc,
    bookProbs: { home: bookProbs[0], draw: bookProbs[1], away: bookProbs[2] },
    margin, marginWarning: { level: 'none', msg: '' },
    calibration: cal, scoreMatrix: matrix, decorrelation, portfolio: [],
    sofTriggered, decorrOverride: false,
    thresholdPass, verdict, tightGame,
    sim, engine: 'jackpot',
    parlayScore: Math.log(Math.max(dc[pick], 1e-9)),
    upsetVulnerable: Math.abs(dc.home - dc.away) < 0.05,
    secondaryPick, secondaryProb: dc[secondaryPick],
    homeBias, skippedDecorrOverride,
  };
}
