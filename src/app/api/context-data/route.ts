// v9.10 §E: venue-aware, kickoff-timezone-aware weather. Explicit unavailable states.
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'atlas-research/9.10' } }); }
  finally { clearTimeout(t); }
}

async function fetchElo(team: string): Promise<number | null> {
  if (!team) return null;
  try {
    const res = await fetchWithTimeout(`https://clubelo.com/Team/${encodeURIComponent(team)}`, 5000);
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1].split(',');
    const elo = parseFloat(last[4]);
    return isFinite(elo) ? elo : null;
  } catch { return null; }
}

interface WeatherResult {
  city?: string; tempC?: number; precipMm?: number; windKmh?: number;
  unavailable?: boolean; reason?: 'missing_kickoff' | 'geocoding_failed' | 'forecast_failed' | 'no_matching_hour';
}

async function fetchWeather(locationQuery: string, kickoffIso: string | undefined): Promise<WeatherResult> {
  if (!kickoffIso || isNaN(Date.parse(kickoffIso))) {
    return { unavailable: true, reason: 'missing_kickoff' };
  }
  const kickoffUtc = new Date(kickoffIso).getTime();
  try {
    const g = await fetchWithTimeout(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(locationQuery)}&count=1&language=en&format=json`, 5000
    ).then((r) => r.json());
    const loc = g?.results?.[0];
    if (!loc) return { unavailable: true, reason: 'geocoding_failed' };

    const w = await fetchWithTimeout(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      `&hourly=temperature_2m,precipitation,wind_speed_10m&forecast_days=3&timezone=UTC`, 5000
    ).then((r) => r.json());

    const times: string[] = w?.hourly?.time ?? [];
    if (!times.length) return { unavailable: true, reason: 'forecast_failed' };

    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(new Date(times[i]).getTime() - kickoffUtc);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    if (bestDiff > 90 * 60 * 1000) return { unavailable: true, reason: 'no_matching_hour' };

    return {
      city: String(loc.name),
      tempC: Math.round(w?.hourly?.temperature_2m?.[bestIdx] ?? 20),
      precipMm: Math.round((w?.hourly?.precipitation?.[bestIdx] ?? 0) * 10) / 10,
      windKmh: Math.round(w?.hourly?.wind_speed_10m?.[bestIdx] ?? 10),
    };
  } catch { return { unavailable: true, reason: 'forecast_failed' }; }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const home = String(body.home ?? '');
    const away = String(body.away ?? '');
    const venue = String(body.venue ?? body.city ?? home);
    const kickoff = body.kickoff;

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

    const weather = await fetchWeather(venue, kickoff);
    return NextResponse.json({ elo, weather, kickoff: kickoff ?? '' });
  } catch (e) {
    return NextResponse.json({ elo: null, weather: { unavailable: true, reason: 'request_error' }, reason: e instanceof Error ? e.message : 'error' });
  }
}