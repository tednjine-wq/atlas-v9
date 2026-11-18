// src/lib/v9/research/factors/betika-scanner.ts
// RESEARCH ONLY: R13-Factors - Contradiction Scanner (gentle edition)
// Run: npx tsx src/lib/v9/research/factors/betika-scanner.ts
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

function readKey() {
  const e = (process.env.SPORTAPI_KEY || '').trim();
  if (e) return { key: e, from: 'env' };
  for (const f of [path.join(process.cwd(), '.sportapi-key'), path.join(__dirname || '.', '../../../../.sportapi-key')]) {
    try { if (fs.existsSync(f)) { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return { key: v, from: f }; } } catch {}
  }
  return { key: '', from: 'none' };
}
const { key: API_KEY, from: KEY_FROM } = readKey();
const BASE = 'https://sportapi.ai/api';
const HDRS = { 'X-Api-Key': API_KEY, 'Accept': 'application/json' };
let HTTP = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJson(u: string): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    HTTP++;
    const r = await fetch(u, { headers: HDRS });
    const t = await r.text();
    if (r.status === 503 && attempt === 0) { await sleep(1500); continue; }
    let j: any; try { j = JSON.parse(t); } catch { j = { __raw: t.slice(0, 200) }; }
    j.__status = r.status;
    return j;
  }
  return { success: false, error: '503 after retry', __status: 503 };
}

const norm = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').replace(/oe/g, 'o').replace(/ae/g, 'a').replace(/ue/g, 'u').trim();
function sim(a: any, b: any) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na.includes(nb) || nb.includes(na)) return 1;
  const A = new Set(na.split(' ').filter(Boolean)), B = new Set(nb.split(' ').filter(Boolean));
  let inter = 0; A.forEach(t => { if (B.has(t)) inter++; });
  return inter / Math.max(A.size, B.size);
}
function pickId(o: any): number | null {
  if (!o || typeof o !== 'object') return null;
  const v = o.id ?? o.team_id ?? o.teamId ?? o.team?.id;
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return +v;
  return null;
}
const pickName = (o: any) => (o && typeof o === 'object') ? String(o.name ?? o.team_name ?? o.title ?? o.slug ?? '') : '';
function extractPair(f: any) {
  if (!f || typeof f !== 'object') return null;
  const shapes: Array<[any, any]> = [[f.home, f.away], [f.homeTeam, f.awayTeam], [f.teams?.home, f.teams?.away], [f.home_team, f.away_team]];
  for (const [h, a] of shapes) {
    const hi = pickId(h), ai = pickId(a);
    if (hi && ai) return { hId: hi, aId: ai, hName: pickName(h), aName: pickName(a) };
  }
  if (f.home_id && f.away_id) return { hId: +f.home_id, aId: +f.away_id, hName: String(f.home_team ?? f.home_name ?? f.home_short ?? ''), aName: String(f.away_team ?? f.away_name ?? f.away_short ?? '') };
  return null;
}

const dateCache = new Map<string, any[]>();
async function fixturesFor(date: string) {
  if (dateCache.has(date)) return dateCache.get(date)!;
  const j = await getJson(`${BASE}/fixtures/date/${date}`);
  const arr = Array.isArray(j) ? j : (j.data ?? j.fixtures ?? j.matches ?? []);
  if (!Array.isArray(arr) || !arr.length) {
    console.log(`   DEBUG date-shape(${date}): ${JSON.stringify(j).slice(0, 220)}`);
    dateCache.set(date, []);
    return [];
  }
  dateCache.set(date, arr);
  return arr;
}

async function resolve(game: any) {
  // Try the stated date only — no concurrent burst.
  let list = await fixturesFor(game.date);
  if (true) {
    // If empty, try one day earlier or later, SEQUENTIALLY.
    for (const off of [-1, 1]) {
      const d = new Date(game.date + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + off);
      const alt = await fixturesFor(d.toISOString().slice(0, 10));
      if (alt.length) { list.push(...alt); break; }
    }
  }
  let best: any = null, bs = 0;
  if (!best && list.length === 0) console.log(`   DEBUG no fixtures for ${game.date} (+-1)`);
  for (const f of list) {
    const p = extractPair(f);
    if (!p) continue;
    const s = Math.min(sim(game.home, p.hName), sim(game.away, p.aName));
    if (s > bs) { bs = s; best = p; }
  }
  return best && bs >= 0.5 ? best : null;
}

