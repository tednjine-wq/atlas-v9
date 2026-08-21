'use client';
import { useMemo, useState } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import type { Match } from '@/lib/v9/atlas-types';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { atlasAnalyseJackpotV9 } from '@/lib/v9/engines/jackpot';
import { fetchMatchContext, contextVerdict } from '@/lib/v9/agents/context-agent';
import type { MatchContext } from '@/lib/v9/agents/context-agent';

const keyFor = (id: string) => `atlas_ctx_${id}`;

function sideOf(ctx: MatchContext): 'home' | 'away' | 'tight' | null {
  const h = ctx.home.motivation, a = ctx.away.motivation;
  const hAbs = ctx.home.keyAbsences.length, aAbs = ctx.away.keyAbsences.length;
  if (h === 'low' && a !== 'low') return 'away';
  if (a === 'low' && h !== 'low') return 'home';
  if (hAbs > aAbs + 1) return 'away';
  if (aAbs > hAbs + 1) return 'home';
  if (h === 'high' && a === 'high') return 'tight';
  return null;
}

export default function ContextBadge({ match }: { match: Match }) {
  const phi = useAtlasStore((s) => s.phi);
  const standardParams = useAtlasStore((s) => s.standardParams);
  const [ctx, setCtx] = useState<MatchContext | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(keyFor(match.id));
      return raw ? (JSON.parse(raw) as MatchContext) : null;
    } catch { return null; }
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const enginePick = useMemo(() => {
    try {
      const a = match.gameType === 'jackpot'
        ? atlasAnalyseJackpotV9(match, phi)
        : atlasAnalyseV9(match, phi, standardParams);
      return a.pick as string;
    } catch { return null; }
  }, [match, phi, standardParams]);

  const fetchCtx = async () => {
    const key = typeof window !== 'undefined' ? localStorage.getItem('atlas_context_key') ?? '' : '';
    if (!key.trim()) { setErr('Set your Gemini key in Context Lab first'); return; }
    setBusy(true); setErr('');
    try {
      const c = await fetchMatchContext(match.home, match.away, match.league, match.kickoff, key.trim());
      localStorage.setItem(keyFor(match.id), JSON.stringify(c));
      setCtx(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'fetch failed');
    } finally { setBusy(false); }
  };

  if (!ctx) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-zinc-800/60 bg-zinc-900/30 px-2 py-1">
        <button onClick={fetchCtx} disabled={busy}
          className="text-[10px] text-zinc-500 hover:text-teal-300 disabled:opacity-40">
          {busy ? '🧠 fetching live context…' : '🧠 Fetch context'}
        </button>
        {err && <span className="text-[9px] text-rose-400">{err}</span>}
      </div>
    );
  }

  const side = sideOf(ctx);
  const agrees = side !== null && side !== 'tight' && side === enginePick;
  const conflicts = side !== null && side !== 'tight' && enginePick !== null && side !== enginePick;
  const tone = agrees
    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
    : conflicts
      ? 'border-rose-500/30 bg-rose-500/5 text-rose-300'
      : 'border-zinc-700/60 bg-zinc-800/30 text-zinc-400';

  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-lg border px-2 py-1 text-[10px] ${tone}`}>
      <span className="font-bold">🧠 {contextVerdict(ctx)}</span>
      <span className="opacity-80">
        {agrees
          ? '✅ agrees with engine pick'
          : conflicts
            ? `⚠ engine picked ${enginePick?.toUpperCase()} — you decide`
            : side === 'tight'
              ? '⚖ high-stakes — engine decides'
              : '⚪ neutral vs engine'}
      </span>
      <span className="text-zinc-600">conf {(ctx.confidence * 100).toFixed(0)}%</span>
      <button
        onClick={() => { localStorage.removeItem(keyFor(match.id)); setCtx(null); }}
        title="Refresh context"
        className="ml-auto text-zinc-600 hover:text-zinc-300">
        ↻
      </button>
    </div>
  );
}
