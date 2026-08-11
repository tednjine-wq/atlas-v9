'use client';
import { useMemo } from 'react';
import type { Match, AtlasAnalysis, AtlasJackpotAnalysis } from '@/lib/v9/atlas-types';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { atlasAnalyseJackpotV9 } from '@/lib/v9/engines/jackpot';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

interface Row { m: Match; jp: AtlasJackpotAnalysis | null; std: AtlasAnalysis | null; }

export default function QuickViewTables() {
  const matches = useAtlasStore((s) => s.matches);
  const phi = useAtlasStore((s) => s.phi);
  const standardParams = useAtlasStore((s) => s.standardParams);

  const rows = useMemo<Row[]>(() => matches
    .filter((m) => parseFloat(m.h) > 1 && parseFloat(m.d) > 1 && parseFloat(m.a) > 1)
    .map((m) => m.gameType === 'jackpot'
      ? { m, jp: atlasAnalyseJackpotV9(m, phi), std: null }
      : { m, jp: null, std: atlasAnalyseV9(m, phi, standardParams) }),
  [matches, phi, standardParams]);

  const jp = rows.filter((r) => r.jp !== null);
  const std = rows.filter((r) => r.std !== null);
  const th = 'py-1.5 px-2 text-left text-[10px] uppercase tracking-wide text-zinc-500';
  const td = 'py-1.5 px-2 text-xs text-zinc-300 tabular-nums';

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-amber-500/25 bg-zinc-900/60 p-3">
        <h3 className="mb-2 text-xs font-bold text-amber-400">JACKPOT — Parlay Probability Table</h3>
        <table className="w-full">
          <thead><tr><th className={th}>Match</th><th className={th}>Pick</th><th className={th}>Prob</th><th className={th}>Parlay ln(p)</th><th className={th}>Risk</th></tr></thead>
          <tbody>
            {jp.map(({ m, jp: j }) => (
              <tr key={m.id} className="border-t border-zinc-800">
                <td className={td}>{m.home} v {m.away}</td>
                <td className={`${td} font-semibold uppercase text-amber-400`}>{j!.pick}</td>
                <td className={td}>{fmtPct(j!.confidence)}</td>
                <td className={td}>{j!.parlayScore.toFixed(3)}</td>
                <td className={td}>{j!.upsetVulnerable ? <span className="text-rose-400">upset</span> : '—'}</td>
              </tr>
            ))}
            {!jp.length && <tr><td className={td} colSpan={5}>No jackpot matches yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-blue-500/25 bg-zinc-900/60 p-3">
        <h3 className="mb-2 text-xs font-bold text-blue-400">STANDARD — EV Maximizing Table</h3>
        <table className="w-full">
          <thead><tr><th className={th}>Match</th><th className={th}>Pick</th><th className={th}>Conf</th><th className={th}>Best EV</th><th className={th}>Gate</th></tr></thead>
          <tbody>
            {std.map(({ m, std: st }) => {
              const best = st!.portfolio.filter((p) => p.ev > 0).sort((x, y) => y.ev - x.ev)[0];
              return (
                <tr key={m.id} className="border-t border-zinc-800">
                  <td className={td}>{m.home} v {m.away}</td>
                  <td className={`${td} font-semibold uppercase text-blue-400`}>{st!.pick}</td>
                  <td className={td}>{fmtPct(st!.confidence)}</td>
                  <td className={td}>{best ? <span className="text-emerald-400">+{fmtPct(best.ev)}</span> : '—'}</td>
                  <td className={td}>{st!.thresholdPass ? <span className="text-emerald-400">✓</span> : <span className="text-rose-400">✗</span>}</td>
                </tr>
              );
            })}
            {!std.length && <tr><td className={td} colSpan={5}>No standard matches yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
