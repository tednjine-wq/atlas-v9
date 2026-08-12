// ============================================================
// Fixture parser v9.13 — fixes field population:
//  • "Country - League" headers split into country + league
//  • column-header garbage ("Home Draw Away 1 or X…", "ID DATE…")
//    can never become a league
//  • pipe rows with a country column populate country
//  • jackpot-style blob team cells split heuristically
// Keeps: pipe rows w/ 10-odds mapping, generic "vs" rows,
// date lines, time prefixes.
// ============================================================
export interface FixtureRow {
  home: string; away: string; league: string; country: string; kickoff: string;
  h: string; d: string; a: string;
  userOdds?: Record<string, number>;
}

const GARBAGE = [
  /home\s+draw\s+away/i, /3 way/i, /double chance/i, /over\/under/i, /both teams/i,
  /^id\b/i, /team 1/i, /team 2/i, /\bdate\b/i, /sportpesa/i, /paybill/i,
  /legal/i, /licence/i, /1 or x/i, /x or 2/i, /\byes\s+no\b/i, /quick pick/i,
];
const isGarbage = (s: string) => GARBAGE.some((r) => r.test(s));
const clean = (s: string) => s.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim();

export function parseFixtureList(text: string): FixtureRow[] {
  const rows: FixtureRow[] = [];
  let league = '';
  let country = '';
  let date = '';

  const setHeader = (raw: string) => {
    const h = clean(raw);
    if (!h || h.length > 70 || isGarbage(h) || /\d\.\d+/.test(h)) return;
    const m = h.match(/^(.+?)\s*-\s*(.+)$/);
    if (m && m[1].length <= 26 && m[2].length >= 3) {
      country = m[1].trim();
      league = m[2].trim();
    } else {
      league = h;
    }
  };

  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const flat = clean(line);
    if (isGarbage(flat)) continue;
    if (/^\d{2}[\/.-]\d{2}[\/.-]\d{2,4}$/.test(flat)) { date = flat; continue; }

    const nums = (flat.match(/\d+\.\d+/g) || []).map(parseFloat);

    // ---------- pipe-style SportPesa rows ----------
    if (line.includes('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter((c) => c.length);
      if (cells.length <= 2 && !nums.length) { setHeader(cells[0] ?? ''); continue; }

      const teamCells: string[] = [];
      let kick = '';
      for (const c of cells) {
        if (/^\d{2}-\d{2}-\d{4}/.test(c)) {
          const t = c.match(/\d{1,2}:\d{2}/);
          kick = `${c.slice(0, 10)}${t ? ' ' + t[0] : ''}`;
        } else if (/^\d+$/.test(c)) continue;                    // IDs
        else if (!/\d\.\d+/.test(c)) teamCells.push(c);         // names / country
      }

      if (nums.length >= 3 && teamCells.length >= 2) {
        let home = teamCells[0];
        let away = teamCells[1];
        let ctry = teamCells[2] ?? '';
        // jackpot blob: "Eintracht Braunschweig VfL Bochum" + "Germany"
        if (teamCells.length === 2 &&
            home.split(' ').length >= 3 && away.split(' ').length <= 2 && !/\d/.test(away)) {
          const w = home.split(' ');
          const n = Math.ceil(w.length / 2);
          ctry = away;
          home = w.slice(0, n).join(' ');
          away = w.slice(n).join(' ');
        }
        const u: Record<string, number> = {};
        if (nums.length >= 10) {
          u.dc1X = nums[3]; u.dcX2 = nums[4]; u.dc12 = nums[5];
          u.over25 = nums[6]; u.under25 = nums[7];
          u.bttsYes = nums[8]; u.bttsNo = nums[9];
        }
        rows.push({
          home, away, league,
          country: ctry || country,
          kickoff: kick || date,
          h: String(nums[0]), d: String(nums[1]), a: String(nums[2]),
          userOdds: u,
        });
        continue;
      }
      if (!nums.length) setHeader(flat);
      continue;
    }

    // ---------- generic rows: [time] Home vs Away h d a ----------
    const m = flat.match(
      /^(?:(\d{1,2}:\d{2})\s+)?(.+?)\s+(?:vs\.?|v)\s+(.+?)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)$/i,
    );
    if (m) {
      rows.push({
        home: m[2].trim(), away: m[3].trim(), league, country,
        kickoff: `${date} ${m[1] ?? ''}`.trim(),
        h: m[4], d: m[5], a: m[6],
      });
      continue;
    }

    // ---------- header lines ----------
    if (!nums.length && flat.length < 70) setHeader(flat);
  }
  return rows;
}
