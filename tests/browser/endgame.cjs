// Browser test: Market (build + trade buttons), Home City cards (panel + shipment), surrender and the defeat screen.
//   node tests/browser/endgame.cjs [outDir]      env BASE=http://localhost:8772/
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
  const G = (f, a) => p.evaluate(f, a);
  const ff = (min) => G(async (min) => { const { step } = await import('/js/sim.js'); const g = __ak.game; for (let i = 0; i < min * 600; i++) { for (const ai of g.ais) ai.tick(); step(g.W); g.hist.tick(); for (const e of g.W.ev) g.onEvent(e); g.W.ev.length = 0; } }, min);
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 112, seed: 777, players: 3, name: '', mode: 'play', map: 'padang' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay'); await p.waitForTimeout(4500);
  // an AI plays our side to reach the Feudal Age with a market, then hands back control
  const ai0 = await G(async () => { const { AI } = await import('/js/ai.js'); const g = __ak.game; g.ais.push(new AI(g.W, 0, 'hard')); return g.ais.length; });
  await ff(20);
  await G(() => { const g = __ak.game; g.ais.pop(); g.paused = false; });
  const st = await G(() => { const g = __ak.game, P = g.W.players[0]; return { age: P.age, xp: Math.round(P.xp), ships: P.ships, cards: P.cards, market: [...g.W.dyn.values()].some(e => e.type === 'market' && e.owner === 0 && e.built), gold: Math.round(P.res.gold) }; });
  console.log('after 20 min', JSON.stringify(st));
  // market: place one for free if the AI hadn't, select it and buy food
  await G(async () => { const { addBuilding } = await import('/js/sim.js'); const g = __ak.game, W = g.W; let m = [...W.dyn.values()].find(e => e.type === 'market' && e.owner === 0 && e.built);
    if (!m) { const tc = W.ents.get(W.players[0].tc); m = addBuilding(W, 0, 'market', tc.x + 6, tc.y + 5, true); }
    W.players[0].res.gold += 500; g.select([m.id]); g.centerOn(m.x + 2, m.y + 2); });
  await p.waitForTimeout(900);
  const before = await G(() => Math.round(__ak.game.W.players[0].res.food));
  await p.keyboard.press('q'); await p.waitForTimeout(400); await p.keyboard.press('q'); await p.waitForTimeout(600);
  console.log('market buy food x2:', before, '->', await G(() => Math.round(__ak.game.W.players[0].res.food)), 'price food', await G(() => Math.round(__ak.game.W.market.food)));
  await p.hover('#cmd .cb:nth-child(1)'); await p.waitForTimeout(300);
  await p.screenshot({ path: `${SP}/eg_market.png` });
  // cards
  await G(() => { const P = __ak.game.W.players[0]; P.ships = Math.max(P.ships, 1); P.shipment = null; });
  await p.keyboard.press('k'); await p.waitForTimeout(700);
  await p.screenshot({ path: `${SP}/eg_cards.png` });
  const ready = await p.$$eval('#cardsBody .card.ready', c => c.map(x => x.dataset.c));
  console.log('cards ready', ready.join(','));
  const pick = ready.find(c => c.startsWith('vil')) || ready[0];
  await p.click(`#cardsBody .card[data-c="${pick}"]`); await p.waitForTimeout(800);
  console.log('shipment', await G(() => JSON.stringify(__ak.game.W.players[0].shipment)));
  await G(async () => { const { step } = await import('/js/sim.js'); const g = __ak.game; for (let i = 0; i < 400; i++) { step(g.W); for (const e of g.W.ev) g.onEvent(e); g.W.ev.length = 0; } });
  await p.waitForTimeout(500);
  console.log('after delivery', await G(() => JSON.stringify({ shipment: __ak.game.W.players[0].shipment, cards: __ak.game.W.players[0].cards })), 'notes', await p.$eval('#notify', n => n.innerText.replace(/\n/g, ' | ').slice(0, 200)));
  await p.keyboard.press('k'); await p.waitForTimeout(300);
  // surrender (two clicks to confirm) in a 3-player game -> defeat screen with "keep watching"
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  if (!(await G(() => __ak.game.paused))) await G(() => __ak.game.togglePause());
  await p.click('#pResign'); await p.waitForTimeout(200); await p.click('#pResign'); await p.waitForTimeout(2500);
  console.log('after resign: over', await G(() => __ak.game.over), 'title', await p.$eval('#endTitle', e => e.textContent), 'watch btn', await p.$eval('#endWatch', e => !e.classList.contains('hidden')),
    'my stuff left', await G(() => [...__ak.game.W.dyn.values()].filter(e => e.owner === 0 && (e.kind === 'unit' || e.kind === 'building')).length));
  await p.screenshot({ path: `${SP}/eg_defeat.png` });
  await p.click('#endWatch'); await p.waitForTimeout(1500);
  console.log('watching: over', await G(() => __ak.game.over), 'reveal', await G(() => __ak.game.view.reveal));
  await ff(40);
  await p.waitForTimeout(800);
  console.log('final: winner', await G(() => __ak.game.W.winner), 'title', await p.$eval('#endTitle', e => e.textContent), 'end visible', await p.$eval('#endScreen', e => !e.classList.contains('hidden')));
  await p.screenshot({ path: `${SP}/eg_final.png` });
  console.log(errs.slice(0, 20).join('\n') || 'no errors', ai0 ? '' : '');
  await b.close();
})();
