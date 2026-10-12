// Browser test (Playwright + system Chrome). Run the game server first (start.bat or: node server.cjs 8772).
//   node tests/browser/features.cjs [outDir]      env BASE=http://localhost:8772/ (e.g. 8791 to test a docs/ build)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
  p.on('requestfailed', r => errs.push('FAIL ' + r.url()));
  await p.goto(BASE, { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 144, seed: 4242, players: 2, name: '' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.waitForTimeout(500);
  await p.screenshot({ path: `${SP}/v2_menu.png` });
  await p.click('#btnPlay'); await p.waitForTimeout(5000);
  const G = (f, a) => p.evaluate(f, a);
  console.log('ents', await G(() => { const c = {}; for (const e of __ak.game.W.ents.values()) { const k = e.kind === 'unit' ? e.type + (e.owner < 0 ? '(g)' : '') : e.kind === 'treasure' ? 'treasure' : null; if (k) c[k] = (c[k] || 0) + 1; } return JSON.stringify(c); }));
  await p.screenshot({ path: `${SP}/v2_start.png` });
  // villagers hunt the nearest sheep
  await G(() => { const g = __ak.game, W = g.W; const vils = [...W.ents.values()].filter(e => e.kind === 'unit' && e.owner === 0 && e.type === 'villager');
    const sheep = [...W.ents.values()].filter(e => e.type === 'sheep' && e.owner === 0)[0];
    g.select(vils.map(v => v.id)); g.rightClickWorld(sheep.x, sheep.y, sheep); g.centerOn(sheep.x, sheep.y); });
  await p.waitForTimeout(9000);
  console.log('hunt', await G(() => { const W = __ak.game.W; return JSON.stringify([...W.ents.values()].filter(e => e.kind === 'unit' && e.owner === 0 && e.type === 'villager').map(v => (v.order ? v.order.t + '/' + (v.order.kind || '') : 'idle') + ':' + v.anim + ':' + (v.carry ? v.carry.k + Math.floor(v.carry.n) : ''))); }));
  await p.screenshot({ path: `${SP}/v2_hunt.png` });
  // player 0 = AI, fast forward 9 minutes
  await G(async () => { const { AI } = await import('/js/ai.js'); const g = __ak.game; g.ais.push(new AI(g.W, 0, 'hard')); });
  await G(async () => { const { step, TICK } = await import('/js/sim.js'); const g = __ak.game; for (let i = 0; i < 9 * 600; i++) { for (const ai of g.ais) ai.tick(); step(g.W); g.W.ev.length = 0; } });
  const shot = async (name, f) => { await G((f) => { const g = __ak.game; const es = [...g.W.ents.values()].filter(new Function('e', 'return ' + f)); if (es.length) { const e = es[0]; g.centerOn(e.x + (e.w || 0) / 2, e.y + (e.h || 0) / 2); g.select([e.id]); } }, f); await p.waitForTimeout(1300); await p.screenshot({ path: `${SP}/${name}.png` }); };
  await shot('v2_base', "e.kind==='building' && e.owner===0 && e.type==='town_center'");
  await shot('v2_farmers', "e.kind==='unit' && e.owner===0 && e.type==='villager' && e.anim==='farm'");
  await shot('v2_lumber', "e.kind==='unit' && e.owner===0 && e.type==='villager' && e.anim==='chop'");
  // reveal map to view wildlife & treasures
  await G(() => { const W = __ak.game.W; W.players[0].exp.fill(1); W.players[0].vis.fill(1); __ak.game.paused = true; });
  await shot('v2_treasure', "e.kind==='treasure' && e.guards.length");
  await shot('v2_wolves', "e.kind==='unit' && e.type==='wolf'");
  await shot('v2_deer', "e.kind==='unit' && e.type==='deer'");
  await shot('v2_bear', "e.kind==='unit' && e.type==='bear'");
  const fps = await G(async () => { const t = __ak.app.ticker; let n = 0; const f = () => n++; t.add(f); await new Promise(r => setTimeout(r, 3000)); t.remove(f); return n / 3; });
  console.log('fps', fps.toFixed(1), 'ents', await G(() => __ak.game.W.ents.size));
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await b.close();
})();
