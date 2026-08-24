'use client';
import { useEffect, useRef, useState } from 'react';
import { useAtlasStore } from '@/lib/v9/store/atlas-store';
import MatchCard from '@/components/atlas/MatchCard';
import QuickViewTables from '@/components/atlas/QuickViewTables';
import SummaryPanel from '@/components/atlas/SummaryPanel';
import SimulationPanel from '@/components/atlas/SimulationPanel';
import LearningPanel from '@/components/atlas/LearningPanel';
import CalibrationPanel from '@/components/atlas/CalibrationPanel';
import APIPicksPanel from '@/components/atlas/APIPicksPanel';
import ScreenerPanel from '@/components/atlas/ScreenerPanel';
import JackpotLabPanel from '@/components/atlas/JackpotLabPanel';
import StandardLabPanel from '@/components/atlas/StandardLabPanel';
import ContextLabPanel from '@/components/atlas/ContextLabPanel';
import DashboardPanel from '@/components/atlas/DashboardPanel';
import ContextBadge from '@/components/atlas/ContextBadge';
import ScrapeButton from '@/components/atlas/ScrapeButton';

const TABS = ['Matches', 'Dashboard', 'Screener', 'Jackpot Lab', 'Standard Lab', 'Context Lab', 'Quick View', 'Simulations', 'Learning', 'Backtest', 'API Picks'] as const;

export default function AtlasPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Matches');
  const [matchView, setMatchView] = useState<'selected' | 'all'>('selected');
  const matches = useAtlasStore((s) => s.matches);
  const phi = useAtlasStore((s) => s.phi);
  const setPhi = useAtlasStore((s) => s.setPhi);
  const addMatch = useAtlasStore((s) => s.addMatch);
  const exportSession = useAtlasStore((s) => s.exportSession);
  const importSession = useAtlasStore((s) => s.importSession);
  const fileRef = useRef<HTMLInputElement>(null);

  // v9.5: panels can request a tab switch (e.g. Screener → Matches)
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if ((TABS as readonly string[]).includes(t)) setTab(t as (typeof TABS)[number]);
    };
    window.addEventListener('atlas:tab', h);
    return () => window.removeEventListener('atlas:tab', h);
  }, []);

  const starredMatches = matches.filter((m) => m.starred);
  const shownMatches = matchView === 'selected' && starredMatches.length ? starredMatches : matches;

  const download = () => {
    const blob = new Blob([exportSession()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `atlas_v9_session_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  const clearAll = () => {
    if (window.confirm(`Delete ALL ${matches.length} matches? Results and learning data are kept. This cannot be undone.`)) {
      useAtlasStore.setState({ matches: [] });
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-4 md:p-6 text-zinc-100">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">
            ATLAS <span className="text-blue-400">v9.10</span>
            <span className="ml-2 text-xs font-normal text-zinc-500">
              Enhanced · hybrid Bayesian calibration · copula HT/FT · adaptive MC · beta-binomial learning · fixture screener · jackpot lab · standard lab
            </span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs">
            φ threshold <b className="tabular-nums text-blue-400">{phi.toFixed(2)}</b>
            <input type="range" min={0} max={0.3} step={0.01} value={phi}
              onChange={(e) => setPhi(parseFloat(e.target.value))} className="w-24 accent-blue-500" />
          </label>
          <button onClick={addMatch} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold hover:bg-blue-500">+ Add Match</button>
          <button onClick={download} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Export</button>
          <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800">Import</button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) importSession(await f.text());
          }} />
        </div>
      </header>

      <nav className="mb-4 flex flex-wrap items-center gap-1.5">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
              tab === t ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800'}`}>
            {t}
          </button>
        ))}
        <div className="ml-auto"><ScrapeButton /></div>
      </nav>

      {tab === 'Matches' && (
        <div className="space-y-4">
          <div className="flex items-center justify-end gap-2">
            <div className="flex overflow-hidden rounded-lg border border-zinc-800 text-[11px]">
              <button onClick={() => setMatchView('selected')}
                className={`px-3 py-1.5 ${matchView === 'selected' ? 'bg-teal-500/15 text-teal-300' : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'}`}>
                ★ Selected ({starredMatches.length})
              </button>
              <button onClick={() => setMatchView('all')}
                className={`px-3 py-1.5 ${matchView === 'all' ? 'bg-zinc-100 text-zinc-950' : 'bg-zinc-900 text-zinc-500 hover:bg-zinc-800'}`}>
                All ({matches.length})
              </button>
            </div>
            {matches.length > 0 && (
              <button onClick={clearAll}
                className="rounded-lg border border-rose-500/30 px-3 py-1.5 text-[11px] text-rose-400 hover:bg-rose-500/10">
                🗑 Clear All Matches
              </button>
            )}
          </div>
          <SummaryPanel />
          {shownMatches.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-800 p-10 text-center text-sm text-zinc-600">
              {matchView === 'selected'
                ? 'No starred matches yet — import a fixture list in the Screener and the auto-built legs will appear here.'
                : 'No matches yet. Click "+ Add Match", use the Screener to import a fixture list, or import API picks.'}
            </div>
          )}
          {shownMatches.map((m) => (
            <div key={m.id} className="space-y-1">
              <ContextBadge match={m} />
              <MatchCard match={m} />
            </div>
          ))}
        </div>
      )}
      {tab === 'Dashboard' && <DashboardPanel />}
      {tab === 'Screener' && <ScreenerPanel />}
      {tab === 'Jackpot Lab' && <JackpotLabPanel />}
      {tab === 'Standard Lab' && <StandardLabPanel />}
      {tab === 'Context Lab' && <ContextLabPanel />}
      {tab === 'Quick View' && <QuickViewTables />}
      {tab === 'Simulations' && <SimulationPanel />}
      {tab === 'Learning' && <LearningPanel />}
      {tab === 'Backtest' && <CalibrationPanel />}
      {tab === 'API Picks' && <APIPicksPanel />}

      <footer className="mt-8 text-center text-[10px] text-zinc-700">
        ATLAS v9.10 · build p79 · 100% client-side computation · Standard ρ=-0.13 / Jackpot ρ=-0.08 · MC is a cross-check, never the primary model
      </footer>
    </div>
  );
}
