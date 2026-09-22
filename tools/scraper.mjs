// tools/scraper.mjs — v5: + Betika Prematch 3-bare-odds vertical layout + auto-load-more
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SITE = process.argv[2] ?? 'betika';
const URL = process.argv[3] ?? (SITE === 'betika' ? 'https://www.betika.com/en-ke/jackpots' : 'https://www.sportpesa.com/ke/games');
const TAB = process.argv[4] ?? '';
const headless = process.env.HEADLESS !== '0';

const browser = await chromium.launch({ headless });
let active = await browser.newPage();
await active.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await active.waitForFunction(() => /\d\.\d{2}/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
await active.waitForTimeout(3000);

if (TAB) {
  const tab = active.locator(`text="${TAB}"`).first();
  if (await tab.count().catch(() => 0)) {
    const popupP = active.context().waitForEvent('page', { timeout: 8000 }).catch(() => null);
    await tab.click().catch(() => {});
    const popup = await popupP;
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      await popup.waitForFunction(() => /\d\.\d{2}/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
      await popup.waitForTimeout(2500);
      active = popup;
    } else await active.waitForTimeout(2500);
  }
}

// Aggressively click "Load more" to get the full board
for (let i = 0; i < 10; i++) {
  const btn = active.locator('button:has-text("Load more"), button:has-text("Show More")').first();
  if (await btn.count().catch(() => 0) && await btn.isVisible().catch(() => false)) { 
    await btn.click().catch(() => {}); 
    await active.waitForTimeout(1500); 
  } else break;
}

const text = await active.evaluate(() => document.body.innerText);
await browser.close();

mkdirSync('tools/scrapes', { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
writeFileSync(`tools/scrapes/${SITE}-${stamp}.raw.txt`, text);

const lines = text.split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const isOdd = (s) => /^\d+\.\d+$/.test(s ?? '');
const oddsTok = (s) => isOdd(s) || s === '-';
const clean = (s) => (s ?? '').replace(/Apply Pass|Auto Pick|Clear All|New|\+?\d+ Markets/gi, '').replace(/\.{2,}$/, '').trim();
const NAV = /^(login|register|home$|live|jackpots$|shikisha|aviator|ligi|casino|promotions|virtuals|crash|live score|app$|print matches|search|back to top|learn more|terms|privacy|responsible|play$|sports$|contact|telephone|email|office|license|18\+|©|mpesa|paybill|shops|call customer|preferences|customise|display|data saver|get help|legal|download|must be won$|midweek|sababisha|results$|game pass|token|stake|combinations|picked|place bet|deposit|notifications|my bets|profile|soccer betting|join our|whether you|keep it|watch live|open a|how to|normal \(0\))/i;
const skip = (s) => !s || NAV.test(s) || isOdd(s) || s === '-' || /^[1X2]$/i.test(s);

const fixtures = []; const seen = new Set();
const push = (home, away, odds, d = '', t = '', l = '') => { 
  const k = home + away; 
  if (!seen.has(k) && home && away && !isOdd(home) && !isOdd(away)) { 
    seen.add(k); 
    fixtures.push({ league: l, date: d, time: t, home, away, odds }); 
  } 
};

for (let i = 0; i < lines.length; i++) {
  const L = lines[i];

  // Dialect E: Betika Prematch vertical (League / Date,Time / Home / Away / H / D / A)
  if (isOdd(L) && isOdd(lines[i+1]) && isOdd(lines[i+2])) {
    const away = clean(lines[i-1]);
    const home = clean(lines[i-2]);
    const dtLine = lines[i-3] ?? '';
    const leagueLine = lines[i-4] ?? '';
    const dm = dtLine.match(/(\d{2}\/\d{2}),?\s*(\d{1,2}:\d{2})/);
    if (dm && home && away && !skip(home) && !skip(away)) {
      push(home, away, [L, lines[i+1], lines[i+2]], dm[1], dm[2], clean(leagueLine));
      i += 2;
      continue;
    }
  }

  // Dialect D: 10-column single line (Print Matches)
  const m10 = L.match(/^(\d{2}\/\d{2}\/\d{2,4})\s+(\d{1,2}:\d{2})\s+(?:(\d{3,6})\s+)?(.+?)\s+vs\.?\s+(.+?)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)$/);
  if (m10) {
    const od = m10.slice(6, 16);
    if (od.slice(0, 3).every(isOdd) && od.slice(3).every(oddsTok)) { 
      push(clean(m10[4]), clean(m10[5]), od, m10[1], m10[2], ''); 
      continue; 
    }
  }

  // Dialect C: 10-column table cells on separate lines
  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(L) && /^\d{1,2}:\d{2}$/.test(lines[i + 1] ?? '')) {
    let j = i + 2;
    if (/^\d{3,6}$/.test(lines[j] ?? '')) j++;
    const match = lines[j] ?? '';
    if (/\s+vs\.?\s+/i.test(match)) {
      const od = lines.slice(j + 1, j + 11);
      if (od.length === 10 && od.slice(0, 3).every(isOdd) && od.slice(3).every(oddsTok)) {
        const [home, away] = match.split(/\s+vs\.?\s+/i);
        push(clean(home), clean(away), od, L, lines[i + 1], '');
        i = j + 10; continue;
      }
    }
  }
}

const dated = fixtures.filter((f) => f.date);
const row = (f) => `${f.date.length > 6 ? f.date : f.date + '/2026'} ${f.time} ${f.home} vs ${f.away} ${f.odds.join(' ')}`;
const block = (dated.length ? dated : fixtures).map(row).join('\n');
writeFileSync(`tools/scrapes/${SITE}-${stamp}.block.txt`, block);
writeFileSync(`tools/scrapes/${SITE}-${stamp}.json`, JSON.stringify(fixtures, null, 2));
console.log(`✅ ${fixtures.length} fixtures (${dated.length} dated, ${fixtures.filter((f) => f.odds.length === 10).length} with extended cols)`);
if (fixtures.length) { 
  console.log(block.slice(0, 500) + (block.length > 500 ? '\n... (truncated)' : '')); 
  try { execSync('clip', { input: block }); console.log('📋 copied to clipboard'); } catch {} 
} else {
  console.log('--- RAW PAGE HEAD (first 40 lines) ---\n' + lines.slice(0, 40).join('\n'));
}