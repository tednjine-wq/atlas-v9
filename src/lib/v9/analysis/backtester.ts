// ============================================================
// Walk-forward calibration diagnostics: Brier, log-loss,
// reliability bins, per-outcome accuracy. Powers CalibrationPanel.
// ============================================================
import type { Outcome } from '../atlas-types';
import type { PredictionRecord } from '../learning/bayesian-learning';

export interface ReliabilityBin { lo: number; hi: number; model: number; actual: number; n: number; }
export interface CalibrationMetrics {
  n: number; brier: number; logLoss: number; accuracy: number;
  byOutcome: Record<Outcome, { n: number; accuracy: number }>;
  reliability: ReliabilityBin[];
}

export function evaluatePredictions(records: PredictionRecord[]): CalibrationMetrics {
  const resolved = records.filter((r) => r.result && r.probs);
  const empty: CalibrationMetrics = {
    n: 0, brier: 0, logLoss: 0, accuracy: 0,
    byOutcome: { home: { n: 0, accuracy: 0 }, draw: { n: 0, accuracy: 0 }, away: { n: 0, accuracy: 0 } },
    reliability: [],
  };
  if (resolved.length < 5) return empty; // same 5-result minimum as learning

  let brier = 0, logLoss = 0, hits = 0;
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
    const pk = p[r.pick];
    const b = bins[Math.min(4, Math.floor(pk * 5))];
    b.model += pk; b.actual += r.pick === actual ? 1 : 0; b.n++;
  }

  const n = resolved.length;
  return {
    n,
    brier: brier / n,
    logLoss: logLoss / n,
    accuracy: hits / n,
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
