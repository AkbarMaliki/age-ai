// Browser test: war statistics panel (play mode = own kingdom + intel, watch mode = all kingdoms + timeline) and map types.
//   node tests/browser/stats.cjs [outDir]      env BASE=http://localhost:8772/
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
  const G = (f, a) => p.evaluate(f, a);
  const ff = (min) => G(async (min) => { const { step } = await import('/js/sim.js'); const g = __ak.game; for (let i = 0; i < min * 600; i++) { for (const ai of g.ais) ai.tick(); step(g.W); g.hist.tick(); for (const e of g.W.ev) if (e.k === 'victory') g.W.ev.length = 0; g.W.ev.length = 0; } }, min);
  for (const [mode, map] of [['play', 'sungai'], ['watch', 'random']]) {
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.evaluate(([mode, map]) => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 144, seed: 0, players: 3, name: '', mode, map })), [mode, map]);
    await p.reload({ waitUntil: 'networkidle' });
    if (mode === 'play') await p.screenshot({ path: `${SP}/st_menu.png` });
    await p.click('#btnPlay'); await p.waitForTimeout(4500);
    console.log(mode, 'map', await G(() => JSON.stringify(__ak.game.W.map)), 'seats', await G(() => JSON.stringify(__ak.game.W.players.map(p => p.start))));
    if (mode === 'play') await G(async () => { const { AI } = await import('/js/ai.js'); const g = __ak.game; g.ais.push(new AI(g.W, 0, 'normal')); });   // let an AI run our side for the fast-forward
    await ff(12);
    await p.keyboard.press('i'); await p.waitForTimeout(700);
    for (const tab of ['sum', 'eco', 'mil', 'time']) {
      await p.click(`#statsTabs button[data-t="${tab}"]`); await p.waitForTimeout(600);
      if (tab === 'time') { const bx = await p.$eval('#statsChart', c => { const r = c.getBoundingClientRect(); return [r.x + r.width * 0.6, r.y + r.height / 2]; }); await p.mouse.move(bx[0], bx[1]); await p.waitForTimeout(300); }
      await p.screenshot({ path: `${SP}/st_${mode}_${tab}.png` });
      console.log(mode, tab, (await p.$eval('#statsBody', e => e.innerText)).replace(/\s+/g, ' ').slice(0, 260));
    }
    console.log(mode, 'columns', await p.$$eval('#statsBody table.st tr:first-child th', t => t.length), 'found', await G(() => JSON.stringify(__ak.game.hist.found.map(f => [f.by, f.of, Math.round(f.t)]))));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    console.log(mode, 'panel hidden after Esc', await p.$eval('#statsPanel', e => e.classList.contains('hidden')));
  }
  // phone landscape
  await p.setViewportSize({ width: 844, height: 390 }); await p.waitForTimeout(500);
  await p.click('#btnStats'); await p.waitForTimeout(500); await p.click('#statsTabs button[data-t="sum"]'); await p.waitForTimeout(400);
  await p.screenshot({ path: `${SP}/st_phone.png` });
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await b.close();
})();
