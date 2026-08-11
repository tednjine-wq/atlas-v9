'use client';
import { useState } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import { emptyMatch } from '@/lib/v9/atlas-types';

export default function ScrapeButton() {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const scrape = async () => {
    if (!url.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch('/api/scrape-sportpesa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'scrape failed');
      const fixtures = data.fixtures ?? [];
      if (fixtures.length > 0) {
        useAtlasStore.setState((s) => ({
          matches: [
            ...s.matches,
            ...fixtures.map((f: { home?: string; away?: string; h?: number; d?: number; a?: number }) => ({
              ...emptyMatch(crypto.randomUUID()),
              home: String(f.home ?? 'Home'), away: String(f.away ?? 'Away'),
              h: String(f.h ?? ''), d: String(f.d ?? ''), a: String(f.a ?? ''),
            })),
          ],
        }));
      }
      setMsg(`Extracted ${fixtures.length} fixtures${fixtures.length === 0 ? ' — use Smart Paste instead' : ''}`);
    } catch (e) {
      setMsg(`Scrape failed: ${e instanceof Error ? e.message : 'error'}. Use Smart Paste instead.`);
    } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-2">
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="SportPesa URL…"
        className="w-56 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-300 focus:border-blue-500 focus:outline-none" />
      <button onClick={scrape} disabled={busy}
        className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40">
        {busy ? 'Scraping…' : 'Scrape'}
      </button>
      {msg && <span className="text-[10px] text-zinc-500">{msg}</span>}
    </div>
  );
}
