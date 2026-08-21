'use client';
import { useMemo } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { atlasAnalyseV9 } from '@/lib/v9/engines/standard';
import { atlasAnalyseJackpotV9 } from '@/lib/v9/engines/jackpot';
import { fmtPct } from '@/lib/v9/ui/atlas-colors';

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function Radar({ axes }: { axes: { label: string; v: number }[] }) {
  const C = 110, R = 74;
  const pt = (i: number, r: number): [number, number] => {
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;
    return [C + r * Math.cos(ang), C + r * Math.sin(ang)];
  };
  const ring = (f: number) => axes.map((_, i) => pt(i, R * f).join(',')).join(' ');
  const poly = axes.map((a, i) => pt(i, R * a.v).join(',')).join(' ');
  return (
    <svg viewBox="0 0 220 220" className="mx-auto h-60 w-60">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon key={f} points={ring(f)} fill="none" stroke="#27272a" strokeWidth={1} />
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="#27272a" />;
      })}
      <polygon points={poly} fill="rgba(45,212,191,0.22)" stroke="#2dd4bf" strokeWidth={2} />
      {axes.map((a, i) => {
        const [x, y] = pt(i, R + 18);
        return (
          <text key={a.label} x={x} y={y} textAnchor="middle" fontSize={9} className="fill-zinc-400">
            {a.label} {(a.v * 100).toFixed(0)}
          </text>
        );
      })}
    </svg>
  );
}

function LineChart({ std, jp }: { std: number[]; jp: number[] }) {
  const W = 560, H = 170, P = 26;
  const maxN = Math.max(std.length, jp.length, 5);
  const xy = (i: number, v: number) =>
    `${P + (i / Math.max(1, maxN - 1)) * (W - 2 * P)},${H - P - v * (H - 2 * P)}`;
  const path = (pts: number[]) => pts.map((v, i) => xy(i, v)).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {[0, 0.333, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={P} x2={W - P} y1={H - P - g * (H - 2 * P)} y2={H - P - g * (H - 2 * P)}
            stroke={g === 0.333 ? '#52525b' : '#27272a'} strokeDasharray={g === 0.333 ? '4 4' : undefined} />
          <text x={2} y={H - P - g * (H - 2 * P) + 3} fontSize={8} className="fill-zinc-500">{Math.round(g * 100)}%</text>
        </g>
      ))}
      {std.length > 1 && <polyline points={path(std)} fill="none" stroke="#3b82f6" strokeWidth={2} />}
      {jp.length > 1 && <polyline points={path(jp)} fill="none" stroke="#f59e0b" strokeWidth={2} />}
      <text x={W - P} y={12} fontSize={9} textAnchor="end" className="fill-blue-400">— standard</text>
      <text x={W - P} y={24} fontSize={9} textAnchor="end" className="fill-amber-400">— jackpot</text>
      <text x={W - P} y={36} fontSize={9} textAnchor="end" className="fill-zinc-500">- - 33% random</text>
    </svg>
  );
}

