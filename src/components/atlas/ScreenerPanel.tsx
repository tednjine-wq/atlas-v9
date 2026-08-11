'use client';
import { useMemo, useState } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { emptyMatch, DC_RHO_STANDARD } from '@/lib/v9/atlas-types';
import type { Match, AtlasAnalysis } from '@/lib/v9/atlas-types';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { atlasAnalyseJackpotV9 } from '@/lib/v9/engines/jackpot';
import { computeExtendedMarketsV9 } from '@/lib/v9/markets/extended-markets';
import { parseFixtureList } from '@/lib/v9/parsers/fixture-parser';
import { qualityStandard, qualityJackpot, buildJackpotTicket, buildStandardSlate } from '@/lib/v9/analysis/screener';
import type { FixtureQuality } from '@/lib/v9/analysis/screener';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

interface ExtEdge { label: string; ev: number; odds: number; }
interface Row { m: Match; a: AtlasAnalysis; q: FixtureQuality; ext: ExtEdge | null; }

export default function ScreenerPanel() {
  const matches = useAtlasStore((s) => s.matches);
  const phi = useAtlasStore((s) => s.phi);
  const standardParams = useAtlasStore((s) => s.standardParams);
  const [text, setText] = useState('');
  const [asJackpot, setAsJackpot] = useState(false);
  const [ticket, setTicket] = useState<string[]>([]);

  const rows = useMemo<Row[]>(() => matches
    .filter((m) => parseFloat(m.h) > 1 && parseFloat(m.d) > 1 && parseFloat(m.a) > 1)
    .map((m) => {
      try {
        if (m.gameType === 'jackpot') {
          const a = atlasAnalyseJackpotV9(m, phi);
          return { m, a, q: qualityJackpot(a), ext: null };
        }
        // v9.6: Standard rows are screened on EXTENDED-market edge too
        const a = atlasAnalyseV9(m, phi, standardParams);
        const ext = computeExtendedMarketsV9(
          a.scoreMatrix, a.calibration.lambdaH, a.calibration.lambdaA,
          DC_RHO_STANDARD, m.userOdds,
        );
        const best = ext.topEvBets.length ? ext.topEvBets[0] : null;
        const extEdge = best && best.ev > 0 ? { label: best.label, ev: best.ev, odds: best.odds } : null;
        const base = qualityStandard(a);
        const q: FixtureQuality = {
          ...base,
          score: Math.min(100, base.score + (extEdge ? Math.min(15, Math.round(extEdge.ev * 200)) : 0)),
          maxEV: Math.max(base.maxEV, extEdge?.ev ?? -1),
        };
        return { m, a, q, ext: extEdge };
      } catch { return null; }
    })
    .filter((r): r is Row => r !== null)
    .sort((x, y) => y.q.score - x.q.score),
  [matches, phi, standardParams]);

  const parsed = useMemo(() => parseFixtureList(text), [text]);

  const importFixtures = () => {
    if (!parsed.length) return;
    useAtlasStore.setState((s) => ({
      matches: [
        ...s.matches,
        ...parsed.map((f) => {
          const base = emptyMatch(crypto.randomUUID());
          return {
            ...base, ...f,
            userOdds: { ...base.userOdds, ...(f.userOdds ?? {}) },
            gameType: asJackpot ? ('jackpot' as const) : ('standard' as const),
          };
        }),
      ],
    }));
    setText('');
  };

  const ticketShape = rows.map((r) => ({ id: r.m.id, league: r.m.league, q: r.q }));

  const toggle = (id: string) =>
    setTicket((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const ticketRows = rows.filter((r) => ticket.includes(r.m.id));
  const parlayProb = ticketRows.reduce((p, r) => p * r.q.legProb, 1);
  const avgEV = ticketRows.length
    ? ticketRows.reduce((s, r) => s + Math.max(r.q.maxEV, 0), 0) / ticketRows.length : 0;

  const scoreColor = (s: number) =>
    s >= 70 ? 'text-emerald-400' : s >= 55 ? 'text-yellow-400' : 'text-zinc-500';

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold text-zinc-300">
            IMPORT FIXTURE LIST (SportPesa PDF → select-all → copy → paste)
          </h3>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${
            parsed.length ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
            {parsed.length} fixtures detected
          </span>
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'Premier League\n14:00 Arsenal vs Chelsea 2.10 3.40 3.60\n16:30 Manchester City vs Atletico Madrid 1.93 3.55 3.05'}
          className="h-28 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-300 focus:border-blue-500 focus:outline-none" />
        <div className="mt-2 flex items-center gap-3">
          <button onClick={importFixtures} disabled={!parsed.length}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
            Import {parsed.length} fixtures
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <input type="checkbox" checked={asJackpot} onChange={(e) => setAsJackpot(e.target.checked)} className="accent-amber-500" />
            import as Jackpot legs
          </label>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => setTicket(buildJackpotTicket(ticketShape))}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500">
          🎰 Auto-Build Jackpot Ticket (8 legs, ≤2 per league)
        </button>
        <button onClick={() => setTicket(buildStandardSlate(ticketShape))}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
          📊 Auto-Build Standard Slate (top 5 +EV, incl. extended markets)
        </button>
        {ticket.length > 0 && (
          <button onClick={() => setTicket([])} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
            Clear ticket
          </button>
        )}
      </div>

      {ticketRows.length > 0 && (
        <div className="rounded-xl border border-teal-500/25 bg-zinc-900/60 p-3">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><div className="text-lg font-bold text-zinc-100">{ticketRows.length}</div><div className="text-[10px] text-zinc-500">legs selected</div></div>
            <div><div className="text-lg font-bold text-amber-300">{fmtPct(parlayProb)}</div><div className="text-[10px] text-zinc-500">combined all-hit probability</div></div>
            <div><div className={`text-lg font-bold ${avgEV > 0 ? 'text-emerald-400' : 'text-zinc-400'}`}>{avgEV > 0 ? '+' : ''}{fmtPct(avgEV)}</div><div className="text-[10px] text-zinc-500">avg best edge (standard)</div></div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase text-zinc-500">
              <th className="px-2 py-2">★</th><th className="px-2 py-2">Score</th>
              <th className="px-2 py-2">Match</th><th className="px-2 py-2">Engine</th>
              <th className="px-2 py-2">Pick</th><th className="px-2 py-2">Conf</th>
              <th className="px-2 py-2">Margin</th><th className="px-2 py-2">Max EV</th>
              <th className="px-2 py-2">Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 80).map(({ m, a, q, ext }) => (
              <tr key={m.id} className={`border-t border-zinc-800 ${ticket.includes(m.id) ? 'bg-teal-500/5' : ''}`}>
                <td className="px-2 py-1.5">
                  <button onClick={() => toggle(m.id)} className={ticket.includes(m.id) ? 'text-teal-400' : 'text-zinc-600 hover:text-zinc-300'}>
                    {ticket.includes(m.id) ? '★' : '☆'}
                  </button>
                </td>
                <td className={`px-2 py-1.5 font-bold tabular-nums ${scoreColor(q.score)}`}>{q.score}</td>
                <td className="px-2 py-1.5 text-zinc-300">{m.home} v {m.away}<span className="ml-1 text-[9px] text-zinc-600">{m.league}</span></td>
                <td className="px-2 py-1.5 text-[10px] text-zinc-500">{m.gameType === 'jackpot' ? 'JP' : 'STD'}</td>
                <td className="px-2 py-1.5 uppercase text-zinc-300">{a.pick}</td>
                <td className="px-2 py-1.5 tabular-nums text-zinc-300">{fmtPct(a.confidence)}</td>
                <td className="px-2 py-1.5 tabular-nums text-zinc-400">{fmtPct(a.margin)}</td>
                <td className="px-2 py-1.5 tabular-nums">
                  {ext ? (
                    <span className="text-emerald-400">+{fmtPct(ext.ev)} {ext.label} @{ext.odds.toFixed(2)}</span>
                  ) : q.maxEV > 0 ? (
                    <span className="text-emerald-400">+{fmtPct(q.maxEV)}</span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-[9px] text-zinc-500">{q.reasons.join(' · ')}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-zinc-600">No analyzable fixtures yet — paste a fixture list above.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
