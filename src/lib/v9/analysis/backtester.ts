// ============================================================
// Walk-forward calibration diagnostics + §F/§G OOS comparison
// v9.10 follow-up: robust odds parsing, per-model n, ROI/P&L.
// ============================================================
import type { Outcome } from '../atlas-types';
import type { PredictionRecord } from '../learning/bayesian-learning';
import { stripMargin } from '../math/calibration';
import { buildScoreMatrix, outcomeProbs } from '../math/dixon-coles';

export interface ReliabilityBin { lo: number; hi: number; model: number; actual: number; n: number; }
export interface CalibrationMetrics {
  n: number; brier: number; logLoss: number; accuracy: number;
  roi: number; pl: number; nBets: number;
  byOutcome: Record<Outcome, { n: number; accuracy: number }>;
  reliability: ReliabilityBin[];
}

type OddsTriple = { h: number; d: number; a: number } | null;
const ODDS_KEY: Record<Outcome, 'h' | 'd' | 'a'> = { home: 'h', draw: 'd', away: 'a' };

function readOdds(r: PredictionRecord): OddsTriple {
  const rec = r as PredictionRecord & {
    h?: unknown; d?: unknown; a?: unknown;
    odds?: { h?: unknown; d?: unknown; a?: unknown };
    oddsH?: unknown; oddsD?: unknown; oddsA?: unknown;
  };
  const num = (x: unknown): number => (typeof x === 'number' && isFinite(x) ? x : parseFloat(String(x ?? '')));
  const h = num(rec.h ?? rec.odds?.h ?? rec.oddsH);
  const d = num(rec.d ?? rec.odds?.d ?? rec.oddsD);
  const a = num(rec.a ?? rec.odds?.a ?? rec.oddsA);
  return h > 1 && d > 1 && a > 1 ? { h, d, a } : null;
}

const emptyMetrics = (): CalibrationMetrics => ({
  n: 0, brier: 0, logLoss: 0, accuracy: 0, roi: 0, pl: 0, nBets: 0,
  byOutcome: { home: { n: 0, accuracy: 0 }, draw: { n: 0, accuracy: 0 }, away: { n: 0, accuracy: 0 } },
  reliability: [],
});

