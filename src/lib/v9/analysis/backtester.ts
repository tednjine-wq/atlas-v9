// ============================================================
// Walk-forward calibration diagnostics: Brier, log-loss,
// reliability bins, per-outcome accuracy. Powers CalibrationPanel.
// v9.10 §F: Chronological splitting for walk-forward validation.
// v9.10 §G: Market baseline, independent model, hybrid model comparison.
// ============================================================
import type { Outcome } from '../atlas-types';
import type { PredictionRecord } from '../learning/bayesian-learning';
import { stripMargin } from '../math/calibration';
import { poisson } from '../math/poisson';

export interface ReliabilityBin { lo: number; hi: number; model: number; actual: number; n: number; }
export interface CalibrationMetrics {
  n: number; brier: number; logLoss: number; accuracy: number;
  byOutcome: Record<Outcome, { n: number; accuracy: number }>;
  reliability: ReliabilityBin[];
}

export function evaluatePredictions(records: PredictionRecord[]): CalibrationMetrics {
  return metricsFor(records, (r) => r.probs);
}

// §F: Chronological split (assumes input array is sorted by date)
export function splitChronologically(
  records: PredictionRecord[], 
  trainPct = 0.6, 
  valPct = 0.2
): { train: PredictionRecord[]; val: PredictionRecord[]; test: PredictionRecord[] } {
  const n = records.length;
  const t1 = Math.floor(n * trainPct);
  const t2 = Math.floor(n * (trainPct + valPct));
  return {
    train: records.slice(0, t1),
    val: records.slice(t1, t2),
    test: records.slice(t2),
  };
}

// Internal helper to compute metrics for any probability source
function metricsFor(
  records: PredictionRecord[], 
  probFn: (r: PredictionRecord) => Record<Outcome, number> | null
): CalibrationMetrics {
  const resolved = records.filter((r) => r.result);
  const empty: CalibrationMetrics = {
    n: 0, brier: 0, logLoss: 0, accuracy: 0,
    byOutcome: { home: { n: 0, accuracy: 0 }, draw: { n: 0, accuracy: 0 }, away: { n: 0, accuracy: 0 } },
    reliability: [],
  };
  if (resolved.length < 5) return empty;

  let brier = 0, logLoss = 0, hits = 0;
  const byOut: Record<Outcome, { n: number; hits: number }> = {
    home: { n: 0, hits: 0 }, draw: { n: 0, hits: 0 }, away: { n: 0, hits: 0 },
  };
  const bins: ReliabilityBin[] = Array.from({ length: 5 }, (_, k) => ({
    lo: k * 0.2, hi: (k + 1) * 0.2, model: 0, actual: 0, n: 0,
  }));

  let validCount = 0;
  for (const r of resolved) {
    const p = probFn(r);
    if (!p) continue;
    validCount++;
    const actual = r.result!;
    for (const k of ['home', 'draw', 'away'] as Outcome[])
      brier += (p[k] - (k === actual ? 1 : 0)) ** 2;
    logLoss += -Math.log(Math.max(p[actual], 1e-9));
    
    const pick = (Object.entries(p) as [Outcome, number][]).sort((a, b) => b[1] - a[1])[0][0];
    if (pick === actual) hits++;
    byOut[actual].n++;
    if (pick === actual) byOut[actual].hits++;
    
    const pk = p[pick];
    const b = bins[Math.min(4, Math.floor(pk * 5))];
    b.model += pk; b.actual += pick === actual ? 1 : 0; b.n++;
  }

  if (validCount === 0) return empty;

  return {
    n: validCount,
    brier: brier / validCount,
    logLoss: logLoss / validCount,
    accuracy: hits / validCount,
    byOutcome: {
      home: { n: byOut.home.n, accuracy: byOut.home.n ? byOut.home.hits / byOut.home.n : 0 },
      draw: { n: byOut.draw.n, accuracy: byOut.draw.n ? byOut.draw.hits / byOut.draw.n : 0 },
      away: { n: byOut.away.n, accuracy: byOut.away.n ? byOut.away.hits / byOut.away.n : 0 },
    },
    reliability: bins.map((b) => ({
      lo: b.lo, hi: b.hi,
      model: b.n ? b.model / b.n : 0,
      actual: b.n ? b.actual / b.n : 0,
      n: b.n,
    })),
  };
}

// §G: Market baseline (bookmaker implied probabilities, margin stripped)
export function evaluateMarketBaseline(records: PredictionRecord[]): CalibrationMetrics {
  return metricsFor(records, (r) => {
    const rec = r as PredictionRecord & { h?: number; d?: number; a?: number }; const h = rec.h, d = rec.d, a = rec.a;
    if (!(typeof h === 'number' && h > 1 && typeof d === 'number' && d > 1 && typeof a === 'number' && a > 1)) return null;
    const { probs } = stripMargin(h, d, a);
    return { home: probs[0], draw: probs[1], away: probs[2] };
  });
}

// §G: Independent model (pure Poisson, fixed league-average lambda, no market calibration)
export function evaluateIndependentModel(records: PredictionRecord[]): CalibrationMetrics {
  return metricsFor(records, () => {
    const lambda = 1.35; // Fixed league-average lambda
    let pH = 0, pD = 0, pA = 0;
    for (let i = 0; i < 10; i++) {
      const pi = poisson(i, lambda);
      for (let j = 0; j < 10; j++) {
        const p = pi * poisson(j, lambda);
        if (i > j) pH += p; else if (i === j) pD += p; else pA += p;
      }
    }
    return { home: pH, draw: pD, away: pA };
  });
}

// §G: Hybrid model (the current ATLAS calibrated approach)
export function evaluateHybridModel(records: PredictionRecord[]): CalibrationMetrics {
  return metricsFor(records, (r) => r.probs);
}