// ============================================================
// STANDARD ENGINE v9.10 — EV-maximizing, rho = -0.13 (RULE 1)
// v9.10 review: §D confidence from final probs, §A φ as EV gate.
// v9.7: multi-market WLS guarded by cross-market consistency gates.
// ============================================================
import { DC_RHO_STANDARD } from '../atlas-types';
import type {
  Match, Outcome, AtlasAnalysis, MarginWarning, PortfolioOutcome, DecorrelationResult, Verdict,
} from '../atlas-types';
import { calibrateLambda, calibrateLambdaMultiMarket, stripMargin } from '../math/calibration';
import type { ExtraMarketProbs } from '../math/calibration';
import { buildScoreMatrix, outcomeProbs } from '../math/dixon-coles';
import { adaptiveSimulate } from '../math/adaptive-mc';
import { htftCopulaJoint } from '../math/copula';
import { applyLearnedAdjustments, defaultParams } from '../learning/bayesian-learning';
import type { LearnedParams } from '../learning/bayesian-learning';

function marginWarning(minOdds: number): MarginWarning {
  if (minOdds < 1.25) return { level: 'severe', msg: 'Extreme favorite — bookmaker margin asymmetry severe. Avoid.' };
  if (minOdds < 1.45) return { level: 'high', msg: 'Heavy favorite — elevated bookmaker edge on short side.' };
  if (minOdds < 1.65) return { level: 'moderate', msg: 'Moderate favorite — slightly elevated margin.' };
  return { level: 'none', msg: '' };
}

interface RefProbs { p1X: number; pX2: number; o15: number; o25: number; btts: number; }

function extraTargets(u: Record<string, number>, ref: RefProbs): ExtraMarketProbs {
  const imp = (o: number) => (o > 1 ? 1 / o : 0);
  const x: ExtraMarketProbs = { count: 0 };
  const close = (v: number, r: number, tol: number) => Math.abs(v - r) <= tol;
  const i1X = imp(u.dc1X), iX2 = imp(u.dcX2), i12 = imp(u.dc12);
  const sDC = i1X + iX2 + i12;
  if (sDC > 0 && i1X && iX2) {
    const p1X = (2 * i1X) / sDC, pX2 = (2 * iX2) / sDC;
    if (close(p1X, ref.p1X, 0.15) && close(pX2, ref.pX2, 0.15)) { x.p1X = p1X; x.pX2 = pX2; x.count += 2; }
  }
  const iO = imp(u.over25), iU = imp(u.under25);
  if (iO && iU) { const p = iO / (iO + iU); if (close(p, ref.o25, 0.25)) { x.pO25 = p; x.count++; } }
  const iO15 = imp(u.over15), iU15 = imp(u.under15);
  if (iO15 && iU15) { const p = iO15 / (iO15 + iU15); if (close(p, ref.o15, 0.25)) { x.pO15 = p; x.count++; } }
  const iY = imp(u.bttsYes), iN = imp(u.bttsNo);
  if (iY && iN) { const p = iY / (iY + iN); if (close(p, ref.btts, 0.25)) { x.pBTTS = p; x.count++; } }
  return x;
}

