'use client';
import { useRef, useState } from 'react';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { computeExtendedMarketsV9 } from '@/lib/v9/markets/extended-markets';
import { DC_RHO_STANDARD, EMPTY_USER_ODDS } from '@/lib/v9/atlas-types';
import type { Match, Outcome } from '@/lib/v9/atlas-types';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

interface Bucket { n: number; hits: number; profit: number; guardedProfit: number; }
interface Report {
  total: number; analyzed: number;
  pickHits: number; pickProfit: number;
  brier: number;
  flags: number; flagHits: number; flagProfit: number; flagProfitGuarded: number;
  lo: Bucket; mid: Bucket; hi: Bucket;
}
interface AggState { files: number; names: string[]; overall: Report; leagues: Record<string, Report>; }

const LS_KEY = 'atlas_v9_stdlab_agg';

const blank = (): Report => ({
  total: 0, analyzed: 0, pickHits: 0, pickProfit: 0, brier: 0,
  flags: 0, flagHits: 0, flagProfit: 0, flagProfitGuarded: 0,
  lo: { n: 0, hits: 0, profit: 0, guardedProfit: 0 },
  mid: { n: 0, hits: 0, profit: 0, guardedProfit: 0 },
  hi: { n: 0, hits: 0, profit: 0, guardedProfit: 0 },
});

const merge = (a: Report, r: Report): Report => ({
  total: a.total + r.total, analyzed: a.analyzed + r.analyzed,
  pickHits: a.pickHits + r.pickHits, pickProfit: a.pickProfit + r.pickProfit,
  brier: a.brier + r.brier,
  flags: a.flags + r.flags, flagHits: a.flagHits + r.flagHits,
  flagProfit: a.flagProfit + r.flagProfit,
  flagProfitGuarded: a.flagProfitGuarded + r.flagProfitGuarded,
  lo: { n: a.lo.n + r.lo.n, hits: a.lo.hits + r.lo.hits, profit: a.lo.profit + r.lo.profit, guardedProfit: a.lo.guardedProfit + r.lo.guardedProfit },
  mid: { n: a.mid.n + r.mid.n, hits: a.mid.hits + r.mid.hits, profit: a.mid.profit + r.mid.profit, guardedProfit: a.mid.guardedProfit + r.mid.guardedProfit },
  hi: { n: a.hi.n + r.hi.n, hits: a.hi.hits + r.hi.hits, profit: a.hi.profit + r.hi.profit, guardedProfit: a.hi.guardedProfit + r.hi.guardedProfit },
});

const fixBucket = (b?: Partial<Bucket>): Bucket => ({
  n: b?.n ?? 0,
  hits: b?.hits ?? 0,
  profit: b?.profit ?? 0,
  guardedProfit: b?.guardedProfit ?? 0,
});

const fixReport = (r?: Partial<Report>): Report => ({
  total: r?.total ?? 0,
  analyzed: r?.analyzed ?? 0,
  pickHits: r?.pickHits ?? 0,
  pickProfit: r?.pickProfit ?? 0,
  brier: r?.brier ?? 0,
  flags: r?.flags ?? 0,
  flagHits: r?.flagHits ?? 0,
  flagProfit: r?.flagProfit ?? 0,
  flagProfitGuarded: r?.flagProfitGuarded ?? 0,
  lo: fixBucket(r?.lo),
  mid: fixBucket(r?.mid),
  hi: fixBucket(r?.hi),
});

const loadAgg = (): AggState | null => {
  try {
    const s = localStorage.getItem(LS_KEY);
    if (!s) return null;
    const raw = JSON.parse(s) as Partial<AggState>;
    const leagues: Record<string, Report> = {};
    for (const [k, v] of Object.entries(raw.leagues ?? {})) {
      leagues[k] = fixReport(v);
    }
    return {
      files: raw.files ?? 0,
      names: raw.names ?? [],
      overall: fixReport(raw.overall),
      leagues,
    };
  } catch {
    return null;
  }
};

