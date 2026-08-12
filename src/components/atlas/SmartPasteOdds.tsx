'use client';
import { useMemo, useState } from 'react';
import { parseSmartPaste } from '@/lib/v9/parsers/odds-parser';
import { auditParsedOdds } from '@/lib/v9/parsers/odds-audit';
import type { PasteProfile } from '@/lib/v9/parsers/odds-parser';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';

export default function SmartPasteOdds({ matchId, onClose }: { matchId: string; onClose: () => void }) {
  const [text, setText] = useState('');
  const [profile, setProfile] = useState<PasteProfile>('auto');
  const updateOdds = useAtlasStore((s) => s.updateOdds);
  const updateMatch = useAtlasStore((s) => s.updateMatch);

  const parsed = useMemo(
    () => parseSmartPaste(text, { profile }),
    [text, profile],
  );
  const audit = useMemo(() => auditParsedOdds(parsed.odds), [parsed]);
  const fails = audit.filter((a) => a.status === 'fail');

  const apply = () => {
    Object.entries(parsed.odds).forEach(([k, v]) => updateOdds(matchId, k, v));
    if (parsed.main) {
      updateMatch(matchId, { h: String(parsed.main.h), d: String(parsed.main.d), a: String(parsed.main.a) });
    }
    onClose();
  };

  const pill = (p: PasteProfile, label: string) => (
    <button onClick={() => setProfile(p)}
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
        profile === p ? 'bg-blue-500/20 text-blue-300 border-blue-500/40' : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 p-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-200">Smart Paste Odds (v6 scoped + v9.11 audit)</h3>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
            parsed.count > 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
            {parsed.count} markets detected
          </span>
        </div>

        <div className="mb-2 flex items-center gap-1.5">
          <span className="text-[10px] uppercase text-zinc-500">Source:</span>
          {pill('auto', 'Auto')}
          {pill('sportpesa', 'SportPesa')}
          {pill('betika', 'Betika')}
          {parsed.main && <span className="ml-auto text-[10px] text-emerald-400">3-Way: {parsed.main.h}/{parsed.main.d}/{parsed.main.a}</span>}
        </div>

        <textarea
          value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Paste the full market page — headers included.\nBOTH TEAMS TO SCORE\nYES (GG) 1.72\nNO (NG) 2.01'}
          className="h-40 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-300 focus:border-blue-500 focus:outline-none"
        />

        {parsed.count > 0 && (
          <div className="mt-2 space-y-1 rounded-lg border border-zinc-700 bg-zinc-950 p-2">
            {audit.map((a, i) => (
              <div key={i} className={`text-[10px] ${
                a.status === 'fail' ? 'text-rose-400' : a.status === 'warn' ? 'text-amber-400' : 'text-emerald-400'}`}>
                {a.status === 'fail' ? '✖' : a.status === 'warn' ? '⚠' : '✔'} {a.group}: {a.msg}
              </div>
            ))}
          </div>
        )}
        {fails.length > 0 && (
          <div className="mt-1 text-[10px] font-bold text-rose-400">
            Apply blocked: impossible mapping detected — fix the paste (wrong section captured).
          </div>
        )}
        {parsed.unmatched.length > 0 && (
          <div className="mt-1 text-[10px] text-zinc-500">{parsed.unmatched.length} unmatched line(s)</div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">Cancel</button>
          <button onClick={apply} disabled={(!parsed.count && !parsed.main) || fails.length > 0}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40 hover:bg-blue-500">
            Parse & Apply {parsed.count} odds
          </button>
        </div>
      </div>
    </div>
  );
}