export default function DashboardPanel() {
  const matches = useAtlasStore((s) => s.matches);
  const phi = useAtlasStore((s) => s.phi);
  const standardParams = useAtlasStore((s) => s.standardParams);
  const predictions = useAtlasStore((s) => s.predictions);
  const marketPosteriors = useAtlasStore((s) => s.marketPosteriors);

  const radar = useMemo(() => {
    const starred = matches.filter((m) => m.starred &&
      parseFloat(m.h) > 1 && parseFloat(m.d) > 1 && parseFloat(m.a) > 1);
    if (!starred.length) return null;
    let confSum = 0, evSum = 0, marginSum = 0, tight = 0, sof = 0, n = 0;
    for (const m of starred) {
      try {
        const a = m.gameType === 'jackpot'
          ? atlasAnalyseJackpotV9(m, phi)
          : atlasAnalyseV9(m, phi, standardParams);
        confSum += a.confidence;
        marginSum += a.margin;
        if (a.sofTriggered) sof++;
        const probs = [a.probs.home, a.probs.draw, a.probs.away].sort((x, y) => y - x);
        if (probs[0] - probs[1] < 0.08) tight++;
        const odds = a.pick === 'home' ? parseFloat(m.h) : a.pick === 'draw' ? parseFloat(m.d) : parseFloat(m.a);
        evSum += Math.max(0, a.confidence * odds - 1);
        n++;
      } catch { /* skip unanalyzable */ }
    }
    if (!n) return null;
    return {
      n,
      conf: confSum / n,
      ev: evSum / n,
      axes: [
        { label: 'Confidence', v: clamp01((confSum / n - 0.33) / 0.42) },
        { label: 'Edge', v: clamp01(evSum / n / 0.15) },
        { label: 'Margin room', v: clamp01((marginSum / n - 0.04) / 0.08) },
        { label: 'Calm', v: 1 - tight / n },
        { label: 'Discipline', v: 1 - sof / n },
      ],
    };
  }, [matches, phi, standardParams]);

  const timeline = useMemo(() => {
    const resolved = predictions.filter((p) => p.result)
      .sort((a, b) => (a.resolvedAt ?? 0) - (b.resolvedAt ?? 0));
    const build = (gt: string) => {
      const list = resolved.filter((p) => p.gameType === gt);
      const pts: number[] = [];
      let hits = 0;
      list.forEach((p, i) => { if (p.result === p.pick) hits++; pts.push(hits / (i + 1)); });
      return pts;
    };
    return { std: build('standard'), jp: build('jackpot') };
  }, [predictions]);

  const clv = useMemo(() => {
    const list = predictions.filter((p) => p.result && typeof p.clv === 'number');
    if (!list.length) return null;
    return list.reduce((s, p) => s + (p.clv ?? 0), 0) / list.length;
  }, [predictions]);

  const marketBars = useMemo(() => Object.entries(marketPosteriors)
    .map(([key, p]) => {
      const [market, pick] = key.split(':');
      const n = p.alpha + p.beta;
      const mean = p.alpha / n;
      const ci = 1.96 * Math.sqrt((mean * (1 - mean)) / n);
      return { key, market, pick, resolved: n - 2, mean, ci };
    })
    .sort((a, b) => b.resolved - a.resolved)
    .slice(0, 8), [marketPosteriors]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
          <div className="text-lg font-bold text-zinc-100">{radar?.n ?? 0}</div>
          <div className="text-[10px] text-zinc-500">★ slate legs</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
          <div className="text-lg font-bold text-zinc-100">{radar ? fmtPct(radar.conf) : '—'}</div>
          <div className="text-[10px] text-zinc-500">avg pick confidence</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
          <div className={`text-lg font-bold ${radar && radar.ev > 0 ? 'text-emerald-400' : 'text-zinc-400'}`}>
            {radar ? `+${fmtPct(radar.ev)}` : '—'}
          </div>
          <div className="text-[10px] text-zinc-500">avg edge (standard)</div>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-center">
          <div className={`text-lg font-bold ${clv !== null ? (clv > 0 ? 'text-teal-400' : 'text-rose-400') : 'text-zinc-400'}`}>
            {clv !== null ? `${clv > 0 ? '+' : ''}${(clv * 100).toFixed(1)}%` : '—'}
          </div>
          <div className="text-[10px] text-zinc-500">avg CLV (skill metric)</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-teal-500/25 bg-zinc-900/60 p-3">
          <h3 className="mb-1 text-xs font-bold text-teal-300">SLATE CONFIDENCE RADAR (bigger = stronger week)</h3>
          {radar ? (
            <Radar axes={radar.axes} />
          ) : (
            <div className="p-10 text-center text-xs text-zinc-600">Star matches in the Screener to see the slate shape.</div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
          <h3 className="mb-1 text-xs font-bold text-zinc-300">CALIBRATION TIMELINE (cumulative pick hit-rate)</h3>
          {timeline.std.length || timeline.jp.length ? (
            <LineChart std={timeline.std} jp={timeline.jp} />
          ) : (
            <div className="p-10 text-center text-xs text-zinc-600">Resolve predictions to draw your learning curve.</div>
          )}
          <div className="mt-1 text-[10px] text-zinc-500">
            Above the 33% dashed line = beating random. Rising slope = the learning loop is working.
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
        <h3 className="mb-2 text-xs font-bold text-zinc-300">MARKET CONFIDENCE BARS (bar = posterior mean · light band = 95% CI)</h3>
        {marketBars.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {marketBars.map((b) => (
              <div key={b.key} className="space-y-0.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-300">{b.market.replace(/_/g, ' ')} · {b.pick}</span>
                  <span className="tabular-nums text-zinc-400">{(b.mean * 100).toFixed(0)}% · n={b.resolved}</span>
                </div>
                <div className="relative h-2 overflow-hidden rounded bg-zinc-800">
                  <div className={`absolute inset-y-0 left-0 ${b.mean >= 0.58 ? 'bg-emerald-500' : b.mean >= 0.5 ? 'bg-amber-500' : 'bg-rose-500'}`}
                    style={{ width: `${b.mean * 100}%` }} />
                  <div className="absolute inset-y-0 bg-zinc-100/30"
                    style={{ left: `${Math.max(0, (b.mean - b.ci) * 100)}%`, width: `${Math.min(100 - Math.max(0, (b.mean - b.ci) * 100), b.ci * 200)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-xs text-zinc-600">Import slips to start building market posteriors.</div>
        )}
      </div>
    </div>
  );
}
