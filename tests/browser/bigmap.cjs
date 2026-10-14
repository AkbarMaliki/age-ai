// Browser check of the big maps: load time, memory, fps at normal speed and zoomed out, after some game time.
// Run the game server first.   node tests/browser/bigmap.cjs [outDir]   env SIZE=560 (default), MOBILE=1
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/', SIZE = +(process.env.SIZE || 560), MOBILE = !!process.env.MOBILE;
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--enable-precise-memory-info'] });
  const p = await b.newPage(MOBILE ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1536, height: 760 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate((s) => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'hard', color: 'blue', size: s, sizeV: 2, seed: 5, players: 4, name: '', mode: 'watch' })), SIZE);
  await p.reload({ waitUntil: 'networkidle' });
  const t0 = Date.now(); await p.click('#btnPlay');
  await p.waitForFunction(() => window.__ak && __ak.game && __ak.game.W, null, { timeout: 120000 });
  console.log(`size ${SIZE}: game ready in ${((Date.now() - t0) / 1000).toFixed(1)} s, entities ${await p.evaluate(() => __ak.game.W.ents.size)}`);
  const fps = (label) => p.evaluate(async (label) => { const t = __ak.app.ticker; let f = 0; const cb = () => f++; t.add(cb); const g0 = __ak.game.W.t; await new Promise(r => setTimeout(r, 4000)); t.remove(cb);
    const mem = performance.memory ? (performance.memory.usedJSHeapSize / 1048576).toFixed(0) + ' MB heap' : ''; return `${label}: ${(f / 4).toFixed(0)} fps, ${((__ak.game.W.t - g0) / 4).toFixed(1)} game-s/s ${mem}`; }, label);
  await p.waitForTimeout(1500); console.log(await fps('start, 2x'));
  await p.evaluate(() => { const g = __ak.game; for (let n = 0; n < 25 * 600; n++) g.tickOnce(false); });
  console.log('minute', await p.evaluate(() => (__ak.game.W.t / 60).toFixed(0)));
  await p.waitForTimeout(1000); console.log(await fps('minute 25, 2x'));
  await p.evaluate(() => { const g = __ak.game; g.zoomAt(g.app.screen.width / 2, g.app.screen.height / 2, 0.05); }); await p.waitForTimeout(1500);
  console.log(await fps('zoomed all the way out'));
  await p.screenshot({ path: `${SP}/bigmap_${SIZE}.png` });
  await p.keyboard.press('0'); await p.waitForTimeout(1500); console.log(await fps('20x'));
  console.log(errs.slice(0, 8).join('\n') || 'no errors'); await b.close();
})();
