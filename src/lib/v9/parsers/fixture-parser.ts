// ============================================================
// Fixture parser v9.14 — adds the space-separated SportPesa
// row format: "ID DD-MM-YYYY - HH:MM TeamOne TeamTwo <odds…>"
// (no pipes, no "vs"). Team blob split at word midpoint with a
// year-token fix ("Durban City FC 2024 Golden Arrows").
// Keeps: pipe rows + 10-odds mapping, generic vs rows, headers
// with country split, garbage-header filter (v9.13).
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

  const splitTeams = (blob: string): [string, string] => {
    const w = blob.split(' ');
    const n = Math.ceil(w.length / 2);
    let home = w.slice(0, n).join(' ');
    let away = w.slice(n).join(' ');
    const yr = away.match(/^(19|20)\d{2}/);
    if (yr && away.split(' ').length > 1) {
      home += ' ' + yr[0];
      away = away.replace(/^(19|20)\d{2}\s*/, '');
    }
    return [home, away || w[w.length - 1]];
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
        } else if (/^\d+$/.test(c)) continue;
        else if (!/\d\.\d+/.test(c)) teamCells.push(c);
      }

      if (nums.length >= 3 && teamCells.length >= 2) {
        let home = teamCells[0];
        let away = teamCells[1];
        let ctry = teamCells[2] ?? '';
        if (teamCells.length === 2 &&
            home.split(' ').length >= 3 && away.split(' ').length <= 2 && !/\d/.test(away)) {
          [home, away] = splitTeams(home);
          ctry = teamCells[1];
        }
        const u: Record<string, number> = {};
        if (nums.length >= 10) {
          u.dc1X = nums[3]; u.dcX2 = nums[4]; u.dc12 = nums[5];
          u.over25 = nums[6]; u.under25 = nums[7];
          u.bttsYes = nums[8]; u.bttsNo = nums[9];
        }
        rows.push({
          home, away, league, country: ctry || country, kickoff: kick || date,
          h: String(nums[0]), d: String(nums[1]), a: String(nums[2]), userOdds: u,
        });
        continue;
      }
      if (!nums.length) setHeader(flat);
      continue;
    }

    // ---------- v9.14: space-separated rows (ID date - time teams odds) ----------
    const sp = flat.match(/^(\d{3,5})\s+(\d{2}-\d{2}-\d{4})\s*-\s*(\d{1,2}:\d{2})\s+(.+)$/);
    if (sp) {
      const om = sp[4].match(/^(.*?)\s+((?:\d+\.\d+\s+){2,}\d+\.\d+)$/);
      if (om) {
        const od = om[2].split(/\s+/).map(parseFloat);
        if (od.length >= 3) {
          const [home, away] = splitTeams(om[1].trim());
          const u: Record<string, number> = {};
          if (od.length >= 9) {
            u.dc1X = od[3]; u.dcX2 = od[4]; u.dc12 = od[5];
            u.over25 = od[6]; u.under25 = od[7]; u.bttsYes = od[8];
            if (od.length >= 10) u.bttsNo = od[9];
          }
          rows.push({
            home, away, league, country, kickoff: `${sp[2]} ${sp[3]}`,
            h: String(od[0]), d: String(od[1]), a: String(od[2]), userOdds: u,
          });
          continue;
        }
      }
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
