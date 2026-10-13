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
  const na = m.n === 0;
  return (
    <tr className="border-b border-zinc-800">
      <td className={`py-2 font-bold ${color}`}>{label}</td>
      <td className="py-2 text-center tabular-nums text-zinc-500">{na ? 'n/a' : m.n}</td>
      <td className="py-2 text-center tabular-nums">{na ? 'n/a' : m.brier.toFixed(3)}</td>
      <td className="py-2 text-center tabular-nums">{na ? 'n/a' : m.logLoss.toFixed(3)}</td>
      <td className="py-2 text-center tabular-nums">{na ? 'n/a' : fmtPct(m.accuracy)}</td>
      <td className={`py-2 text-center tabular-nums ${m.roi > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {na || m.nBets === 0 ? 'n/a' : `${m.roi >= 0 ? '+' : ''}${(m.roi * 100).toFixed(1)}%`}
      </td>
      <td className={`py-2 text-center tabular-nums ${m.pl > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {na || m.nBets === 0 ? 'n/a' : `${m.pl >= 0 ? '+' : ''}${m.pl.toFixed(1)}u`}
      </td>
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
    return {
      market: evaluateMarketBaseline(test),
      independent: evaluateIndependentModel(test),
      hybrid: evaluateHybridModel(test),
      n: test.length,
      dates: {
        start: new Date(test[0].timestamp).toLocaleDateString(),
        end: new Date(test[test.length - 1].timestamp).toLocaleDateString(),
      },
    };
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
          Test Period: {results.dates.start} to {results.dates.end} | n = {results.n} records (per-model n below)
        </p>
        <p className="text-[10px] text-rose-400 mt-1">
          * Metrics computed strictly on the held-out test set (last 20% chronological). No parameters were tuned on this data.
        </p>
        <p className="text-[10px] text-zinc-600 mt-1">
          Market Baseline / ROI show n/a when prediction records carry no usable odds. Independent = fixed-λ naive (always-home strawman). ROI/P&L = flat 1u on each model&apos;s argmax at recorded odds.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 border-b border-zinc-700">
            <tr>
              <th className="text-left py-2">Model</th>
              <th className="text-center py-2">n</th>
              <th className="text-center py-2">Brier</th>
              <th className="text-center py-2">Log Loss</th>
              <th className="text-center py-2">Accuracy</th>
              <th className="text-center py-2">ROI</th>
              <th className="text-center py-2">P/L</th>
            </tr>
          </thead>
          <tbody>
            <Row label="Market Baseline" m={results.market} color="text-zinc-400" />
            <Row label="Independent (naive λ)" m={results.independent} color="text-zinc-400" />
            <Row label="ATLAS Hybrid (v9.10)" m={results.hybrid} color="text-emerald-400" />
          </tbody>
        </table>
      </div>
    </div>
  );
}