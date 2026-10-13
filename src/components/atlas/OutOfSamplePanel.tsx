'use client';
import { useMemo } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import {
  splitChronologically,
  evaluateMarketBaseline,
  evaluateIndependentModel,
  evaluateHybridModel,
} from '@/lib/v9/analysis/backtester';
import type { CalibrationMetrics } from '@/lib/v9/analysis/backtester';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

function Row({ label, m, color }: { label: string; m: CalibrationMetrics; color: string }) {
  return (
    <tr className="border-b border-zinc-800">
      <td className={`py-2 font-bold ${color}`}>{label}</td>
      <td className="py-2 text-center tabular-nums">{m.brier.toFixed(3)}</td>
      <td className="py-2 text-center tabular-nums">{m.logLoss.toFixed(3)}</td>
      <td className="py-2 text-center tabular-nums">{fmtPct(m.accuracy)}</td>
    </tr>
  );
}

export default function OutOfSamplePanel() {
  const predictions = useAtlasStore((s) => s.predictions);

  const results = useMemo(() => {
    const sorted = [...predictions].sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length < 30) return null;

    const { test } = splitChronologically(sorted, 0.6, 0.2);
    if (test.length < 5) return null;

    const market = evaluateMarketBaseline(test);
    const independent = evaluateIndependentModel(test);
    const hybrid = evaluateHybridModel(test);

    const dates = {
      start: new Date(test[0].timestamp).toLocaleDateString(),
      end: new Date(test[test.length - 1].timestamp).toLocaleDateString(),
    };

    return { market, independent, hybrid, n: test.length, dates };
  }, [predictions]);

  if (!results) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 text-xs text-zinc-500">
        Out-of-Sample Backtest requires at least 30 resolved predictions to generate a statistically significant test period.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-500/25 bg-zinc-900/60 p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-indigo-300">OUT-OF-SAMPLE BACKTEST (§F / §G)</h3>
        <p className="text-[10px] text-zinc-500">
          Test Period: {results.dates.start} to {results.dates.end} | n = {results.n} predictions
        </p>
        <p className="text-[10px] text-rose-400 mt-1">
          * These metrics are calculated strictly on the held-out test set (last 20% of chronological data). No parameters were tuned on this data.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 border-b border-zinc-700">
            <tr>
              <th className="text-left py-2">Model</th>
              <th className="text-center py-2">Brier Score</th>
              <th className="text-center py-2">Log Loss</th>
              <th className="text-center py-2">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Market Baseline" m={results.market} color="text-zinc-400" />
            <Row label="Independent (Poisson)" m={results.independent} color="text-zinc-400" />
            <Row label="ATLAS Hybrid (v9.10)" m={results.hybrid} color="text-emerald-400" />
          </tbody>
        </table>
      </div>
    </div>
  );
}