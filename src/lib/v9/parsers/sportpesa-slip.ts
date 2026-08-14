// ============================================================
// SportPesa bet-slip parser v9.22 — v9.21 PLUS:
//  • market-fragment vocabulary widened (\btime\b, \bteam\b) so
//    wrapped cells ("Time", "Team - Full Time") never leak into
//    team names
//  • game buffer scrubbed of market words at finalize
//  • dash normalization for split team cells ("Shelbourne-"+"Ajax")
// Legs keep ft/ht scores so the Learning panel can log them.
// ============================================================
export interface SlipLeg {
  n: number; id: string; kickoff: string;
  home: string; away: string;
  odds: number; market: string; pick: string;
  ft: string; ht: string;
  won: boolean | null;
  marketKey: string; marketLabel: string;
}
export interface ParsedSlip {
  betId: string; stake: number; possibleWin: number;
  status: string; description: string;
  legs: SlipLeg[];
}

const ascii = (s: string) => s.replace(/：/g, ':').replace(/（/g, '(').replace(/）/g, ')');
const SKIP = /Bet (ID|amount|status)|Description|Possible Win|Section|SportPesa|Paybill|Licence|N°|\bGAME\b|\bMARKET\b|\bPICK\b|\bRESULTS\b|\bODDS\b|^\d{6,}$/i;
const MARKET_RE = /total goals|over\/under|half\s*time|full\s*time|home\s*team|away\s*team|both\s*teams|btts|double\s*chance|asian|match\s*result|\btime\b|\bteam\b/i;
const GAME_SCRUB = /\b(Total|Goals?|Over|Under|Home|Away|Team|Time|Half|Full|Match|Result|Double|Chance|Asian|Handicap)\b/gi;

export function classifySlip(market: string, dir: 'OVER' | 'UNDER', line: number): { key: string; label: string } {
  const m = market.toLowerCase();
  const lk = String(line).replace('.', '');
  const du = dir === 'OVER' ? 'Over' : 'Under';
  if (/both teams|btts/.test(m)) return { key: dir === 'OVER' ? 'bttsYes' : 'bttsNo', label: `BTTS ${dir === 'OVER' ? 'Yes' : 'No'}` };
  if (/half/.test(m) && /home\s*team/.test(m)) return { key: `home${du}${lk}HT`, label: `Home ${du} ${line} HT` };
  if (/home\s*team/.test(m)) return { key: `home${du}${lk}`, label: `Home ${du} ${line} FT` };
  if (/away\s*team/.test(m)) return { key: `away${du}${lk}`, label: `Away ${du} ${line} FT` };
  if (/half/.test(m)) return { key: `ht${du}${lk}`, label: `HT ${du} ${line}` };
  return { key: `${du.toLowerCase()}${lk}`, label: `${du} ${line} FT` };
}

function extractHeader(raw: string[]): ParsedSlip {
  const slip: ParsedSlip = { betId: '', stake: 0, possibleWin: 0, status: '', description: '', legs: [] };
  for (const l of raw) {
    let m = l.match(/Bet ID:\s*(\d+)/i); if (m) slip.betId = m[1];
    m = l.match(/Bet amount:\s*KSH\s*([\d.]+)/i); if (m) slip.stake = parseFloat(m[1]);
    m = l.match(/Possible Win:\s*KSH\s*([\d.]+)/i); if (m) slip.possibleWin = parseFloat(m[1]);
    m = l.match(/Bet status:\s*(.+)/i); if (m) slip.status = m[1].trim();
    m = l.match(/Description:\s*(.+)/i); if (m) slip.description = m[1].trim();
  }
  return slip;
}

function cleanGame(s: string): string {
  return s.replace(GAME_SCRUB, '').replace(/\s*-+\s*/g, '-').replace(/^-|-$/g, '').replace(/\s{2,}/g, ' ').trim();
}

function splitGame(g: string): [string, string] {
  const gi = g.indexOf('-');
  if (gi > 0) return [g.slice(0, gi).trim(), g.slice(gi + 1).trim()];
  const w = g.split(' ');
  if (w.length >= 2) {
    const n = Math.ceil(w.length / 2);
    return [w.slice(0, n).join(' '), w.slice(n).join(' ')];
  }
  return [g, ''];
}

