// Browser test (Playwright + system Chrome). Run the game server first (start.bat or: node server.cjs 8772).
//   node tests/browser/zoom.cjs [outDir]      env BASE=http://localhost:8772/ (e.g. 8791 to test a docs/ build)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'hard', color: 'blue', size: 180, sizeV: 2, seed: 12, players: 4, name: '', mode: 'watch' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay'); await p.waitForFunction(() => window.__ak && __ak.game && __ak.game.W, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(async () => { const { step } = await import('/js/sim.js'); const g = __ak.game; for (let i = 0; i < 12 * 600; i++) { for (const ai of g.ais) ai.tick(); step(g.W); g.W.ev.length = 0; } });
  await p.mouse.move(800, 400);
  for (let k = 0; k < 30; k++) { await p.mouse.wheel(0, 120); await p.waitForTimeout(30); }
  await p.waitForTimeout(1500);
  const fps = await p.evaluate(async () => { const t = __ak.app.ticker; let n = 0; const f = () => n++; t.add(f); await new Promise(r => setTimeout(r, 3000)); t.remove(f); return [n / 3, __ak.game.view.cam.zoom, __ak.game.view.objs.children.filter(c => c.visible).length]; });
  console.log('fps/zoom/visible sprites', fps);
  await p.screenshot({ path: `${SP}/zoomout.png` });
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
