'use client';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';

export default function APIPicksPanel() {
  const apiPicks = useAtlasStore((s) => s.apiPicks);
  const loading = useAtlasStore((s) => s.apiPicksLoading);
  const error = useAtlasStore((s) => s.apiPicksError);
  const fetchApiPicks = useAtlasStore((s) => s.fetchApiPicks);
  const importApiPicks = useAtlasStore((s) => s.importApiPicks);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button onClick={fetchApiPicks} disabled={loading}
          className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-40">
          {loading ? 'Fetching…' : '⟳ Fetch Live Picks (The Odds API)'}
        </button>
        {apiPicks.length > 0 && (
          <button onClick={importApiPicks} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500">
            ⤓ Import {apiPicks.length} matches
          </button>
        )}
        {error && <span className="text-xs text-rose-400">{error} (set ODDS_API_KEY env var)</span>}
      </div>
      {apiPicks.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
          <table className="w-full text-xs">
            <thead><tr className="text-left text-[10px] uppercase text-zinc-500">
              <th className="px-3 py-2">Match</th><th className="px-3 py-2">League</th>
              <th className="px-3 py-2">H/D/A</th><th className="px-3 py-2">Books</th><th className="px-3 py-2">Value gap</th>
            </tr></thead>
            <tbody>
              {apiPicks.map((p) => (
                <tr key={p.id} className="border-t border-zinc-800">
                  <td className="px-3 py-2 text-zinc-200">{p.home} v {p.away}</td>
                  <td className="px-3 py-2 text-zinc-400">{p.league}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-300">{p.h} / {p.d} / {p.a}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-400">{p.bookmakers}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-400">{(p.valueGap * 100).toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
