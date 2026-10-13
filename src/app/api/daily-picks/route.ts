// Live odds via The Odds API — GET cached 3h, respects free tier (500 req/mo)
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
const CACHE_TTL = 3 * 60 * 60 * 1000;
let cache: { at: number; picks: unknown[] } | null = null;

const SPORTS = ['soccer_epl', 'soccer_spain_la_liga', 'soccer_italy_serie_a',
  'soccer_germany_bundesliga', 'soccer_france_ligue_one', 'soccer_uefa_champs_league'];

interface OddsOutcome { name: string; price: number; }
interface OddsMarket { key: string; outcomes: OddsOutcome[]; }
interface OddsEvent {
  id: string; home_team: string; away_team: string; sport_title: string;
  commence_time: string; bookmakers: { key: string; markets: OddsMarket[] }[];
}

export async function GET() {
  const key = process.env.ODDS_API_KEY;
  if (!key) return NextResponse.json({ picks: [], error: 'ODDS_API_KEY not set' }, { status: 500 });
  if (cache && Date.now() - cache.at < CACHE_TTL) return NextResponse.json({ picks: cache.picks, cached: true });

  const picks: object[] = [];
  for (const sport of SPORTS) {
    try {
      const res = await fetch(
        `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${key}&regions=eu&markets=h2h&oddsFormat=decimal`,
      );
      if (!res.ok) continue;
      const events: OddsEvent[] = await res.json();
      for (const ev of events) {
        const book = ev.bookmakers?.[0];
        const mkt = book?.markets?.find((m) => m.key === 'h2h');
        if (!mkt) continue;
        const o: Record<string, number> = {};
        for (const out of mkt.outcomes) o[out.name] = out.price;
        const h = o[ev.home_team], a = o[ev.away_team], d = o['Draw'];
        if (!h || !a || !d) continue;
        const bestHome = Math.max(...ev.bookmakers.map((b) =>
          b.markets.find((m) => m.key === 'h2h')?.outcomes.find((x) => x.name === ev.home_team)?.price ?? h));
        picks.push({
          id: ev.id, home: ev.home_team, away: ev.away_team,
          league: ev.sport_title, kickoff: ev.commence_time,
          h: String(h), d: String(d), a: String(a),
          bookmakers: ev.bookmakers.length,
          valueGap: bestHome / h - 1,
        });
      }
    } catch { /* skip failing sport */ }
  }
  cache = { at: Date.now(), picks };
  return NextResponse.json({ picks, cached: false });
}
