// ============================================================
// Engine color system — Rule 2: bars MUST be color-differentiated
// Standard = blue/violet/green | Jackpot = amber/orange/yellow
// ============================================================
export type EngineMode = 'standard' | 'jackpot';

export const ENGINE_COLORS: Record<EngineMode, {
  home: string; draw: string; away: string;
  barHome: string; barDraw: string; barAway: string;
  badge: string; accent: string; border: string;
}> = {
  standard: {
    home: 'text-blue-400', draw: 'text-violet-400', away: 'text-emerald-400',
    barHome: 'bg-blue-500', barDraw: 'bg-violet-500', barAway: 'bg-emerald-500',
    badge: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
    accent: 'text-blue-400', border: 'border-blue-500/25',
  },
  jackpot: {
    home: 'text-amber-400', draw: 'text-orange-400', away: 'text-yellow-300',
    barHome: 'bg-amber-500', barDraw: 'bg-orange-500', barAway: 'bg-yellow-400',
    badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    accent: 'text-amber-400', border: 'border-amber-500/25',
  },
};

export const fmtPct = (x: number) => `${(x * 100).toFixed(1)}%`;
export const fmtOdds = (x: number) => (x > 1 ? x.toFixed(2) : '—');
