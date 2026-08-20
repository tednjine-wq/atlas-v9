// ============================================================
// Context Agent v1.1 (semi-auto) — Gemini + Google Search
// grounding fetches REAL-TIME team context: motivation,
// key absences, form, fatigue, weather, derby flag.
// v1.1: MODEL FALLBACK CHAIN — Google retires/renames models;
// the agent now tries stable aliases until one returns 200.
// Human reviews every result; the engine math is NEVER mutated.
// ============================================================
export interface TeamContext {
  motivation: 'high' | 'medium' | 'low';
  reason: string;
  formLast5: string;
  keyAbsences: string[];
  fatigue: 'none' | 'medium' | 'high';
}
export interface MatchContext {
  home: TeamContext; away: TeamContext;
  weather: string; derby: boolean;
  summary: string; confidence: number; fetchedAt: string; model: string;
}

const MODELS = [
  'gemini-2.5-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash',
  'gemini-2.5-pro',
  'gemini-pro-latest',
];

export async function fetchMatchContext(
  home: string, away: string, league: string, kickoff: string, apiKey: string,
): Promise<MatchContext> {
  const today = new Date().toISOString().slice(0, 10);
  const prompt = `You are a football intelligence analyst. Today is ${today}.
Match: ${home} vs ${away} (${league}), kickoff ${kickoff}.
Use fresh web evidence (last 14 days only). Return STRICT JSON, no prose:
{"home":{"motivation":"high|medium|low","reason":"max 18 words","formLast5":"e.g. W-D-L-W-W","keyAbsences":["player (reason)"],"fatigue":"none|medium|high"},
"away":{"motivation":"high|medium|low","reason":"max 18 words","formLast5":"e.g. W-W-D-L-W","keyAbsences":["player (reason)"],"fatigue":"none|medium|high"},
"weather":"max 8 words","derby":true|false,
"summary":"max 40 words, betting-relevant synthesis","confidence":0.0-1.0}`;

  let lastErr = '';
  for (const model of MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      },
    );
    if (res.status === 404) { lastErr = `404 on ${model}`; continue; }
    if (!res.ok) throw new Error(`Gemini API ${res.status} on ${model} — check key / quota`);
    const json = await res.json();
    const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`${model} returned no JSON`);
    return {
      ...(JSON.parse(m[0]) as Omit<MatchContext, 'fetchedAt' | 'model'>),
      fetchedAt: new Date().toLocaleString(),
      model,
    };
  }
  throw new Error(`All model names 404 (${lastErr}) — verify the key at aistudio.google.com/apikey`);
}

export function contextVerdict(ctx: MatchContext): string {
  const h = ctx.home.motivation, a = ctx.away.motivation;
  const hAbs = ctx.home.keyAbsences.length, aAbs = ctx.away.keyAbsences.length;
  if (h === 'low' && a !== 'low') return 'Context favors AWAY (home motivation low)';
  if (a === 'low' && h !== 'low') return 'Context favors HOME (away motivation low)';
  if (hAbs > aAbs + 1) return 'Context favors AWAY (home key absences)';
  if (aAbs > hAbs + 1) return 'Context favors HOME (away key absences)';
  if (h === 'high' && a === 'high') return 'High-stakes clash — tight game, draw risk elevated';
  if (ctx.derby) return 'Derby — form guides weaken, variance up';
  return 'Context broadly neutral — trust the engine';
}
