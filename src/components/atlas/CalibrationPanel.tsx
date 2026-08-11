'use client';
import { useMemo } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { evaluatePredictions } from '@/lib/v9/analysis/backtester';
import type { CalibrationMetrics } from '@/lib/v9/analysis/backtester';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

function MetricsCard({ title, m, color }: { title: string; m: CalibrationMetrics; color: string }) {
  return (
    <div className={`rounded-xl border ${color} bg-zinc-900/60 p-3`}>
      <h3 className="mb-2 text-xs font-bold">{title}</h3>
      {m.n < 5 ? (
        <div className="text-xs text-zinc-600">Need ≥5 resolved predictions (have {m.n}).</div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="text-lg font-bold text-zinc-100">{m.brier.toFixed(3)}</div><div className="text-[9px] text-zinc-500">Brier (lower better, 1X2 baseline 0.667)</div></div>
            <div><div className="text-lg font-bold text-zinc-100">{m.logLoss.toFixed(3)}</div><div className="text-[9px] text-zinc-500">Log loss (baseline 1.099)</div></div>
            <div><div className="text-lg font-bold text-emerald-400">{fmtPct(m.accuracy)}</div><div className="text-[9px] text-zinc-500">pick accuracy (n={m.n})</div></div>
          </div>
          <div className="mt-3">
            <div className="mb-1 text-[10px] uppercase text-zinc-500">Reliability diagram (model conf vs realized hit rate)</div>
            <div className="space-y-1">
              {m.reliability.filter((b) => b.n > 0).map((b, i) => (
                <div key={i} className="flex items-center gap-2 text-[10px]">
                  <span className="w-16 tabular-nums text-zinc-500">{(b.lo * 100).toFixed(0)}–{(b.hi * 100).toFixed(0)}%</span>
                  <div className="relative h-2 flex-1 rounded bg-zinc-800">
                    <div className="absolute h-full rounded bg-blue-500/60" style={{ width: `${b.model * 100}%` }} />
                    <div className="absolute h-full w-0.5 bg-emerald-400" style={{ left: `${b.actual * 100}%` }} />
                  </div>
                  <span className="w-10 tabular-nums text-zinc-400">n={b.n}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function CalibrationPanel() {
  const predictions = useAtlasStore((s) => s.predictions);
  const feedback = useAtlasStore((s) => s.feedback);
  const recalibrationLog = useAtlasStore((s) => s.recalibrationLog);
  const std = useMemo(() => evaluatePredictions(predictions.filter((p) => p.gameType === 'standard')), [predictions]);
  const jp = useMemo(() => evaluatePredictions(predictions.filter((p) => p.gameType === 'jackpot')), [predictions]);

  // v9.1 CLV: the true skill metric — did you beat the closing price?
  const clv = useMemo(() => {
    const vals: number[] = [];
    for (const p of predictions) if (typeof p.clv === 'number') vals.push(p.clv);
    for (const f of feedback) if (f.closingOdds && f.closingOdds > 1 && f.odds > 1) vals.push(f.odds / f.closingOdds - 1);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const beat = vals.length ? vals.filter((v) => v > 0).length / vals.length : 0;
    return { vals, avg, beat };
  }, [predictions, feedback]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-teal-500/25 bg-zinc-900/60 p-3">
        <h3 className="mb-2 text-xs font-bold text-teal-300">CLOSING LINE VALUE — the skill metric</h3>
        {clv.vals.length === 0 ? (
          <div className="text-xs text-zinc-600">
            No CLV data yet. CLV is captured automatically: enter odds early, log the result later — the drift of your pick&apos;s odds is your CLV. Optionally add closing odds to manually logged bets.
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className={`text-lg font-bold ${clv.avg > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{clv.avg > 0 ? '+' : ''}{(clv.avg * 100).toFixed(1)}%</div><div className="text-[9px] text-zinc-500">avg CLV ({clv.vals.length} bets)</div></div>
            <div><div className="text-lg font-bold text-zinc-100">{fmtPct(clv.beat)}</div><div className="text-[9px] text-zinc-500">beat the closing line</div></div>
            <div><div className="text-lg font-bold text-zinc-100">{clv.vals.length >= 30 ? (clv.avg > 0 ? 'EDGE ✔' : 'NO EDGE') : 'BUILDING'}</div><div className="text-[9px] text-zinc-500">status (needs 30+ bets)</div></div>
          </div>
        )}
        <div className="mt-2 text-[10px] text-zinc-500">
          If you consistently take better prices than the closing line (avg CLV &gt; 0 over 30+ bets), you have a structural edge — even when individual bets lose. Hit rate alone is noise.
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <MetricsCard title="STANDARD CALIBRATION" m={std} color="border-blue-500/25" />
        <MetricsCard title="JACKPOT CALIBRATION" m={jp} color="border-amber-500/25" />
      </div>
      {recalibrationLog.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <h3 className="mb-2 text-xs font-bold text-zinc-300">RECALIBRATION LOG</h3>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {[...recalibrationLog].reverse().map((l, i) => (
              <div key={i} className="text-[11px] text-zinc-400">
                <span className="text-zinc-600">{new Date(l.at).toLocaleString()}</span>{' '}
                <span className={l.gameType === 'standard' ? 'text-blue-400' : 'text-amber-400'}>[{l.gameType}]</span> {l.message}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
