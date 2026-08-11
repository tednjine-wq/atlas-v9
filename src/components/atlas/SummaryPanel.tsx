'use client';
import { useMemo } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

export default function SummaryPanel() {
  const matches = useAtlasStore((s) => s.matches);
  const phi = useAtlasStore((s) => s.phi);
  const standardParams = useAtlasStore((s) => s.standardParams);

  const summary = useMemo(() => {
    const std = matches.filter((m) => m.gameType === 'standard' && parseFloat(m.h) > 1 && parseFloat(m.d) > 1 && parseFloat(m.a) > 1);
    let totalEV = 0, totalVar = 0, totalStake = 0;
    const dist = { home: 0, draw: 0, away: 0 };
    for (const m of std) {
      try {
        const a = atlasAnalyseV9(m, phi, standardParams);
        dist[a.pick]++;
        const best = a.portfolio.find((p) => p.isMaxEp);
        if (best) { totalEV += best.ev * best.stake; totalVar += best.varPerUnit * best.stake ** 2; totalStake += best.stake; }
      } catch { /* skip invalid */ }
    }
    return { count: std.length, dist, roundSharpe: totalVar > 0 ? totalEV / Math.sqrt(totalVar) : 0, totalStake };
  }, [matches, phi, standardParams]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
      <h3 className="mb-2 text-xs font-bold text-zinc-300">PORTFOLIO SUMMARY</h3>
      <div className="grid grid-cols-4 gap-3 text-center">
        <div><div className="text-lg font-bold text-zinc-100">{summary.count}</div><div className="text-[10px] text-zinc-500">standard legs</div></div>
        <div><div className="text-lg font-bold text-blue-400">{summary.dist.home}·{summary.dist.draw}·{summary.dist.away}</div><div className="text-[10px] text-zinc-500">H·D·A pick mix</div></div>
        <div><div className="text-lg font-bold text-teal-300">{summary.roundSharpe.toFixed(2)}</div><div className="text-[10px] text-zinc-500">round Sharpe</div></div>
        <div><div className="text-lg font-bold text-emerald-400">{fmtPct(summary.totalStake)}</div><div className="text-[10px] text-zinc-500">total Kelly exposure</div></div>
      </div>
    </div>
  );
}
