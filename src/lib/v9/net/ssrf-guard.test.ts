import { describe, expect, it, vi } from 'vitest';
import { isPublicIp, validateUrl, safeFetchHtml, SsrfError } from './ssrf-guard';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn().mockResolvedValue([{ address: '104.18.3.1', family: 4 }]),
}));

describe('isPublicIp', () => {
  it('blocks non-public v4', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '203.0.113.9', '198.18.0.1', '240.0.0.1', '255.255.255.255']) {
      expect(isPublicIp(ip)).toBe(false);
    }
  });
  it('allows public v4', () => {
    for (const ip of ['8.8.8.8', '104.18.3.1', '197.232.1.1']) expect(isPublicIp(ip)).toBe(true);
  });
  it('blocks non-public v6 incl mapped v4', () => {
    for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isPublicIp(ip)).toBe(false);
    }
  });
  it('allows public v6', () => {
    expect(isPublicIp('2606:4700::1111')).toBe(true);
  });
});

describe('validateUrl', () => {
  it('rejects bad protocol/creds/port/host', () => {
    expect(() => validateUrl('http://www.sportpesa.com/ke')).toThrow(SsrfError);
    expect(() => validateUrl('ftp://www.sportpesa.com/')).toThrow(SsrfError);
    expect(() => validateUrl('https://user:pw@www.sportpesa.com/')).toThrow(SsrfError);
    expect(() => validateUrl('https://www.sportpesa.com:8443/')).toThrow(SsrfError);
    expect(() => validateUrl('https://evil.com/')).toThrow(SsrfError);
    expect(() => validateUrl('https://localhost/')).toThrow(SsrfError);
    expect(() => validateUrl('https://127.0.0.1/')).toThrow(SsrfError);
    expect(() => validateUrl('not a url')).toThrow(SsrfError);
  });
  it('accepts approved hosts', () => {
    expect(validateUrl('https://www.sportpesa.com/ke/games').hostname).toBe('www.sportpesa.com');
    expect(validateUrl('https://sportpesa.com/ke').hostname).toBe('sportpesa.com');
  });
});

describe('safeFetchHtml', () => {
  it('returns html on valid approved fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchHtml('https://www.sportpesa.com/ke')).resolves.toBe('<html>ok</html>');
    vi.unstubAllGlobals();
  });
  it('rejects redirect to non-allowlisted host without fetching it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(safeFetchHtml('https://www.sportpesa.com/ke')).rejects.toThrow(SsrfError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});