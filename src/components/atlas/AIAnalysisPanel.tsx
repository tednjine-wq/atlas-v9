'use client';
import type { Match, AtlasAnalysis, AtlasJackpotAnalysis } from '@/lib/v9/atlas-types';
import type { ExtendedMarkets } from '@/lib/v9/markets/extended-markets';
import { ENGINE_COLORS, fmtPct, fmtOdds } from '@/lib/v9/ui/atlas-colors';
import ProbBar from './ProbBar';
import DecorrBadge from './DecorrBadge';
import ThresholdGate from './ThresholdGate';

interface Props {
  match: Match;
  math: AtlasAnalysis;
  ext: ExtendedMarkets | null;
  phi: number;
  isJackpot: boolean;
}

function Section({ n, title, color, children }: {
  n: string; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={`text-[10px] font-bold ${color}`}>{n}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{title}</span>
      </div>
      {children}
    </div>
  );
}

export default function AIAnalysisPanel({ match, math, ext, phi, isJackpot }: Props) {
  const C = ENGINE_COLORS[isJackpot ? 'jackpot' : 'standard'];
  const jp = isJackpot ? (math as AtlasJackpotAnalysis) : null;
  const best = !isJackpot ? math.portfolio.find((p) => p.isMaxEp) : null;
  const oddsMap = { home: parseFloat(match.h), draw: parseFloat(match.d), away: parseFloat(match.a) };

  return (
    <div className="space-y-2.5">
      <div className={`rounded-lg border p-3 ${C.border} bg-zinc-900/60`}>
        <div className="flex items-center justify-between">
          <div>
            <div className={`text-sm font-bold ${C.accent}`}>ATLAS v9.1 {isJackpot ? 'JACKPOT' : 'STANDARD'} ENGINE</div>
            <div className="text-[11px] text-zinc-500">
              ρ = {isJackpot ? '-0.08 · parlay-max' : '-0.13 · EV-max'} · honest confidence · CLV tracking
            </div>
          </div>
          <div className={`text-2xl font-bold tabular-nums ${C.accent}`}>{fmtPct(math.confidence)}</div>
        </div>
      </div>

      <Section n="02" title="Real-World Context" color="text-zinc-400">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-zinc-300">
          <span>League: <b>{match.league || '—'}</b></span>
          <span>Kickoff: <b>{match.kickoff || '—'}</b></span>
          <span>Odds: <b>{match.h} / {match.d} / {match.a}</b></span>
          <span>Margin: <b className={math.margin > 0.08 ? 'text-amber-400' : ''}>{fmtPct(math.margin)}</b></span>
          <span>λH: <b>{math.calibration.lambdaH.toFixed(2)}</b> · λA: <b>{math.calibration.lambdaA.toFixed(2)}</b></span>
          <span> Calibration: <b>{math.calibration.hybrid.source}{math.calibration.mmMarkets ? ' · multi-market (' + math.calibration.mmMarkets + ' prices)' : ''}</b>{match.prior ? ` (prior conf ${match.prior.confidence.toFixed(0)})` : ''}</span>
        </div>
        {match.context ? (
          <div className="mt-2 rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-[11px] leading-relaxed text-zinc-300">
            <span className={`font-bold ${match.context.source === 'ai' ? 'text-emerald-400' : 'text-sky-400'}`}>
              {match.context.source === 'ai' ? '✨ AI CONTEXT:' : '📐 MODEL CONTEXT:'}
            </span>{' '}
            {match.context.narrative}
          </div>
        ) : (
          <div className="mt-2 text-[10px] text-zinc-600">
            Press ✨ AI on the card for real-world context (Elo strength, weather, form) — works with or without an AI key.
          </div>
        )}
      </Section>

      <Section n="03" title="ATLAS Verdict" color={math.thresholdPass ? 'text-emerald-400' : 'text-rose-400'}>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-md px-2.5 py-1 text-sm font-bold uppercase ${C.badge}`}>{math.pick}</span>
          {/* v9.1 honest verdict */}
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
            math.verdict === 'BET'
              ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
            {math.verdict === 'BET' ? '● BET SIGNAL' : '○ NO-BET (market efficient)'}
          </span>
          <ThresholdGate pass={math.thresholdPass} confidence={math.confidence} simMultiplier={math.sim?.confMultiplier} />
          {math.tightGame && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-400 border border-violet-500/30">TIGHT GAME</span>}
          {!isJackpot && <DecorrBadge score={math.decorrelation.score} hasRealSpot={math.decorrelation.hasRealSpot} />}
          {math.sofTriggered && <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] text-violet-400 border border-violet-500/30">SOF v4</span>}
          {math.decorrOverride && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-400 border border-emerald-500/30">DECORR FLIP</span>}
        </div>
        {jp && (
          <div className="mt-2 text-[11px] text-zinc-400">
            Parlay score <b className="tabular-nums">{jp.parlayScore.toFixed(3)}</b>
            {jp.upsetVulnerable && <span className="ml-2 text-rose-400">⚠ upset vulnerable — secondary: {jp.secondaryPick.toUpperCase()} {fmtPct(jp.secondaryProb)}</span>}
            {jp.skippedDecorrOverride && (
              <span className="ml-2 text-zinc-500">skipped EV flip → {jp.skippedDecorrOverride.wouldFlipTo.toUpperCase()} (+{fmtPct(jp.skippedDecorrOverride.evLost)} EV sacrificed for parlay)</span>
            )}
          </div>
        )}
      </Section>

      <Section n="04" title="Probability Breakdown" color={C.accent}>
        <div className="space-y-2">
          <ProbBar label="HOME" value={math.probs.home} barClass={C.barHome} textClass={C.home} compare={math.bookProbs.home} />
          <ProbBar label="DRAW" value={math.probs.draw} barClass={C.barDraw} textClass={C.draw} compare={math.bookProbs.draw} />
          <ProbBar label="AWAY" value={math.probs.away} barClass={C.barAway} textClass={C.away} compare={math.bookProbs.away} />
        </div>
      </Section>

      <Section n="05" title="Best Bet" color="text-emerald-400">
        {best ? (
          <div className="text-xs text-zinc-300">
            <b className="text-emerald-400 uppercase">{best.outcome}</b> @ {fmtOdds(oddsMap[best.outcome])}
            {' '}· EV <b>{fmtPct(best.ev)}</b> · edge per unit variance {best.sharpe.toFixed(2)}
          </div>
        ) : (
          <div className="text-xs text-zinc-500">
            No positive-EV 1X2 bet at current model probabilities — NO-BET is the correct position{isJackpot ? ' (jackpot mode optimizes parlay probability, not EV)' : ''}.
          </div>
        )}
      </Section>

      {!isJackpot && (
        <Section n="06" title="Staking Advice" color="text-teal-400">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            {math.portfolio.map((p) => (
              <div key={p.outcome} className="rounded bg-zinc-900 p-1.5 border border-zinc-800">
                <div className="text-[10px] uppercase text-zinc-500">{p.outcome}</div>
                <div className="tabular-nums text-teal-300">{fmtPct(p.stake)} stake</div>
                <div className="text-[10px] text-zinc-500">Sharpe {p.sharpe.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {ext && (
        <Section n="07" title="Key Markets" color="text-sky-400">
          <div className="mb-2 text-[11px] text-zinc-300">
            Best market: <b className="text-sky-300">{ext.pOver25 >= 0.5 ? 'Over' : 'Under'} 2.5 Goals + BTTS {ext.pBttsYes >= 0.5 ? 'Yes' : 'No'}</b>
            <span className="ml-2 text-zinc-500">Margin: {fmtPct(math.margin)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([['O2.5', ext.pOver25], ['BTTS', ext.pBttsYes], ['1X', ext.p1X], ['Draw', ext.pDraw], ['U2.5', 1 - ext.pOver25]] as [string, number][]).map(([l, p]) => (
              <span key={l} className="rounded-full bg-sky-500/10 border border-sky-500/25 px-2 py-0.5 text-[11px] text-sky-300 tabular-nums">
                {l} {fmtPct(p)}
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section n="08" title="Most Likely Scores" color="text-violet-400">
        <div className="grid grid-cols-4 gap-1.5">
          {math.scoreMatrix.slice(0, 4).map((s) => (
            <div key={s.s} className="rounded bg-zinc-900 border border-zinc-800 p-1.5 text-center">
              <div className="text-sm font-bold text-violet-300">{s.s}</div>
              <div className="h-1 mt-1 rounded bg-zinc-800"><div className="h-full bg-violet-500 rounded" style={{ width: `${Math.min(100, s.p * 600)}%` }} /></div>
              <div className="text-[10px] text-zinc-500 tabular-nums">{fmtPct(s.p)}</div>
            </div>
          ))}
        </div>
      </Section>

      {ext && ext.topEvBets.length > 0 && (
        <Section n="9a" title="Top Positive-EV Bets" color="text-emerald-400">
          <table className="w-full text-[11px]">
            <tbody>
              {ext.topEvBets.map((b) => (
                <tr key={b.key} className="border-b border-zinc-800/60 last:border-0">
                  <td className="py-1 text-zinc-300">{b.label}</td>
                  <td className="py-1 text-right tabular-nums text-zinc-400">@{b.odds.toFixed(2)}</td>
                  <td className="py-1 text-right tabular-nums text-emerald-400 font-semibold">+{fmtPct(b.ev)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {math.sim && (
        <Section n="9b" title="Monte Carlo Cross-Check" color="text-orange-400">
          <div className="text-[11px] text-zinc-300 space-y-0.5">
            <div>{math.sim.n.toLocaleString()} sims (adaptive) · mean goals <b>{math.sim.meanGoals.toFixed(2)}</b> ± {math.sim.sdGoals.toFixed(2)}</div>
            <div>
              Disagreement: <b className={
                math.sim.disagreement === 'none' ? 'text-emerald-400' :
                math.sim.disagreement === 'low' ? 'text-yellow-400' :
                math.sim.disagreement === 'medium' ? 'text-orange-400' : 'text-rose-400'
              }>{math.sim.disagreement.toUpperCase()}</b> · max Δ {fmtPct(math.sim.maxDelta)}
              {math.sim.recommendation !== 'none' && <> · rec: <b>{math.sim.recommendation}</b></>}
            </div>
            <div className="text-zinc-500">Sim is a cross-check only — grid model remains primary (Rule 5)</div>
          </div>
        </Section>
      )}

      <Section n="9c" title="Key Risk" color="text-rose-400">
        <ul className="text-[11px] text-zinc-400 space-y-0.5 list-disc list-inside">
          {math.verdict === 'NO-BET' && <li className="text-zinc-400">No positive-EV spot — the market is efficient here. NO-BET is a winning decision.</li>}
          {math.tightGame && <li className="text-violet-400">Tight game — if you must participate, prefer Draw No Bet / Double Chance over the raw 1X2 pick.</li>}
          {math.marginWarning.msg && <li className="text-amber-400">{math.marginWarning.msg}</li>}
          {jp?.upsetVulnerable && <li className="text-rose-400">Home/away within 5% — pick is fragile for parlay use.</li>}
          {!math.thresholdPass && <li className="text-rose-400">Confidence below φ={phi} — suppress or reduce stake.</li>}
          {math.sim && math.sim.disagreement === 'high' && <li className="text-orange-400">Monte Carlo strongly disagrees with grid calibration.</li>}
        </ul>
      </Section>
    </div>
  );
}
