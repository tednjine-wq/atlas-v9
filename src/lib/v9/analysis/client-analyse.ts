// ============================================================
// Client-side analysis text generator (export/copy path).
// Two separate code paths — jackpot NEVER applies learning
// adjustments or decorrelation overrides (Rule 6).
// ============================================================
import type { Match } from '../atlas-types';
import { DC_RHO_STANDARD, DC_RHO_JACKPOT } from '../atlas-types';
import { atlasAnalyseV9 } from '../engines/standard';
import { atlasAnalyseJackpotV9 } from '../engines/jackpot';
import { computeExtendedMarketsV9 } from '../markets/extended-markets';
import type { LearnedParams } from '../learning/bayesian-learning';

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function generateAnalysisText(
  match: Match, phi: number, standardParams: LearnedParams,
): string {
  const isJackpot = match.gameType === 'jackpot';
  const L: string[] = [];
  L.push(`ATLAS v9.0 ${isJackpot ? 'JACKPOT' : 'STANDARD'} ANALYSIS`);
  L.push(`${match.home || 'Home'} vs ${match.away || 'Away'} — ${match.league || 'Unknown league'}`);

  if (isJackpot) {
    const a = atlasAnalyseJackpotV9(match, phi);
    L.push('');
    L.push(`ENGINE: Jackpot | rho=${DC_RHO_JACKPOT} | Parlay-probability maximizing`);
    L.push('Decorrelation override: DISABLED (parlay purity) | Learning: DISABLED');
    L.push('');
    L.push(`VERDICT: ${a.pick.toUpperCase()} @ ${pct(a.confidence)} confidence`);
    L.push(`Parlay score (log p): ${a.parlayScore.toFixed(3)}`);
    if (a.upsetVulnerable)
      L.push(`UPSET VULNERABLE: |P(H)-P(A)| < 5% — consider secondary pick ${a.secondaryPick.toUpperCase()} (${pct(a.secondaryProb)})`);
    L.push(`Home bias (std-jp rho delta): ${pct(a.homeBias)}`);
    if (a.skippedDecorrOverride)
      L.push(`Skipped EV flip to ${a.skippedDecorrOverride.wouldFlipTo.toUpperCase()} (EV ${pct(a.skippedDecorrOverride.evLost)} sacrificed for parlay probability)`);
    L.push('');
    L.push(`PROBS: H ${pct(a.probs.home)} | D ${pct(a.probs.draw)} | A ${pct(a.probs.away)}`);
    L.push(`Threshold ${a.thresholdPass ? 'PASS' : 'FAIL'} (phi=${phi})`);
    return L.join('\n');
  }

  const a = atlasAnalyseV9(match, phi, standardParams);
  const ext = computeExtendedMarketsV9(
    a.scoreMatrix, a.calibration.lambdaH, a.calibration.lambdaA, DC_RHO_STANDARD, match.userOdds,
  );
  L.push('');
  L.push(`ENGINE: Standard | rho=${DC_RHO_STANDARD} | EV-maximizing`);
  L.push('Decorrelation: ON | SOF: ON | Learning: ON');
  L.push('');
  L.push(`CALIBRATION: lH=${a.calibration.lambdaH.toFixed(2)} lA=${a.calibration.lambdaA.toFixed(2)} (SSE ${a.calibration.sse.toExponential(2)}, source: ${a.calibration.hybrid.source})`);
  L.push(`Margin stripped: ${pct(a.margin)}`);
  L.push('');
  L.push(`VERDICT: ${a.pick.toUpperCase()} @ ${pct(a.confidence)} confidence${a.sofTriggered ? ' (SOF draw trigger)' : ''}${a.decorrOverride ? ' (decorrelation override)' : ''}`);
  L.push(`Threshold ${a.thresholdPass ? 'PASS' : 'FAIL'} (phi=${phi})`);
  L.push('');
  L.push(`PROBS (adjusted): H ${pct(a.probs.home)} | D ${pct(a.probs.draw)} | A ${pct(a.probs.away)}`);
  L.push(`BOOK:             H ${pct(a.bookProbs.home)} | D ${pct(a.bookProbs.draw)} | A ${pct(a.bookProbs.away)}`);
  L.push('');
  L.push(`DECORRELATION: score ${a.decorrelation.score.toFixed(0)}/100, max edge ${pct(a.decorrelation.maxEdge)}${a.decorrelation.spotted ? `, real spot: ${a.decorrelation.spotted.toUpperCase()}` : ''}`);
  const best = a.portfolio.find((p) => p.isMaxEp);
  if (best)
    L.push(`BEST BET: ${best.outcome.toUpperCase()} | EV ${pct(best.ev)} | Kelly ${pct(best.stake)} | Sharpe ${best.sharpe.toFixed(2)}`);
  L.push('');
  L.push(`KEY MARKETS: O2.5 ${pct(ext.pOver25)} | BTTS ${pct(ext.pBttsYes)} | 1X ${pct(ext.p1X)}`);
  L.push(`TOP SCORES: ${a.scoreMatrix.slice(0, 4).map((s) => `${s.s} (${pct(s.p)})`).join(', ')}`);
  if (ext.topEvBets.length)
    L.push(`TOP +EV: ${ext.topEvBets.map((b) => `${b.label} @${b.odds} EV ${pct(b.ev)}`).join(' | ')}`);
  if (a.sim)
    L.push(`MONTE CARLO (${a.sim.n.toLocaleString()} sims): disagreement ${a.sim.disagreement} | max delta ${pct(a.sim.maxDelta)} | conf x${a.sim.confMultiplier}`);
  L.push('');
  L.push(`KEY RISK: ${a.marginWarning.msg || 'No material warnings'}`);
  return L.join('\n');
}
