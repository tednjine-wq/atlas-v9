// ============================================================
// Free real-world context (no API keys, no scraping):
//  • ClubElo team-strength ratings -> Bayesian prior (conf 5)
//  • open-meteo geocoding + forecast -> weather at kickoff
// Server-side fetch only (CORS); ALL prediction math stays
// client-side (Rule 7 preserved). Best-effort: nulls on failure.
// ============================================================
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function fetchElo(team: string): Promise<number | null> {
  if (!team) return null;
  try {
    const res = await fetch(`https://clubelo.com/Team/${encodeURIComponent(team)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1].split(',');
    const elo = parseFloat(last[4]);
    return isFinite(elo) ? elo : null;
  } catch { return null; }
}

async function fetchWeather(city: string) {
  try {
    const g = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
    ).then((r) => r.json());
    const loc = g?.results?.[0];
    if (!loc) return null;
    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&hourly=temperature_2m,precipitation,wind_speed_10m&forecast_days=3`,
    ).then((r) => r.json());
    const times: string[] = w?.hourly?.time ?? [];
    const idx = times.length ? Math.min(times.length - 1, 18) : 0;
    return {
      city: String(loc.name),
      tempC: Math.round(w?.hourly?.temperature_2m?.[idx] ?? 20),
      precipMm: Math.round((w?.hourly?.precipitation?.[idx] ?? 0) * 10) / 10,
      windKmh: Math.round(w?.hourly?.wind_speed_10m?.[idx] ?? 10),
    };
  } catch { return null; }
}

export async function POST(req: Request) {
  try {
    const { home, away, kickoff } = await req.json();

    let elo = null;
    const [rh, ra] = await Promise.all([fetchElo(home), fetchElo(away)]);
    if (rh !== null && ra !== null) {
      const dr = rh - ra + 60;
      const eh = 1 / (1 + Math.pow(10, -dr / 400));
      const pDraw = Math.min(0.34, Math.max(0.20, 0.26 + 0.08 * Math.max(0, 1 - Math.abs(dr) / 200)));
      const pHome = (1 - pDraw) * eh;
      const pAway = (1 - pDraw) * (1 - eh);
      elo = { pHome, pDraw, pAway, confidence: 5, ratingHome: Math.round(rh), ratingAway: Math.round(ra) };
    }

    const weather = await fetchWeather(home);
    return NextResponse.json({ elo, weather, kickoff: kickoff ?? '' });
  } catch (e) {
    return NextResponse.json({ elo: null, weather: null, reason: e instanceof Error ? e.message : 'error' });
  }
}
