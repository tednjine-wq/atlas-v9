// tools/scraper.mjs — v3: state-machine parser (layout-agnostic) + smarter wait + tab arg
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const SITE = process.argv[2] ?? 'betika';
const URL = process.argv[3] ?? (SITE === 'betika' ? 'https://www.betika.com/en-ke/jackpots' : 'https://www.sportpesa.com/ke/games');
const TAB = process.argv[4] ?? '';
const headless = process.env.HEADLESS !== '0';

const browser = await chromium.launch({ headless });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => /\d\.\d{2}/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(3000);
if (TAB) {
  const tab = page.locator(`text="${TAB}"`).first();
  if (await tab.count().catch(() => 0)) { await tab.click().catch(() => {}); await page.waitForTimeout(3000); }
}
for (let i = 0; i < 3; i++) {
  const btn = page.locator('button:has-text("Load More"), button:has-text("Show More")').first();
  if (await btn.count().catch(() => 0) && await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(1500); } else break;
}
const text = await page.evaluate(() => document.body.innerText);
await browser.close();

mkdirSync('tools/scrapes', { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
writeFileSync(`tools/scrapes/${SITE}-${stamp}.raw.txt`, text);

const lines = text.split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
const isOdd = (s) => /^\d+\.\d+$/.test(s ?? '');
const oddsTok = (s) => isOdd(s) || s === '-';
const clean = (s) => (s ?? '').replace(/Apply Pass|Auto Pick|Clear All|New/gi, '').trim();
const NAV = /^(login|register|home$|live|jackpots$|shikisha|aviator|ligi|casino|promotions|virtuals|crash|live score|app$|print matches|search|back to top|learn more|terms|privacy|responsible|play$|sports$|contact|telephone|email|office|license|18\+|©|mpesa|paybill|shops|call customer|preferences|customise|display|data saver|get help|legal|download|must be won$|midweek|sababisha|results$|game pass|token|stake|combinations|picked|place bet|deposit|notifications|my bets|profile)/i;
const skip = (s) => !s || NAV.test(s) || isOdd(s) || s === '-' || /^[1X2]$/i.test(s) || /^\d{1,2}:\d{2}$/.test(s) || /^\d{2}\/\d{2}/.test(s);

const fixtures = []; const seen = new Set();
let league = '', date = '', time = '';
const names = [];
const push = (home, away, odds) => { const k = home + away; if (!seen.has(k) && home && away) { seen.add(k); fixtures.push({ league, date, time, home, away, odds }); } };

for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  // Dialect C: 10-column print table (date, time, [id], "A vs B", 10 odds)
  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(L) && /^\d{1,2}:\d{2}$/.test(lines[i + 1] ?? '')) {
    let j = i + 2;
    if (/^\d{3,6}$/.test(lines[j] ?? '')) j++;
    const match = lines[j] ?? '';
    if (/\s+vs\.?\s+/i.test(match)) {
      const od = lines.slice(j + 1, j + 11);
      if (od.length === 10 && od.slice(0, 3).every(isOdd) && od.slice(3).every(oddsTok)) {
        const [home, away] = match.split(/\s+vs\.?\s+/i);
        push(clean(home), clean(away), od);
        i = j + 10; continue;
      }
    }
  }
  const dm = L.match(/(\d{2}\/\d{2}),?\s*(\d{1,2}:\d{2})/);
  const lm = L.match(/^soccer\s*[•>:-]\s*(.+)$/i);
  if (dm) { date = dm[1]; time = dm[2]; }
  if (lm) { league = lm[1].replace(/\s*(?:apply pass|auto pick|\d{2}\/\d{2},?\s*\d{1,2}:\d{2}).*$/i, '').replace(/[.,\s…]+$/, '').trim(); continue; }
  if (dm) continue;
  let odds = null, consumed = 0;
  const one = L.match(/^1\s+(\d+\.\d+)\s+X\s+(\d+\.\d+)\s+2\s+(\d+\.\d+)$/i);
  if (one) odds = [one[1], one[2], one[3]];
  else if (/^1\s+\d+\.\d+$/i.test(L) && /^X\s+\d+\.\d+$/i.test(lines[i + 1] ?? '') && /^2\s+\d+\.\d+$/i.test(lines[i + 2] ?? '')) {
    odds = [L.match(/(\d+\.\d+)/)[1], lines[i + 1].match(/(\d+\.\d+)/)[1], lines[i + 2].match(/(\d+\.\d+)/)[1]]; consumed = 2;
  }
  else if (L === '1' && isOdd(lines[i + 1]) && lines[i + 2] === 'X' && isOdd(lines[i + 3]) && lines[i + 4] === '2' && isOdd(lines[i + 5])) {
    odds = [lines[i + 1], lines[i + 3], lines[i + 5]]; consumed = 5;
  }
  else if (/^\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+$/.test(L)) odds = L.split(/\s+/);
  if (odds) {
    if (names.length >= 2) push(names[names.length - 2], names[names.length - 1], odds);
    i += consumed; continue;
  }
  const vm = L.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  if (vm && !isOdd(L)) { names.push(clean(vm[1]), clean(vm[2])); if (names.length > 6) names.shift(); continue; }
  if (!skip(L) && !/^soccer/i.test(L)) { names.push(clean(L)); if (names.length > 6) names.shift(); }
}

const dated = fixtures.filter((f) => f.date);
const row = (f) => `${f.date.length > 6 ? f.date : f.date + '/2026'} ${f.time} ${f.home} vs ${f.away} ${f.odds.join(' ')}`;
const block = (dated.length ? dated : fixtures).map(row).join('\n');
writeFileSync(`tools/scrapes/${SITE}-${stamp}.block.txt`, block);
writeFileSync(`tools/scrapes/${SITE}-${stamp}.json`, JSON.stringify(fixtures, null, 2));
console.log(`✅ ${fixtures.length} fixtures (${dated.length} dated, ${fixtures.filter((f) => f.odds.length === 10).length} with extended cols)`);
if (fixtures.length) { console.log(block); try { execSync('clip', { input: block }); console.log('📋 copied to clipboard'); } catch {} }
else console.log('--- RAW PAGE HEAD (first 40 lines) ---\n' + lines.slice(0, 40).join('\n'));