// SportPesa scraper — SSRF-hardened (v9.10 review §C), globally capped (§I).
import { NextResponse } from 'next/server';
import { safeFetchHtml, SsrfError } from '@/lib/v9/net/ssrf-guard';
import { extractFixtures, extractFixturesFromHtml, MAX_FIXTURES } from '@/lib/v9/scrape/extract-fixtures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HITS = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (HITS.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  HITS.set(ip, arr);
  if (HITS.size > 5_000) HITS.clear();
  return arr.length > 10;
}

export async function POST(req: Request) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
  if (rateLimited(ip)) return NextResponse.json({ error: 'rate limited' }, { status: 429 });
  let url: unknown;
  try { const body = await req.json(); url = (body as { url?: unknown }).url; } catch { return NextResponse.json({ error: 'invalid body' }, { status: 400 }); }
  if (typeof url !== 'string' || !url) return NextResponse.json({ error: 'invalid url' }, { status: 400 });
  try {
    const html = await safeFetchHtml(url);
    // Strategy 1: embedded JSON
    const jsonMatch = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]+?\});<\/script>/) ||
                      html.match(/<script[^>]*type="application\/json"[^>]*>(\{[\s\S]+?\})<\/script>/);
    if (jsonMatch) {
      try {
        const fixtures = extractFixtures(JSON.parse(jsonMatch[1]));
        if (fixtures.length) return NextResponse.json({ fixtures, strategy: 'json', max: MAX_FIXTURES });
      } catch { /* fall through */ }
    }
    // Strategy 2: regex over HTML (capped)
    const fixtures = extractFixturesFromHtml(html);
    return NextResponse.json({ fixtures, strategy: fixtures.length ? 'regex' : 'none', max: MAX_FIXTURES });
  } catch (e) {
    if (e instanceof SsrfError) {
      const upstream = e.code === 'UPSTREAM' || e.code === 'TOO_BIG';
      return NextResponse.json({ error: upstream ? 'upstream request failed' : 'url rejected' }, { status: upstream ? 502 : 400 });
    }
    return NextResponse.json({ error: 'scrape failed' }, { status: 500 });
  }
}