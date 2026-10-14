// Browser test: living world + new systems. Map types / seasons, day-night, roads, upgrades, formations, advisor,
// deck builder, achievements. node tests/browser/world.cjs [outDir]   env BASE=http://localhost:8772/
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message + ' ' + (e.stack || '').split('\n')[1])); p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
  const G = (f, a) => p.evaluate(f, a);
  const ff = (sec) => G(async (sec) => { const { step } = await import('/js/sim.js'); const g = __ak.game; for (let i = 0; i < sec * 10; i++) { for (const ai of g.ais) ai.tick(); step(g.W); g.hist.tick(); for (const e of g.W.ev) g.onEvent(e); g.W.ev.length = 0; } }, sec);
  const cases = (process.env.CASES || 'pegunungan:salju,sungai:gugur,kepulauan:semi').split(',');
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.screenshot({ path: `${SP}/wd_menu.png` });
  // deck builder + achievements in the menu
  await p.click('#btnDeck'); await p.waitForTimeout(500); await p.screenshot({ path: `${SP}/wd_deck.png` }); await p.click('#deckClose'); await p.waitForTimeout(200);
  await p.click('#btnAch'); await p.waitForTimeout(300); await p.screenshot({ path: `${SP}/wd_ach.png` }); await p.click('#achClose');
  for (const cs of cases) {
    const [map, season] = cs.split(':');
    await p.evaluate(([map, season]) => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 144, sizeV: 2, seed: 0, players: 2, name: '', mode: 'play', map, season, night: 'full' })), [map, season]);
    await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay'); await p.waitForTimeout(4500);
    await G(async () => { const { AI } = await import('/js/ai.js'); const g = __ak.game; g.ais.push(new AI(g.W, 0, 'hard')); });
    await ff(60 * 16);
    const info = await G(() => { const g = __ak.game, W = g.W, P = W.players[0]; const c = {}; for (const e of W.dyn.values()) if (e.owner === 0) c[e.type] = (c[e.type] || 0) + 1; return { map: W.map.name, season: W.opts.season, t: Math.round(W.t), day: W.day, night: W.night, age: P.age, techs: [...P.techs].join(','), roads: W.road.reduce((s, v) => s + v, 0), have: c }; });
    console.log(cs, JSON.stringify(info));
    // centre on the town; daytime screenshot then night
    await G(() => { const g = __ak.game, W = g.W, tc = [...W.dyn.values()].find(e => e.owner === 0 && e.type === 'town_center'); g.centerOn(tc.x + 2, tc.y + 2); g.view.cam.zoom = 0.6; });
    await G(() => { const W = __ak.game.W; const len = 420; W.t = Math.floor(W.t / len) * len + len * 0.35; });
    await p.waitForTimeout(1200); await p.screenshot({ path: `${SP}/wd_${map}_day.png` });
    await G(() => { const W = __ak.game.W; const len = 420; W.t = Math.floor(W.t / len) * len + len * 0.88; W.night = true; });
    await p.waitForTimeout(1500); await p.screenshot({ path: `${SP}/wd_${map}_night.png` });
    // select soldiers -> formation buttons; open the advisor
    await G(() => { const g = __ak.game; const ids = [...g.W.dyn.values()].filter(e => e.owner === 0 && e.kind === 'unit' && e.type !== 'villager' && !e.nav && e.type !== 'sheep').map(e => e.id); g.select(ids); });
    await p.waitForTimeout(500); await p.keyboard.press('w'); await p.waitForTimeout(300);
    console.log('  formation', await G(() => { const g = __ak.game; const u = g.W.ents.get(g.sel[0]); return u ? u.form : 'none'; }));
    await p.keyboard.press('j'); await p.waitForTimeout(600); await p.screenshot({ path: `${SP}/wd_${map}_advisor.png` });
    console.log('  advisor', (await p.$eval('#advBody', e => e.innerText)).replace(/\s+/g, ' ').slice(0, 300));
    await p.keyboard.press('Escape');
    // blacksmith / academy panels
    for (const t of ['blacksmith', 'academy']) {
      const ok = await G((t) => { const g = __ak.game; const bl = [...g.W.dyn.values()].find(e => e.owner === 0 && e.type === t && e.built); if (bl) { g.select([bl.id]); g.centerOn(bl.x + 1, bl.y + 1); } return !!bl; }, t);
      if (ok) { await p.waitForTimeout(700); await p.hover('#cmd .cb:nth-child(11)'); await p.waitForTimeout(300); await p.screenshot({ path: `${SP}/wd_${map}_${t}.png` }); }
    }
  }
  const fps = await G(async () => { const t = __ak.app.ticker; let n = 0; const f = () => n++; t.add(f); await new Promise(r => setTimeout(r, 3000)); t.remove(f); return n / 3; });
  console.log('fps', fps.toFixed(1));
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await b.close();
})();
