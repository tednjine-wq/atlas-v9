// v9.10 review §I: global fixture cap enforced at the accumulator (all branches).
export interface Fixture { home: string; away: string; h: number; d: number; a: number; }
export const MAX_FIXTURES = 50;

export function extractFixtures(obj: unknown, acc: Fixture[] = []): Fixture[] {
  if (!obj || typeof obj !== 'object' || acc.length >= MAX_FIXTURES) return acc;
  if (Array.isArray(obj)) {
    for (const x of obj) { extractFixtures(x, acc); if (acc.length >= MAX_FIXTURES) break; }
    return acc;
  }
  const rec = obj as Record<string, unknown>;
  if (rec.homeTeam && rec.awayTeam && rec.odds) {
    const o = rec.odds as Record<string, unknown>;
    if (acc.length < MAX_FIXTURES) {
      acc.push({ home: String(rec.homeTeam), away: String(rec.awayTeam), h: Number(o.home ?? 0), d: Number(o.draw ?? 0), a: Number(o.away ?? 0) });
    }
  }
  for (const v of Object.values(rec)) { extractFixtures(v, acc); if (acc.length >= MAX_FIXTURES) break; }
  return acc;
}

export function extractFixturesFromHtml(html: string): Fixture[] {
  const fixtures: Fixture[] = [];
  const rowRe = /data-home="([^"]+)"[^>]*data-away="([^"]+)"[^>]*data-odds="([\d.,]+)"/g;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    if (fixtures.length >= MAX_FIXTURES) break;
    const odds = m[3].split(',').map(parseFloat);
    if (odds.length === 3) fixtures.push({ home: m[1], away: m[2], h: odds[0], d: odds[1], a: odds[2] });
  }
  return fixtures;
}