'use client';
import { useMemo, useState } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { parseBetSlip, computeMarketStats, MANUAL_MARKET_OPTIONS } from '@/lib/v9/parsers/bet-slip-parser';
import type { BetMarket } from '@/lib/v9/parsers/bet-slip-parser';
import { parseSportPesaSlip } from '@/lib/v9/parsers/sportpesa-slip';
import { parseBetikaSlip } from '@/lib/v9/parsers/betika-slip';
import type { LearnedParams } from '@/lib/v9/learning/bayesian-learning';
import type { Outcome } from '@/lib/v9/atlas-types';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const predLabel = (p: unknown, fallback: string) =>
  ((p as { label?: string }).label ?? fallback);

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

const marketLabel = (market: string, pick: string) => {
  const m = market.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return `${m} · ${pick}`;
};

export default function LearningPanel() {
  const predictions = useAtlasStore((s) => s.predictions);
  const results = useAtlasStore((s) => s.results);
  const submitResult = useAtlasStore((s) => s.submitResult);
  const standardParams = useAtlasStore((s) => s.standardParams);
  const jackpotParams = useAtlasStore((s) => s.jackpotParams);
  const forceRecalibrate = useAtlasStore((s) => s.forceRecalibrate);
  const clearLearningData = useAtlasStore((s) => s.clearLearningData);
  const addFeedback = useAtlasStore((s) => s.addFeedback);
  const feedback = useAtlasStore((s) => s.feedback);
  const marketPosteriors = useAtlasStore((s) => s.marketPosteriors);
  const predictionLabels = useAtlasStore((s) => s.predictionLabels);

  const [slipText, setSlipText] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [closingInput, setClosingInput] = useState<Record<string, string>>({});
  const sportPesaSlip = useMemo(() => parseSportPesaSlip(slipText), [slipText]);

  const betikaSlip = useMemo(() => parseBetikaSlip(slipText), [slipText]);
  
  const parsedBets = useMemo(() => {
    if (sportPesaSlip && sportPesaSlip.legs.length && !(betikaSlip && betikaSlip.events.length)) {
      return sportPesaSlip.legs.map((l) => ({
        teams: `${l.home} v ${l.away}${l.ft ? ` · FT ${l.ft}${l.ht ? ` (HT ${l.ht})` : ''}` : ''}`,
        market: toBetMarket(l.marketKey),
        pick: l.pick,
        odds: l.odds,
        result: l.won === true ? 'won' : l.won === false ? 'lost' : 'pending',
      })) as ReturnType<typeof parseBetSlip>;
    }
    if (betikaSlip && betikaSlip.events.length) {
      return betikaSlip.events.map((e) => ({
        teams: `${e.home} v ${e.away}${e.ft ? ` · FT ${e.ft}` : ''}`,
        market: e.market,
        pick: e.pick,
        odds: e.odds,
        result: e.result,
      })) as ReturnType<typeof parseBetSlip>;
    }
    return parseBetSlip(slipText);
  }, [sportPesaSlip, betikaSlip, slipText]);

  const marketStats = useMemo(() => computeMarketStats(parsedBets), [parsedBets]);

  const resolvable = useMemo(() => {
    return predictions
      .filter((p) => !p.result)
      .map((p) => ({
        p,
        label: predLabel(p, predictionLabels[p.matchId] ?? 'Unknown match (pre-v9.4)'),
      }))
      .slice(-12)
      .reverse();
  }, [predictions, predictionLabels]);

  const [form, setForm] = useState<{
    matchLabel: string; market: BetMarket; pick: string; odds: string;
    closing: string; result: 'won' | 'lost' | 'pending';
  }>({ matchLabel: '', market: '1x2', pick: 'Home', odds: '1.85', closing: '', result: 'pending' });

  const marketRanking = useMemo(() => {
    return Object.entries(marketPosteriors)
      .map(([key, p]) => {
        const [market, pick] = key.split(':');
        const n = p.alpha + p.beta;
        const mean = p.alpha / n;
        const se = Math.sqrt((mean * (1 - mean)) / n);
        return { key, market, pick, alpha: p.alpha, beta: p.beta, n, mean, se };
      })
      .sort((a, b) => b.n - a.n);
  }, [marketPosteriors]);



  // v9.10 weekly evidence digest
  const digest = useMemo(() => {
    const recent = [...feedback].slice(-20);
    const w = recent.filter((f) => f.result === 'won').length;
    const l = recent.filter((f) => f.result === 'lost').length;
    const p = recent.filter((f) => f.result === 'pending').length;
    const clvs = predictions.filter((x) => typeof x.clv === 'number').map((x) => x.clv as number);
    const avgClv = clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : 0;
    const beat = clvs.filter((c) => c > 0).length;
    const top = [...marketRanking].sort((a, b) => b.n - a.n).slice(0, 3);
    return { n: recent.length, w, l, p, clvN: clvs.length, avgClv, beat, top };
  }, [feedback, predictions, marketRanking]);

  const copyDigest = () => {
    const hit = digest.w + digest.l ? Math.round((100 * digest.w) / (digest.w + digest.l)) : 0;
    const lines = [
      `ATLAS EVIDENCE DIGEST — ${new Date().toLocaleDateString()}`,
      `Bets (latest ${digest.n}): ${digest.w}W ${digest.l}L ${digest.p}P · hit ${hit}%`,
      `CLV: avg ${(digest.avgClv * 100).toFixed(1)}% over ${digest.clvN} closes · ${digest.beat}/${digest.clvN} beat the line`,
      `Top markets: ${digest.top.map((t) => `${t.market} ${t.pick} ${(t.mean * 100).toFixed(0)}% (n${t.n - 2})`).join(' · ')}`,
    ];
    navigator.clipboard.writeText(lines.join('\n'));
  };

  const totalMarketResolved = marketRanking.reduce((s, m) => s + m.n - 2, 0);

  const orphanFor = (label: string) => {
    const core = norm(label.split('·')[0]);
    return predictions.find((p) =>
      !p.result && norm(predLabel(p, predictionLabels[p.matchId] ?? '')) === core);
  };

  const closingFor = (id: string) => {
    const c = parseFloat(closingInput[id] ?? '');
    return c > 1 ? c : undefined;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <ParamsCard title="STANDARD PARAMS (beta-binomial, time-decay)" params={standardParams} color="border-blue-500/25" onRecalibrate={() => forceRecalibrate('standard')} />
        <ParamsCard title="JACKPOT PARAMS (isolated — parlay purity)" params={jackpotParams} color="border-amber-500/25" onRecalibrate={() => forceRecalibrate('jackpot')} />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-xs text-zinc-400">
          {predictions.length} predictions · {predictions.filter((p) => p.result).length} resolved · {totalMarketResolved} market outcomes · auto-recalibration every 5 resolved (never below 5)
        </div>
        <button onClick={clearLearningData} className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-[11px] text-rose-400 hover:bg-rose-500/10">
          Reset All Learning Data
        </button>
      </div>

      {resolvable.length > 0 && (
        <div className="rounded-xl border border-blue-500/25 bg-zinc-900/60 p-3">
          <h3 className="mb-2 text-xs font-bold text-blue-300">RESOLVE 1X2 PREDICTIONS (survives match clears)</h3>
          <div className="space-y-1">
            {resolvable.map(({ p, label }) => (
              <div key={p.id} className="flex items-center justify-between rounded bg-zinc-950/60 px-2 py-1 text-[11px]">
                <span className="text-zinc-300">
                  {label} · <span className="text-zinc-500">engine: {p.pick}</span>
                </span>
                <span className="flex gap-1">
                  {(['home', 'draw', 'away'] as Outcome[]).map((o) => (
                    <button key={o} onClick={() => submitResult(p.matchId, o)}
                      className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700">
                      {o === 'home' ? 'H' : o === 'draw' ? 'D' : 'A'}
                    </button>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {marketRanking.length > 0 && (
        <div className="rounded-xl border border-teal-500/25 bg-zinc-900/60 p-3">
          <h3 className="mb-2 text-xs font-bold text-teal-300">MARKET CONFIDENCE (β-binomial posteriors per market+pick)</h3>
          <div className="grid gap-1.5 md:grid-cols-2 lg:grid-cols-3">
            {marketRanking.slice(0, 12).map((m) => {
              const confColor = m.mean >= 0.58 ? 'text-emerald-400' : m.mean >= 0.50 ? 'text-amber-400' : 'text-rose-400';
              const ciW = (1.96 * m.se * 100).toFixed(1);
              return (
                <div key={m.key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-zinc-200">{marketLabel(m.market, m.pick)}</span>
                    <span className={`text-[10px] font-bold tabular-nums ${confColor}`}>{(m.mean * 100).toFixed(1)}%</span>
                  </div>
                  <div className="mt-0.5 flex gap-2 text-[9px] text-zinc-500 tabular-nums">
                    <span>{m.n - 2} resolved</span>
                    <span>α {m.alpha.toFixed(1)}</span>
                    <span>β {m.beta.toFixed(1)}</span>
                    <span>±{ciW}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-cyan-500/25 bg-zinc-900/60 p-3">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-bold text-cyan-300">📊 EVIDENCE DIGEST (latest {digest.n} bets)</h3>
          <button onClick={copyDigest}
            className="rounded-lg border border-cyan-600 px-2 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/10">
            📋 Copy digest
          </button>
        </div>
        <div className="grid gap-2 text-[11px] text-zinc-300 md:grid-cols-3">
          <div>
            <span className="text-zinc-500">Bets:</span>{' '}
            <span className="text-emerald-400">{digest.w}W</span>{' '}
            <span className="text-rose-400">{digest.l}L</span>{' '}
            <span className="text-zinc-500">{digest.p}P</span> · hit{' '}
            {digest.w + digest.l ? Math.round((100 * digest.w) / (digest.w + digest.l)) : 0}%
          </div>
          <div>
            <span className="text-zinc-500">CLV:</span> avg{' '}
            <span className={digest.avgClv > 0 ? 'text-teal-400' : 'text-zinc-400'}>{(digest.avgClv * 100).toFixed(1)}%</span>{' '}
            over {digest.clvN} closes · {digest.beat}/{digest.clvN} beat the line
          </div>
          <div>
            <span className="text-zinc-500">Top markets:</span>{' '}
            {digest.top.map((t) => `${t.market} ${t.pick} ${(t.mean * 100).toFixed(0)}%`).join(' · ')}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-zinc-300">BET SLIP IMPORT (SportPesa + Betika + 23 market types)</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => setSlipText('')} disabled={!slipText}
              className="rounded-lg border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 disabled:opacity-40">
              🗑 Clear
            </button>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${parsedBets.length ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-800 text-zinc-500'}`}>
              {parsedBets.length} bets detected
            </span>
          </div>
        </div>
        <textarea value={slipText} onChange={(e) => setSlipText(e.target.value)}
          placeholder={'Paste bet history or a SportPesa slip…\nArsenal vs Chelsea\nPick: Over 2.5 (1.85) ✅'}
          className="h-24 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-xs text-zinc-300 focus:border-blue-500 focus:outline-none" />
        {betikaSlip && betikaSlip.events.length > 0 ? (
          <div className="mt-1 text-[10px] text-teal-400">
            🎫 Betika {betikaSlip.header.betId || '—'} · stake {betikaSlip.header.stake || 0} · possible win {betikaSlip.header.possiblePayout || 0} · {betikaSlip.header.status || '—'} · {betikaSlip.header.tally || '—'}
          </div>
        ) : sportPesaSlip && sportPesaSlip.legs.length > 0 && (
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
          <h3 className="mb-2 text-xs font-bold text-zinc-300">BET HISTORY ({feedback.length}) — click a row to log its 1X2 result</h3>
          <div className="max-h-60 space-y-1 overflow-y-auto">
            {[...feedback].reverse().slice(0, 50).map((f) => {
              const ft = f.matchLabel.match(/FT\s*(\d+)\s*:\s*(\d+)/i);
              const orphan = !f.matchId ? orphanFor(f.matchLabel) : undefined;
              const linkId = f.matchId ?? orphan?.matchId;
              const logged = linkId ? results[linkId] : undefined;
              return (
                <div key={f.id} className="rounded bg-zinc-950/60 px-2 py-1 text-[11px]">
                  <button onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                    className="flex w-full items-center justify-between text-left">
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
                  </button>
                  {expandedId === f.id && (
                    <div className="mt-1 flex flex-wrap items-center gap-1 border-t border-zinc-800 pt-1">
                      {linkId ? (
                        <>
                          <span className="text-[9px] text-zinc-500">LOG 1X2:</span>
                          <input value={closingInput[f.id] ?? ''}
                            onChange={(e) => setClosingInput((c) => ({ ...c, [f.id]: e.target.value }))}
                            placeholder="closing (opt)"
                            className="w-20 rounded border border-zinc-700 bg-zinc-950 px-1.5 py-0.5 text-[10px] text-zinc-300 focus:border-teal-500 focus:outline-none" />
                          {ft && (
                            <button
                              onClick={() => {
                                const x = parseInt(ft[1], 10), y = parseInt(ft[2], 10);
                                submitResult(linkId, x > y ? 'home' : x === y ? 'draw' : 'away', closingFor(f.id));
                                setExpandedId(null);
                              }}
                              className="rounded bg-teal-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-teal-500">
                              ⚡ From FT {ft[1]}:{ft[2]}
                            </button>
                          )}
                          {(['home', 'draw', 'away'] as Outcome[]).map((o) => (
                            <button key={o} onClick={() => { submitResult(linkId, o, closingFor(f.id)); setExpandedId(null); }}
                              className="rounded border border-zinc-700 px-2 py-0.5 text-[10px] font-bold text-zinc-300 hover:bg-zinc-700">
                              {o === 'home' ? 'H' : o === 'draw' ? 'D' : 'A'}
                            </button>
                          ))}
                          {logged && <span className="text-[9px] text-emerald-400">logged: {logged}</span>}
                        </>
                      ) : (
                        <span className="text-[9px] text-zinc-600">No linked prediction (analyzed before v9.4 and match cleared).</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
