import { describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, SsrfError, safeFetchHtml } from './ssrf-guard';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '104.18.3.1', family: 4 }]),
}));

describe('safeFetchHtml body-cap enforcement (audit 8c)', () => {
  it('rejects oversized bodies', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 1024);
    const fetchMock = vi.fn().mockResolvedValue(new Response(big, { status: 200, headers: { 'content-type': 'text/html' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchHtml('https://www.sportpesa.com/ke')).rejects.toThrow(SsrfError);
    vi.unstubAllGlobals();
  });
  it('enforces the cap even when Content-Length lies low', async () => {
    const big = 'x'.repeat(MAX_BODY_BYTES + 1024);
    const fetchMock = vi.fn().mockResolvedValue(new Response(big, { status: 200, headers: { 'content-type': 'text/html', 'content-length': '10' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchHtml('https://www.sportpesa.com/ke')).rejects.toThrow(SsrfError);
    vi.unstubAllGlobals();
  });
});