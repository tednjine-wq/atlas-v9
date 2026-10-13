import { describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('§K ai-context', () => {
  it('returns meta with freshness=live and isVerified=false on success', async () => {
    process.env.AI_API_KEY = 'test';
    const fetchMock = vi.fn().mockImplementation(() => new Response(
      JSON.stringify({ choices: [{ message: { content: '{"narrative":"ok","pHome":0.5,"pDraw":0.2,"pAway":0.3,"confidence":5}' } }] }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);
    const req = new Request('http://test', { method: 'POST', body: JSON.stringify({ home: 'A', away: 'B' }) });
    const res = await POST(req);
    const data = await res.json();
    expect(data.meta.freshness).toBe('live');
    expect(data.ai.isVerified).toBe(false);
    vi.unstubAllGlobals();
    delete process.env.AI_API_KEY;
  });
});