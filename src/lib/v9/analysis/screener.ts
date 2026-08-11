// ============================================================
// Fixture Screener v9.2 — ranks a 240-game card into "better games".
// Quality score 0-100 from margin sharpness, confidence, +EV spots,
// MC agreement, and margin-asymmetry penalties. Auto-builds a
// jackpot ticket (league-capped) and a standard +EV slate.
// ============================================================
import type { AtlasAnalysis, AtlasJackpotAnalysis } from '../atlas-types';

export interface FixtureQuality {
  score: number;
  reasons: string[];
  legProb: number;
  maxEV: number;
}

export function qualityStandard(a: AtlasAnalysis): FixtureQuality {
  let s = 50;
  const reasons: string[] = [];
  if (a.margin <= 0.05) { s += 15; reasons.push('sharp margin'); }
  else if (a.margin <= 0.07) { s += 10; reasons.push('good margin'); }
  else if (a.margin <= 0.09) { s += 5; }
  else { s -= 10; reasons.push('high margin'); }

  if (a.confidence >= 0.65) { s += 15; reasons.push('strong conf'); }
  else if (a.confidence >= 0.58) { s += 10; }
  else if (!a.thresholdPass) { s -= 15; reasons.push('below φ'); }

  const maxEV = Math.max(...a.portfolio.map((p) => p.ev));
  if (maxEV > 0) { s += Math.min(20, maxEV * 300); reasons.push('+EV spot'); }

  const dis = a.sim?.disagreement;
  if (dis === 'none') s += 5; else if (dis === 'low') s += 2;
  else if (dis === 'medium') s -= 5; else if (dis === 'high') { s -= 15; reasons.push('MC disagree'); }

  if (a.marginWarning.level === 'severe') { s -= 20; reasons.push('avoid: extreme fav'); }
  else if (a.marginWarning.level === 'high') s -= 10;
  if (a.verdict === 'BET') { s += 5; reasons.push('BET signal'); }

  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons, legProb: a.probs[a.pick], maxEV };
}

export function qualityJackpot(a: AtlasJackpotAnalysis): FixtureQuality {
  let s = Math.round(a.confidence * 100);
  const reasons: string[] = [];
  if (a.confidence >= 0.70) { s += 10; reasons.push('solid leg'); }
  if (a.upsetVulnerable) { s -= 20; reasons.push('upset-vulnerable'); }
  if (a.marginWarning.level === 'severe') { s -= 15; reasons.push('extreme fav'); }
  if (a.sim?.disagreement === 'high') { s -= 10; reasons.push('MC disagree'); }
  if (a.margin <= 0.06) { s += 5; reasons.push('sharp margin'); }
  return { score: Math.max(0, Math.min(100, Math.round(s))), reasons, legProb: a.probs[a.pick], maxEV: 0 };
}

export interface TicketRow { id: string; league: string; q: FixtureQuality; }

// Jackpot ticket: greedy by leg probability, max 2 legs per league
export function buildJackpotTicket(rows: TicketRow[], maxLegs = 8, maxPerLeague = 2): string[] {
  const leagueCount = new Map<string, number>();
  const ids: string[] = [];
  for (const r of [...rows].sort((a, b) => b.q.legProb - a.q.legProb)) {
    if (ids.length >= maxLegs) break;
    const lg = r.league || 'unknown';
    if ((leagueCount.get(lg) ?? 0) >= maxPerLeague) continue;
    leagueCount.set(lg, (leagueCount.get(lg) ?? 0) + 1);
    ids.push(r.id);
  }
  return ids;
}

// Standard slate: top +EV, quality-filtered
export function buildStandardSlate(rows: TicketRow[], maxPicks = 5): string[] {
  return [...rows]
    .filter((r) => r.q.maxEV > 0 && r.q.score >= 55)
    .sort((a, b) => b.q.maxEV - a.q.maxEV || b.q.score - a.q.score)
    .slice(0, maxPicks)
    .map((r) => r.id);
}
