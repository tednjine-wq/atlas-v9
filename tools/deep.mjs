// tools/deep.mjs — v2: triple-strategy link extraction (anchors → DOM ids → click-walk)
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

const URL = process.argv[2] ?? 'https://www.betika.com/en-ke/prematch';
const LIMIT = Math.min(parseInt(process.argv[3] ?? '15', 10) || 15, 40);
const DELAY = parseInt(process.argv[4] ?? '2000', 10) || 2000;
const headless = process.env.HEADLESS !== '0';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = 'https://www.betika.com/en-ke/m/';

const browser = await chromium.launch({ headless });
const page = await browser.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForFunction(() => /\d\.\d{2}/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(3000);
for (let i = 0; i < 3; i++) {
  const btn = page.locator('button:has-text("Load more")').first();
  if (await btn.count().catch(() => 0) && await btn.isVisible().catch(() => false)) { await btn.click(); await page.waitForTimeout(1500); } else break;
}

// Strategy A: real anchors
let links = await page.$$eval('a[href*="/m/"]', (as) => Array.from(new Set(as.map((a) => a.href)))).catch(() => []);
// Strategy B: ids embedded anywhere in the live DOM/HTML
if (!links.length) {
  const html = await page.content().catch(() => '');
  const ids = Array.from(new Set((html.match(/\/m\/(\d{5,10})/g) ?? []).map((s) => s.replace('/m/', ''))));
  links = ids.map((id) => BASE + id);
}
console.log(`🔗 ${links.length} match links (A/B) — deep-scraping first ${Math.min(LIMIT, links.length)}`);

const lineKey = (s) => s.replace('.', '');
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function parseMatchPage(text) {
  const isOddL = (s) => /^\d+\.\d+$/.test(s ?? '');
  const rawLines = text.split(/\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  // Betika match pages put each odd on its own line — merge it into its label line
  const lines = [];
  const LABEL_WITH_LINE = /^(over|under)\s*\d+\.\d+$/i;
  for (const raw of rawLines) {
    const prev = lines[lines.length - 1];
    const paired = prev && /\s\d+\.\d+$/.test(prev) && !LABEL_WITH_LINE.test(prev);
    if (isOddL(raw) && prev && !isOddL(prev) && !paired) lines[lines.length - 1] = prev + ' ' + raw;
    else lines.push(raw);
  }
  const out = {};
  let section = '', home = '', away = '';
  for (let i = 0; i < lines.length; i++) {
    if (/^VS$/i.test(lines[i])) {
      home = lines[i - 1] ?? '';
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        if (/^#\d+$/.test(lines[j])) { away = lines[j + 1] ?? ''; break; }
      }
      break;
    }
  }
  for (const L0 of lines) {
    const L = L0.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9()/.,-]+$/g, '').trim();
    if (/^double chance/i.test(L)) { section = 'dc'; continue; }
    if (/^total\b/i.test(L)) { section = 'tot'; continue; }
    if (/^both teams to score/i.test(L)) { section = 'btts'; continue; }
    if (/^1×2/i.test(L) || /^1x2/i.test(L)) { section = '1x2'; continue; }
    const tm = L.match(/^(.+?)\s+total\b/i);
    if (tm && !/^total/i.test(L)) { section = norm(tm[1]) === norm(home) ? 'htot' : 'atot'; continue; }
    if (/handicap|who will win|scoreboard|statistics|all markets|my favourites|1st half|first half|half time|multigoals|1st goal|cards|combo|player|others/i.test(L)) { section = ''; continue; }
    if (section === 'dc') {
      const a = L.match(/1\/X\s+(\d+\.\d+)/i), b = L.match(/X\/2\s+(\d+\.\d+)/i), c = L.match(/1\/2\s+(\d+\.\d+)/i);
      if (a) out.dc1X = +a[1]; if (b) out.dcX2 = +b[1]; if (c) out.dc12 = +c[1];
      continue;
    }
    if (section === 'btts') {
      const y = L.match(/(?:yes|gg)\s+(\d+\.\d+)/i), n = L.match(/(?:no|ng)\s+(\d+\.\d+)/i);
      if (y) out.bttsYes = +y[1]; if (n) out.bttsNo = +n[1];
      continue;
    }
    if (section === 'tot' || section === 'htot' || section === 'atot') {
      for (const m of L.matchAll(/(over|under)\s*(\d+\.\d+)\s+(\d+\.\d+)/gi)) {
        const k = (m[1].toLowerCase() === 'over' ? 'over' : 'under') + lineKey(m[2]);
        if (section === 'tot') out[k] = +m[3];
        else out[(section === 'htot' ? 'home' : 'away') + k[0].toUpperCase() + k.slice(1)] = +m[3];
      }
      continue;
    }
  }
  return { home, away, out };
}

