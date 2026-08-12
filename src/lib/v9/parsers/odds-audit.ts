// ============================================================
// Smart Paste Audit v9.11 — mathematical invariants that make
// mis-mapped pastes IMPOSSIBLE to apply:
//  • pair implied sums in [98%, 135%]
//  • over ladder increasing / under ladder decreasing
//  • double-chance triple sum ≈ 2×(1+margin)
//  • subset laws: HT-BTTS ⊂ FT-BTTS, HT O1.5 ⊂ FT O1.5,
//    team O2.5 ⊂ total O2.5, BTTS ⊂ O1.5 (warn)
// These are the exact failure classes seen in the wild
// (BTTS @12/@16, away-O2.5 @8.60 captured as main O2.5).
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
      items.push({ group: 'Double Chance', status: 'fail', msg: `implied average ${(s * 100).toFixed(0)}% (sane 100–140%)` });
  }

  const overKeys = ['over05', 'over15', 'over25', 'over35', 'over45'].filter((k) => o[k] > 1);
  for (let i = 1; i < overKeys.length; i++)
    if (o[overKeys[i]] <= o[overKeys[i - 1]]) {
      items.push({ group: 'Over ladder', status: 'fail', msg: 'over odds must increase with the line' });
      break;
    }
  const underKeys = ['under05', 'under15', 'under25', 'under35', 'under45'].filter((k) => o[k] > 1);
  for (let i = 1; i < underKeys.length; i++)
    if (o[underKeys[i]] >= o[underKeys[i - 1]]) {
      items.push({ group: 'Under ladder', status: 'fail', msg: 'under odds must decrease with the line' });
      break;
    }

  if (o.bttsHTYes > 1 && o.bttsYes > 1 && imp(o.bttsHTYes) > imp(o.bttsYes) + 0.03)
    items.push({ group: 'BTTS HT ⊂ BTTS', status: 'fail', msg: 'HT BTTS implied > FT BTTS implied (first-half leak?)' });
  if (o.htOver15 > 1 && o.over15 > 1 && imp(o.htOver15) > imp(o.over15) + 0.03)
    items.push({ group: 'HT O1.5 ⊂ FT O1.5', status: 'fail', msg: 'HT over 1.5 implied > FT over 1.5 implied (HT leak?)' });
  if (o.awayOver25 > 1 && o.over25 > 1 && imp(o.awayOver25) > imp(o.over25) + 0.03)
    items.push({ group: 'Away O2.5 ⊂ Total O2.5', status: 'fail', msg: 'away over 2.5 implied > total over 2.5 implied (team-goals leak?)' });
  if (o.homeOver25 > 1 && o.over25 > 1 && imp(o.homeOver25) > imp(o.over25) + 0.03)
    items.push({ group: 'Home O2.5 ⊂ Total O2.5', status: 'fail', msg: 'home over 2.5 implied > total over 2.5 implied (team-goals leak?)' });
  if (o.bttsYes > 1 && o.over15 > 1 && imp(o.bttsYes) > imp(o.over15) + 0.05)
    items.push({ group: 'BTTS ⊂ O1.5', status: 'warn', msg: 'BTTS implied > over 1.5 implied — double-check' });

  if (!items.length) items.push({ group: 'All captured groups', status: 'ok', msg: 'every invariant passed' });
  return items;
}
