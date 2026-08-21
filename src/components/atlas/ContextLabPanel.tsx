'use client';
import { useState } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { fetchMatchContextAuto, contextVerdict } from '@/lib/v9/agents/context-agent';
import type { MatchContext } from '@/lib/v9/agents/context-agent';

const GKEY = 'atlas_context_key';
const OKEY = 'atlas_openrouter_key';
const motColor = (m: string) =>
  m === 'high' ? 'text-emerald-400' : m === 'low' ? 'text-rose-400' : 'text-amber-400';

function TeamBlock({ label, t }: { label: string; t: MatchContext['home'] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-bold text-zinc-200">{label}</span>
        <span className={`text-[10px] font-bold uppercase ${motColor(t.motivation)}`}>{t.motivation} motivation</span>
      </div>
      <div className="text-[10px] text-zinc-400">{t.reason}</div>
      <div className="mt-1 flex gap-3 text-[10px] text-zinc-500 tabular-nums">
        <span>form {t.formLast5 || '—'}</span>
        <span>fatigue {t.fatigue}</span>
      </div>
      {t.keyAbsences.length > 0 && (
        <div className="mt-1 text-[10px] text-rose-300">Out: {t.keyAbsences.join(', ')}</div>
      )}
    </div>
  );
}

export default function ContextLabPanel() {
  const matches = useAtlasStore((s) => s.matches);
  const [apiKey, setApiKey] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(GKEY) ?? '' : '');
  const [orKey, setOrKey] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem(OKEY) ?? '' : '');
  const [matchId, setMatchId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ctx, setCtx] = useState<MatchContext | null>(null);
  const [verdict, setVerdict] = useState('');
  const [history, setHistory] = useState<{ label: string; verdict: string }[]>([]);

  const target = matches.find((m) => m.id === matchId) ?? matches[0];

  const run = async () => {
    if (!target) { setErr('Add a match first (Matches tab).'); return; }
    if (!apiKey.trim() && !orKey.trim()) { setErr('Paste a Gemini or OpenRouter key first.'); return; }
    setBusy(true); setErr(''); setCtx(null);
    try {
      const c = await fetchMatchContextAuto(target.home, target.away, target.league, target.kickoff, {
        gemini: apiKey, openrouter: orKey,
      });
      const v = contextVerdict(c);
      setCtx(c); setVerdict(v);
      setHistory((h) => [{ label: `${target.home} v ${target.away}`, verdict: v }, ...h].slice(0, 12));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Fetch failed');
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <h3 className="mb-2 text-xs font-bold text-zinc-300">CONTEXT LAB (semi-auto · Gemini → OpenRouter fallback · you decide)</h3>
        <div className="flex flex-wrap gap-2">
          <input
            type="password" value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); localStorage.setItem(GKEY, e.target.value); }}
            placeholder="Gemini key (optional)"
            className="w-56 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:border-teal-500 focus:outline-none"
          />
          <input
            type="password" value={orKey}
            onChange={(e) => { setOrKey(e.target.value); localStorage.setItem(OKEY, e.target.value); }}
            placeholder="OpenRouter key sk-or-… (openrouter.ai → Keys)"
            className="w-64 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:border-teal-500 focus:outline-none"
          />
          <select value={target?.id ?? ''} onChange={(e) => setMatchId(e.target.value)}
            className="max-w-64 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300">
            {matches.map((m) => <option key={m.id} value={m.id}>{m.home} v {m.away}</option>)}
          </select>
          <button onClick={run} disabled={busy}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-40">
            {busy ? 'Fetching live context…' : '🌐 Fetch live context'}
          </button>
        </div>
        {err && <div className="mt-2 text-[11px] text-rose-400">{err}</div>}
      </div>

      {ctx && target && (
        <div className="rounded-xl border border-teal-500/25 bg-zinc-900/60 p-3">
          <div className="mb-2 text-xs font-bold text-teal-300">
            {target.home} v {target.away} · <span className="uppercase">{verdict}</span>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <TeamBlock label={target.home} t={ctx.home} />
            <TeamBlock label={target.away} t={ctx.away} />
          </div>
          <div className="mt-2 text-[11px] text-zinc-300">{ctx.summary}</div>
          <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-zinc-500">
            <span>weather: {ctx.weather || '—'}</span>
            <span>derby: {ctx.derby ? 'yes' : 'no'}</span>
            <span>source confidence: {(ctx.confidence * 100).toFixed(0)}%</span>
            <span>via {ctx.model}</span>
            <span>fetched {ctx.fetchedAt}</span>
          </div>
          <div className="mt-2 text-[10px] text-amber-400">
            Advisory only — compare with the engine pick on the match card, then YOU decide (star / skip / override).
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <h3 className="mb-2 text-xs font-bold text-zinc-300">CONTEXT HISTORY ({history.length})</h3>
          <div className="space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-center justify-between rounded bg-zinc-950/60 px-2 py-1 text-[11px]">
                <span className="text-zinc-300">{h.label}</span>
                <span className="text-teal-400">{h.verdict}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
