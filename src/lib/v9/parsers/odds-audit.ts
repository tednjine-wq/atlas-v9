// ============================================================
// Smart Paste Audit v9.12 — invariants (Part 33) PLUS a
// surgical repair layer: re-extracts the FT O/U ladder and
// Asian Handicap FT windows straight from the raw paste and
// overwrites stored keys, independent of parser internals.
// ============================================================
export interface AuditItem { group: string; status: 'ok' | 'warn' | 'fail'; msg: string; }

const imp = (o: number) => (o > 1 ? 1 / o : 0);

export function auditParsedOdds(o: Record<string, number>): AuditItem[] {
  const items: AuditItem[] = [];
  const pair = (group: string, a: number, b: number, lo = 0.98, hi = 1.35) => {
    if (!(a > 1) || !(b > 1)) return;
    const s = imp(a) + imp(b);
    if (s < lo || s > hi)
      items.push({ group, status: 'fail', msg: `implied sum ${(s * 100).toFixed(0)}% (sane 98–135%)` });
  };
  pair('BTTS', o.bttsYes, o.bttsNo);
  pair('BTTS HT', o.bttsHTYes, o.bttsHTNo);
  for (const lk of ['05', '15', '25', '35', '45']) pair(`O/U ${lk}`, o[`over${lk}`], o[`under${lk}`]);
  const i1X = imp(o.dc1X), iX2 = imp(o.dcX2), i12 = imp(o.dc12);
  if (i1X && iX2 && i12) {
    const s = (i1X + iX2 + i12) / 2;
    if (s < 1.0 || s > 1.4)
      items.push({ group: 'Double Chance', status: 'fail', msg: `implied average ${(s * 100).toFixed(0)}%` });
  }
  const overKeys = ['over05', 'over15', 'over25', 'over35', 'over45'].filter((k) => o[k] > 1);
  for (let i = 1; i < overKeys.length; i++)
    if (o[overKeys[i]] <= o[overKeys[i - 1]]) { items.push({ group: 'Over ladder', status: 'fail', msg: 'over odds must increase with the line' }); break; }
  const underKeys = ['under05', 'under15', 'under25', 'under35', 'under45'].filter((k) => o[k] > 1);
  for (let i = 1; i < underKeys.length; i++)
    if (o[underKeys[i]] >= o[underKeys[i - 1]]) { items.push({ group: 'Under ladder', status: 'fail', msg: 'under odds must decrease with the line' }); break; }
  if (o.bttsHTYes > 1 && o.bttsYes > 1 && imp(o.bttsHTYes) > imp(o.bttsYes) + 0.03)
    items.push({ group: 'BTTS HT ⊂ BTTS', status: 'fail', msg: 'HT BTTS implied > FT BTTS implied' });
  if (o.htOver15 > 1 && o.over15 > 1 && imp(o.htOver15) > imp(o.over15) + 0.03)
    items.push({ group: 'HT O1.5 ⊂ FT O1.5', status: 'fail', msg: 'HT over 1.5 implied > FT over 1.5 implied' });
  if (o.awayOver25 > 1 && o.over25 > 1 && imp(o.awayOver25) > imp(o.over25) + 0.03)
    items.push({ group: 'Away O2.5 ⊂ Total O2.5', status: 'fail', msg: 'away over 2.5 implied > total over 2.5 implied' });
  if (o.homeOver25 > 1 && o.over25 > 1 && imp(o.homeOver25) > imp(o.over25) + 0.03)
    items.push({ group: 'Home O2.5 ⊂ Total O2.5', status: 'fail', msg: 'home over 2.5 implied > total over 2.5 implied' });
  if (o.bttsYes > 1 && o.over15 > 1 && imp(o.bttsYes) > imp(o.over15) + 0.05)
    items.push({ group: 'BTTS ⊂ O1.5', status: 'warn', msg: 'BTTS implied > over 1.5 implied — double-check' });
  if (!items.length) items.push({ group: 'All captured groups', status: 'ok', msg: 'every invariant passed' });
  return items;
}

// ---------- v9.12 repair layer ----------
const HEADERS = [
  'total goals over/under', 'asian total goals', 'full time result', 'draw no bet',
  'first team to score', '3 way', 'both teams to score', 'double chance',
  'correct score', 'half with most goals', 'half time/full time', 'euro handicap',
  'total goals exactly', 'odd/even', 'number of goals in groups', 'asian handicap',
];

export function repairParsedOdds(text: string, odds: Record<string, number>): number {
  const lines = text.split(/\n/).map((l) => l.replace(/\|/g, ' ').trim()).filter(Boolean);
  const low = lines.map((l) => l.toLowerCase());
  const isHeader = (s: string) => HEADERS.some((h) => s.includes(h));
  let fixed = 0;

  const win = (start: string): string[] => {
    const i = low.findIndex((s) => s.includes(start));
    if (i < 0) return [];
    const out: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (isHeader(low[j])) break;
      out.push(lines[j]);
    }
    return out;
  };

  const pairUp = (w: string[]): [string, number][] => {
    const out: [string, number][] = [];
    for (let k = 0; k < w.length - 1; k++) {
      if (/^\d+\.\d+$/.test(w[k + 1])) { out.push([w[k].toLowerCase(), parseFloat(w[k + 1])]); k++; }
    }
    return out;
  };

  // 1) FT Over/Under ladder (overwrites ghosts like @1.21)
  const ou = pairUp(win('total goals over/under - full time'));
  const ouMap: [RegExp, string][] = [
    [/^over 0\.5$/, 'over05'], [/^under 0\.5$/, 'under05'],
    [/^over 1\.5$/, 'over15'], [/^under 1\.5$/, 'under15'],
    [/^over 2\.5$/, 'over25'], [/^under 2\.5$/, 'under25'],
    [/^over 3\.5$/, 'over35'], [/^under 3\.5$/, 'under35'],
  ];
  for (const [re, key] of ouMap)
    for (const [lab, v] of ou) if (re.test(lab)) { odds[key] = v; fixed++; }

  // 2) Asian Handicap FT
  const ah = pairUp(win('asian handicap - full time'));
  for (const [lab, v] of ah) {
    const m = lab.match(/\[\s*([+-]?\d+(?:\.\d+)?)\s*\]/);
    if (!m) continue;
    const pos = m[1].startsWith('+');
    const lk = String(Math.abs(parseFloat(m[1])));
    odds[pos ? `ah${lk}` : `ah${lk}_a`] = v;
    fixed++;
  }
  return fixed;
}
