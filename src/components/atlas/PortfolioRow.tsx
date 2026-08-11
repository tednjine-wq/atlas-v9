'use client';
import type { PortfolioOutcome } from '@/lib/v9/atlas-types';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

export default function PortfolioRow({ portfolio }: { portfolio: PortfolioOutcome[] }) {
  if (!portfolio.length) return null;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {portfolio.map((p) => (
        <div key={p.outcome} className={`rounded-lg border p-1.5 text-center ${
          p.isMaxEp ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/50'}`}>
          <div className="text-[10px] uppercase text-zinc-500">{p.outcome}{p.isMaxEp ? ' ★' : ''}</div>
          <div className={`text-xs tabular-nums ${p.ev > 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
            EV {p.ev > 0 ? '+' : ''}{fmtPct(p.ev)}
          </div>
          <div className="text-[10px] text-zinc-400 tabular-nums">
            K {fmtPct(p.stake)} · SR {p.sharpe.toFixed(2)}
          </div>
        </div>
      ))}
    </div>
  );
}