async function visit(url) {
  const mp = await browser.newPage();
  await mp.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await mp.waitForFunction(() => /double chance/i.test(document.body.innerText), { timeout: 15000 }).catch(() => {});
  await mp.waitForTimeout(1500);
  const text = await mp.evaluate(() => document.body.innerText).catch(() => '');
  await mp.close();
  return text;
}

const overlays = [];
if (links.length) {
  const n = Math.min(LIMIT, links.length);
  for (let i = 0; i < n; i++) {
    const { home, away, out } = parseMatchPage(await visit(links[i]));
    if (home && away && Object.keys(out).length) { overlays.push({ home, away, odds: out }); console.log(`✅ ${home} v ${away}: ${Object.keys(out).length} markets`); }
    else console.log(`⚠ link ${i + 1}: no markets parsed`);
    if (i < n - 1) await sleep(DELAY);
  }
} else {
  // Strategy C v3: popup-aware click-walk + All Markets tab + lazy-scroll + diagnostics
  const total = await page.locator('text=/\\+\\d+ Markets/').count().catch(() => 0);
  const n = Math.min(LIMIT, total);
  console.log(`🖱 no ids in DOM — click-walking ${n} rows`);
  for (let i = 0; i < n; i++) {
    const row = page.locator('text=/\\+\\d+ Markets/').nth(i);
    const popupP = page.context().waitForEvent('page', { timeout: 6000 }).catch(() => null);
    await row.click().catch(() => {});
    let target = await popupP;
    if (target) { await target.waitForLoadState('domcontentloaded').catch(() => {}); await target.waitForTimeout(2500); }
    else { await page.waitForTimeout(2500); target = page; }
    const am = target.locator('text="All Markets"').first();
    if (await am.count().catch(() => 0)) { await am.click().catch(() => {}); await target.waitForTimeout(1500); }
    await target.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); }
      window.scrollTo(0, 0);
    }).catch(() => {});
    await target.waitForTimeout(800);
    const text = await target.evaluate(() => document.body.innerText).catch(() => '');
    const { home, away, out } = parseMatchPage(text);
    const mk = Object.keys(out).length;
    console.log(`row ${i + 1}: url=…${target.url().slice(-18)} home=${home || '?'} markets=${mk}`);
    if (mk === 0) {
      const idx = text.search(/double chance/i);
      console.log('   ctx: ' + (idx >= 0 ? text.slice(idx, idx + 260).replace(/\n/g, ' | ') : 'NO "DOUBLE CHANCE" TEXT ON PAGE'));
    }
    if (home && away && mk) { overlays.push({ home, away, odds: out }); console.log(`✅ ${home} v ${away}: ${mk} markets`); }
    if (target !== page) await target.close().catch(() => {});
    else if (page.url().includes('/m/')) { await page.goBack().catch(() => {}); await page.waitForTimeout(2000); }
    if (i < n - 1) await sleep(DELAY);
  }
}
await browser.close();

mkdirSync('tools/scrapes', { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const block = overlays.map((o) => `${o.home} vs ${o.away} | ` + Object.entries(o.odds).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' | ')).join('\n');
writeFileSync(`tools/scrapes/deep-${stamp}.txt`, block);
writeFileSync(`tools/scrapes/deep-${stamp}.json`, JSON.stringify(overlays, null, 2));
console.log(`🧩 ${overlays.length} overlays → tools/scrapes/deep-${stamp}.txt`);
try { execSync('clip', { input: block }); console.log('📋 copied to clipboard'); } catch {}