// Browser test (Playwright + system Chrome). Run the game server first (start.bat or: node server.cjs 8772).
//   node tests/browser/mobile.cjs [outDir]      env BASE=http://localhost:8772/ (e.g. 8791 to test a docs/ build)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
  const ctx = await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 112, seed: 31, players: 2, name: '', mode: 'play' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(800);
  console.log('touch class', await p.evaluate(() => document.body.classList.contains('touch')));
  await p.screenshot({ path: `${SP}/m_menu.png` });
  await p.tap('#btnPlay'); await p.waitForTimeout(6000);
  await p.screenshot({ path: `${SP}/m_game.png` });
  const G = (f, a) => p.evaluate(f, a);
  // tap a villager
  const vpos = await G(() => { const g = __ak.game; const v = [...g.W.ents.values()].find(e => e.kind === 'unit' && e.owner === 0 && e.type === 'villager'); const [sx, sy] = g.view.worldToScreen(v.x, v.y); return [sx, sy - 20, v.id]; });
  await p.touchscreen.tap(vpos[0], vpos[1]); await p.waitForTimeout(400);
  console.log('selected after tap', await G(() => __ak.game.sel.map(id => __ak.game.W.ents.get(id).type)));
  // tap ground -> move order
  await G(() => { window.__cmds = []; const W = __ak.game.W; const o = W.cmds.push.bind(W.cmds); W.cmds.push = (c) => { window.__cmds.push(JSON.stringify(c)); return o(c); }; });
  const gpos = await G(async () => { const { placementOk } = await import('/js/sim.js'); const g = __ak.game, W = g.W, tc = W.ents.get(W.players[0].tc);
    for (let r = 5; r < 12; r++) for (let a = 0; a < 16; a++) { const i = Math.round(tc.x + 2 + Math.cos(a) * r), j = Math.round(tc.y + 2 + Math.sin(a) * r); if (placementOk(W, 0, 'house', i, j) && placementOk(W, 0, 'house', i - 1, j - 1)) { const [sx, sy] = g.view.worldToScreen(i + 1, j + 1); if (sx > 60 && sx < 780 && sy > 50 && sy < 270) return [sx, sy, i, j]; } } return null; });
  console.log('free spot', gpos);
  await p.touchscreen.tap(gpos[0], gpos[1]); await p.waitForTimeout(150);
  console.log('cmds', await G(() => window.__cmds), 'sel', await G(() => __ak.game.sel), 'order', await G((id) => JSON.stringify(__ak.game.W.ents.get(id).order), vpos[2]));
  // drag with one finger -> camera pans (CDP touch events)
  const cdp = await ctx.newCDPSession(p);
  const cam0 = await G(() => [__ak.game.view.cam.x, __ak.game.view.cam.y]);
  const tp = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  await tp('touchStart', [{ x: 400, y: 200 }]); for (let k = 1; k <= 8; k++) await tp('touchMove', [{ x: 400 - k * 20, y: 200 - k * 8 }]); await tp('touchEnd', []);
  const cam1 = await G(() => [__ak.game.view.cam.x, __ak.game.view.cam.y]);
  // pinch out
  const z0 = await G(() => __ak.game.view.cam.zoom);
  await tp('touchStart', [{ x: 380, y: 200, id: 1 }, { x: 460, y: 200, id: 2 }]);
  for (let k = 1; k <= 8; k++) await tp('touchMove', [{ x: 380 + k * 12, y: 200, id: 1 }, { x: 460 - k * 6, y: 200, id: 2 }]);
  await tp('touchEnd', []);
  const z1 = await G(() => __ak.game.view.cam.zoom);
  console.log('pan', cam0.map(Math.round), '->', cam1.map(Math.round), 'pinch zoom', z0.toFixed(2), '->', z1.toFixed(2));
  // select TC via touch bar, train villager via command button
  await p.tap('#tbTC'); await p.waitForTimeout(300);
  await p.tap('#cmd .cb:nth-child(1)'); await p.waitForTimeout(300);
  console.log('tc queue', await G(() => { const g = __ak.game; const tc = g.W.ents.get(g.W.players[0].tc); return tc.queue.map(q => q.unit); }));
  await p.screenshot({ path: `${SP}/m_tc.png` });
  // building placement with touch: select villagers, tap house button, tap ground
  await G(() => { const g = __ak.game; g.select([...g.W.ents.values()].filter(e => e.kind === 'unit' && e.owner === 0 && e.type === 'villager').map(e => e.id)); });
  await p.waitForTimeout(300); await p.tap('#cmd .cb:nth-child(1)'); await p.waitForTimeout(200);
  const spot = await G(([i, j]) => __ak.game.view.worldToScreen(i + 1, j + 1), [gpos[2], gpos[3]]);
  await p.touchscreen.tap(spot[0], spot[1]); await p.waitForTimeout(400);
  console.log('placing state', await G(() => JSON.stringify(__ak.game.placing)), 'cmds', await G(() => window.__cmds.slice(-2)));
  console.log('foundations', await G(() => [...__ak.game.W.ents.values()].filter(e => e.kind === 'building' && e.owner === 0 && !e.built).map(e => e.type)));
  const fps = await G(async () => { const t = __ak.app.ticker; let n = 0; const f = () => n++; t.add(f); await new Promise(r => setTimeout(r, 2000)); t.remove(f); return n / 2; });
  console.log('fps', fps, 'renderer res', await G(() => __ak.app.renderer.resolution));
  console.log(errs.slice(0, 10).join('\n') || 'no errors');
  // portrait warning
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(500); await p.screenshot({ path: `${SP}/m_portrait.png` });
  await b.close();
})();
