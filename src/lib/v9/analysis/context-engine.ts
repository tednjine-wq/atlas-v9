// ============================================================
// Real-World Context engine — tier 1 (free, offline, rule-based).
// Derives narrative sentences from the model itself, exactly like
// v8.4's "Heavy mismatch — strong favorite expected to dominate".
// Tier 2 (LLM) lives in /api/ai-context and feeds match.prior.
// ============================================================
import type { AtlasAnalysis } from '../atlas-types';

export interface ContextLine { text: string; tone: 'info' | 'warn' | 'good'; }

export function buildRuleNarrative(a: AtlasAnalysis): ContextLine[] {
  const lines: ContextLine[] = [];
  const { home, draw, away } = a.dcProbs;
  const gap = Math.abs(home - away);
  const maxP = Math.max(home, draw, away);

  // matchup shape
  if (maxP > 0.60 && gap > 0.30)
    lines.push({ text: 'Heavy mismatch — strong favorite expected to dominate', tone: 'info' });
  else if (maxP > 0.52)
    lines.push({ text: 'Clear favorite — but the opposition is capable of an upset', tone: 'info' });
  else if (gap < 0.08)
    lines.push({ text: 'Evenly matched — coin-flip territory, the draw is very live', tone: 'warn' });
  else
    lines.push({ text: 'Competitive fixture — narrow edge to the favorite', tone: 'info' });

  // scoring tempo from calibrated lambdas
  const xg = a.calibration.lambdaH + a.calibration.lambdaA;
  if (xg > 3.2)
    lines.push({ text: `Open game expected (xG total ${xg.toFixed(2)}) — over profile`, tone: 'good' });
  else if (xg < 2.2)
    lines.push({ text: `Tight, low-scoring affair expected (xG total ${xg.toFixed(2)}) — under profile`, tone: 'info' });
  else
    lines.push({ text: `Moderate scoring tempo expected (xG total ${xg.toFixed(2)})`, tone: 'info' });

  // draw proneness
  if (draw > 0.29)
    lines.push({ text: 'Draw-prone profile — a low-scoring stalemate is a realistic outcome', tone: 'warn' });
  if (a.sofTriggered)
    lines.push({ text: 'SOF v4 active — statistical profile flags the draw', tone: 'warn' });

  // BTTS profile from the DC-corrected matrix (audit-safe, not independence)
  let btts = 0;
  for (const e of a.scoreMatrix) if (e.i > 0 && e.j > 0) btts += e.p;
  if (btts > 0.60)
    lines.push({ text: `Both teams likely to score (${(btts * 100).toFixed(0)}%)`, tone: 'good' });
  else if (btts < 0.42)
    lines.push({ text: `At least one blanking likely (BTTS only ${(btts * 100).toFixed(0)}%)`, tone: 'info' });

  // bookmaker margin commentary
  if (a.marginWarning.msg)
    lines.push({ text: a.marginWarning.msg, tone: 'warn' });

  return lines;
}
