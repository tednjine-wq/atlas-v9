'use client';
export default function ProbBar({ label, value, barClass, textClass, compare }: {
  label: string; value: number; barClass: string; textClass: string; compare?: number;
}) {
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[11px]">
        <span className={textClass}>{label}</span>
        <span className="text-zinc-300 tabular-nums">
          {(value * 100).toFixed(1)}%
          {compare !== undefined && (
            <span className={`ml-1 ${value > compare ? 'text-emerald-400' : 'text-zinc-500'}`}>
              ({value > compare ? '+' : ''}{((value - compare) * 100).toFixed(1)})
            </span>
          )}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className={`h-full ${barClass}`} style={{ width: `${Math.min(value * 100, 100)}%` }} />
      </div>
    </div>
  );
}
