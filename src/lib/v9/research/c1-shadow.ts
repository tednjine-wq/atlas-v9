// ============================================================
// C1 shadow runner — RESEARCH ONLY. Replays the prospective
// ledger chronologically: each settled prediction is scored
// twice (frozen control probs vs C1-adjusted candidate probs),
// where the candidate's multipliers use ONLY outcomes resolved
// strictly earlier. Never touches production state or params.
// ============================================================
import type { Outcome } from '../atlas-types';
import type { ProspectiveEvent } from '../evidence/prospective-ledger';
import { evaluateModel } from './benchmark/metrics';
import type { ModelReport, ScoredMatch } from './benchmark/metrics';
import { C1_DEFAULTS, applyC1Mult, c1Evaluate, c1InitialState, finalMultFor } from './c1-recalibration';
import type { C1Config, C1Obs, C1State } from './c1-recalibration';

export interface ShadowRow {
  predictionId: string; date: number; league?: string;
  control: Record<Outcome, number>; candidate: Record<Outcome, number>;
  outcome: Outcome;
}

export interface ShadowResult {
  rows: ShadowRow[];
  control: ModelReport; candidate: ModelReport;
  state: C1State;
}

export function runShadow(events: ProspectiveEvent[], cfg: C1Config = C1_DEFAULTS): ShadowResult {
  const preds = new Map<string, ProspectiveEvent>();
  for (const e of events) if ((e.type === 'prediction' || e.type === 'backfill') && e.predictionId && e.probs) preds.set(e.predictionId, e);
  const settled = events
    .filter((e) => e.type === 'settlement' && e.result && e.predictionId && preds.has(e.predictionId))
    .sort((a, b) => (a.resolvedAt ?? a.at) - (b.resolvedAt ?? b.at));

  let c1: C1State = c1InitialState();
  const obs: C1Obs[] = [];
  const scoredC: ScoredMatch[] = [], scoredK: ScoredMatch[] = [];
  const rows: ShadowRow[] = [];

  for (const e of settled) {
    const p = preds.get(e.predictionId!)!;
    const date = e.resolvedAt ?? e.at;
    const cand = applyC1Mult(p.probs!, finalMultFor(c1, p.league ?? undefined)).probs;
    rows.push({ predictionId: e.predictionId!, date, league: p.league ?? undefined, control: p.probs!, candidate: cand, outcome: e.result! });
    scoredC.push({ id: e.predictionId!, date, probs: p.probs!, outcome: e.result! });
    scoredK.push({ id: e.predictionId!, date, probs: cand, outcome: e.result! });
    obs.push({ id: e.predictionId!, outcome: e.result!, probs: p.probs!, resolvedAt: date, league: p.league ?? undefined });
    c1 = c1Evaluate(c1, obs, date, cfg, date).state; // applies only at/above floor, per spec
  }
  return { rows, control: evaluateModel('frozen-control', scoredC), candidate: evaluateModel('c1-shadow', scoredK), state: c1 };
}