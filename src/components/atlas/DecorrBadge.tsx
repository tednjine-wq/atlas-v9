'use client';
export default function DecorrBadge({ score, hasRealSpot }: { score: number; hasRealSpot: boolean }) {
  const cls = score >= 15 ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
    : score > 5 ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
    : 'bg-zinc-800 text-zinc-400 border-zinc-700';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      DECORR {score.toFixed(0)}{hasRealSpot ? ' • SPOT' : ''}
    </span>
  );
}
