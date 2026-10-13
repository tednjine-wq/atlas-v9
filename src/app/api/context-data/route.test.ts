import { describe, expect, it, vi } from 'vitest';
import { POST } from './route';

describe('§E context-data', () => {
  it('returns weather unavailable if kickoff is missing', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Response('', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = new Request('http://test', { method: 'POST', body: JSON.stringify({ home: 'A', away: 'B' }) });
    const res = await POST(req);
    const data = await res.json();
    expect(data.weather.unavailable).toBe(true);
    expect(data.weather.reason).toBe('missing_kickoff');
    vi.unstubAllGlobals();
  });

  it('marks weather unavailable when geocoding fails', async () => {
    const fetchMock = vi.fn().mockImplementation(() => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const req = new Request('http://test', { method: 'POST', body: JSON.stringify({ home: 'A', away: 'B', kickoff: '2026-10-13T15:00:00Z' }) });
    const res = await POST(req);
    const data = await res.json();
    expect(data.weather.unavailable).toBe(true);
    expect(data.weather.reason).toBe('geocoding_failed');
    vi.unstubAllGlobals();
  });
});