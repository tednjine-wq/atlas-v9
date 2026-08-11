'use client';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

export default function SimulationPanel() {
  const matches = useAtlasStore((s) => s.matches);
  const simResults = useAtlasStore((s) => s.simResults);
  const runAllSims = useAtlasStore((s) => s.runAllSims);
  const runParlaySim = useAtlasStore((s) => s.runParlaySim);
  const parlaySim = useAtlasStore((s) => s.parlaySim);
  const simsRunning = useAtlasStore((s) => s.simsRunning);

  const rows = matches.flatMap((m) => {
    const sim = simResults[m.id];
    return sim ? [{ m, sim }] : [];
  }).sort((a, b) => b.sim.maxDelta - a.sim.maxDelta);

  const dColor = (d: string) =>
    d === 'none' ? 'text-emerald-400' : d === 'low' ? 'text-yellow-400' : d === 'medium' ? 'text-orange-400' : 'text-rose-400';

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button onClick={runAllSims} disabled={simsRunning}
          className="rounded-lg bg-orange-600 px-4 py-2 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-40">
          {simsRunning ? 'Running…' : '▶ Run All Sims (adaptive antithetic MC)'}
        </button>
        <button onClick={runParlaySim}
          className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-500">
          🎰 Simulate Jackpot Parlay
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[10px] uppercase text-zinc-500">
              <th className="px-3 py-2">Match</th><th className="px-3 py-2">Sims</th>
              <th className="px-3 py-2">H / D / A</th><th className="px-3 py-2">Max Δ</th>
              <th className="px-3 py-2">Disagreement</th><th className="px-3 py-2">Rec</th><th className="px-3 py-2">Conf ×</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ m, sim }) => (
              <tr key={m.id} className="border-t border-zinc-800 text-xs">
                <td className="px-3 py-2 text-zinc-300">{m.home} v {m.away}</td>
                <td className="px-3 py-2 tabular-nums text-zinc-400">{sim.n.toLocaleString()}</td>
                <td className="px-3 py-2 tabular-nums text-zinc-300">
                  {fmtPct(sim.probs.home)} / {fmtPct(sim.probs.draw)} / {fmtPct(sim.probs.away)}
                </td>
                <td className="px-3 py-2 tabular-nums text-zinc-300">{fmtPct(sim.maxDelta)}</td>
                <td className={`px-3 py-2 font-semibold ${dColor(sim.disagreement)}`}>{sim.disagreement.toUpperCase()}</td>
                <td className="px-3 py-2 text-zinc-400">{sim.recommendation}</td>
                <td className="px-3 py-2 tabular-nums text-orange-300">×{sim.confMultiplier.toFixed(2)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td className="px-3 py-4 text-xs text-zinc-600" colSpan={7}>No simulations run yet. Sims are a cross-check only — the grid model stays primary.</td></tr>}
          </tbody>
        </table>
      </div>

      {parlaySim && (
        <div className="rounded-xl border border-amber-500/25 bg-zinc-900/60 p-4">
          <h3 className="mb-2 text-xs font-bold text-amber-400">PARLAY SIMULATION — {parlaySim.legs} legs</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div><div className="text-2xl font-bold text-amber-300">{fmtPct(parlaySim.allCorrect)}</div><div className="text-[10px] text-zinc-500">all legs correct</div></div>
            <div><div className="text-2xl font-bold text-zinc-100">{parlaySim.expectedCorrect.toFixed(1)}</div><div className="text-[10px] text-zinc-500">expected correct</div></div>
            <div><div className="text-sm font-bold text-zinc-100">{parlaySim.legProbs.map((p) => fmtPct(p)).join(' · ')}</div><div className="text-[10px] text-zinc-500">per-leg hit rates</div></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(parlaySim.cumulative).map(([x, p]) => (
              <span key={x} className="rounded-full bg-zinc-800 px-2.5 py-1 text-[10px] text-zinc-300 tabular-nums">≥{x} correct: {fmtPct(p)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