export function atlasAnalyseV9(
  match: Match, phi = 0.10, learnedParams: LearnedParams = defaultParams(),
): AtlasAnalysis {
  const h = parseFloat(match.h), d = parseFloat(match.d), a = parseFloat(match.a);
  if (!(h > 1 && d > 1 && a > 1)) throw new Error('Invalid 1X2 odds');

  const { probs: bookProbs, margin } = stripMargin(h, d, a);

  const baseCal = calibrateLambda(h, d, a, DC_RHO_STANDARD, match.prior);
  const smRef = buildScoreMatrix(baseCal.lambdaH, baseCal.lambdaA, DC_RHO_STANDARD);
  const pRef = outcomeProbs(smRef.raw, smRef.sum, smRef.size);
  let le1 = 0, le2 = 0, bt = 0;
  for (const e of smRef.matrix) {
    const t = e.i + e.j;
    if (t <= 1) le1 += e.p;
    if (t <= 2) le2 += e.p;
    if (e.i > 0 && e.j > 0) bt += e.p;
  }
  const ref: RefProbs = {
    p1X: pRef.home + pRef.draw, pX2: pRef.draw + pRef.away,
    o15: 1 - le1, o25: 1 - le2, btts: bt,
  };
  const extra = extraTargets(match.userOdds, ref);
  const cal = extra.count >= 3
    ? calibrateLambdaMultiMarket(h, d, a, DC_RHO_STANDARD, extra, match.prior)
    : baseCal;
  const rho = DC_RHO_STANDARD + learnedParams.rhoAdjust;

  const sm = buildScoreMatrix(cal.lambdaH, cal.lambdaA, rho);
  const dc = outcomeProbs(sm.raw, sm.sum, sm.size);

  const tightGame = Math.abs(dc.home - dc.away) < 0.08;

  let pick: Outcome = (Object.entries(dc) as [Outcome, number][]).sort((x, y) => y[1] - x[1])[0][0];
  let confidence = dc[pick];

  const sofT = learnedParams.sofThreshold;
  const sofPrimary = Math.abs(dc.home - dc.away) < sofT;
  const sofSecondary = Math.abs(dc.home - dc.draw) < 0.03 || Math.abs(dc.draw - dc.away) < 0.03;
  const drawShortest = d < h && d < a;
  const sofTriggered = sofPrimary || sofSecondary || drawShortest;
  if (sofTriggered) {
    pick = 'draw';
    confidence = dc.draw;
  }

  const edges: Record<Outcome, number> = {
    home: dc.home - bookProbs[0], draw: dc.draw - bookProbs[1], away: dc.away - bookProbs[2],
  };
  const oddsMap: Record<Outcome, number> = { home: h, draw: d, away: a };
  const evs: Record<Outcome, number> = {
    home: dc.home * h - 1, draw: dc.draw * d - 1, away: dc.away * a - 1,
  };
  const spots = (Object.keys(edges) as Outcome[]).filter((o) => edges[o] > 0 && evs[o] > 0);
  const spotted = spots.sort((x, y) => edges[y] - edges[x])[0] ?? null;
  const maxEdge = Math.max(...Object.values(edges), 0);
  const decorrelation: DecorrelationResult = {
    score: Math.min(100, maxEdge * 500), edges, evs, spotted,
    hasRealSpot: !!spotted, maxEdge,
  };
  let decorrOverride = false;
  if (spotted && spotted !== pick && decorrelation.score >= 15 && edges[spotted] > 0.04 && evs[spotted] > 0.03) {
    pick = spotted; decorrOverride = true;
    confidence = dc[pick];
  }
  confidence = Math.min(confidence, 0.78);

  const sim = adaptiveSimulate(cal.lambdaH, cal.lambdaA, DC_RHO_STANDARD, {
    gridProbs: dc, gridPick: pick,
  });

  const [fh, fd, fa] = applyLearnedAdjustments(
    dc.home, dc.draw, dc.away, match.league, learnedParams, sim.confMultiplier,
  );
  const probs: Record<Outcome, number> = { home: fh, draw: fd, away: fa };

  // §D FIX: recompute confidence from final post-learning probabilities
  confidence = Math.min(probs[pick], 0.78);

  const portfolio: PortfolioOutcome[] = (['home', 'draw', 'away'] as Outcome[]).map((o) => {
    const ev = probs[o] * oddsMap[o] - 1;
    const variance = (1 - probs[o]) * probs[o] * oddsMap[o] ** 2;
    const kelly = ev > 0 ? Math.min(ev / (oddsMap[o] - 1), 0.25) : 0;
    return { outcome: o, stake: kelly, ev, sharpe: variance > 0 ? ev / Math.sqrt(variance) : 0,
             kelly, isMaxEp: false, varPerUnit: variance };
  });
  const best = portfolio.filter((p) => p.ev > 0).sort((x, y) => y.ev - x.ev)[0];
  if (best) best.isMaxEp = true;

  const htft = htftCopulaJoint(cal.lambdaH, cal.lambdaA, DC_RHO_STANDARD);

  // §A FIX: φ gates on EV (fraction), not |p - 0.5|
  const bestEv = Math.max(...portfolio.map((p) => p.ev));
  const thresholdPass = bestEv >= phi;
  const verdict: Verdict = thresholdPass ? 'BET' : 'NO-BET';

  return {
    pick, confidence, probs, dcProbs: dc,
    bookProbs: { home: bookProbs[0], draw: bookProbs[1], away: bookProbs[2] },
    margin, marginWarning: marginWarning(Math.min(h, d, a)),
    calibration: cal, scoreMatrix: sm.matrix, decorrelation, portfolio,
    sofTriggered, decorrOverride, thresholdPass, verdict, tightGame,
    sim, htft, engine: 'standard',
  };
}