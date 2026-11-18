import * as fs from 'fs';

type Res = 'H' | 'D' | 'A';
interface Row { date: string; o1: number; oX: number; o2: number; res: Res }

const path = process.argv[2] || 'jackpot-history.txt';
const lines = fs.readFileSync(path, 'utf8').split(/\r?\n/).filter(l => l.includes('|'));
const rows: Row[] = [];
for (const l of lines) {
  const p = l.split('|').map(s => s.trim());
  if (p.length < 7) continue;
  const o1 = parseFloat(p[3]), oX = parseFloat(p[4]), o2 = parseFloat(p[5]);
  const res = p[6] as Res;
  if (!o1 || !oX || !o2 || !['H', 'D', 'A'].includes(res)) continue;
  rows.push({ date: p[0], o1, oX, o2, res });
}
console.log('Parsed ' + rows.length + ' jackpot legs from ' + path);

const devig = (r: Row) => { const s = 1 / r.o1 + 1 / r.oX + 1 / r.o2; return { H: (1 / r.o1) / s, D: (1 / r.oX) / s, A: (1 / r.o2) / s }; };
const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const rate = (xs: boolean[]) => xs.length ? xs.filter(Boolean).length / xs.length : 0;

function report(name: string, sub: Row[]) {
  if (!sub.length) { console.log(name + ': n=0'); return; }
  const n = sub.length;
  const aH = rate(sub.map(r => r.res === 'H')), aD = rate(sub.map(r => r.res === 'D')), aA = rate(sub.map(r => r.res === 'A'));
  const iH = mean(sub.map(r => devig(r).H)), iD = mean(sub.map(r => devig(r).D)), iA = mean(sub.map(r => devig(r).A));
  const gap = aD - iD;
  console.log(name.padEnd(28) + ' n=' + String(n).padStart(3) + '  actual H/D/A ' + aH.toFixed(2) + '/' + aD.toFixed(2) + '/' + aA.toFixed(2) + '  implied ' + iH.toFixed(2) + '/' + iD.toFixed(2) + '/' + iA.toFixed(2) + '  drawGap ' + (gap >= 0 ? '+' : '') + gap.toFixed(3));
}

report('ALL JACKPOT LEGS', rows);
report('COIN-FLIP |H-A|<=5pp', rows.filter(r => Math.abs(devig(r).H - devig(r).A) <= 0.05));
report('CLEAR-FAV |H-A|>10pp', rows.filter(r => Math.abs(devig(r).H - devig(r).A) > 0.10));
report('DRAW ODDS <=3.00', rows.filter(r => r.oX <= 3.0));
report('DRAW ODDS 3.00-3.30', rows.filter(r => r.oX > 3.0 && r.oX <= 3.3));
report('DRAW ODDS >3.30', rows.filter(r => r.oX > 3.3));
report('FAV ODDS <=2.20', rows.filter(r => Math.min(r.o1, r.o2) <= 2.2));
report('FAV ODDS 2.20-2.60', rows.filter(r => { const m = Math.min(r.o1, r.o2); return m > 2.2 && m <= 2.6; }));
report('FAV ODDS >2.60', rows.filter(r => Math.min(r.o1, r.o2) > 2.6));

const blockKey = (d: string) => {
  const parts = d.split(' ')[0].split('-');
  if (parts.length !== 3) return 'unknown';
  const dt = new Date(Date.UTC(+parts[0], +parts[1] - 1, +parts[2]));
  if (isNaN(dt.getTime())) return 'unknown';
  const day = (dt.getUTCDay() + 6) % 7;
  return new Date(dt.getTime() - day * 86400000).toISOString().slice(0, 10);
};
const byBlock = new Map<string, Row[]>();
for (const r of rows) byBlock.set(blockKey(r.date), [...(byBlock.get(blockKey(r.date)) || []), r]);
const series = [...byBlock.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, rs]) => ({ d, n: rs.length, dr: rate(rs.map(r => r.res === 'D')) }));
console.log('\nWEEK-BLOCK DRAW-RATE SERIES:');
for (const s of series) console.log('  ' + s.d + '  n=' + String(s.n).padStart(2) + '  draws=' + (s.dr * 100).toFixed(0) + '%');
if (series.length > 2) {
  const xs = series.slice(0, -1).map(s => s.dr), ys = series.slice(1).map(s => s.dr);
  const mx = mean(xs), my = mean(ys);
  const cov = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
  const vx = Math.sqrt(xs.reduce((a, x) => a + (x - mx) ** 2, 0)), vy = Math.sqrt(ys.reduce((a, y) => a + (y - my) ** 2, 0));
  console.log('\nLag-1 autocorrelation: ' + (cov / (vx * vy)).toFixed(2) + '  (negative => mean-reversion regime)');
}

