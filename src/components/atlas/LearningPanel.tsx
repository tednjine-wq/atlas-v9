'use client';
import { useMemo, useState } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { parseBetSlip, computeMarketStats, MANUAL_MARKET_OPTIONS } from '@/lib/v9/parsers/bet-slip-parser';
import type { BetMarket } from '@/lib/v9/parsers/bet-slip-parser';
import { parseSportPesaSlip } from '@/lib/v9/parsers/sportpesa-slip';
import type { LearnedParams } from '@/lib/v9/learning/bayesian-learning';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

function ParamsCard({ title, params, color, onRecalibrate }: {
  title: string; params: LearnedParams; color: string; onRecalibrate: () => void;
}) {
  return (
    <div className={`rounded-xl border ${color} bg-zinc-900/60 p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold">{title}</h3>
        <button onClick={onRecalibrate} className="rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700">
          Force Recalibrate
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div><div className="font-bold text-zinc-100">{params.totalResolved}</div><div className="text-[9px] text-zinc-500">resolved</div></div>
        <div><div className="font-bold text-zinc-100">{fmtPct(params.hitRates.overall)}</div><div className="text-[9px] text-zinc-500">hit rate</div></div>
        <div><div className={`font-bold ${params.trend === 'improving' ? 'text-emerald-400' : params.trend === 'declining' ? 'text-rose-400' : 'text-zinc-300'}`}>{params.trend}</div><div className="text-[9px] text-zinc-500">trend</div></div>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1 text-[10px] text-zinc-400 tabular-nums">
        <span>drawBoost {params.drawBoost.toFixed(3)}</span>
        <span>SOF thr {params.sofThreshold.toFixed(3)}</span>
        <span>ρ adj {params.rhoAdjust.toFixed(3)}</span>
        <span>upset {params.upsetWeight.toFixed(3)}</span>
      </div>
      <div className="mt-1 text-[9px] text-zinc-600">β-binomial posterior · H α={params.posteriors.home.alpha.toFixed(1)} · D α={params.posteriors.draw.alpha.toFixed(1)} · A α={params.posteriors.away.alpha.toFixed(1)}</div>
    </div>
  );
}

const toBetMarket = (key: string): BetMarket => {
  if (/^(over|under)(15|25|35)$/.test(key)) return key as BetMarket;
  if (key === 'bttsYes') return 'btts_yes' as BetMarket;
  if (key === 'bttsNo') return 'btts_no' as BetMarket;
  if (/^dc/.test(key)) return 'double_chance' as BetMarket;
  if (/^(eh|ah)/.test(key)) return 'asian_handicap' as BetMarket;
  if (/^ht/.test(key)) return 'half_time_result' as BetMarket;
  if (/^home/.test(key)) return 'home_over25' as BetMarket;
  if (/^away/.test(key)) return 'away_over25' as BetMarket;
  return 'other' as BetMarket;
};

export default function LearningPanel() {
  const predictions = useAtlasStore((s) => s.predictions);
  const standardParams = useAtlasStore((s) => s.standardParams);
  const jackpotParams = useAtlasStore((s) => s.jackpotParams);
  const forceRecalibrate = useAtlasStore((s) => s.forceRecalibrate);
  const clearLearningData = useAtlasStore((s) => s.clearLearningData);
  const addFeedback = useAtlasStore((s) => s.addFeedback);
  const feedback = useAtlasStore((s) => s.feedback);

  const [slipText, setSlipText] = useState('');
  const sportPesaSlip = useMemo(() => parseSportPesaSlip(slipText), [slipText]);

  // v9.22: logged bets carry pick + odds + FT/HT result for learning
  const parsedBets = useMemo(() => {
    if (sportPesaSlip && sportPesaSlip.legs.length) {
      return sportPesaSlip.legs.map((l) => ({
        teams: `${l.home} v ${l.away}${l.ft ? ` · FT ${l.ft}${l.ht ? ` (HT ${l.ht})` : ''}` : ''}`,
        market: toBetMarket(l.marketKey),
        pick: l.pick,
        odds: l.odds,
        result: l.won === true ? 'won' : l.won === false ? 'lost' : 'pending',
      })) as ReturnType<typeof parseBetSlip>;
    }
    return parseBetSlip(slipText);
  }, [sportPesaSlip, slipText]);

  const marketStats = useMemo(() => computeMarketStats(parsedBets), [parsedBets]);

  const [form, setForm] = useState<{
    matchLabel: string; market: BetMarket; pick: string; odds: string;
    closing: string; result: 'won' | 'lost' | 'pending';
  }>({ matchLabel: '', market: '1x2', pick: 'Home', odds: '1.85', closing: '', result: 'pending' });

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <ParamsCard title="STANDARD PARAMS (beta-binomial, time-decay)" params={standardParams} color="border-blue-500/25" onRecalibrate={() => forceRecalibrate('standard')} />
        <ParamsCard title="JACKPOT PARAMS (isolated — parlay purity)" params={jackpotParams} color="border-amber-500/25" onRecalibrate={() => forceRecalibrate('jackpot')} />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-400">
          {predictions.length} predictions · {predictions.filter((p) => p.result).length} resolved · auto-recalibration every 5 resolved (never below 5)
        </div>
        <button onClick={clearLearningData} className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-[11px] text-rose-400 hover:bg-rose-500/10">
          Reset All Learning Data
        </button>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-bold text-zinc-300">BET SLIP IMPORT (23 market types + SportPesa slip table)</h3>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${parsedBets.length ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
            {parsedBets.length} bets detected
          </span>
        </div>
        <textarea value={slipText} onChange={(e) => setSlipText(e.target.value)}
          placeholder={'Paste bet history or a SportPesa slip…\nArsenal vs Chelsea\nPick: Over 2.5 (1.85) ✅'}
          className="h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-300 focus:border-blue-500 focus:outline-none" />
        {sportPesaSlip && sportPesaSlip.legs.length > 0 && (
          <div className="mt-1 text-[10px] text-teal-400">
            🎫 Bet {sportPesaSlip.betId || '—'} · stake {sportPesaSlip.stake || 0} · possible win {sportPesaSlip.possibleWin || 0} · {sportPesaSlip.status || '—'} · {sportPesaSlip.description || '—'}
          </div>
        )}
        {parsedBets.length > 0 && (
          <>
            <button
              onClick={() => { parsedBets.forEach((b) => addFeedback({ matchLabel: b.teams, market: b.market, pick: b.pick, odds: b.odds, result: b.result })); setSlipText(''); }}
              className="mt-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500">
              Import {parsedBets.length} bets
            </button>
            {marketStats.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {marketStats.map((s) => (
                  <span key={s.market} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-300 tabular-nums">
                    {s.market}: {s.wins}/{s.total} ({fmtPct(s.hitRate)})
                  </span>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <h3 className="mb-2 text-xs font-bold text-zinc-300">MANUAL BET ENTRY (closing odds optional → CLV)</h3>
        <div className="flex flex-wrap gap-2">
          <input value={form.matchLabel} onChange={(e) => setForm({ ...form, matchLabel: e.target.value })} placeholder="Match"
            className="w-40 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none" />
          <select value={form.market} onChange={(e) => {
            const opt = MANUAL_MARKET_OPTIONS.find((o) => o.value === e.target.value)!;
            setForm({ ...form, market: e.target.value as BetMarket, pick: opt.picks[0] });
          }} className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300">
            {MANUAL_MARKET_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={form.pick} onChange={(e) => setForm({ ...form, pick: e.target.value })}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300">
            {(MANUAL_MARKET_OPTIONS.find((o) => o.value === form.market)?.picks ?? []).map((p) => <option key={p}>{p}</option>)}
          </select>
          <input value={form.odds} onChange={(e) => setForm({ ...form, odds: e.target.value })} placeholder="Odds"
            className="w-20 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none" />
          <input value={form.closing} onChange={(e) => setForm({ ...form, closing: e.target.value })} placeholder="Closing (opt)"
            className="w-24 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300 focus:border-teal-500 focus:outline-none" />
          <select value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value as 'won' | 'lost' | 'pending' })}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300">
            <option value="pending">Pending</option><option value="won">Won</option><option value="lost">Lost</option>
          </select>
          <button
            onClick={() => {
              const c = parseFloat(form.closing);
              addFeedback({
                matchLabel: form.matchLabel || 'Manual', market: form.market, pick: form.pick,
                odds: parseFloat(form.odds) || 1, closingOdds: c > 1 ? c : undefined, result: form.result,
              });
            }}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
            Add Bet
          </button>
        </div>
      </div>

      {feedback.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <h3 className="mb-2 text-xs font-bold text-zinc-300">BET HISTORY ({feedback.length})</h3>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {[...feedback].reverse().slice(0, 50).map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded bg-zinc-950/60 px-2 py-1 text-[11px]">
                <span className="text-zinc-300">{f.matchLabel} · {f.market} · {f.pick}</span>
                <span className="tabular-nums">
                  <span className="text-zinc-400">@{f.odds.toFixed(2)}</span>
                  {f.closingOdds && f.closingOdds > 1 && (
                    <span className={f.odds / f.closingOdds - 1 > 0 ? 'text-teal-400' : 'text-zinc-500'}>
                      {' '}→ {f.closingOdds.toFixed(2)} ({((f.odds / f.closingOdds - 1) * 100).toFixed(1)}%)
                    </span>
                  )}{' '}
                  <span className={f.result === 'won' ? 'text-emerald-400' : f.result === 'lost' ? 'text-rose-400' : 'text-zinc-500'}>{f.result}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
