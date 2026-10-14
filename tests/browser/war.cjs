// Browser test (Playwright + system Chrome): spectator fog eye button (V) and the war chronicle (Statistik > Kronik Perang).
// Run the game server first (start.bat or: node server.cjs 8772).   node tests/browser/war.cjs [outDir]
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'hard', color: 'blue', size: 112, sizeV: 2, seed: 5, players: 3, name: '', mode: 'watch' })));
  await p.reload({ waitUntil: 'networkidle' });
  await p.click('#btnPlay'); await p.waitForFunction(() => window.__ak && __ak.game && __ak.game.W, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  const st = () => p.evaluate(() => ({ btn: !document.getElementById('fogBtn').classList.contains('hidden'), off: document.getElementById('fogBtn').classList.contains('off'), reveal: __ak.game.view.reveal, seeAll: __ak.game.seeAll }));
  console.log('start', JSON.stringify(await st()));
  await p.screenshot({ path: `${SP}/war_fog_open.png` });
  await p.click('#fogBtn'); await p.waitForTimeout(800);
  console.log('after click', JSON.stringify(await st()));
  console.log('note', await p.evaluate(() => [...document.querySelectorAll('#notify > *')].map(n => n.textContent).filter(t => t.includes('👁')).pop()));
  await p.keyboard.press('Tab'); await p.waitForTimeout(300);
  console.log('note after Tab', await p.evaluate(() => [...document.querySelectorAll('#notify > *')].map(n => n.textContent).filter(t => t.includes('👁')).pop()));
  await p.screenshot({ path: `${SP}/war_fog_on.png` });
  await p.keyboard.press('v'); await p.waitForTimeout(500);
  console.log('after V', JSON.stringify(await st()));
  // fast-forward ~50 game-minutes so the commanders go to war
  const t0 = Date.now();
  await p.evaluate(() => { const g = __ak.game; for (let n = 0; n < 30000 && g.W.winner < 0; n++) g.tickOnce(false); });
  console.log('ff', ((Date.now() - t0) / 1000).toFixed(0) + 's', 'game min', await p.evaluate(() => (__ak.game.W.t / 60).toFixed(1)));
  console.log('chronicle', await p.evaluate(() => (__ak.game.W.chron || []).length), JSON.stringify(await p.evaluate(() => (__ak.game.W.chron || []).slice(0, 6).map(c => c.text))));
  await p.click('#btnStats'); await p.waitForTimeout(300);
  await p.click('#statsTabs button[data-t="war"]'); await p.waitForTimeout(600);
  console.log('panel', (await p.evaluate(() => document.getElementById('statsBody').innerText)).slice(0, 700));
  await p.screenshot({ path: `${SP}/war_chronicle.png` });
  console.log(errs.slice(0, 15).join('\n') || 'no errors');
  await b.close();
})();