const cf = rows.filter(r => Math.abs(devig(r).H - devig(r).A) <= 0.05);
const pD = rate(cf.map(r => r.res === 'D')); const avgX = mean(cf.map(r => r.oX));
console.log('\nSTRATEGY straight-draw-on-coinflip: p=' + pD.toFixed(3) + ' avgOdds=' + avgX.toFixed(2) + ' EV=' + (pD * avgX - 1 >= 0 ? '+' : '') + (pD * avgX - 1).toFixed(3));
const rest = rows.filter(r => Math.abs(devig(r).H - devig(r).A) > 0.05);
const pF = rate(rest.map(r => (r.o1 < r.o2 ? r.res === 'H' : r.res === 'A'))); const avgF = mean(rest.map(r => Math.min(r.o1, r.o2)));
console.log('STRATEGY market-favourite-elsewhere: p=' + pF.toFixed(3) + ' avgOdds=' + avgF.toFixed(2) + ' EV=' + (pF * avgF - 1 >= 0 ? '+' : '') + (pF * avgF - 1).toFixed(3));
const pAll = rate(rows.map(r => r.res === 'D')); const avgAll = mean(rows.map(r => r.oX));
console.log('STRATEGY straight-draw-ALL-legs:     p=' + pAll.toFixed(3) + ' avgOdds=' + avgAll.toFixed(2) + ' EV=' + (pAll * avgAll - 1 >= 0 ? '+' : '') + (pAll * avgAll - 1).toFixed(3));const blockMap = new Map<string, Row[]>();
for (const r of rows) { const bk = blockKey(r.date); if (!blockMap.has(bk)) blockMap.set(bk, []); blockMap.get(bk)!.push(r); }
const weekend: Row[] = [], midweek: Row[] = [];
for (const [bk, rs] of blockMap) { if (rs.length >= 17) weekend.push(...rs); else midweek.push(...rs); }
report('WEEKEND COUPONS (n>=17)', weekend);
report('  + coin-flip weekend', weekend.filter(r => Math.abs(devig(r).H - devig(r).A) <= 0.05));
report('  + cf+draw>3.30 wknd', weekend.filter(r => r.oX > 3.30 && Math.abs(devig(r).H - devig(r).A) <= 0.05));
report('MIDWEEK COUPONS (n=13)', midweek);
report('  + coin-flip midweek', midweek.filter(r => Math.abs(devig(r).H - devig(r).A) <= 0.05));
const cfW = weekend.filter(r => Math.abs(devig(r).H - devig(r).A) <= 0.05);
const cfM = midweek.filter(r => Math.abs(devig(r).H - devig(r).A) <= 0.05);
const pW = rate(cfW.map(r => r.res === 'D')), pM = rate(cfM.map(r => r.res === 'D'));
const oW = mean(cfW.map(r => r.oX)), oM = mean(cfM.map(r => r.oX));
console.log('WEEKEND cf draw: p=' + pW.toFixed(3) + ' avgOdds=' + oW.toFixed(2) + ' EV=' + (pW * oW - 1).toFixed(3));
console.log('MIDWEEK cf draw: p=' + pM.toFixed(3) + ' avgOdds=' + oM.toFixed(2) + ' EV=' + (pM * oM - 1).toFixed(3));