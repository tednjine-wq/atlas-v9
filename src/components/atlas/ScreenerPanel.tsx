'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { emptyMatch, DC_RHO_STANDARD } from '@/lib/v9/atlas-types';
import type { Match, AtlasAnalysis } from '@/lib/v9/atlas-types';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { atlasAnalyseJackpotV9 } from '@/lib/v9/engines/jackpot';
import { computeExtendedMarketsV9 } from '@/lib/v9/markets/extended-markets';
import { parseFixtureList } from '@/lib/v9/parsers/fixture-parser';
import { parseBetikaList } from '@/lib/v9/parsers/betika-parser';
import { qualityStandard, qualityJackpot, buildJackpotTicket, buildStandardSlate } from '@/lib/v9/analysis/screener';
import type { FixtureQuality } from '@/lib/v9/analysis/screener';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

interface ExtEdge { label: string; ev: number; odds: number; }
interface Row { m: Match; a: AtlasAnalysis; q: FixtureQuality; ext: ExtEdge | null; flat: Record<string, number> | null; }

type EdgeCat = 'floor' | 'single' | 'trap' | 'none';
const CAT_META: Record<EdgeCat, { label: string; cls: string; desc: string }> = {
  floor: { label: '🟢 FLOOR — bet', cls: 'border-emerald-500/50 text-emerald-300', desc: 'EV 0–6% or trusted market: the proven profitable band' },
  single: { label: '🟡 SINGLES — tiny stake', cls: 'border-amber-500/50 text-amber-300', desc: 'Edge present but guard-filtered: 0.5–1% singles only' },
  trap: { label: '🔴 TRAPS — skip', cls: 'border-rose-500/50 text-rose-300', desc: 'EV >6%: the hi-band mirage that bled −50u' },
  none: { label: '⚪ NO EDGE', cls: 'border-zinc-600 text-zinc-400', desc: 'EV ≤0 or jackpot leg: nothing to bet' },
};

const ADV_TARGET = 0.40;
const TRUST_LOWER = 0.55;
const TRUST_MIN_RES = 5;
const MODEL_MIN = 0.65;

