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
import type { PredictionRecord } from '@/lib/v9/learning/bayesian-learning';
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

const hasOdds = (p: PredictionRecord): boolean => {
  const e = (p as PredictionRecord & { entryOdds?: Record<string, number> }).entryOdds;
  return !!e && e.home > 1 && e.draw > 1 && e.away > 1;
};

interface EngineBlock {
  engine: string;
  records: number; resolved: number; withProbs: number; oddsEligible: number;
  testN: number;
  market: CalibrationMetrics; independent: CalibrationMetrics; hybrid: CalibrationMetrics;
  dates: { start: string; end: string } | null;
}

function buildBlock(engine: string, recs: PredictionRecord[]): EngineBlock {
  const sorted = [...recs].sort((a, b) => a.timestamp - b.timestamp);
  const resolved = sorted.filter((r) => r.result);
  const withProbs = resolved.filter((r) => r.probs);
  const oddsEligible = resolved.filter(hasOdds);
  const { test } = splitChronologically(sorted, 0.6, 0.2);
  const block: EngineBlock = {
    engine,
    records: sorted.length, resolved: resolved.length,
    withProbs: withProbs.length, oddsEligible: oddsEligible.length,
    testN: test.length,
    market: evaluateMarketBaseline(test),
    independent: evaluateIndependentModel(test),
    hybrid: evaluateHybridModel(test),
    dates: test.length
      ? { start: new Date(test[0].timestamp).toLocaleDateString(), end: new Date(test[test.length - 1].timestamp).toLocaleDateString() }
      : null,
  };
  return block;
}

function EngineTable({ b }: { b: EngineBlock }) {
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold text-zinc-300">
        {b.engine.toUpperCase()} — funnel: {b.records} records → {b.resolved} resolved → {b.withProbs} with probs → {b.oddsEligible} odds-eligible
        {b.dates && <span className="text-zinc-500"> · test period {b.dates.start}–{b.dates.end} (test records {b.testN})</span>}
      </div>
      {b.testN < 5 ? (
        <div className="text-[10px] text-zinc-600">Insufficient test-period records for this engine.</div>
      ) : (
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
            <Row label="Market Baseline" m={b.market} color="text-zinc-400" />
            <Row label="Independent (naive λ)" m={b.independent} color="text-zinc-400" />
            <Row label="ATLAS Hybrid (v9.10)" m={b.hybrid} color="text-emerald-400" />
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function OutOfSamplePanel() {
  const predictions = useAtlasStore((s) => s.predictions);

  const blocks = useMemo(() => {
    if (predictions.length < 30) return null;
    return [
      buildBlock('Standard', predictions.filter((p) => p.gameType === 'standard')),
      buildBlock('Jackpot', predictions.filter((p) => p.gameType === 'jackpot')),
    ];
  }, [predictions]);

  if (!blocks) {
    return (
      <div className="rounded-xl border border-zinc-700 bg-zinc-900/60 p-4 text-xs text-zinc-500">
        Out-of-Sample Backtest requires at least 30 resolved predictions before hold-out metrics are shown. 30 is a minimum viability floor, not a statistical-significance guarantee.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-indigo-500/25 bg-zinc-900/60 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-bold text-indigo-300">OUT-OF-SAMPLE BACKTEST (§F / §G) — per-engine, chronological</h3>
        <p className="text-[10px] text-rose-400 mt-1">
          * Metrics computed strictly on each engine&apos;s held-out test slice (last 20% chronological). No parameters were tuned on this data. Engines never share records. Per-model n is displayed; at n &lt; 100 all differences are indicative only (accuracy 95% CI is roughly +/-1.96*sqrt(p(1-p)/n), i.e. about +/-15 points at n=20). No significance is claimed at any sample size; at least 100 resolved per engine is a pre-registered evidence milestone, not a significance threshold.
        </p>
        <p className="text-[10px] text-zinc-600 mt-1">
          Market Baseline / ROI show n/a when records carry no usable entry odds. Independent = fixed-λ naive (always-home strawman). ROI/P&L = flat 1u on each model&apos;s argmax at recorded entry odds. Any positive ROI for the naive comparator at small n is small-sample luck, not skill. Never rank models on these tables until per-engine n reaches the pre-registered milestone.
        </p>
      </div>
      {blocks.map((b) => <EngineTable key={b.engine} b={b} />)}
    </div>
  );
}