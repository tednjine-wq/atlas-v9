// SportPesa scraper — 3 strategies: embedded JSON, DOM patterns, regex fallback
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface Fixture { home: string; away: string; h: number; d: number; a: number; }

export async function POST(req: Request) {
  try {
    const { url } = await req.json();
    if (!url || !/^https?:\/\//.test(url)) return NextResponse.json({ error: 'invalid url' }, { status: 400 });
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();

    // Strategy 1: embedded JSON
        const jsonMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]+?\});<\/script>/) ||
                      html.match(/<script[^>]*type="application\/json"[^>]*>(\{[\s\S]+?\})<\/script>/);
    if (jsonMatch) {
      try {
        const data = JSON.parse(jsonMatch[1]);
        const fixtures = extractFixtures(data);
        if (fixtures.length) return NextResponse.json({ fixtures, strategy: 'json' });
      } catch { /* fall through */ }
    }
    // Strategy 2/3: regex over HTML
    const fixtures: Fixture[] = [];
    const rowRe = /data-home="([^"]+)"[^>]*data-away="([^"]+)"[^>]*data-odds="([\d.,]+)"/g;
    let m;
    while ((m = rowRe.exec(html)) !== null) {
      const odds = m[3].split(',').map(parseFloat);
      if (odds.length === 3) fixtures.push({ home: m[1], away: m[2], h: odds[0], d: odds[1], a: odds[2] });
    }
    return NextResponse.json({ fixtures, strategy: fixtures.length ? 'regex' : 'none' });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'scrape failed' }, { status: 500 });
  }
}

function extractFixtures(obj: unknown, acc: Fixture[] = []): Fixture[] {
  if (!obj || typeof obj !== 'object') return acc;
  if (Array.isArray(obj)) { obj.forEach((x) => extractFixtures(x, acc)); return acc; }
  const rec = obj as Record<string, unknown>;
  if (rec.homeTeam && rec.awayTeam && rec.odds) {
    const o = rec.odds as Record<string, unknown>;
    acc.push({
      home: String(rec.homeTeam), away: String(rec.awayTeam),
      h: Number(o.home ?? 0), d: Number(o.draw ?? 0), a: Number(o.away ?? 0),
    });
  }
  Object.values(rec).forEach((v) => extractFixtures(v, acc));
  return acc.slice(0, 50);
}