async function h2hStats(id1: number, id2: number, gameDate: string) {
  const j = await getJson(`${BASE}/fixtures/h2h/${id1}/${id2}`);
  const arr = Array.isArray(j) ? j : (j.data ?? j.fixtures ?? j.matches ?? j.h2h ?? j.results ?? []);
  if (!Array.isArray(arr) || !arr.length) {
    console.log(`   DEBUG h2h-shape: ${JSON.stringify(j).slice(0, 300)}`);
    return null;
  }
  let t1 = 0, dr = 0, t2 = 0, used = 0, skipped = 0;
  for (const m of arr) {
    const p = extractPair(m);
    if (!p) continue;
    const d = String(m.date ?? m.match_date ?? m.kickoff ?? m.time ?? '').slice(0, 10);
    if (d && gameDate && d >= gameDate) { skipped++; continue; }
    let outcome: number | null = null;
    if (typeof m.result === 'number') outcome = m.result;
    else {
      const hg = m.home_score ?? m.homeGoals ?? m.home_goals ?? m.goals_home ?? (Array.isArray(m.score) ? m.score[0] : null);
      const ag = m.away_score ?? m.awayGoals ?? m.away_goals ?? m.goals_away ?? (Array.isArray(m.score) ? m.score[1] : null);
      if (hg != null && ag != null) { const a = +hg, b = +ag; outcome = a > b ? 1 : a === b ? 0 : -1; }
      else if (typeof m.winner === 'string') { const w = m.winner.toLowerCase(); outcome = (w.includes('draw') || w.includes('tie')) ? 0 : (sim(w, p.hName) > sim(w, p.aName) ? 1 : -1); }
    }
    if (outcome === null) continue;
    used++;
    const homeIsTeam1 = p.hId === id1;
    if (outcome === 0) dr++;
    else if (outcome === 1) { if (homeIsTeam1) t1++; else t2++; }
    else { if (homeIsTeam1) t2++; else t1++; }
  }
  return { t1, dr, t2, used, skipped };
}

interface JackpotGame { n: number; date: string; home: string; away: string; odds1: number; oddsX: number; odds2: number; }
const GAMES: JackpotGame[] = [
  { n: 1,  date: '2026-11-07', home: 'Aberdeen FC',            away: 'Hibernian FC',          odds1: 2.55, oddsX: 3.25, odds2: 2.65 },
  { n: 2,  date: '2026-11-07', home: 'Pau FC',                 away: 'FC Nantes',             odds1: 2.95, oddsX: 3.10, odds2: 2.39 },
  { n: 3,  date: '2026-11-07', home: 'Grasshopper Club Zurich',away: 'Lausanne-Sport',        odds1: 2.33, oddsX: 3.55, odds2: 2.70 },
  { n: 4,  date: '2026-11-07', home: 'RAAL La Louviere',       away: 'Cercle Brugge',         odds1: 2.70, oddsX: 3.35, odds2: 2.60 },
  { n: 5,  date: '2026-11-08', home: 'IFK Goteborg',           away: 'Malmo FF',              odds1: 2.33, oddsX: 3.45, odds2: 2.75 },
  { n: 6,  date: '2026-11-08', home: 'WSG Tirol',              away: 'FK Austria Wien',       odds1: 2.49, oddsX: 3.30, odds2: 2.46 },
  { n: 7,  date: '2026-11-08', home: 'TSV Hartberg',           away: 'SCR Altach',            odds1: 2.24, oddsX: 3.35, odds2: 2.70 },
  { n: 8,  date: '2026-11-08', home: 'NK Brinje Grosuplje',    away: 'Aluminij Kidricevo',    odds1: 2.34, oddsX: 3.10, odds2: 2.75 },
  { n: 9,  date: '2026-11-08', home: 'Virtus Entella',         away: 'Modena FC',             odds1: 2.90, oddsX: 3.15, odds2: 2.33 },
  { n: 10, date: '2026-11-08', home: 'IF Brommapojkarna',      away: 'Mjallby AIF',           odds1: 2.39, oddsX: 3.45, odds2: 2.70 },
  { n: 11, date: '2026-11-08', home: 'Carrarese Calcio',       away: 'Sampdoria Genoa',       odds1: 2.41, oddsX: 3.15, odds2: 2.80 },
  { n: 12, date: '2026-11-08', home: 'Le Havre AC',            away: 'FC Lorient',            odds1: 2.90, oddsX: 3.30, odds2: 2.55 },
  { n: 13, date: '2026-11-08', home: 'Stade Brest 29',         away: 'Olympique Lyon',        odds1: 2.80, oddsX: 3.45, odds2: 2.55 },
  { n: 14, date: '2026-11-08', home: 'Manchester United',      away: 'Aston Villa',           odds1: 2.19, oddsX: 3.70, odds2: 3.20 },
  { n: 15, date: '2026-11-08', home: 'FC Viktoria Plzen',      away: 'Sparta Prague',         odds1: 2.49, oddsX: 3.45, odds2: 2.45 },
  { n: 16, date: '2026-11-08', home: 'Fredrikstad FK',         away: 'SK Brann',              odds1: 2.65, oddsX: 3.65, odds2: 2.34 },
  { n: 17, date: '2026-11-08', home: 'L.R. Vicenza',           away: 'US Cremonese',          odds1: 2.85, oddsX: 3.10, odds2: 2.39 },
];

