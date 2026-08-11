'use client';
export default function ThresholdGate({ pass, confidence, simMultiplier }: {
  pass: boolean; confidence: number; simMultiplier?: number;
}) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
      pass ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
           : 'bg-rose-500/15 text-rose-400 border-rose-500/30'}`}>
      {pass ? '✓ THRESHOLD PASS' : '✗ THRESHOLD FAIL'} · conf {(confidence * 100).toFixed(0)}%
      {simMultiplier !== undefined && simMultiplier < 1 && (
        <span className="text-orange-400">sim ×{simMultiplier.toFixed(2)}</span>
      )}
    </span>
  );
}
