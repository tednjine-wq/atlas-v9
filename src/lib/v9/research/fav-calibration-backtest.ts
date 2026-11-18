import * as fs from 'fs';
type Res = 'H' | 'D' | 'A';
interface Row { date: string; home: string; away: string; o1: number; oX: number; o2: number; res: Res }
const lines = fs.readFileSync(process.argv[2] || 'jackpot-history.txt', 'utf8').split(/\r?\n/).filter(l => l.includes('|'));
const rows: Row[] = [];
for (const l of lines) {
  const p = l.split('|').map(s => s.trim());
  if (p.length < 7) continue;
  const o1 = +p[3], oX = +p[4], o2 = +p[5]; const res = p[6] as Res;
  if (!o1 || !oX || !o2 || !['H', 'D', 'A'].includes(res)) continue;
  rows.push({ date: p[0], home: p[1], away: p[2], o1, oX, o2, res });
}
const BIG = ['manchester','arsenal','chelsea','liverpool','tottenham','newcastle','brighton','leeds','brentford','west ham','everton','fulham','crystal palace','sunderland','nottingham','wolverhampton','leicester','burnley','aston villa','bournemouth','southampton','ipswich','watford','west brom','sheffield','real madrid','barcelona','atletico','sevilla','valencia','betis','villarreal','athletic','real sociedad','getafe','osasuna','mallorca','rayo','elche','levante','alaves','celta','espanyol','girona','las palmas','bayern','dortmund','leipzig','leverkusen','frankfurt','freiburg','wolfsburg','stuttgart','mainz','augsburg','hoffenheim','koln','bremen','union berlin','gladbach','st. pauli','juventus','inter','milan','napoli','roma','lazio','atalanta','fiorentina','bologna','torino','genoa','udinese','monza','como','cagliari','verona','sassuolo','lecce','parma','empoli','venezia','pisa','cremonese','psg','paris saint','marseille','lyon','monaco','lille','nice','rennes','lens','nantes','strasbourg','toulouse','montpellier','brest','reims','auxerre','angers','le havre','lorient','metz','paris fc'];
const isBig = (r: Row) => { const h = r.home.toLowerCase(), a = r.away.toLowerCase(); return BIG.some(k => h.includes(k) || a.includes(k)); };
const devig = (r: Row) => { const s = 1 / r.o1 + 1 / r.oX + 1 / r.o2; return { H: 1 / r.o1 / s, D: 1 / r.oX / s, A: 1 / r.o2 / s }; };
const mean = (x: number[]) => x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0;
function favReport(name: string, sub: Row[]) {
  if (!sub.length) { console.log(name + ': n=0'); return; }
  const n = sub.length; let favHits = 0; const imp: number[] = [];
  for (const r of sub) { const d = devig(r); const side = r.o1 <= r.o2 ? 'H' : 'A'; imp.push(side === 'H' ? d.H : d.A); if (r.res === side) favHits++; }
  const act = favHits / n, impF = mean(imp);
  const evFav = act / impF - 1, evFade = (1 - act) / (1 - impF) - 1;
  console.log(name.padEnd(30) + ' n=' + String(n).padStart(3) + '  favImplied=' + impF.toFixed(3) + '  favActual=' + act.toFixed(3) + '  gap=' + (act - impF >= 0 ? '+' : '') + (act - impF).toFixed(3) + '  EV_fav=' + evFav.toFixed(3) + '  EV_fade=' + evFade.toFixed(3));
}
const bands: [string, (r: Row) => boolean][] = [
  ['FAV <=2.20', r => Math.min(r.o1, r.o2) <= 2.20],
  ['FAV 2.20-2.50', r => { const m = Math.min(r.o1, r.o2); return m > 2.20 && m <= 2.50; }],
  ['FAV 2.50-2.80', r => { const m = Math.min(r.o1, r.o2); return m > 2.50 && m <= 2.80; }],
  ['FAV >2.80', r => Math.min(r.o1, r.o2) > 2.80],
];
console.log('=== ALL LEGS ==='); for (const [n, f] of bands) favReport(n, rows.filter(f));
const big = rows.filter(isBig), small = rows.filter(r => !isBig(r));
console.log('=== BIG-5 LEAGUE LEGS ==='); for (const [n, f] of bands) favReport(n, big.filter(f));
console.log('=== SMALLER / LOWER LEAGUES ==='); for (const [n, f] of bands) favReport(n, small.filter(f));
console.log('\nBIG n=' + big.length + '  SMALL n=' + small.length);