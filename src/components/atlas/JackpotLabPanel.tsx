'use client';
import { useState } from 'react';
import { parseHistory, runJackpotLab } from '@/lib/v9/analysis/jackpot-lab';
import type { LabReport } from '@/lib/v9/analysis/jackpot-lab';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

export default function JackpotLabPanel() {
  const [text, setText] = useState('');
  const [report, setReport] = useState<LabReport | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBundled = async () => {
    try {
      const r = await fetch('/data/jackpot_history.txt');
      setText(await r.text());
    } catch { /* ignore */ }
  };

  const run = () => {
    setBusy(true);
    setTimeout(() => {
      setReport(runJackpotLab(parseHistory(text)));
      setBusy(false);
    }, 30);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-500/25 bg-zinc-900/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold text-amber-400">
            JACKPOT LAB — historical backtest (format: date | home | away | H | X | A | result H/D/A or ?)
          </h3>
          <button onClick={loadBundled} className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">
            Load bundled dataset
          </button>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'2026-05-02 17:00 | Newcastle | Brighton | 2.50 | 3.50 | 2.65 | H'}
          className="h-40 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-[10px] text-zinc-300 focus:border-amber-500 focus:outline-none" />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={run} disabled={busy || !text.trim()}
            className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40">
            {busy ? 'Crunching…' : '▶ Run Backtest'}
          </button>
          <span className="text-[10px] text-zinc-500">
            Rounds = actual jackpot tickets (grouped by slip date). Rows with “?” drive pick distribution only.
          </span>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
              <div className="text-lg font-bold text-zinc-100">{report.resolved}/{report.total}</div>
              <div className="text-[9px] text-zinc-500">resolved games</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
              <div className="text-lg font-bold text-amber-400">{fmtPct(report.hitRate)}</div>
              <div className="text-[9px] text-zinc-500">jackpot pick hit rate</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
              <div className="text-lg font-bold text-zinc-100">{report.brier.toFixed(3)}</div>
              <div className="text-[9px] text-zinc-500">Brier (baseline 0.667)</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
              <div className="text-lg font-bold text-violet-400">{fmtPct(report.drawRate)}</div>
              <div className="text-[9px] text-zinc-500">actual draw rate (spec ~32%)</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
              <div className="text-lg font-bold text-zinc-100">{report.sofHits}/{report.sofResolved}</div>
              <div className="text-[9px] text-zinc-500">tight-game (SOF flag) hits</div>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
              <div className="text-lg font-bold text-zinc-100">{report.pickDist.home}·{report.pickDist.draw}·{report.pickDist.away}</div>
              <div className="text-[9px] text-zinc-500">pick mix H·D·A</div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
            <h3 className="mb-2 text-xs font-bold text-zinc-300">ρ RE-DERIVATION SWEEP (Rule 1 evidence)</h3>
            <div className="grid grid-cols-6 gap-1.5">
              {report.rhoTable.map((r) => (
                <div key={r.rho} className={`rounded-lg border p-2 text-center ${
                  r.rho === report.bestRho ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800'}`}>
                  <div className="text-[10px] text-zinc-500">ρ {r.rho.toFixed(2)}</div>
                  <div className="text-xs font-bold tabular-nums text-zinc-200">{r.brier.toFixed(3)}</div>
                  <div className="text-[9px] tabular-nums text-zinc-500">{fmtPct(r.hitRate)} hit</div>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-zinc-500">
              Best ρ = {report.bestRho.toFixed(2)} · current −0.08 Brier = {report.currentRhoBrier.toFixed(3)}.
              Rule 1: consider re-derivation ONLY with ≥100 resolved games AND |best − (−0.08)| ≥ 0.04. Below that, keep −0.08.
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-zinc-500">
                  <th className="px-3 py-2">Round (ticket)</th><th className="px-3 py-2">Legs</th>
                  <th className="px-3 py-2">Resolved</th><th className="px-3 py-2">Legs hit</th>
                  <th className="px-3 py-2">Pred. all-hit</th><th className="px-3 py-2">Actual all-hit</th>
                </tr>
              </thead>
              <tbody>
                {report.rounds.map((r) => (
                  <tr key={r.round} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-zinc-300">{r.round}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-400">{r.legs}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-400">{r.resolved}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-300">{r.hits}/{r.resolved}</td>
                    <td className="px-3 py-2 tabular-nums text-amber-300">
                      {r.resolved
                        ? (r.predAllHit < 0.005 ? `1 in ${Math.round(1 / r.predAllHit).toLocaleString()}` : fmtPct(r.predAllHit))
                        : '—'}
                    </td>
                    <td className="px-3 py-2">
                      {r.actualAllHit === null ? <span className="text-zinc-600">pending</span>
                        : r.actualAllHit ? <span className="text-emerald-400">HIT ✔</span>
                        : <span className="text-rose-400">missed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