function devig(h: number, d: number, a: number) { const ih = 1/h, id = 1/d, ia = 1/a; const t = ih + id + ia; return { h: ih/t, d: id/t, a: ia/t }; }

async function scan() {
  console.log(`DEBUG startup: keyLen=${API_KEY.length} head=${API_KEY.slice(0, 8)} from=${KEY_FROM}`);
  if (!API_KEY) { console.log('No key loaded.\n'); return; }
  console.log(`\nR13-Factors Contradiction Engine - ${GAMES.length} legs (gentle edition)\n`);
  console.log('='.repeat(90));
  const traps: Array<{ n: number; home: string; away: string; type: string; detail: string }> = [];
  for (const g of GAMES) {
    const mkt = devig(g.odds1, g.oddsX, g.odds2);
    console.log(`\n#${g.n} ${g.home} vs ${g.away} (${g.date})`);
    console.log(`   Market: H=${(mkt.h*100).toFixed(1)}%  D=${(mkt.d*100).toFixed(1)}%  A=${(mkt.a*100).toFixed(1)}%`);
    let pair: any = null;
    try { pair = await resolve(g); } catch (e) { console.log(`   ! resolve error: ${String(e).slice(0, 120)}`); }
    if (!pair) { console.log('   ! could not map names to team IDs'); await sleep(500); continue; }
    console.log(`   IDs: ${pair.hId} / ${pair.aId} (${pair.hName} vs ${pair.aName})`);
    await sleep(500);
    let st: any = null;
    try { st = await h2hStats(pair.hId, pair.aId, g.date); } catch (e) { console.log(`   ! h2h error: ${String(e).slice(0, 120)}`); }
    await sleep(500);
    if (!st) { console.log('   ! no usable H2H record'); continue; }
    if (!st.used) { console.log(`   ! H2H parsed 0 meetings (skipped ${st.skipped} on/after match date)`); continue; }
    const total = st.t1 + st.dr + st.t2;
    const hWin = st.t1 / total, aWin = st.t2 / total;
    console.log(`   H2H pre-match: ${st.t1}W-${st.dr}D-${st.t2}L (Home ${(hWin*100).toFixed(0)}% / Away ${(aWin*100).toFixed(0)}%) [${st.used} meetings, ${st.skipped} skipped]`);
    if (hWin > 0.50 && mkt.a > mkt.h) { traps.push({ n: g.n, home: g.home, away: g.away, type: 'H2H-HOME-TRAP', detail: `H2H ${(hWin*100).toFixed(0)}% Home, market favours Away` }); console.log('   TRAP: H2H favours Home but market says Away'); }
    else if (aWin > 0.50 && mkt.h > mkt.a) { traps.push({ n: g.n, home: g.home, away: g.away, type: 'H2H-AWAY-TRAP', detail: `H2H ${(aWin*100).toFixed(0)}% Away, market favours Home` }); console.log('   TRAP: H2H favours Away but market says Home'); }
    else { console.log('   OK: Market and H2H aligned'); }
  }
  console.log('\n' + '='.repeat(90));
  console.log(`SUMMARY: ${traps.length} traps flagged out of ${GAMES.length} legs`);
  console.log(`API calls used: ${HTTP} / 2000 daily limit`);
  if (traps.length > 0) { console.log('\nAVOID THESE PICKS (or double-cover):'); traps.forEach(t => console.log(`   #${t.n} ${t.home} vs ${t.away} - ${t.type} - ${t.detail}`)); }
  console.log('');
}
scan();