// ---------- horizontal single-line legs ----------
function parseHorizontal(raw: string[]): SlipLeg[] {
  const legs: SlipLeg[] = [];
  const legLines: string[] = [];
  for (const l of raw) {
    if (/^\|?\s*\d{1,2}\s*\|\s*\d{3,5}\s*\|\s*\d{2}\/\d{2}\/\d{2}/.test(l)) legLines.push(l);
    else if (legLines.length && !SKIP.test(l)) legLines[legLines.length - 1] += ' ' + l;
  }
  for (const line of legLines) {
    const flat = line.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();
    const m = flat.match(
      /^(\d{1,2})\s+(\d{3,5})\s+(\d{2}\/\d{2}\/\d{2})\s+(\d{1,2}:\d{2})\s+(.+?)\s+(\d+\.\d+)\s+(.*?)\s*(OVER|UNDER)\s*(\d+(?:\.\d+)?)\s+(\d+:\d+)\s*(?:\((\d+:\d+)\))?\s*([√✓xX✗]?)\s*$/i,
    );
    if (!m) continue;
    const dir = m[8].toUpperCase() as 'OVER' | 'UNDER';
    const lv = parseFloat(m[9]);
    const cls = classifySlip(m[7], dir, lv);
    const [home, away] = splitGame(cleanGame(m[5]));
    legs.push({
      n: parseInt(m[1], 10), id: m[2], kickoff: `${m[3]} ${m[4]}`,
      home, away, odds: parseFloat(m[6]), market: m[7].trim(), pick: `${dir} ${m[9]}`,
      ft: m[10], ht: m[11] ?? '',
      won: m[12] === '√' || m[12] === '✓' ? true : m[12] ? false : null,
      marketKey: cls.key, marketLabel: cls.label,
    });
  }
  return legs;
}

// ---------- vertical-cell state machine ----------
function parseVertical(raw: string[]): SlipLeg[] {
  const legs: SlipLeg[] = [];
  let cur: Partial<SlipLeg> & { dir?: 'OVER' | 'UNDER'; ln?: number } | null = null;
  let game = '';
  let market = '';

  const finalize = () => {
    if (cur && cur.pick && game) {
      const [home, away] = splitGame(cleanGame(game));
      const dir = cur.dir ?? 'UNDER';
      const cls = classifySlip(market, dir, cur.ln ?? 0);
      legs.push({
        n: cur.n ?? legs.length + 1, id: cur.id ?? '', kickoff: cur.kickoff ?? '',
        home, away, odds: cur.odds ?? 1, market: market.trim(), pick: cur.pick ?? '',
        ft: cur.ft ?? '', ht: cur.ht ?? '', won: cur.won ?? null,
        marketKey: cls.key, marketLabel: cls.label,
      });
    }
    cur = null; game = ''; market = '';
  };

  for (const line of raw) {
    if (SKIP.test(line)) continue;
    if (/^\d{1,2}$/.test(line)) { if (cur && cur.pick) finalize(); if (!cur) cur = { n: parseInt(line, 10) }; continue; }
    if (/^\d{3,5}$/.test(line)) { if (!cur) cur = {}; cur.id = line; continue; }
    if (/^\d{2}\/\d{2}\/\d{2}(\s+\d{1,2}:\d{2})?$/.test(line)) { if (!cur) cur = {}; cur.kickoff = line; continue; }
    if (/^\d{1,2}:\d{2}$/.test(line)) { if (cur) cur.kickoff = `${cur.kickoff ?? ''} ${line}`.trim(); continue; }

    const pm = line.match(/\b(OVER|UNDER)\s*(\d+(?:\.\d+)?)\b/i);
    const isTime = /^\d{1,2}:\d{2}$/.test(line);
    const sm = !isTime ? line.match(/(\d{1,2})\s*:\s*(\d{1,2})(?:\s*\((\d{1,2})\s*:\s*(\d{1,2})\))?/) : null;
    const mk = line.match(/([√✓✗]|X)\s*$/i);

    if (pm || sm || mk) {
      if (!cur) cur = {};
      if (pm) { cur.dir = pm[1].toUpperCase() as 'OVER' | 'UNDER'; cur.ln = parseFloat(pm[2]); cur.pick = `${pm[1].toUpperCase()} ${pm[2]}`; }
      if (sm && pm) { cur.ft = `${sm[1]}:${sm[2]}`; if (sm[3] !== undefined) cur.ht = `${sm[3]}:${sm[4]}`; }
      if (mk) cur.won = /√|✓/.test(mk[1]);
      if (cur.pick && (cur.ft || cur.won !== null)) finalize();
      continue;
    }
    if (/^\d+\.\d+$/.test(line)) { if (!cur) cur = {}; if (!cur.odds) cur.odds = parseFloat(line); continue; }
    if (MARKET_RE.test(line)) { market += (market ? ' ' : '') + line; continue; }
    if (/[A-Za-z]{2}/.test(line)) { game += (game ? ' ' : '') + line; continue; }
  }
  finalize();
  return legs;
}

export function parseSportPesaSlip(text: string): ParsedSlip | null {
  if (!text || !text.trim()) return null;
  const raw = text.split(/\n/).map((l) => ascii(l).replace(/\|/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean);
  const header = extractHeader(raw);
  const legs = parseHorizontal(raw);
  if (legs.length) return { ...header, legs };
  const v = parseVertical(raw);
  if (v.length) return { ...header, legs: v };
  return header.betId ? header : null;
}
