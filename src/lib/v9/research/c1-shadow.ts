// ============================================================
// C1 shadow runner — RESEARCH ONLY. Replays the prospective
// ledger chronologically: each settled prediction is scored
// twice (frozen control probs vs C1-adjusted candidate probs),
// where the candidate's multipliers use ONLY outcomes resolved
// strictly earlier. Never touches production state or params.
// R9: paired per-match score differences (candidate - control)
// with normal-approx CIs, per protocol H2 reporting rules.
// ============================================================
import type { Outcome } from '../atlas-types';
import type { ProspectiveEvent } from '../evidence/prospective-ledger';
import { brier, evaluateModel, logLoss, rps } from './benchmark/metrics';
import type { ModelReport, ScoredMatch } from './benchmark/metrics';
import { C1_DEFAULTS, applyC1Mult, c1Evaluate, c1InitialState, finalMultFor } from './c1-recalibration';
import type { C1Config, C1Obs, C1State } from './c1-recalibration';

export interface ShadowRow {
  predictionId: string; date: number; league?: string;
  control: Record<Outcome, number>; candidate: Record<Outcome, number>;
  outcome: Outcome;
}

export interface PairedStat { n: number; mean: number; lo: number; hi: number; }

export interface ShadowResult {
  rows: ShadowRow[];
  control: ModelReport; candidate: ModelReport;
  state: C1State;
  paired: { brier: PairedStat; logLoss: PairedStat; rps: PairedStat };
}

function pairedStat(diffs: number[]): PairedStat {
  const n = diffs.length;
  if (!n) return { n: 0, mean: 0, lo: 0, hi: 0 };
  const mean = diffs.reduce((a, x) => a + x, 0) / n;
  const varr = diffs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, n - 1);
  const h = (1.96 * Math.sqrt(varr)) / Math.sqrt(n);
  return { n, mean, lo: mean - h, hi: mean + h };
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
    c1 = c1Evaluate(c1, obs, date, cfg, date).state;
  }
  const paired = {
    brier: pairedStat(rows.map((r) => brier(r.candidate, r.outcome) - brier(r.control, r.outcome))),
    logLoss: pairedStat(rows.map((r) => logLoss(r.candidate, r.outcome) - logLoss(r.control, r.outcome))),
    rps: pairedStat(rows.map((r) => rps(r.candidate, r.outcome) - rps(r.control, r.outcome))),
  };
  return { rows, control: evaluateModel('frozen-control', scoredC), candidate: evaluateModel('c1-shadow', scoredK), state: c1, paired };
}