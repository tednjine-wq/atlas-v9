// v9.10 review §C: SSRF guard for server-side fetching.
// v9.10 audit 8c: body cap enforced DURING streaming (immune to missing or
// spoofed Content-Length); abort timer now covers headers AND body read.
import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';

export const APPROVED_HOSTS = new Set(['sportpesa.com', 'www.sportpesa.com']);
export const MAX_REDIRECTS = 5;
export const FETCH_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

export class SsrfError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SsrfError';
    this.code = code;
  }
}

export function isPublicIp(ip: string): boolean {
  if (isIPv4(ip)) {
    const p = ip.split('.').map(Number);
    const [a, b] = [p[0], p[1]];
    if (a === 0 || a === 127 || a === 10 || a === 255) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 0 || b === 168)) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 203 && b === 0) return false;
    if (a >= 240) return false;
    return true;
  }
  if (isIPv6(ip)) {
    const s = ip.toLowerCase();
    if (s === '::' || s === '::1') return false;
    if (s.startsWith('fe80:') || s.startsWith('fe9') || s.startsWith('fea') || s.startsWith('feb')) return false;
    if (s.startsWith('fc') || s.startsWith('fd')) return false;
    if (s.startsWith('ff')) return false;
    if (s.startsWith('::ffff:')) {
      const v4 = s.slice(7);
      return isIPv4(v4) ? isPublicIp(v4) : false;
    }
    return true;
  }
  return false;
}

export function validateUrl(raw: string): URL {
  let u: URL;
  try { u = new URL(raw); } catch { throw new SsrfError('BAD_URL', 'Malformed URL'); }
  if (u.protocol !== 'https:') throw new SsrfError('BAD_PROTO', 'Unsupported protocol');
  if (u.username || u.password) throw new SsrfError('CREDS', 'Credentials not allowed');
  if (u.port !== '' && u.port !== '443') throw new SsrfError('BAD_PORT', 'Unexpected port');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!APPROVED_HOSTS.has(host)) throw new SsrfError('BAD_HOST', 'Host not allowlisted');
  return u;
}

export async function assertPublicDns(host: string): Promise<void> {
  let addrs: { address: string }[];
  try { addrs = await lookup(host, { all: true }); } catch { throw new SsrfError('DNS', 'DNS resolution failed'); }
  if (!addrs.length) throw new SsrfError('DNS', 'No DNS records');
  for (const r of addrs) {
    if (!isPublicIp(r.address)) throw new SsrfError('PRIVATE_IP', 'Destination resolves to non-public IP');
  }
}

// Stream-counted body cap: never buffers more than MAX_BODY_BYTES, and a
// missing or lying Content-Length cannot bypass it.
async function readCapped(res: Response): Promise<string> {
  const cl = res.headers.get('content-length');
  if (cl && parseInt(cl, 10) > MAX_BODY_BYTES) throw new SsrfError('TOO_BIG', 'Response too large');
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_BODY_BYTES) throw new SsrfError('TOO_BIG', 'Response too large');
    return Buffer.from(buf).toString('utf8');
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      void reader.cancel().catch(() => undefined);
      throw new SsrfError('TOO_BIG', 'Response too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function safeFetchHtml(rawUrl: string): Promise<string> {
  let current = validateUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicDns(current.hostname);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      let res: Response;
      try {
        res = await fetch(current, { redirect: 'manual', signal: ctl.signal, headers: { 'user-agent': 'atlas-research/9.10' } });
      } catch {
        throw new SsrfError(ctl.signal.aborted ? 'TIMEOUT' : 'UPSTREAM', ctl.signal.aborted ? 'Upstream timed out' : 'Upstream request failed');
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) throw new SsrfError('BAD_REDIRECT', 'Redirect without location');
        if (hop === MAX_REDIRECTS) throw new SsrfError('BAD_REDIRECT', 'Too many redirects');
        current = validateUrl(new URL(loc, current).toString());
        continue;
      }
      if (!res.ok) throw new SsrfError('UPSTREAM', 'Upstream request failed');
      const ct = res.headers.get('content-type') ?? '';
      if (!/text\/html|application\/xhtml\+xml/i.test(ct)) throw new SsrfError('BAD_TYPE', 'Unexpected content type');
      try {
        return await readCapped(res);
      } catch (e) {
        if (e instanceof SsrfError) throw e;
        if (ctl.signal.aborted) throw new SsrfError('TIMEOUT', 'Upstream timed out');
        throw new SsrfError('UPSTREAM', 'Upstream request failed');
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new SsrfError('BAD_REDIRECT', 'Too many redirects');
}