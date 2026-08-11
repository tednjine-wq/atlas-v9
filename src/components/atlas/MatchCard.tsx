'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Match, Outcome, AtlasAnalysis, AtlasJackpotAnalysis } from '@/lib/v9/atlas-types';
import { DC_RHO_STANDARD, DC_RHO_JACKPOT } from '@/lib/v9/atlas-types';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { atlasAnalyseJackpotV9 } from '@/lib/v9/engines/jackpot';
import { computeExtendedMarketsV9 } from '@/lib/v9/markets/extended-markets';
import { buildRuleNarrative } from '@/lib/v9/analysis/context-engine';
import { generateAnalysisText } from '@/lib/v9/analysis/client-analyse';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { ENGINE_COLORS, fmtPct } from '@/lib/v9/ui/atlas-colors';
import ProbBar from './ProbBar';
import DecorrBadge from './DecorrBadge';
import PortfolioRow from './PortfolioRow';
import ThresholdGate from './ThresholdGate';
import AIAnalysisPanel from './AIAnalysisPanel';
import SmartPasteOdds from './SmartPasteOdds';

export default function MatchCard({ match }: { match: Match }) {
  const phi = useAtlasStore((s) => s.phi);
  const standardParams = useAtlasStore((s) => s.standardParams);
  const updateMatch = useAtlasStore((s) => s.updateMatch);
  const removeMatch = useAtlasStore((s) => s.removeMatch);
  const submitResult = useAtlasStore((s) => s.submitResult);
  const recordPrediction = useAtlasStore((s) => s.recordPrediction);
  const result = useAtlasStore((s) => s.results[match.id]);

  const [showAI, setShowAI] = useState(false);
  const [showMarkets, setShowMarkets] = useState(false);
  const [showText, setShowText] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const isJackpot = match.gameType === 'jackpot';
  const C = ENGINE_COLORS[match.gameType];

  const math = useMemo<AtlasAnalysis | null>(() => {
    try {
      return isJackpot ? atlasAnalyseJackpotV9(match, phi) : atlasAnalyseV9(match, phi, standardParams);
    } catch { return null; }
  }, [match, phi, standardParams, isJackpot]);

  const ext = useMemo(() => {
    if (!math || isJackpot) return null;
    return computeExtendedMarketsV9(
      math.scoreMatrix, math.calibration.lambdaH, math.calibration.lambdaA,
      DC_RHO_STANDARD, match.userOdds,
    );
  }, [math, isJackpot, match.userOdds]);

  useEffect(() => {
    if (math) recordPrediction(match, math);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [math?.pick, math?.confidence]);

  // ✨ Context: LLM (optional) + Elo + weather (free) + rules fallback
  const runContext = async () => {
    if (!math || aiBusy) return;
    setAiBusy(true);
    const rules = buildRuleNarrative(math);
    const parts: string[] = [];
    let prior = match.prior;
    let source: 'ai' | 'rules' = 'rules';
    try {
      const res = await fetch('/api/ai-context', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home: match.home, away: match.away, league: match.league, kickoff: match.kickoff }),
      });
      const data = await res.json();
      if (data?.ai && data.ai.confidence > 0) {
        prior = { pHome: data.ai.pHome, pDraw: data.ai.pDraw, pAway: data.ai.pAway, confidence: data.ai.confidence };
        parts.push(data.ai.narrative);
        source = 'ai';
      }
    } catch { /* fallback */ }
    try {
      const res2 = await fetch('/api/context-data', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ home: match.home, away: match.away, kickoff: match.kickoff }),
      });
      const d2 = await res2.json();
      if (d2?.elo) {
        if (!prior) prior = { pHome: d2.elo.pHome, pDraw: d2.elo.pDraw, pAway: d2.elo.pAway, confidence: d2.elo.confidence };
        parts.push(`Elo strength ${d2.elo.ratingHome} vs ${d2.elo.ratingAway} (prior conf ${d2.elo.confidence})`);
      }
      if (d2?.weather) {
        parts.push(`Weather in ${d2.weather.city}: ${d2.weather.tempC}°C, ${d2.weather.precipMm}mm rain, ${d2.weather.windKmh}km/h wind${d2.weather.precipMm >= 3 ? ' — under profile' : ''}`);
      }
    } catch { /* fallback */ }
    if (!parts.length) parts.push(...rules.map((r) => r.text));
    updateMatch(match.id, { prior, context: { narrative: parts.join(' · '), source, at: Date.now() } });
    setAiBusy(false);
  };

  const jp = isJackpot && math ? (math as AtlasJackpotAnalysis) : null;
  const validOdds = parseFloat(match.h) > 1 && parseFloat(match.d) > 1 && parseFloat(match.a) > 1;
  const inputCls = 'rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 focus:border-blue-500 focus:outline-none';

  return (
    <div className={`rounded-xl border ${C.border} bg-zinc-900/60 p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <input value={match.home} placeholder="Home Team"
          onChange={(e) => updateMatch(match.id, { home: e.target.value } as Partial<Match>)}
          className={`flex-1 ${inputCls}`} />
        <span className="text-[10px] text-zinc-500">vs</span>
        <input value={match.away} placeholder="Away Team"
          onChange={(e) => updateMatch(match.id, { away: e.target.value } as Partial<Match>)}
          className={`flex-1 ${inputCls}`} />
        <button onClick={runContext} disabled={!math || aiBusy} title="Real-world context (Elo, weather, form)"
          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40">
          {aiBusy ? '…' : '✨ AI'}
        </button>
        <button onClick={() => removeMatch(match.id)}
          className="rounded-lg px-2 py-1.5 text-[10px] text-zinc-600 hover:text-rose-400">✕</button>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input value={match.league} placeholder="League"
          onChange={(e) => updateMatch(match.id, { league: e.target.value } as Partial<Match>)} className={inputCls} />
        <input value={match.country} placeholder="Country"
          onChange={(e) => updateMatch(match.id, { country: e.target.value } as Partial<Match>)} className={inputCls} />
        <input value={match.kickoff} placeholder="Kickoff"
          onChange={(e) => updateMatch(match.id, { kickoff: e.target.value } as Partial<Match>)} className={inputCls} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase text-zinc-500">Type:</span>
        <button onClick={() => updateMatch(match.id, { gameType: 'jackpot' } as Partial<Match>)}
          className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${isJackpot ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>
          Jackpot
        </button>
        <button onClick={() => updateMatch(match.id, { gameType: 'standard' } as Partial<Match>)}
          className={`rounded-lg px-2.5 py-1 text-[10px] font-bold ${!isJackpot ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>
          Standard
        </button>
        <span className="mx-1 h-4 w-px bg-zinc-800" />
        {(['h', 'd', 'a'] as const).map((k) => (
          <input key={k} value={match[k]} placeholder={k.toUpperCase()}
            onChange={(e) => updateMatch(match.id, { [k]: e.target.value } as Partial<Match>)}
            className="w-16 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-center text-xs text-zinc-200 focus:border-blue-500 focus:outline-none" />
        ))}
        <button onClick={() => setShowPaste(true)}
          className="rounded-lg border border-zinc-700 px-2 py-1.5 text-[10px] text-zinc-400 hover:bg-zinc-800">Smart Paste</button>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] font-bold ${C.badge}`}>
          {isJackpot ? `JACKPOT ρ=${DC_RHO_JACKPOT}` : `STANDARD ρ=${DC_RHO_STANDARD}`}
        </span>
      </div>
      <div className="text-right text-[9px] text-zinc-500">
        {isJackpot ? 'Decorrelation: DISABLED · SOF: ON · Learning: OFF' : 'Decorrelation: ON · SOF: ON · Learning: ON'}
      </div>

      {math && validOdds ? (
        <>
          <div className="grid grid-cols-3 gap-3">
            <ProbBar label="HOME" value={math.probs.home} barClass={C.barHome} textClass={C.home} compare={math.bookProbs.home} />
            <ProbBar label="DRAW" value={math.probs.draw} barClass={C.barDraw} textClass={C.draw} compare={math.bookProbs.draw} />
            <ProbBar label="AWAY" value={math.probs.away} barClass={C.barAway} textClass={C.away} compare={math.bookProbs.away} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md px-2.5 py-1 text-xs font-bold uppercase ${C.badge}`}>Pick: {math.pick}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
              math.verdict === 'BET'
                ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
              {math.verdict === 'BET' ? '● BET' : '○ NO-BET'}
            </span>
            <ThresholdGate pass={math.thresholdPass} confidence={math.confidence} simMultiplier={math.sim?.confMultiplier} />
            {math.tightGame && <span className="rounded-full bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 text-[10px] text-violet-400">TIGHT GAME</span>}
            {!isJackpot && <DecorrBadge score={math.decorrelation.score} hasRealSpot={math.decorrelation.hasRealSpot} />}
            {math.sofTriggered && <span className="rounded-full bg-violet-500/15 border border-violet-500/30 px-2 py-0.5 text-[10px] text-violet-400">SOF</span>}
            {jp?.upsetVulnerable &&
              <span className="rounded-full bg-rose-500/15 border border-rose-500/30 px-2 py-0.5 text-[10px] text-rose-400">UPSET RISK</span>}
          </div>

          {!isJackpot && <PortfolioRow portfolio={math.portfolio} />}
          {math.marginWarning.msg && <div className="text-[11px] text-amber-400">⚠ {math.marginWarning.msg}</div>}

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setShowAI(!showAI)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800">
              {showAI ? '▾' : '▸'} AI Analysis (9 sections)
            </button>
            {ext && (
              <button onClick={() => setShowMarkets(!showMarkets)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800">
                {showMarkets ? '▾' : '▸'} Extended Markets ({ext.groups.length})
              </button>
            )}
            <button onClick={() => setShowText(!showText)}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800">
              {showText ? '▾' : '▸'} AI Intelligence (full text)
            </button>
          </div>

          {showText && (
            <pre className="whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-[11px] leading-relaxed text-zinc-300">
              {generateAnalysisText(match, phi, standardParams)}
            </pre>
          )}

          {showAI && <AIAnalysisPanel match={match} math={math} ext={ext} phi={phi} isJackpot={isJackpot} />}

          {showMarkets && ext && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {ext.groups.map((g) => (
                <div key={g.name} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-2">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{g.name}</div>
                  <div className="space-y-0.5">
                    {g.items.slice(0, 9).map((it) => (
                      <div key={it.key} className="flex justify-between text-[11px]">
                        <span className="text-zinc-400">{it.label}</span>
                        <span className="tabular-nums">
                          <span className="text-zinc-300">{fmtPct(it.prob)}</span>
                          {it.odds > 1 && <span className={`ml-1.5 ${it.ev > 0 ? 'text-emerald-400 font-semibold' : 'text-zinc-600'}`}>
                            @{it.odds.toFixed(2)} {it.ev > 0 ? `+${fmtPct(it.ev)}` : ''}
                          </span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="text-xs text-zinc-600">Enter valid 1X2 odds (all &gt; 1.00) to run analysis.</div>
      )}

      <div className="flex items-center gap-2 border-t border-zinc-800 pt-2">
        <span className="text-[10px] uppercase text-zinc-500">Log result:</span>
        {(['home', 'draw', 'away'] as Outcome[]).map((o) => (
          <button key={o} onClick={() => submitResult(match.id, o)}
            className={`rounded px-2.5 py-1 text-[10px] font-semibold ${
              result === o ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}>
            {o === 'home' ? 'Home Won' : o === 'draw' ? 'Draw' : 'Away Won'}
          </button>
        ))}
        {result && <span className="text-[10px] text-emerald-400">logged: {result}</span>}
      </div>

      {showPaste && <SmartPasteOdds matchId={match.id} onClose={() => setShowPaste(false)} />}
    </div>
  );
}
