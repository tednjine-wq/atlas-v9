// ============================================================
// Betika fixture parser v5 — table rows now carry the extra
// market columns when present (DC 1X/12/X2, O/U 2.5, GG/NG),
// feeding userOdds so extended markets show real odds + EV.
// Dialects: single-line table (pipes optional, game id and
// competition optional), midweek PDF, vertical web copy.
// ============================================================
export interface BetikaFixture {
  home: string; away: string; league: string; country: string;
  kickoff: string; h: string; d: string; a: string;
  userOdds?: Record<string, number>;
  dc1X?: number; dc12?: number; dcX2?: number;
  over25?: number; under25?: number; bttsYes?: number; bttsNo?: number;
}

const ODD = '(?:\\d+\\.\\d+|-)';
const COMP_WORD = /cup|league|champions|conference|europa|shield|trophy|^efl$|^uefa$|^fifa$|^afc$|^caf$/i;

const num = (s?: string) => {
  if (!s || s === '-') return undefined;
  const v = parseFloat(s);
  return v > 1 ? v : undefined;
};

function splitLeague(chunk: string): { league: string; home: string } {
  const toks = chunk.split(' ').filter(Boolean);
  let i = 0;
  while (i < toks.length - 1 && COMP_WORD.test(toks[i])) i++;
  if (i > 0) {
    const home = toks.slice(i).join(' ');
    if (home) return { league: toks.slice(0, i).join(' '), home };
  }
  return { league: '', home: chunk };
}

function parseVerticalWeb(text: string): BetikaFixture[] {
  const lines = text.split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const out: BetikaFixture[] = [];
  const webRe = /^soccer\s*-\s*(.*?)(\d{2}\/\d{2}),\s*(\d{1,2}:\d{2})$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(webRe);
    if (!m) continue;
    const league = m[1].replace(/[.,\s…]+$/g, '').trim();
    const home = lines[i + 1], away = lines[i + 2];
    if (!home || !away) continue;
    const seq = lines.slice(i + 3, i + 9);
    if (seq[0] === '1' && seq[2] === 'X' && seq[4] === '2' &&
        /^\d+\.\d+$/.test(seq[1] ?? '') && /^\d+\.\d+$/.test(seq[3] ?? '') && /^\d+\.\d+$/.test(seq[5] ?? '')) {
      out.push({ home, away, league, country: '', kickoff: `${m[2]} ${m[3]}`, h: seq[1], d: seq[3], a: seq[5] });
      i += 8;
    }
  }
  return out;
}

export function parseBetikaList(text: string): BetikaFixture[] {
  const lines = text.split(/\n/)
    .map((l) => l.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const out: BetikaFixture[] = [];
  const rowRe = new RegExp(
    '^(\\d{2}/\\d{2}/\\d{2,4})\\s+(\\d{1,2}:\\d{2})\\s+(?:(\\d{3,6})\\s+)?' +
    '(.+?)\\s+vs\\.?\\s+(.+?)\\s+' +
    `(${ODD})\\s+(${ODD})\\s+(${ODD})` +
    `(?:\\s+(${ODD})\\s+(${ODD})\\s+(${ODD})\\s+(${ODD})\\s+(${ODD})\\s+(${ODD})\\s+(${ODD}))?` +
    '\\s*$',
    'i',
  );
  for (const line of lines) {
    const m = line.match(rowRe);
    if (!m) continue;
    const [h, d, a] = [m[6], m[7], m[8]];
    if (h === '-' || d === '-' || a === '-') continue;
    const { league, home } = splitLeague(m[4].trim());
    out.push({
      home, away: m[5].trim(), league, country: '',
      kickoff: `${m[1]} ${m[2]}`, h, d, a,
      dc1X: num(m[9]), dc12: num(m[10]), dcX2: num(m[11]),
      over25: num(m[12]), under25: num(m[13]), bttsYes: num(m[14]), bttsNo: num(m[15]),
    });
  }
  if (out.length) return out;
  return parseVerticalWeb(text);
}