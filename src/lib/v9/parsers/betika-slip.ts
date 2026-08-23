// ============================================================
// Betika slip parser v3 — clean single-block build.
// Dialect: home / score / away / Type / <type> / FT Results /
// <ft> / Pick / <pick (odds)> / Outcome / <outcome>.
// pick line = Type+5. Team totals via team tokens; win/loss
// derived line-aware from FT score; HT totals stay pending.
// ============================================================
import type { BetMarket } from './bet-slip-parser';

export interface BetikaSlipHeader {
  betId: string; stake: number; possiblePayout: number; status: string; tally: string;
}
export interface BetikaEvent {
  home: string; away: string; ft?: string;
  market: BetMarket; pick: string; odds: number;
  result: 'won' | 'lost' | 'pending';
}
export interface BetikaSlip { header: BetikaSlipHeader; events: BetikaEvent[]; }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const tok = (t: string) => {
  const w = norm(t).split(' ').filter((x) => x.length > 3);
  return w[w.length - 1] ?? '';
};
const lineFrom = (pick: string) => {
  const m = pick.match(/(\d+\.\d+)/);
  return m ? parseFloat(m[1]) : NaN;
};

function classifyMarket(type: string, pick: string, home: string, away: string): BetMarket {
  const t = norm(type); const p = norm(pick);
  if (/1st half|half time/.test(t) && /total/.test(t)) return 'half_time_result';
  if (/total/.test(t)) {
    const ht = tok(home), at = tok(away);
    if (ht && t.includes(ht)) return 'home_over25';
    if (at && t.includes(at)) return 'away_over25';
    const line = lineFrom(p);
    const over = /over/.test(p);
    if (line === 1.5) return over ? 'over15' : 'under15';
    if (line === 2.5) return over ? 'over25' : 'under25';
    if (line === 3.5) return over ? 'over35' : 'under35';
    return 'other';
  }
  if (/double chance/.test(t)) return 'double_chance';
  if (/both teams/.test(t)) return /yes/.test(p) ? 'btts_yes' : 'btts_no';
  return 'other';
}

function deriveResult(
  market: BetMarket, pick: string, ft: string | undefined, home: string, away: string,
): 'won' | 'lost' | 'pending' {
  if (!ft) return 'pending';
  const m = ft.match(/(\d+)\s*:\s*(\d+)/);
  if (!m) return 'pending';
  const h = parseInt(m[1], 10), a = parseInt(m[2], 10);
  const total = h + a;
  const line = lineFrom(pick);
  const isOver = /over/i.test(pick);
  const isUnder = /under/i.test(pick);

  if (market === 'half_time_result') return 'pending';

  if (market === 'home_over25' || market === 'away_over25') {
    if (Number.isNaN(line)) return 'pending';
    const g = market === 'home_over25' ? h : a;
    const over = g > line;
    return isOver ? (over ? 'won' : 'lost') : isUnder ? (!over ? 'won' : 'lost') : 'pending';
  }

  if (market === 'double_chance') {
    const p = norm(pick);
    const ftr = h > a ? '1' : h === a ? 'X' : '2';
    const covers: string[] = [];
    if (/draw/.test(p)) covers.push('X');
    const ht = tok(home), at = tok(away);
    if (ht && p.includes(ht)) covers.push('1');
    if (at && p.includes(at)) covers.push('2');
    if (!covers.length) return 'pending';
    return covers.includes(ftr) ? 'won' : 'lost';
  }

  if (!Number.isNaN(line) && (isOver || isUnder)) {
    const over = total > line;
    return isOver ? (over ? 'won' : 'lost') : (!over ? 'won' : 'lost');
  }

  return 'pending';
}

export function parseBetikaSlip(text: string): BetikaSlip | null {
  if (!text || !/\bBetID:|Won\/Lost\/Total/i.test(text)) return null;
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  let betId = '', stake = 0, possiblePayout = 0, status = '', tally = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^BetID:/i.test(line) && !betId) betId = line.replace(/^BetID:\s*/i, '').trim();
    if (/^Amount$/i.test(line) && lines[i + 1]) {
      const mm = lines[i + 1].match(/KES\s*([\d,]+)/); if (mm) stake = parseFloat(mm[1].replace(/,/g, ''));
    }
    if (/^Possible Payout$/i.test(line) && lines[i + 1]) {
      const mm = lines[i + 1].match(/KES\s*([\d,]+)/); if (mm) possiblePayout = parseFloat(mm[1].replace(/,/g, ''));
    }
    if (/^(Won|Lost|Void|Pending)$/i.test(line) && !status) status = line;
    if (/^Won\/Lost\/Total$/i.test(line) && lines[i + 1]) tally = lines[i + 1];
  }

  const events: BetikaEvent[] = [];
  let i = 0;
  while (i < lines.length) {
    if (/^Type$/i.test(lines[i])) {
      const home = lines[i - 3] ?? '';
      const ft = lines[i - 2] ?? '';
      const away = lines[i - 1] ?? '';
      const type = lines[i + 1] ?? '';
      const pickLine = lines[i + 5] ?? '';
      const pm = pickLine.match(/^(.+?)\s*\(([\d.]+)\)$/);
      if (pm && home && away && /\d+\s*:\s*\d+/.test(ft)) {
        const pick = pm[1].trim();
        const odds = parseFloat(pm[2]);
        const market = classifyMarket(type, pick, home, away);
        events.push({
          home, away, ft, market, pick, odds,
          result: deriveResult(market, pick, ft, home, away),
        });
        i += 8;
        continue;
      }
    }
    i++;
  }

  if (!events.length) return null;
  return { header: { betId, stake, possiblePayout, status, tally }, events };
}