export default function ScreenerPanel() {
  const matches = useAtlasStore((s) => s.matches);
  const phi = useAtlasStore((s) => s.phi);
  const standardParams = useAtlasStore((s) => s.standardParams);
  const updateMatch = useAtlasStore((s) => s.updateMatch);
  const snapshotClosing = useAtlasStore((s) => s.snapshotClosing);
  const marketPosteriors = useAtlasStore((s) => s.marketPosteriors);
  const [text, setText] = useState('');
  const [asJackpot, setAsJackpot] = useState(false);
  const [ticket, setTicket] = useState<string[]>([]);
  const [pending, setPending] = useState<null | 'jp' | 'std'>(null);
  const [sentMsg, setSentMsg] = useState('');
  const [cat, setCat] = useState<'all' | EdgeCat>('all');
  const [overlayText, setOverlayText] = useState('');

  const trusted = useMemo(() => Object.entries(marketPosteriors)
    .map(([key, p]) => {
      const [market, pick] = key.split(':');
      const n = p.alpha + p.beta;
      const mean = p.alpha / n;
      const se = Math.sqrt((mean * (1 - mean)) / n);
      return { market, pick, mean, lower: mean - 1.96 * se, resolved: n - 2 };
    })
    .filter((t) => t.lower > TRUST_LOWER && t.resolved >= TRUST_MIN_RES),
  [marketPosteriors]);

  const flatKeyFor = (market: string, pick: string): string | null => {
    const up = pick.toUpperCase();
    const dir = up.includes('OVER') ? 'Over' : up.includes('UNDER') ? 'Under' : '';
    const line = (up.match(/(\d+\.\d+)/) ?? [])[1]?.replace('.', '') ?? '';
    if (market === 'btts_yes') return 'bttsYes';
    if (market === 'btts_no') return 'bttsNo';
    if (!dir || !line) return null;
    if (/^over\d+$/.test(market)) return `over${line}`;
    if (/^under\d+$/.test(market)) return `under${line}`;
    if (market === 'home_over25') return `home${dir}${line}`;
    if (market === 'away_over25') return `away${dir}${line}`;
    return null;
  };

  const trustedFor = (flat: Record<string, number> | null) => {
    if (!flat) return null;
    for (const t of trusted) {
      const fk = flatKeyFor(t.market, t.pick);
      if (fk && (flat[fk] ?? 0) >= MODEL_MIN) return t;
    }
    return null;
  };

  // v9.10 part 99: Constitution edge classifier
  const edgeCat = (r: Row): EdgeCat => {
    if (r.m.gameType === 'jackpot') return 'none';
    const ev = r.q.maxEV;
    if (ev > 0.06) return 'trap';
    if (ev <= 0) return 'none';
    if (ev <= 0.03) return 'floor';
    const t = trustedFor(r.flat);
    return r.a.margin >= 0.06 || (t && t.market !== '1x2') ? 'floor' : 'single';
  };

  const rows = useMemo<Row[]>(() => matches
    .filter((m) => parseFloat(m.h) > 1 && parseFloat(m.d) > 1 && parseFloat(m.a) > 1)
    .map((m): Row | null => {
      try {
        if (m.gameType === 'jackpot') {
          const a = atlasAnalyseJackpotV9(m, phi);
          return { m, a, q: qualityJackpot(a), ext: null, flat: null };
        }
        const a = atlasAnalyseV9(m, phi, standardParams);
        const ext = computeExtendedMarketsV9(
          a.scoreMatrix, a.calibration.lambdaH, a.calibration.lambdaA,
          DC_RHO_STANDARD, m.userOdds,
        );
        // part 103: only core markets drive EV/category — HT/exact/AH spots are model noise
        const CORE_KEY = (k: string) =>
          /^(over|under)\d+$/.test(k) || /^btts(Yes|No)$/.test(k) ||
          /^dc(1X|X2|12)$/.test(k) || /^(home|away)(Over|Under)\d+$/.test(k);
        const coreBets = ext.topEvBets.filter((b) => CORE_KEY(b.key));
        const best = coreBets.length ? coreBets[0] : null;
        const extEdge = best && best.ev > 0 ? { label: best.label, ev: best.ev, odds: best.odds } : null;
        const base = qualityStandard(a);
        const q: FixtureQuality = {
          ...base,
          score: Math.min(100, base.score + (extEdge ? Math.min(15, Math.round(extEdge.ev * 200)) : 0)),
          maxEV: Math.max(base.maxEV, extEdge?.ev ?? -1),
        };
        return { m, a, q, ext: extEdge, flat: ext.flat };
      } catch { return null; }
    })
    .filter((r): r is Row => r !== null)
    .sort((x, y) => y.q.score - x.q.score),
  [matches, phi, standardParams]);

  const catCounts = useMemo(() => {
    const c: Record<EdgeCat, number> = { floor: 0, single: 0, trap: 0, none: 0 };
    for (const r of rows) c[edgeCat(r)]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, trusted]);

  const shownRows = cat === 'all' ? rows : rows.filter((r) => edgeCat(r) === cat);

  // part 107: merge deep-scraped market odds onto existing matches
  const mergeOverlay = () => {
    const nm2 = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    let n = 0;
    for (const line of overlayText.split(/\n/)) {
      const parts = line.split('|').map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const hdr = parts[0].match(/^(.+?)\s+vs\.?\s+(.+)$/i);
      if (!hdr) continue;
      const key = nm2(hdr[1]) + ' ' + nm2(hdr[2]);
      const target = matches.find((m) => nm2(m.home) + ' ' + nm2(m.away) === key);
      if (!target) continue;
      const add: Record<string, number> = {};
      for (const p of parts.slice(1)) {
        const kv = p.match(/^([a-zA-Z0-9]+)\s+(\d+\.\d+)$/);
        if (kv) add[kv[1]] = parseFloat(kv[2]);
      }
      if (Object.keys(add).length) { updateMatch(target.id, { userOdds: { ...target.userOdds, ...add } }); n++; }
    }
    setSentMsg(`🧩 Overlay merged onto ${n} match${n === 1 ? '' : 'es'}`);
    setOverlayText('');
  };

  const parsed = useMemo(() => {
    // part 102: Betika first — it carries the extra market columns;
    // the generic parser only handles date-less SportPesa pastes
    const p = parseBetikaList(text);
    return p.length ? (p as ReturnType<typeof parseFixtureList>) : parseFixtureList(text);
  }, [text]);

  const ticketShape = rows.map((r) => ({ id: r.m.id, league: r.m.league, q: r.q }));

  const stdShape = rows
    .filter((r) => r.m.gameType !== 'jackpot')
    .filter((r) => {
      const ev = r.q.maxEV;
      if (ev <= 0) return false;
      if (ev <= 0.03) return true;
      if (ev <= 0.06) return r.a.margin >= 0.06;
      return false; // part 97 floor policy
    })
    .map((r) => ({ id: r.m.id, league: r.m.league, q: r.q }));

  const syncStars = (ids: string[]) => {
    for (const r of rows) updateMatch(r.m.id, { starred: ids.includes(r.m.id) });
  };
  const applyTicket = (ids: string[]) => { setTicket(ids); syncStars(ids); };

  useEffect(() => {
    if (!pending || !rows.length) return;
    const built = pending === 'jp' ? buildJackpotTicket(ticketShape) : buildStandardSlate(stdShape);
    const trustedIds = rows
      .filter((r) => {
        if (r.m.gameType === 'jackpot') return false;
        const t = trustedFor(r.flat);
        return !!t && t.market !== '1x2'; // constitution: no raw 1X2 auto-bets
      })
      .map((r) => r.m.id);
    applyTicket(Array.from(new Set([...ticket, ...built, ...trustedIds])));
    if (trustedIds.length) setSentMsg(`🛡 ${trustedIds.length} trusted-market leg${trustedIds.length > 1 ? 's' : ''} auto-starred`);
    setPending(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, rows]);

  const importFixtures = () => {
    if (!parsed.length) return;
    useAtlasStore.setState((s) => ({
      matches: [
        ...s.matches,
        ...parsed.map((f) => {
          const base = emptyMatch(crypto.randomUUID());
          const userOdds: Record<string, number> = { ...base.userOdds, ...(f.userOdds ?? {}) };
          // part 101: Betika table extras → extended-market odds
          const extra = f as Partial<Record<'dc1X' | 'dc12' | 'dcX2' | 'over25' | 'under25' | 'bttsYes' | 'bttsNo', number>>;
          for (const k of ['dc1X', 'dc12', 'dcX2', 'over25', 'under25', 'bttsYes', 'bttsNo'] as const) {
            const v = extra[k];
            if (typeof v === 'number' && v > 1) userOdds[k] = v;
          }
          return {
            ...base, ...f,
            userOdds,
            gameType: asJackpot ? ('jackpot' as const) : ('standard' as const),
          };
        }),
      ],
    }));
    setPending(asJackpot ? 'jp' : 'std');
    setText('');
  };

  const snapshot = () => {
    if (!parsed.length) return;
    const KEY = 'atlas_v9_snap_first';
    let first: Record<string, number> = {};
    try { first = JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { first = {}; }
    const now = Date.now();
    const normKey = (h: string, a: string) => (h + ' ' + a).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const eligible = parsed.filter((f) => {
      const k = normKey(f.home, f.away);
      if (!first[k]) { first[k] = now; return false; }
      return now - first[k] >= 3 * 3600 * 1000;
    });
    localStorage.setItem(KEY, JSON.stringify(first));
    if (!eligible.length) {
      setSentMsg('⏳ Too early — closing odds only update ≥3h after first snapshot (real drift only).');
      setText('');
      return;
    }
    const n = snapshotClosing(eligible);
    setSentMsg(`📸 Closing odds captured for ${n} prediction${n === 1 ? '' : 's'} — CLV from ≥3h drift`);
    setText('');
  };

  const toggle = (id: string) =>
    applyTicket(ticket.includes(id) ? ticket.filter((x) => x !== id) : [...ticket, id]);

  const sendToMatches = () => {
    if (!ticket.length) return;
    syncStars(ticket);
    setSentMsg(`➡ ${ticket.length} selected match${ticket.length > 1 ? 'es' : ''} sent to Matches (★ Selected)`);
    window.dispatchEvent(new CustomEvent('atlas:tab', { detail: 'Matches' }));
  };

  const ticketRows = rows.filter((r) => ticket.includes(r.m.id));
  const parlayProb = ticketRows.reduce((p, r) => p * r.q.legProb, 1);
  const avgEV = ticketRows.length
    ? ticketRows.reduce((s, r) => s + Math.max(r.q.maxEV, 0), 0) / ticketRows.length : 0;

  const advisor = (() => {
    if (!ticketRows.length) return null;
    const n = ticketRows.length;
    const sortedDesc = [...ticketRows].sort((a, b) => b.q.legProb - a.q.legProb);
    let comb = 1;
    const kept: Row[] = [];
    for (const r of sortedDesc) {
      if (kept.length >= 2 && comb * r.q.legProb < ADV_TARGET) break;
      kept.push(r);
      comb *= r.q.legProb;
    }
    const dropped = sortedDesc.slice(kept.length);
    const geomean = Math.pow(Math.max(parlayProb, 1e-9), 1 / n);
    const slipSize = Math.min(n, Math.max(2, Math.floor(Math.log(ADV_TARGET) / Math.log(Math.min(geomean, 0.99)))));
    const slips = Math.ceil(n / slipSize);
    const slipProb = Math.pow(geomean, slipSize);
    const wipeoutSplit = Math.pow(1 - slipProb, slips);
    return { n, sortedDesc, kept, dropped, slipSize, slips, slipProb, wipeoutSplit };
  })();

  const preflight = (() => {
    if (ticketRows.length < 2) return null;
    const legs = ticketRows.map((r) => {
      const odds = r.a.pick === 'home' ? parseFloat(r.m.h) : r.a.pick === 'draw' ? parseFloat(r.m.d) : parseFloat(r.m.a);
      return { name: `${r.m.home} v ${r.m.away}`, pick: r.a.pick, odds, p: r.q.legProb };
    });
    const combOdds = legs.reduce((s, l) => s * (l.odds > 1 ? l.odds : 1), 1);
    const bookImpl = legs.reduce((s, l) => s * (1 / (l.odds > 1 ? l.odds : 1)), 1);
    const ev = parlayProb * combOdds - 1;
    const kelly = ev > 0 && combOdds > 1 ? Math.max(0, ev / (combOdds - 1)) : 0;
    const shortLegs = legs.filter((l) => l.odds > 1 && l.odds < 1.5).length;
    const hiLegs = ticketRows.filter((r) => r.q.maxEV > 0.06).length;
    let stake = Math.min(kelly, 0.02);
    if (combOdds < 1.8) stake = Math.min(stake, 0.01);
    if (shortLegs > 0) stake *= 0.5;
    return { legs, combOdds, bookImpl, ev, kelly, shortLegs, hiLegs, stake, fairOdds: parlayProb > 0 ? 1 / parlayProb : 0 };
  })();

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
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button onClick={importFixtures} disabled={!parsed.length}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
            Import {parsed.length} fixtures
          </button>
          <button onClick={snapshot} disabled={!parsed.length}
            title="Re-paste the SAME card ~1h before kickoff: new prices become closing odds, CLV auto-computed"
            className="rounded-lg border border-teal-600 px-3 py-1.5 text-xs font-semibold text-teal-300 hover:bg-teal-500/10 disabled:opacity-40">
            📸 Snapshot closing odds
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-zinc-400">
            <input type="checkbox" checked={asJackpot} onChange={(e) => setAsJackpot(e.target.checked)} className="accent-amber-500" />
            import as Jackpot legs
          </label>
        </div>
        <div className="mt-1 text-[10px] text-zinc-500">
          First paste = import & auto-build. Pre-kickoff re-paste = 📸 closing snapshot (no duplicates, CLV auto). Click rows to curate, ➕ Send to push picks to Matches.
        </div>
        {sentMsg && <div className="mt-1 text-[10px] text-teal-400">{sentMsg}</div>}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-bold text-zinc-300">🧩 DEEP-MARKETS OVERLAY (paste tools/deep.mjs output)</h3>
          <button onClick={mergeOverlay} className="rounded-lg bg-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-indigo-500">
            Merge odds overlay
          </button>
        </div>
        <textarea value={overlayText} onChange={(e) => setOverlayText(e.target.value)}
          placeholder={'Fc Sevastopol vs Fc Rubin Yalta | over15 1.30 | under15 3.00 | bttsYes 1.71'}
          className="h-16 w-full rounded-lg border border-zinc-700 bg-zinc-950 p-2 font-mono text-[10px] text-zinc-300 focus:border-indigo-500 focus:outline-none" />
      </div>

      {trusted.length > 0 && (
        <div className="rounded-xl border border-emerald-500/25 bg-zinc-900/60 p-2 text-[10px] text-zinc-400">
          🛡 <b className="text-emerald-300">TRUSTED MARKETS</b> (CI lower &gt;55%, n≥5):{' '}
          {trusted.map((t) => `${t.market} ${t.pick} ${(t.mean * 100).toFixed(0)}%`).join(' · ')}
          <span className="text-zinc-500"> — matching legs auto-star on import (🛡 in WHY column)</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setCat('all')}
          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${cat === 'all' ? 'border-blue-500 text-blue-300' : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'}`}>
          ALL ({rows.length})
        </button>
        {(Object.keys(CAT_META) as EdgeCat[]).map((k) => (
          <button key={k} onClick={() => setCat(cat === k ? 'all' : k)} title={CAT_META[k].desc}
            className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${cat === k ? CAT_META[k].cls : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'}`}>
            {CAT_META[k].label} ({catCounts[k]})
          </button>
        ))}
        <button
          onClick={() => applyTicket(Array.from(new Set([...ticket, ...rows.filter((r) => edgeCat(r) === 'floor').map((r) => r.m.id)])))}
          className="ml-auto rounded-lg bg-emerald-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-emerald-500">
          ★ Star all FLOOR legs
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => applyTicket(buildJackpotTicket(ticketShape))}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500">
          🎰 Auto-Build Jackpot Ticket (8 legs, ≤2 per league)
        </button>
        <button onClick={() => applyTicket(buildStandardSlate(stdShape))}
          title="Band rule: EV 0-3% any venue · 3-6% margin ≥6% · >6% skipped (floor policy)"
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500">
          📊 Auto-Build Standard Slate (EV-guarded)
        </button>
        <button onClick={sendToMatches} disabled={!ticket.length}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-500 disabled:opacity-40">
          ➕ Send {ticket.length || ''} selected to Matches
        </button>
        {ticket.length > 0 && (
          <button onClick={() => applyTicket([])} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800">
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

      {advisor && (
        <div className="rounded-xl border border-fuchsia-500/25 bg-zinc-900/60 p-3">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-xs font-bold text-fuchsia-300">🎯 MULTI-BET ADVISOR (target ≥40% slip-hit)</h3>
            <span className={`text-[10px] font-bold tabular-nums ${parlayProb >= ADV_TARGET ? 'text-emerald-400' : 'text-rose-400'}`}>
              current slip: {fmtPct(parlayProb)}
            </span>
          </div>
          <div className="space-y-1 text-[11px] text-zinc-300">
            <div className="text-zinc-400">
              Weakest legs: {advisor.sortedDesc.slice(-3).map((r) => `${r.m.home} v ${r.m.away} (${fmtPct(r.q.legProb)})`).join(' · ')}
            </div>
            {advisor.dropped.length > 0 ? (
              <div className="text-amber-300">
                One slip ≥40% needs ≤{advisor.kept.length} legs — trim {advisor.dropped.length}: {advisor.dropped.slice(0, 3).map((r) => `${r.m.home} v ${r.m.away}`).join(', ')}{advisor.dropped.length > 3 ? '…' : ''}
                <button onClick={() => applyTicket(advisor.kept.map((r) => r.m.id))}
                  className="ml-2 rounded bg-amber-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-amber-500">
                  ✂️ Trim
                </button>
              </div>
            ) : parlayProb >= ADV_TARGET ? (
              <div className="text-emerald-400">Single slip meets the 40% target ✅</div>
            ) : (
              <div className="text-amber-300">Best achievable slip — below the 40% comfort target. +EV? Then small stake; no EV? Skip.</div>
            )}
            {advisor.slips > 1 && (
              <div className="text-zinc-400">
                Or split {advisor.n} legs into <b className="text-zinc-200">{advisor.slips} slips of ≤{advisor.slipSize} legs</b> (each ≈{fmtPct(advisor.slipProb)} to hit) — wipeout risk ≈{fmtPct(advisor.wipeoutSplit)} vs {fmtPct(1 - parlayProb)} for one big slip.
              </div>
            )}
          </div>
        </div>
      )}

      {preflight && (
        <div className="rounded-xl border border-blue-500/25 bg-zinc-900/60 p-3">
          <h3 className="mb-1 text-xs font-bold text-blue-300">🧮 SLIP PRE-FLIGHT (before you stake)</h3>
          <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-5">
            <div><div className="text-lg font-bold text-zinc-100">@{preflight.combOdds.toFixed(1)}</div><div className="text-[10px] text-zinc-500">combined book odds</div></div>
            <div><div className="text-lg font-bold text-amber-300">{fmtPct(preflight.bookImpl)}</div><div className="text-[10px] text-zinc-500">book-implied all-hit</div></div>
            <div><div className="text-lg font-bold text-emerald-400">{fmtPct(parlayProb)}</div><div className="text-[10px] text-zinc-500">model all-hit</div></div>
            <div><div className={`text-lg font-bold ${preflight.ev > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{preflight.ev > 0 ? '+' : ''}{fmtPct(preflight.ev)}</div><div className="text-[10px] text-zinc-500">slip EV</div></div>
            <div><div className="text-lg font-bold text-cyan-300">{fmtPct(preflight.stake)}</div><div className="text-[10px] text-zinc-500">guarded stake</div></div>
          </div>
          <div className="mt-1 space-y-0.5 text-[10px] text-zinc-500">
            <div>
              Fair odds from model: @{preflight.fairOdds.toFixed(1)} · EV &gt; 0 means the slip price beats your model · Kelly {fmtPct(Math.min(preflight.kelly, 0.02))} → guarded {fmtPct(preflight.stake)}.
            </div>
            {preflight.shortLegs > 0 && (
              <div className="text-amber-400">
                ⚠ {preflight.shortLegs} short-price leg{preflight.shortLegs > 1 ? 's' : ''} (&lt;1.50) — margin territory: stake halved. The historical bleed lives here.
              </div>
            )}
            {preflight.combOdds < 1.8 && (
              <div className="text-amber-400">⚠ Combined odds &lt;1.80 — no-value stack: stake capped at 1%.</div>
            )}
            {preflight.hiLegs > 0 && (
              <div className="text-rose-400">⚠ {preflight.hiLegs} hi-band leg{preflight.hiLegs > 1 ? 's' : ''} (EV &gt;6%) — floor policy: drop from the multi or keep as a tiny single.</div>
            )}
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
            {shownRows.slice(0, 80).map(({ m, a, q, ext, flat }) => (
              <tr key={m.id} onClick={() => toggle(m.id)}
                className={`cursor-pointer border-t border-zinc-800 hover:bg-zinc-800/30 ${ticket.includes(m.id) ? 'bg-teal-500/5' : ''}`}>
                <td className="px-2 py-1.5">
                  <button onClick={(e) => { e.stopPropagation(); toggle(m.id); }}
                    className={ticket.includes(m.id) ? 'text-teal-400' : 'text-zinc-600 hover:text-zinc-300'}>
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
                    <span className={ext.ev > 0.06 && a.margin < 0.08 ? 'text-amber-400' : 'text-emerald-400'}>
                      +{fmtPct(ext.ev)} {ext.label} @{ext.odds.toFixed(2)}{ext.ev > 0.06 && a.margin < 0.08 ? ' ⚠' : ''}
                    </span>
                  ) : q.maxEV > 0 ? (
                    <span className="text-emerald-400">+{fmtPct(q.maxEV)}</span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-[9px] text-zinc-500">
                  {trustedFor(flat) && <span className="mr-1 text-emerald-400">🛡</span>}
                  {q.reasons.join(' · ')}
                </td>
              </tr>
            ))}
            {!shownRows.length && <tr><td colSpan={9} className="px-3 py-6 text-center text-zinc-600">No matches in this category.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}