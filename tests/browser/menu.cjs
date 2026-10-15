// Browser check of the main menu background: the drifting picture, then the living world (?live), fps while it runs,
// starting a game replaces it cleanly, and it comes back on the way back to the menu.   node tests/browser/menu.cjs [outDir]
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
  const p = await b.newPage({ viewport: { width: 1536, height: 760 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const t0 = Date.now();
  await p.goto(BASE + '?live', { waitUntil: 'networkidle' });
  await p.waitForTimeout(800); await p.screenshot({ path: `${SP}/menu_picture.png` });
  await p.waitForFunction(() => document.body.classList.contains('livebg'), null, { timeout: 90000 });
  console.log(`living background ready after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await p.waitForTimeout(3000);
  const fps = await p.evaluate(async () => { let f = 0; const cb = () => { f++; requestAnimationFrame(cb); }; requestAnimationFrame(cb); await new Promise(r => setTimeout(r, 4000)); return f / 4; });
  console.log('page frames per second while the menu shows', fps.toFixed(0));
  await p.screenshot({ path: `${SP}/menu_live.png` });
  await p.waitForTimeout(10000); await p.screenshot({ path: `${SP}/menu_live2.png` });
  // start a game: the scene goes, the game comes
  await p.click('#btnPlay');
  await p.waitForFunction(() => window.__ak && __ak.game && __ak.game.W, null, { timeout: 90000 }); await p.waitForTimeout(1500);
  console.log('in game: livebg', await p.evaluate(() => document.body.classList.contains('livebg')), 'stage children', await p.evaluate(() => __ak.app.stage.children.length));
  // back to the menu: the living background returns
  await p.evaluate(() => { document.getElementById('pQuit').click(); });
  await p.waitForFunction(() => document.body.classList.contains('livebg'), null, { timeout: 90000 });
  console.log('back in the menu: living background again');
  console.log(errs.slice(0, 8).join('\n') || 'no errors'); await b.close();
})();