function settleKey(key: string, i: number, j: number): boolean | null {
  let m = key.match(/^over(\d+)$/); if (m) return i + j > +m[1] / 10;
  m = key.match(/^under(\d+)$/); if (m) return i + j < +m[1] / 10;
  if (key === 'bttsYes') return i > 0 && j > 0;
  if (key === 'bttsNo') return !(i > 0 && j > 0);
  if (key === 'dc1X') return i >= j;
  if (key === 'dcX2') return j >= i;
  if (key === 'dc12') return i !== j;
  m = key.match(/^exact(\d+)$/); if (m) return i + j === +m[1];
  if (key === 'exact6plus') return i + j >= 6;
  if (key === 'oddGoals') return (i + j) % 2 === 1;
  if (key === 'evenGoals') return (i + j) % 2 === 0;
  m = key.match(/^group(\d)(\d)$/); if (m) return i + j >= +m[1] && i + j <= +m[2];
  if (key === 'group6p') return i + j >= 6;
  m = key.match(/^cs_(\d)_(\d)$/); if (m) return i === +m[1] && j === +m[2];
  return null;
}

// v9.10 part 96: band-aware stake for backtest flags
// mirrors Part 94 Screener guard: hi-band halved, sub-1.50 odds halved again
function guardedStake(ev: number, odds: number): number {
  if (ev > 0.06) return 0;     // part 97 floor policy: hi-band skipped
  let s = 1;
  if (odds < 1.5) s *= 0.5;    // short-price guard
  return s;
}

