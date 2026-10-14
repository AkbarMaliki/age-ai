// Browser check of the underground mine: build button, the mine sprite, ore buttons and miners going down.
//   node tests/browser/mines.cjs [outDir]      env BASE=http://localhost:8772/
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push('error: ' + m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 144, seed: 4242, players: 2, name: '' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.click('#btnPlay'); await p.waitForFunction(() => window.__ak && __ak.game, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  const G = (f, a) => p.evaluate(f, a);
  // the build button on the villager's economy page
  const btn = await G(() => { const g = __ak.game, W = g.W; W.players[0].age = 2; W.players[0].res.wood = 2000; const v = [...W.ents.values()].find(e => e.owner === 0 && e.type === 'villager'); g.select([v.id]); g.hud.update(0.1); g.hud.buildCommands(g.selected ? g.selected() : [v]); return [...document.querySelectorAll('#cmds button, .cmd')].map(b => b.title || b.getAttribute('data-name') || b.textContent).join(' | ').slice(0, 600); });
  console.log('villager buttons:', btn.includes('Tambang') ? 'mine button present' : btn);
  // a mine, miners, and the mine selected
  await G(async () => { const { addBuilding, addUnit, nearestFree, command } = await import('/js/sim.js'); const g = __ak.game, W = g.W, tc = W.ents.get(W.players[0].tc);
    const f = nearestFree(W, tc.x + 8, tc.y + 6, 0, 8); const m = addBuilding(W, 0, 'mine_shaft', f[0], f[1], true); window.__mine = m.id;
    const ids = []; for (let k = 0; k < 7; k++) { const q = nearestFree(W, m.x + 1, m.y + 5, 0, 6); ids.push(addUnit(W, 0, 'villager', q[0] + 0.5, q[1] + 0.5).id); }
    command(W, { t: 'smart', pid: 0, ids, target: m.id, x: m.x + 1, y: m.y + 1 }); g.centerOn(m.x + 1.5, m.y + 1.5); g.select([m.id]); });
  await p.waitForTimeout(9000);
  const info = await G(() => { const W = __ak.game.W, m = W.ents.get(window.__mine); return { under: [...W.dyn.values()].filter(u => u.inside === m.id).length, left: Math.round(m.left), ore: m.ore, panel: (document.querySelector('.stats') || {}).textContent }; });
  console.log('mine', JSON.stringify(info));
  await p.screenshot({ path: `${SP}/mine.png` });
  console.log(errs.length ? errs.join('\n') : 'no errors');
  await b.close();
})();