export function evaluatePredictions(records: PredictionRecord[]): CalibrationMetrics {
  const resolved = records.filter((r) => r.result && r.probs);
  if (resolved.length < 5) return emptyMetrics();
  let brier = 0, logLoss = 0, hits = 0, pl = 0, nBets = 0;
  const byOut: Record<Outcome, { n: number; hits: number }> = {
    home: { n: 0, hits: 0 }, draw: { n: 0, hits: 0 }, away: { n: 0, hits: 0 },
  };
  const bins: ReliabilityBin[] = Array.from({ length: 5 }, (_, k) => ({
    lo: k * 0.2, hi: (k + 1) * 0.2, model: 0, actual: 0, n: 0,
  }));
  for (const r of resolved) {
    const actual = r.result!;
    const p = r.probs;
    for (const k of ['home', 'draw', 'away'] as Outcome[])
      brier += (p[k] - (k === actual ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(p[actual], 1e-9));
    if (r.pick === actual) hits++;
    byOut[actual].n++;
    if (r.pick === actual) byOut[actual].hits++;
    const o = readOdds(r);
    if (o) { nBets++; pl += r.pick === actual ? o[ODDS_KEY[r.pick]] - 1 : -1; }
    const pk = p[r.pick];
    const b = bins[Math.min(4, Math.floor(pk * 5))];
    b.model += pk; b.actual += r.pick === actual ? 1 : 0; b.n++;
  }
  const n = resolved.length;
  return {
    n, brier: brier / n, logLoss: logLoss / n, accuracy: hits / n,
    roi: nBets ? pl / nBets : 0, pl, nBets,
    byOutcome: {
      home: { n: byOut.home.n, accuracy: byOut.home.n ? byOut.home.hits / byOut.home.n : 0 },
      draw: { n: byOut.draw.n, accuracy: byOut.draw.n ? byOut.draw.hits / byOut.draw.n : 0 },
      away: { n: byOut.away.n, accuracy: byOut.away.n ? byOut.away.hits / byOut.away.n : 0 },
    },
    reliability: bins.map((b) => ({
      lo: b.lo, hi: b.hi, model: b.n ? b.model / b.n : 0, actual: b.n ? b.actual / b.n : 0, n: b.n,
    })),
  };
}

export interface ChronologicalSplit { train: PredictionRecord[]; val: PredictionRecord[]; test: PredictionRecord[]; }
export function splitChronologically(records: PredictionRecord[], trainPct = 0.6, valPct = 0.2): ChronologicalSplit {
  const n = records.length;
  const t1 = Math.floor(n * trainPct);
  const t2 = Math.floor(n * (trainPct + valPct));
  return { train: records.slice(0, t1), val: records.slice(t1, t2), test: records.slice(t2) };
}

interface EvalInput { p: Record<Outcome, number>; odds: OddsTriple; }

function metricsFor(records: PredictionRecord[], probFn: (r: PredictionRecord) => EvalInput | null): CalibrationMetrics {
  const resolved = records.filter((r) => r.result);
  if (resolved.length < 5) return emptyMetrics();
  let brier = 0, logLoss = 0, hits = 0, pl = 0, nBets = 0, valid = 0;
  const byOut: Record<Outcome, { n: number; hits: number }> = {
    home: { n: 0, hits: 0 }, draw: { n: 0, hits: 0 }, away: { n: 0, hits: 0 },
  };
  const bins: ReliabilityBin[] = Array.from({ length: 5 }, (_, k) => ({
    lo: k * 0.2, hi: (k + 1) * 0.2, model: 0, actual: 0, n: 0,
  }));
  for (const r of resolved) {
    const inp = probFn(r);
    if (!inp) continue;
    valid++;
    const actual = r.result!;
    const p = inp.p;
    for (const k of ['home', 'draw', 'away'] as Outcome[])
      brier += (p[k] - (k === actual ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(p[actual], 1e-9));
    const pick = (Object.entries(p) as [Outcome, number][]).sort((x, y) => y[1] - x[1])[0][0];
    const hit = pick === actual;
    if (hit) hits++;
    if (inp.odds) { nBets++; pl += hit ? inp.odds[ODDS_KEY[pick]] - 1 : -1; }
    byOut[actual].n++;
    if (hit) byOut[actual].hits++;
    const pk = p[pick];
    const b = bins[Math.min(4, Math.floor(pk * 5))];
    b.model += pk; b.actual += hit ? 1 : 0; b.n++;
  }
  if (!valid) return emptyMetrics();
  return {
    n: valid, brier: brier / valid, logLoss: logLoss / valid, accuracy: hits / valid,
    roi: nBets ? pl / nBets : 0, pl, nBets,
    byOutcome: {
      home: { n: byOut.home.n, accuracy: byOut.home.n ? byOut.home.hits / byOut.home.n : 0 },
      draw: { n: byOut.draw.n, accuracy: byOut.draw.n ? byOut.draw.hits / byOut.draw.n : 0 },
      away: { n: byOut.away.n, accuracy: byOut.away.n ? byOut.away.hits / byOut.away.n : 0 },
    },
    reliability: bins.map((b) => ({
      lo: b.lo, hi: b.hi, model: b.n ? b.model / b.n : 0, actual: b.n ? b.actual / b.n : 0, n: b.n,
    })),
  };
}

export function evaluateMarketBaseline(records: PredictionRecord[]): CalibrationMetrics {
  return metricsFor(records, (r) => {
    const o = readOdds(r);
    if (!o) return null;
    const { probs } = stripMargin(o.h, o.d, o.a);
    return { p: { home: probs[0], draw: probs[1], away: probs[2] }, odds: o };
  });
}

// Naive no-market baseline: fixed league-average lambdas, DC rho -0.13.
// Deliberately market-free; with equal lambdas its argmax is always 'home',
// so it acts as a home-base-rate strawman. Documented, not hidden.
const IND = outcomeProbs(...(() => { const s = buildScoreMatrix(1.35, 1.35, -0.13); return [s.raw, s.sum] as const; })());
export function evaluateIndependentModel(records: PredictionRecord[]): CalibrationMetrics {
  return metricsFor(records, (r) => ({ p: { home: IND.home, draw: IND.draw, away: IND.away }, odds: readOdds(r) }));
}

export function evaluateHybridModel(records: PredictionRecord[]): CalibrationMetrics {
  return metricsFor(records, (r) => (r.probs ? { p: r.probs, odds: readOdds(r) } : null));
}