export default function StandardLabPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [agg, setAgg] = useState<AggState | null>(loadAgg);
  const [last, setLast] = useState<{ name: string; rep: Report } | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (text: string, fileName: string) => {
    setBusy(true);
    setLast(null);
    await new Promise((r) => setTimeout(r, 30));

    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const hs = lines[0].split(',');
    const col = (name: string) => hs.indexOf(name);
    const first = (...names: string[]) => { for (const n of names) { const i = col(n); if (i >= 0) return i; } return -1; };
    const iDiv = first('Div'), iHome = first('HomeTeam'), iAway = first('AwayTeam');
    const iHG = first('FTHG'), iAG = first('FTAG'), iR = first('FTR');
    const iH = first('B365H', 'PSH', 'BbAvH', 'WHH');
    const iD = first('B365D', 'PSD', 'BbAvD', 'WHD');
    const iA = first('B365A', 'PSA', 'BbAvA', 'WHA');
    const iO25 = hs.findIndex((h) => h === 'B365>2.5' || h === 'PS>2.5' || h.endsWith('>2.5'));
    const iU25 = hs.findIndex((h) => h === 'B365<2.5' || h === 'PS<2.5' || h.endsWith('<2.5'));
    const iBTH = hs.findIndex((h) => h === 'B365BTH' || /BTH$/.test(h));
    const iBTA = hs.findIndex((h) => h === 'B365BTA' || /BTA$/.test(h));

    const rep = blank();
    const leagues: Record<string, Report> = {};

    const rows = lines.slice(1);
    for (let b = 0; b < rows.length; b += 25) {
      for (const line of rows.slice(b, b + 25)) {
        const c = line.split(',');
        rep.total++;
        const h = parseFloat(c[iH]), d = parseFloat(c[iD]), a = parseFloat(c[iA]);
        const hg = parseInt(c[iHG], 10), ag = parseInt(c[iAG], 10);
        const ftr = (c[iR] ?? '').trim();
        if (!(h > 1 && d > 1 && a > 1) || !(hg >= 0) || !(ag >= 0) || !ftr) continue;
        try {
          const div = (c[iDiv] ?? '??').trim() || '??';
          const userOdds: Record<string, number> = { ...EMPTY_USER_ODDS };
          if (iO25 >= 0 && parseFloat(c[iO25]) > 1) userOdds.over25 = parseFloat(c[iO25]);
          if (iU25 >= 0 && parseFloat(c[iU25]) > 1) userOdds.under25 = parseFloat(c[iU25]);
          if (iBTH >= 0 && parseFloat(c[iBTH]) > 1) userOdds.bttsYes = parseFloat(c[iBTH]);
          if (iBTA >= 0 && parseFloat(c[iBTA]) > 1) userOdds.bttsNo = parseFloat(c[iBTA]);
          const match: Match = {
            id: `lab_${rep.total}`, home: c[iHome] ?? '', away: c[iAway] ?? '',
            league: div, country: '', kickoff: '',
            h: String(h), d: String(d), a: String(a),
            gameType: 'standard', userOdds,
          };
          const an = atlasAnalyseV9(match, 0.10);
          const ext = computeExtendedMarketsV9(
            an.scoreMatrix, an.calibration.lambdaH, an.calibration.lambdaA,
            DC_RHO_STANDARD, userOdds,
          );

          const lg = leagues[div] ?? (leagues[div] = blank());
          for (const t of [rep, lg]) { t.analyzed++; }

          const o: Outcome = ftr === 'H' ? 'home' : ftr === 'A' ? 'away' : 'draw';
          const pickOdds = an.pick === 'home' ? h : an.pick === 'away' ? a : d;
          const hit = an.pick === o;
          for (const t of [rep, lg]) {
            t.pickHits += hit ? 1 : 0;
            t.pickProfit += hit ? pickOdds - 1 : -1;
            for (const k of ['home', 'draw', 'away'] as Outcome[])
              t.brier += (an.probs[k] - (k === o ? 1 : 0)) ** 2;
          }

          const flag = ext.topEvBets.length ? ext.topEvBets[0] : null;
          if (flag && flag.odds > 1) {
            const s = settleKey(flag.key, hg, ag);
            if (s !== null) {
              const gs = guardedStake(flag.ev, flag.odds);
              const bkt: 'lo' | 'mid' | 'hi' = flag.ev > 0.06 ? 'hi' : flag.ev > 0.03 ? 'mid' : 'lo';
              for (const t of [rep, lg]) {
                t.flags++;
                t.flagHits += s ? 1 : 0;
                t.flagProfit += s ? flag.odds - 1 : -1;
                if (gs <= 0) continue;
                t.flagProfitGuarded += s ? (flag.odds - 1) * gs : -gs;
                t[bkt].n++;
                if (s) {
                  t[bkt].hits++;
                  t[bkt].profit += flag.odds - 1;
                  t[bkt].guardedProfit += (flag.odds - 1) * gs;
                } else {
                  t[bkt].profit -= 1;
                  t[bkt].guardedProfit -= gs;
                }
              }
            }
          }
        } catch { /* skip malformed */ }
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    const prev = agg ?? { files: 0, names: [], overall: blank(), leagues: {} };
    const next: AggState = {
      files: prev.files + 1,
      names: [...prev.names, fileName],
      overall: merge(prev.overall, rep),
      leagues: { ...prev.leagues },
    };
    for (const [k, v] of Object.entries(leagues))
      next.leagues[k] = next.leagues[k] ? merge(next.leagues[k], v) : v;

    setAgg(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* full */ }
    setLast({ name: fileName, rep });
    setBusy(false);
  };

  const reset = () => {
    if (window.confirm('Reset the cumulative Standard Lab evidence? This clears all stacked seasons.')) {
      localStorage.removeItem(LS_KEY);
      setAgg(null);
      setLast(null);
    }
  };

  const card = (v: string, l: string, tone = 'text-zinc-100') => (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
      <div className={`text-lg font-bold ${tone}`}>{v}</div>
      <div className="text-[9px] text-zinc-500">{l}</div>
    </div>
  );
  const bCard = (t: string, b: Bucket) => (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
      <div className="text-[10px] text-zinc-500">{t}</div>
      <div className="text-sm font-bold tabular-nums text-zinc-200">{b.n ? fmtPct(b.hits / b.n) : '—'}</div>
      <div className={`text-xs font-bold tabular-nums ${b.profit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        raw: {b.profit >= 0 ? '+' : ''}{b.profit.toFixed(1)}u
      </div>
      <div className={`text-xs font-bold tabular-nums ${b.guardedProfit > 0 ? 'text-emerald-300' : 'text-zinc-400'}`}>
        guarded: {b.guardedProfit >= 0 ? '+' : ''}{b.guardedProfit.toFixed(1)}u
      </div>
      <div className="text-[9px] text-zinc-600">{b.n} bets</div>
    </div>
  );
  const block = (title: string, r: Report) => (
    <div className="space-y-3">
      <h4 className="text-[10px] font-bold uppercase text-zinc-500">{title}</h4>
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {card(`${r.analyzed}`, 'matches analyzed')}
        {card(fmtPct(r.analyzed ? r.pickHits / r.analyzed : 0), '1X2 pick hit rate', 'text-blue-400')}
        {card((r.analyzed ? r.brier / r.analyzed : 0).toFixed(3), 'Brier (baseline 0.667)')}
        {card(`${r.flags}`, 'extended +EV flags', 'text-amber-400')}
        {card(r.flags ? fmtPct(r.flagHits / r.flags) : '—', 'flag hit rate', 'text-amber-400')}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
          <div className="text-[9px] text-zinc-500">flag P/L (flat 1u)</div>
          <div className={`text-sm font-bold tabular-nums ${r.flagProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {r.flagProfit >= 0 ? '+' : ''}{r.flagProfit.toFixed(1)}u
          </div>
          <div className={`text-[10px] font-bold tabular-nums ${r.flagProfitGuarded > 0 ? 'text-emerald-300' : 'text-zinc-400'}`}>
            guarded: {r.flagProfitGuarded >= 0 ? '+' : ''}{r.flagProfitGuarded.toFixed(1)}u
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {bCard('EV 0–3% (full stake)', r.lo)}
        {bCard('EV 3–6% (full stake)', r.mid)}
        {bCard('EV > 6% (skipped)', r.hi)}
      </div>
    </div>
  );

  const guardDelta = agg ? agg.overall.flagProfitGuarded - agg.overall.flagProfit : 0;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-500/25 bg-zinc-900/60 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-blue-400">
            STANDARD LAB — persistent out-of-sample validation (stacks every CSV you upload)
          </h3>
          <div className="flex items-center gap-2">
            {agg && (
              <button onClick={reset}
                className="rounded-lg border border-rose-500/30 px-2 py-1 text-[10px] text-rose-400 hover:bg-rose-500/10">
                Reset aggregate
              </button>
            )}
            <button onClick={() => fileRef.current?.click()}
              className="rounded-lg border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800">
              Upload season CSV
            </button>
          </div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) run(await f.text(), f.name);
            }} />
        </div>
        <div className="text-[10px] text-zinc-500">
          {agg ? `Stacked: ${agg.names.join(' · ')}` : 'Upload E0, then SP1, D1, I1, F1 — evidence persists across refreshes and visits.'}
        </div>
      </div>

      {busy && <div className="text-xs text-zinc-400">Crunching season… (batched, UI stays live)</div>}

      {last && block(`Last file (${last.name})`, last.rep)}

      {agg && (
        <>
          {block(`Cumulative — ${agg.files} file${agg.files > 1 ? 's' : ''}`, agg.overall)}

          <div className="rounded-xl border border-fuchsia-500/25 bg-zinc-900/60 p-3">
            <h4 className="mb-1 text-[10px] font-bold uppercase text-fuchsia-300">🛡 Band-aware stake guard impact (Part 94 applied)</h4>
            <div className="grid grid-cols-2 gap-4 text-[11px] text-zinc-300 md:grid-cols-4">
              <div>
                <div className="text-zinc-500">Raw flat P/L</div>
                <div className={`text-sm font-bold tabular-nums ${agg.overall.flagProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {agg.overall.flagProfit >= 0 ? '+' : ''}{agg.overall.flagProfit.toFixed(1)}u
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Guarded P/L</div>
                <div className={`text-sm font-bold tabular-nums ${agg.overall.flagProfitGuarded > 0 ? 'text-emerald-300' : 'text-zinc-400'}`}>
                  {agg.overall.flagProfitGuarded >= 0 ? '+' : ''}{agg.overall.flagProfitGuarded.toFixed(1)}u
                </div>
              </div>
              <div>
                <div className="text-zinc-500">Guard delta</div>
                <div className={`text-sm font-bold tabular-nums ${guardDelta > 0 ? 'text-emerald-300' : 'text-zinc-400'}`}>
                  {guardDelta >= 0 ? '+' : ''}{guardDelta.toFixed(1)}u
                </div>
              </div>
              <div>
                <div className="text-zinc-500">hi-band bleed</div>
                <div className={`text-sm font-bold tabular-nums ${agg.overall.hi.profit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  raw: {agg.overall.hi.profit.toFixed(1)}u → guarded: {agg.overall.hi.guardedProfit.toFixed(1)}u
                </div>
              </div>
            </div>
            <div className="mt-1 text-[9px] text-zinc-500">
              hi-band (EV &gt;6%): stake halved · any flag &lt;1.50 odds: halved again · lo/mid: full stake. A successful guard shrinks hi-band bleed without touching lo/mid profit.
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-zinc-500">
                  <th className="px-3 py-2">League</th>
                  <th className="px-3 py-2">Matches</th>
                  <th className="px-3 py-2">1X2 hit</th>
                  <th className="px-3 py-2">Brier</th>
                  <th className="px-3 py-2">Flags</th>
                  <th className="px-3 py-2">Flag hit</th>
                  <th className="px-3 py-2">Raw P/L</th>
                  <th className="px-3 py-2">Guarded P/L</th>
                  <th className="px-3 py-2">0–3%</th>
                  <th className="px-3 py-2">3–6%</th>
                  <th className="px-3 py-2">&gt;6%</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(agg.leagues).map(([lg, r]) => (
                  <tr key={lg} className="border-t border-zinc-800">
                    <td className="px-3 py-2 text-zinc-300">{lg}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-400">{r.analyzed}</td>
                    <td className="px-3 py-2 tabular-nums text-blue-400">{fmtPct(r.analyzed ? r.pickHits / r.analyzed : 0)}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-300">{(r.analyzed ? r.brier / r.analyzed : 0).toFixed(3)}</td>
                    <td className="px-3 py-2 tabular-nums text-amber-400">{r.flags}</td>
                    <td className="px-3 py-2 tabular-nums text-zinc-300">{r.flags ? fmtPct(r.flagHits / r.flags) : '—'}</td>
                    <td className={`px-3 py-2 tabular-nums font-bold ${r.flagProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {r.flagProfit >= 0 ? '+' : ''}{r.flagProfit.toFixed(1)}u
                    </td>
                    <td className={`px-3 py-2 tabular-nums font-bold ${r.flagProfitGuarded > 0 ? 'text-emerald-300' : 'text-zinc-400'}`}>
                      {r.flagProfitGuarded >= 0 ? '+' : ''}{r.flagProfitGuarded.toFixed(1)}u
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${r.lo.guardedProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {r.lo.guardedProfit >= 0 ? '+' : ''}{r.lo.guardedProfit.toFixed(1)}
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${r.mid.guardedProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {r.mid.guardedProfit >= 0 ? '+' : ''}{r.mid.guardedProfit.toFixed(1)}
                    </td>
                    <td className={`px-3 py-2 tabular-nums ${r.hi.guardedProfit > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {r.hi.guardedProfit >= 0 ? '+' : ''}{r.hi.guardedProfit.toFixed(1)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] text-zinc-400">
            Cumulative blind 1X2 P/L:{' '}
            <b className={agg.overall.pickProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {agg.overall.pickProfit >= 0 ? '+' : ''}{agg.overall.pickProfit.toFixed(1)}u
            </b>{' '}over {agg.overall.analyzed} bets. The bucket that stays positive at ~2,000 bets is your betting floor.
          </div>
        </>
      )}
    </div>
  );
}