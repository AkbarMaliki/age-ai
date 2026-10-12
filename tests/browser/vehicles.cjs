// Browser test: ships, ram and cannon render from the units atlas (not the fallback box), and fight/sail without errors.
//   node tests/browser/vehicles.cjs [outDir]      env BASE=http://localhost:8772/
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
  const G = (f, a) => p.evaluate(f, a);
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await G(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'easy', color: 'blue', size: 144, seed: 21, players: 2, name: '', mode: 'play', map: 'kepulauan', season: 'semi', night: 'off' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay'); await p.waitForTimeout(4000);
  const where = await G(async () => {
    const { addUnit, passable } = await import('/js/sim.js'); const g = __ak.game, W = g.W, P = W.players[0], [sx, sy] = P.start;
    P.exp.fill(1);
    let wx = 0, wy = 0, best = 1e9;      // open water closest to home
    for (let j = 2; j < W.size - 2; j++) for (let i = 2; i < W.size - 2; i++) {
      if (![[0, 0], [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2]].every(([a, c]) => passable(W, i + a, j + c, 0, true))) continue;
      const d = Math.hypot(i - sx, j - sy); if (d < best) { best = d; wx = i; wy = j; }
    }
    const ships = ['fishing_boat', 'transport_ship', 'war_ship'].map((t, k) => addUnit(W, 0, t, wx + 0.5 + k * 1.6, wy + 0.5).id);
    const land = ['ram', 'cannon'].map((t, k) => addUnit(W, 0, t, sx + 5 + k * 2, sy + 4).id);
    g.centerOn(wx, wy); g.view.cam.zoom = 1.1;
    return { wx, wy, ships, land };
  });
  await p.waitForTimeout(1500); await p.screenshot({ path: `${SP}/veh_ships.png` });
  await G(() => { const g = __ak.game, [sx, sy] = g.W.players[0].start; g.centerOn(sx + 6, sy + 4); });
  await p.waitForTimeout(1000); await p.screenshot({ path: `${SP}/veh_siege.png` });
  // the sprites must come from the atlas: their texture frame keys name the unit type
  const tex = await G((ids) => {
    const g = __ak.game, out = {};
    for (const id of ids) { const e = g.W.ents.get(id), v = g.view.views.get(id), [fr] = g.view.frameFor(e); out[e.type] = !v ? 'no-view' : fr ? `atlas ${Math.round(v.spr.width)}x${Math.round(v.spr.height)}` : 'fallback'; }
    return out;
  }, [...where.ships, ...where.land]);
  console.log('textures', JSON.stringify(tex));
  // move the war ship and fire the cannon at a fake enemy to exercise anims + projectiles
  await G(async (w) => {
    const { command, addUnit } = await import('/js/sim.js'); const g = __ak.game, W = g.W, c = W.ents.get(w.land[1]);
    const foe = addUnit(W, 1, 'militia', c.x + 5, c.y);
    command(W, { t: 'smart', pid: 0, ids: [w.land[1]], target: foe.id, x: foe.x, y: foe.y });
    command(W, { t: 'move', pid: 0, ids: [w.ships[2]], x: w.wx + 8, y: w.wy + 3 });
  }, where);
  await p.waitForTimeout(5000); await p.screenshot({ path: `${SP}/veh_fire.png` });
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await b.close();
})();
