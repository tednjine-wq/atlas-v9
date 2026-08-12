'use client';
import { useRef, useState } from 'react';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { computeExtendedMarketsV9 } from '@/lib/v9/markets/extended-markets';
import { DC_RHO_STANDARD, EMPTY_USER_ODDS } from '@/lib/v9/atlas-types';
import type { Match, Outcome } from '@/lib/v9/atlas-types';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

interface Bucket { n: number; hits: number; profit: number; }
interface Report {
  total: number; analyzed: number;
  pickHits: number; pickProfit: number;
  brier: number;
  flags: number; flagHits: number; flagProfit: number;
  lo: Bucket; mid: Bucket; hi: Bucket;
}

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

const merge = (a: Report | null, r: Report): Report => a ? {
  total: a.total + r.total, analyzed: a.analyzed + r.analyzed,
  pickHits: a.pickHits + r.pickHits, pickProfit: a.pickProfit + r.pickProfit,
  brier: a.brier + r.brier,
  flags: a.flags + r.flags, flagHits: a.flagHits + r.flagHits, flagProfit: a.flagProfit + r.flagProfit,
  lo: { n: a.lo.n + r.lo.n, hits: a.lo.hits + r.lo.hits, profit: a.lo.profit + r.lo.profit },
  mid: { n: a.mid.n + r.mid.n, hits: a.mid.hits + r.mid.hits, profit: a.mid.profit + r.mid.profit },
  hi: { n: a.hi.n + r.hi.n, hits: a.hi.hits + r.hi.hits, profit: a.hi.profit + r.hi.profit },
} : r;

export default function StandardLabPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [agg, setAgg] = useState<Report | null>(null);
  const [files, setFiles] = useState(0);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState('');

  const run = async (text: string) => {
    setBusy(true);
    setReport(null);
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

    const bk = (): Bucket => ({ n: 0, hits: 0, profit: 0 });
    const rep: Report = { total: 0, analyzed: 0, pickHits: 0, pickProfit: 0, brier: 0,
                          flags: 0, flagHits: 0, flagProfit: 0, lo: bk(), mid: bk(), hi: bk() };

    const rows = lines.slice(1);
    for (let b = 0; b < rows.length; b += 25) {           // Rule 10.3 batching
      for (const line of rows.slice(b, b + 25)) {
        const c = line.split(',');
        rep.total++;
        const h = parseFloat(c[iH]), d = parseFloat(c[iD]), a = parseFloat(c[iA]);
        const hg = parseInt(c[iHG], 10), ag = parseInt(c[iAG], 10);
        const ftr = (c[iR] ?? '').trim();
        if (!(h > 1 && d > 1 && a > 1) || !(hg >= 0) || !(ag >= 0) || !ftr) continue;
        try {
          const userOdds: Record<string, number> = { ...EMPTY_USER_ODDS };
          if (iO25 >= 0 && parseFloat(c[iO25]) > 1) userOdds.over25 = parseFloat(c[iO25]);
          if (iU25 >= 0 && parseFloat(c[iU25]) > 1) userOdds.under25 = parseFloat(c[iU25]);
          if (iBTH >= 0 && parseFloat(c[iBTH]) > 1) userOdds.bttsYes = parseFloat(c[iBTH]);
          if (iBTA >= 0 && parseFloat(c[iBTA]) > 1) userOdds.bttsNo = parseFloat(c[iBTA]);
          const match: Match = {
            id: `lab_${rep.total}`, home: c[iHome] ?? '', away: c[iAway] ?? '',
            league: c[iDiv] ?? '', country: '', kickoff: '',
            h: String(h), d: String(d), a: String(a),
            gameType: 'standard', userOdds,
          };
          const an = atlasAnalyseV9(match, 0.10);
          const ext = computeExtendedMarketsV9(
            an.scoreMatrix, an.calibration.lambdaH, an.calibration.lambdaA,
            DC_RHO_STANDARD, userOdds,
          );
          rep.analyzed++;

          const o: Outcome = ftr === 'H' ? 'home' : ftr === 'A' ? 'away' : 'draw';
          const pickOdds = an.pick === 'home' ? h : an.pick === 'away' ? a : d;
          const hit = an.pick === o;
          rep.pickHits += hit ? 1 : 0;
          rep.pickProfit += hit ? pickOdds - 1 : -1;
          for (const k of ['home', 'draw', 'away'] as Outcome[])
            rep.brier += (an.probs[k] - (k === o ? 1 : 0)) ** 2;

          const flag = ext.topEvBets.length ? ext.topEvBets[0] : null;
          if (flag && flag.odds > 1) {
            const s = settleKey(flag.key, hg, ag);
            if (s !== null) {
              rep.flags++;
              rep.flagHits += s ? 1 : 0;
              rep.flagProfit += s ? flag.odds - 1 : -1;
              const bkt = flag.ev > 0.06 ? rep.hi : flag.ev > 0.03 ? rep.mid : rep.lo;
              bkt.n++;
              if (s) { bkt.hits++; bkt.profit += flag.odds - 1; } else bkt.profit -= 1;
            }
          }
        } catch { /* skip malformed */ }
      }
      await new Promise((r) => setTimeout(r, 0));
    }

    setReport(rep);
    setAgg((prev) => merge(prev, rep));
    setFiles((f) => f + 1);
    setBusy(false);
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
        {b.profit >= 0 ? '+' : ''}{b.profit.toFixed(1)}u
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
        {card(`${r.flagProfit >= 0 ? '+' : ''}${r.flagProfit.toFixed(1)}u`,
          'flag P/L (flat 1u)', r.flagProfit > 0 ? 'text-emerald-400' : 'text-rose-400')}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {bCard('EV 0–3%', r.lo)}
        {bCard('EV 3–6%', r.mid)}
        {bCard('EV > 6%', r.hi)}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-500/25 bg-zinc-900/60 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-blue-400">
            STANDARD LAB — out-of-sample validation (football-data.co.uk CSV, cumulative)
          </h3>
          <div className="flex items-center gap-2">
            {agg && (
              <button onClick={() => { setAgg(null); setFiles(0); }}
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
              if (f) { setFileName(f.name); run(await f.text()); }
            }} />
        </div>
        <div className="text-[10px] text-zinc-500">
          {fileName || 'Upload E0, then SP1, D1, I1, F1 — the aggregate stacks all files.'}
          {' '}Every +EV flag settled vs the real score at flat 1u; buckets show which EV size earns.
        </div>
      </div>

      {busy && <div className="text-xs text-zinc-400">Crunching season… (batched, UI stays live)</div>}

      {report && block(`Last file (${fileName})`, report)}
      {agg && files > 1 && block(`Cumulative — ${files} files`, agg)}

      {agg && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-[11px] text-zinc-400">
          Cumulative blind 1X2 P/L:{' '}
          <b className={agg.pickProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {agg.pickProfit >= 0 ? '+' : ''}{agg.pickProfit.toFixed(1)}u
          </b>{' '}over {agg.analyzed} bets. The bucket that stays positive at ~2,000 bets is your betting floor.
        </div>
      )}
    </div>
  );
}
