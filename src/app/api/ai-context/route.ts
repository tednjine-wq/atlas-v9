// ============================================================
// AI Real-World Context (tier 2, OPTIONAL).
// OpenAI-compatible proxy (Groq free tier by default).
// Returns narrative + a bounded strength prior that feeds the
// v9 hybrid Bayesian calibration. RULE 7 PRESERVED: prediction
// math stays client-side; this only adds context + weak prior.
// Env: AI_API_KEY (required) · AI_BASE_URL · AI_MODEL (optional)
// ============================================================
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const clamp = (x: unknown, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, typeof x === 'number' && isFinite(x) ? x : lo));

export async function POST(req: Request) {
  try {
    const { home, away, league, kickoff } = await req.json();
    const key = process.env.AI_API_KEY;
    const base = process.env.AI_BASE_URL ?? 'https://api.groq.com/openai/v1';
    const model = process.env.AI_MODEL ?? 'llama-3.1-8b-instant';
    if (!key)
      return NextResponse.json({ ai: null, reason: 'AI_API_KEY not set — rule-based context used' });

    const prompt = `You are a senior football analyst. Match: ${home || 'Home'} vs ${away || 'Away'}${league ? ` (${league})` : ''}${kickoff ? `, kickoff ${kickoff}` : ''}.
Return ONLY a valid JSON object (no markdown) with exactly these keys:
{"narrative": "2-3 sentences: recent form, motivation, known injuries/suspensions, tactical style",
 "pHome": 0.0-1.0, "pDraw": 0.0-1.0, "pAway": 0.0-1.0,
 "confidence": 0-8}
The three probabilities must sum to 1. confidence = how sure you are (0-2 low, 3-5 medium, 6-8 high).
If you do not reliably know these teams, set confidence to 0 and narrative to "Insufficient recent information on these teams."`;

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model, temperature: 0.3, max_tokens: 400,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) return NextResponse.json({ ai: null, reason: `AI HTTP ${res.status}` });
    const data = await res.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return NextResponse.json({ ai: null, reason: 'AI returned non-JSON' });
    const p = JSON.parse(m[0]);
    let pH = clamp(p.pHome, 0.02, 0.96);
    let pD = clamp(p.pDraw, 0.02, 0.96);
    let pA = clamp(p.pAway, 0.02, 0.96);
    const s = pH + pD + pA; pH /= s; pD /= s; pA /= s;
    return NextResponse.json({
      ai: {
        narrative: String(p.narrative ?? ''),
        pHome: pH, pDraw: pD, pAway: pA,
        confidence: clamp(p.confidence, 0, 8),
      },
    });
  } catch (e) {
    return NextResponse.json({ ai: null, reason: e instanceof Error ? e.message : 'AI error' });
  }
}
