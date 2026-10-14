// Browser check: a mercenary camp (sprite, info panel, Rekrut button, hiring), the hired band, and the helping-hand
// pop-up (accept).   node tests/browser/mercs.cjs [outDir]   (server running)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
  const p = await b.newPage({ viewport: { width: 1536, height: 760 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'easy', color: 'blue', size: 224, sizeV: 2, seed: 9, players: 2, name: '', mode: 'play', night: 'off' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay');
  await p.waitForFunction(() => window.__ak && __ak.game && __ak.game.W, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  // find a camp, give the player what it takes, select the camp
  const info = await p.evaluate(() => { const g = __ak.game, W = g.W, P = W.players[g.me], c = [...W.dyn.values()].find(e => e.kind === 'camp');
    for (let j = c.y - 8; j < c.y + 10; j++) for (let i = c.x - 8; i < c.x + 10; i++) P.exp[j * W.size + i] = 1;
    P.age = 2; P.res.gold = 3000; P.res.food = 3000; P.res.iron = 500; P.popCap = Math.max(P.popCap, 60);
    g.centerOn(c.x + 1, c.y + 2); g.view.cam.zoom = 1.2; g.select([c.id]); return { name: c.name, faction: c.faction }; });
  await p.waitForTimeout(1200);
  console.log('camp', JSON.stringify(info));
  console.log('info panel', (await p.evaluate(() => document.getElementById('info').innerText)).replace(/\s+/g, ' ').slice(0, 260));
  const btn = await p.evaluate(() => { const b = [...document.querySelectorAll('#cmd .cb')].find(x => x.dataset && x.onclick); return document.querySelector('#cmd').innerText; });
  await p.screenshot({ path: `${SP}/merc_camp.png` });
  await p.keyboard.press('q'); await p.waitForTimeout(1500);
  console.log('hired', await p.evaluate(() => { const g = __ak.game; return [...g.W.dyn.values()].filter(e => e.kind === 'unit' && e.owner === g.me && e.merc).map(e => e.type).join(','); }));
  await p.evaluate(() => __ak.game.select([])); await p.waitForTimeout(800);
  await p.screenshot({ path: `${SP}/merc_band.png` });
  // the helping hand
  await p.evaluate(() => { const g = __ak.game; g.W.players[g.me].mercOffer = { faction: 'gunung', n: 5, until: g.W.t + 60 }; g.mercT = 0; });
  await p.waitForTimeout(800);
  console.log('offer shown', await p.evaluate(() => !document.getElementById('mercBox').classList.contains('hidden') && document.getElementById('mercBox').innerText.replace(/\s+/g, ' ')));
  await p.screenshot({ path: `${SP}/merc_offer.png` });
  await p.click('#mercYes'); await p.waitForTimeout(1500);
  console.log('after accept', await p.evaluate(() => { const g = __ak.game; return { box: document.getElementById('mercBox').classList.contains('hidden'), monks: [...g.W.dyn.values()].filter(e => e.owner === g.me && e.type === 'biksu').length }; }));
  console.log(errs.slice(0, 8).join('\n') || 'no errors'); await b.close();
})();
