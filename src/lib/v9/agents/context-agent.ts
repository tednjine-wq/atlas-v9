// ============================================================
// Context Agent v1.3 — MULTI-PROVIDER.
// Tries the Gemini chain first; falls back to OpenRouter whose
// ":online" suffix adds live web search (free :free:online models
// first, auto:online last). Human reviews every result; the
// engine math is NEVER mutated.
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
export interface ContextKeys { gemini?: string; openrouter?: string; }

const GEMINI_MODELS = [
  'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-pro-latest',
];
const OR_MODELS = [
  'meta-llama/llama-3.3-70b-instruct:free:online',
  'google/gemini-2.0-flash-exp:free:online',
  'mistralai/mistral-7b-instruct:free:online',
  'openrouter/auto:online',
];

const buildPrompt = (home: string, away: string, league: string, kickoff: string) => {
  const today = new Date().toISOString().slice(0, 10);
  return `You are a football intelligence analyst. Today is ${today}.
Match: ${home} vs ${away} (${league}), kickoff ${kickoff}.
Use fresh web evidence (last 14 days only). Return STRICT JSON, no prose:
{"home":{"motivation":"high|medium|low","reason":"max 18 words","formLast5":"e.g. W-D-L-W-W","keyAbsences":["player (reason)"],"fatigue":"none|medium|high"},
"away":{"motivation":"high|medium|low","reason":"max 18 words","formLast5":"e.g. W-W-D-L-W","keyAbsences":["player (reason)"],"fatigue":"none|medium|high"},
"weather":"max 8 words","derby":true|false,
"summary":"max 40 words, betting-relevant synthesis","confidence":0.0-1.0}`;
};

const parseReply = (text: string) => {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Model returned no JSON');
  return JSON.parse(m[0]) as Omit<MatchContext, 'fetchedAt' | 'model'>;
};

async function viaGemini(prompt: string, key: string): Promise<MatchContext> {
  let lastErr = '';
  for (const model of GEMINI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
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
    if (res.status === 404 || res.status === 429) { lastErr = `${res.status} on ${model}`; continue; }
    if (!res.ok) throw new Error(`Gemini ${res.status} on ${model}`);
    const json = await res.json();
    const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { ...parseReply(text), fetchedAt: new Date().toLocaleString(), model: `gemini:${model}` };
  }
  throw new Error(`Gemini unavailable (${lastErr})`);
}

async function viaOpenRouter(prompt: string, key: string): Promise<MatchContext> {
  let lastErr = '';
  for (const model of OR_MODELS) {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
        'X-Title': 'ATLAS',
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (res.status === 404 || res.status === 429 || res.status === 402) { lastErr = `${res.status} on ${model}`; continue; }
    if (!res.ok) throw new Error(`OpenRouter ${res.status} on ${model}`);
    const json = await res.json();
    const text: string = json?.choices?.[0]?.message?.content ?? '';
    return { ...parseReply(text), fetchedAt: new Date().toLocaleString(), model: `or:${model}` };
  }
  throw new Error(`OpenRouter unavailable (${lastErr}) — free models may be at daily limit; $5 credit unlocks auto:online for months`);
}

export async function fetchMatchContextAuto(
  home: string, away: string, league: string, kickoff: string, keys: ContextKeys,
): Promise<MatchContext> {
  const prompt = buildPrompt(home, away, league, kickoff);
  if (keys.gemini?.trim()) {
    try { return await viaGemini(prompt, keys.gemini.trim()); } catch { /* fall through */ }
  }
  if (keys.openrouter?.trim()) return viaOpenRouter(prompt, keys.openrouter.trim());
  throw new Error('No provider key set — add a Gemini or OpenRouter key');
}

export async function fetchMatchContext(
  home: string, away: string, league: string, kickoff: string, apiKey: string,
): Promise<MatchContext> {
  return fetchMatchContextAuto(home, away, league, kickoff, { gemini: apiKey });
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
