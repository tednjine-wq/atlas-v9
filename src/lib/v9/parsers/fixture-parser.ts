// ============================================================
// Bulk fixture-list parser v3 — improved team-name splitting:
//  • away-starter rule: "Arsenal Borussia Dortmund" -> Arsenal | Borussia Dortmund
//  • fragment rule: "Motherwell Falkirk FC" -> Motherwell | Falkirk FC
// SportPesa PDF 10-odds mapping preserved (1X2,1X,X2,O1.5,O/U2.5,GG/NG).
// ============================================================
export interface ParsedFixture {
  home: string; away: string; league: string; kickoff: string;
  h: string; d: string; a: string;
  userOdds?: Record<string, number>;
}

const ABBREV_END = new Set(['FC', 'SC', 'SK', 'VSC', 'TK', 'SE', 'CF', 'AC', 'AFC', 'UTD', 'UNITED', 'CITY', 'SV', 'BSV', 'RSC', 'KSC']);
const CLUB_START = new Set(['FC', 'SC', 'SK']);
const AWAY_STARTERS = new Set(['SPORTING', 'BORUSSIA', 'DINAMO', 'DYNAMO', 'ATHLETIC', 'ATLETICO', 'REAL', 'INTER', 'RACING', 'STELLA', 'LOKOMOTIV', 'UNIVERSITATEA']);

function splitTeams(raw: string): [string, string] {
  const t = raw.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (t.length < 2) return [raw, ''];
  // 0) home swallowed an away-starter word
  if (t.length >= 3 && AWAY_STARTERS.has(t[1].toUpperCase())) return [t[0], t.slice(1).join(' ')];
  // 1) repeated club starter
  if (CLUB_START.has(t[0].toUpperCase())) {
    for (let i = 1; i < t.length; i++) {
      if (CLUB_START.has(t[i].toUpperCase())) return [t.slice(0, i).join(' '), t.slice(i).join(' ')];
    }
  }
  // 2) mid abbreviation ends the home name
  for (let i = 1; i <= t.length - 2; i++) {
    if (ABBREV_END.has(t[i].toUpperCase())) return [t.slice(0, i + 1).join(' '), t.slice(i + 1).join(' ')];
  }
  // 3) away collapsed to a fragment (FC / Utd)
  const away = t[t.length - 1];
  if (t.length >= 3 && away.length <= 4 && ABBREV_END.has(away.toUpperCase())) {
    return [t.slice(0, t.length - 2).join(' '), t.slice(t.length - 2).join(' ')];
  }
  if (t.length === 3) return [t.slice(0, 2).join(' '), t[2]];
  const mid = Math.ceil(t.length / 2);
  return [t.slice(0, mid).join(' '), t.slice(mid).join(' ')];
}

export function parseFixtureList(text: string): ParsedFixture[] {
  const out: ParsedFixture[] = [];
  let league = '';
  let date = '';

  for (const raw of text.split(/\n/)) {
    const line = raw.replace(/\s+/g, ' ').trim();
    if (!line) continue;

    if (/^(mon|tue|wed|thu|fri|sat|sun)\w*/i.test(line) || /^\d{2}[\/.-]\d{2}[\/.-]\d{2,4}$/.test(line)) {
      date = line.replace(/^(mon|tue|wed|thu|fri|sat|sun)\w*\s*/i, '');
      continue;
    }

    const spRow = line.match(
      /^(\d{3,5})\s+(\d{2}-\d{2}-\d{4})\s*-\s*(\d{2}:\d{2})\s+(.+?)\s+((?:\d+\.\d+\s+){2,9}\d+\.\d+)$/,
    );
    if (spRow) {
      const nums = spRow[5].trim().split(/\s+/).map(parseFloat);
      const [home, away] = splitTeams(spRow[4]);
      const f: ParsedFixture = {
        home, away, league,
        kickoff: `${spRow[2]} ${spRow[3]}`,
        h: String(nums[0]), d: String(nums[1]), a: String(nums[2]),
      };
      if (nums.length >= 10) {
        f.userOdds = {
          dc1X: nums[3], dcX2: nums[4], over15: nums[5],
          over25: nums[6], under25: nums[7], bttsYes: nums[8], bttsNo: nums[9],
        };
      }
      out.push(f);
      continue;
    }

    const row = line.match(
      /^(?:(\d{2}:\d{2})\s+)?(.+?)\s+(?:vs\.?|v)\s+(.+?)\s+(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)$/i,
    );
    if (row) {
      out.push({
        home: row[2].trim(), away: row[3].trim(), league,
        kickoff: [date, row[1]].filter(Boolean).join(' '),
        h: row[4], d: row[5], a: row[6],
      });
      continue;
    }

    const row2 = line.match(/^(.+?)\s{2,}(\d+\.\d+)\s+(\d+\.\d+)\s+(\d+\.\d+)$/);
    if (row2) {
      const teams = row2[1].split(/\s{2,}|\t/).map((t) => t.trim()).filter(Boolean);
      if (teams.length >= 2) {
        out.push({
          home: teams[0], away: teams[teams.length - 1], league,
          kickoff: [date].filter(Boolean).join(' '),
          h: row2[2], d: row2[3], a: row2[4],
        });
        continue;
      }
    }

    if (!/\d\.\d/.test(line) && !/\bvs\b/i.test(line) && line.length < 60) league = line;
  }
  return out;
}
