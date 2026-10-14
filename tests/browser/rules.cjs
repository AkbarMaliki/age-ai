// Browser test (v7): rules in the setup screen (victory, treaty, teams, start resources, pop limit, speed), goal timers,
// diplomacy (tribute, flare), the tech tree, and the new command buttons (reseed, fish trap, gate lock, garrison,
// trebuchet pack), with a screenshot of the new units and buildings.
//   node tests/browser/rules.cjs [outDir]      env BASE=http://localhost:8793/
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8793/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (['error'].includes(m.type())) errs.push(m.type() + ': ' + m.text()); });
  const G = (f, a) => p.evaluate(f, a);
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'easy', color: 'blue', size: 144, sizeV: 2, seed: 4242, players: 4, name: '', mode: 'play', map: 'padang', season: 'semi', night: 'off' })));
  await p.reload({ waitUntil: 'networkidle' });
  // tech tree from the home menu
  await p.click('#btnTreeHome'); await p.waitForTimeout(400);
  await p.click('#techTabs button[data-b="siege_workshop"]'); await p.waitForTimeout(200);
  const tt = await G(() => ({ cards: document.querySelectorAll('#techBody .tt').length, txt: document.querySelector('#techBody').innerText.slice(0, 400) }));
  check(tt.cards >= 6 && /Mangonel/.test(tt.txt), `tech tree shows the siege workshop (${tt.cards} cards)`);
  await p.screenshot({ path: path.join(SP, 'rules_techtree.png') });
  await p.click('#techClose');
  // setup: rules
  await p.click('#btnNew'); await p.waitForTimeout(300);
  for (const [k, v] of [['teams', 'ally'], ['victory', 'koth'], ['treaty', '10'], ['startRes', 'deathmatch'], ['popLimit', '125'], ['speed', '1.5']]) await p.click(`.seg[data-k="${k}"] button[data-v="${v}"]`);
  await p.screenshot({ path: path.join(SP, 'rules_setup.png') });
  await p.click('#btnStart'); await p.waitForFunction(() => window.__ak && __ak.game, null, { timeout: 30000 }).catch(() => { }); await p.waitForTimeout(2500);
  if (!await G(() => !!__ak.game)) { console.log('game did not start', errs); process.exit(1); }
  const o = await G(() => { const g = __ak.game, W = g.W; return { opts: W.opts, teams: W.players.map(p => p.team), res: W.players[0].res.wood, speed: g.speed, mon: !!W.monument }; });
  check(o.opts.victory === 'koth' && o.opts.treaty === 600 && o.opts.popLimit === 125 && o.res >= 20000 && o.speed === 1.5 && o.mon && o.teams.join() === '0,0,1,1', 'rules reach the world: ' + JSON.stringify({ v: o.opts.victory, t: o.opts.treaty, pop: o.opts.popLimit, wood: o.res, speed: o.speed, teams: o.teams.join() }));
  await p.waitForTimeout(800);
  check(/🕊/.test(await G(() => document.querySelector('#goalInfo').textContent)), 'treaty countdown in the top bar');
  // diplomacy: tribute to the ally
  await p.click('#btnDiplo'); await p.waitForTimeout(300);
  const g1 = await G(() => __ak.game.W.players[1].res.gold);
  await p.click('#diploBody button[data-to="1"][data-r="gold"]'); await p.waitForTimeout(600);
  const g2 = await G(() => __ak.game.W.players[1].res.gold);
  check(g2 - g1 >= 79, `tribute: ally gold ${Math.round(g1)} -> ${Math.round(g2)}`);
  await p.screenshot({ path: path.join(SP, 'rules_diplo.png') });
  await p.click('#diploClose');
  // a little town with the new things in it
  const ids = await G(async () => {
    const { addBuilding, addUnit, placementOk, nearestFree } = await import('/js/sim.js'); const g = __ak.game, W = g.W, P = W.players[0], tc = W.ents.get(P.tc);
    P.age = 4; g.ais.length = 0;
    const put = (type, dx, dy) => { for (let r = 0; r < 12; r++) for (let a = 0; a < 16; a++) { const i = Math.round(tc.x + dx + Math.cos(a / 16 * 6.28) * r), j = Math.round(tc.y + dy + Math.sin(a / 16 * 6.28) * r); if (placementOk(W, 0, type, i, j)) return addBuilding(W, 0, type, i, j, true); } };
    const unit = (type, x, y) => { const f = nearestFree(W, x, y, 0, 8); return addUnit(W, 0, type, f[0] + 0.5, f[1] + 0.5); };
    const mill = put('mill', -6, 6), tw = put('watch_tower', 8, 0), sw = put('siege_workshop', 6, 8), gate = put('gate', 0, -8), wonder = put('wonder', -10, -8);
    for (let k = 0; k < 6; k++) put('palisade', 12 + k, -6);
    const mg = unit('mangonel', tc.x + 4, tc.y + 10), sc = unit('scorpion', tc.x + 5, tc.y + 11), tb = unit('trebuchet_p', tc.x + 2, tc.y + 12), tr = unit('trebuchet', tc.x + 7, tc.y + 12), cart = unit('trade_cart', tc.x + 9, tc.y + 10), arch = [0, 1, 2].map(k => unit('archer', tw.x + 2, tw.y + 2 + k));
    g.centerOn(tc.x + 4, tc.y + 6);
    return { mill: mill.id, tw: tw.id, sw: sw.id, gate: gate && gate.id, mg: mg.id, tb: tb.id, arch: arch.map(a => a.id), wonder: wonder && wonder.id };
  });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: path.join(SP, 'rules_town.png') });
  // mill: reseed queue
  await G((id) => __ak.game.select([id]), ids.mill); await p.waitForTimeout(700);
  const btnNames = () => G(() => [...document.querySelectorAll('#cmd .cb')].map(b => (b.tipHtml || '').replace(/<[^>]+>/g, ' ').slice(0, 40)));
  let names = await btnNames(); check(names.some(n => /Tanam Ulang/.test(n)), 'mill offers the reseed queue');
  const r0 = await G(() => __ak.game.W.reseed[0] || 0);
  await G(() => { const b = [...document.querySelectorAll('#cmd .cb')].find(b => /Antre Tanam Ulang/.test(b.tipHtml || '')); b.click(); });
  await p.waitForTimeout(500); check(await G(() => __ak.game.W.reseed[0] || 0) === r0 + 1, 'reseed queued');
  // tower: garrison archers, then the eject button
  await G((a) => { const g = __ak.game; g.select(a.arch); }, ids); await p.waitForTimeout(200);
  await G((a) => { const g = __ak.game, t = g.W.ents.get(a.tw); g.rightClickWorld(t.x + 0.5, t.y + 0.5, t); }, ids);
  await p.waitForTimeout(5000);
  await G((id) => __ak.game.select([id]), ids.tw); await p.waitForTimeout(700);
  const info = await G(() => document.querySelector('#info').innerText);
  check(/garnisun 3/.test(info), 'tower info shows the garrison: ' + info.replace(/\s+/g, ' ').slice(0, 120));
  names = await btnNames(); check(names.some(n => /Keluarkan Garnisun/.test(n)), 'tower has an eject button');
  check(names.some(n => /Menara Pengawal|Keep|Benteng/.test(n)), 'tower upgrade offered: ' + names.filter(Boolean).join(' | '));
  // siege workshop buttons, trebuchet unpack
  await G((id) => __ak.game.select([id]), ids.sw); await p.waitForTimeout(700);
  names = await btnNames(); check(names.filter(n => /Mangonel|Skorpion|Pendobrak/.test(n)).length >= 3, 'siege workshop trains ram, mangonel, scorpion');
  await G((id) => __ak.game.select([id]), ids.tb); await p.waitForTimeout(700);
  await G(() => { const b = [...document.querySelectorAll('#cmd .cb')].find(b => /Pasang Trebuchet/.test(b.tipHtml || '')); b && b.click(); });
  await p.waitForTimeout(3200 / 1.5 + 2500);
  check(await G((id) => __ak.game.W.ents.get(id).type, ids.tb) === 'trebuchet', 'trebuchet unpacked from the button');
  if (ids.gate) { await G((id) => __ak.game.select([id]), ids.gate); await p.waitForTimeout(600); await G(() => { const b = [...document.querySelectorAll('#cmd .cb')].find(b => /Kunci Gerbang/.test(b.tipHtml || '')); b && b.click(); }); await p.waitForTimeout(400); check(await G((id) => !!__ak.game.W.ents.get(id).locked, ids.gate), 'gate locked from the button'); }
  // flare (alt + click)
  await G(() => __ak.game.sel = []);
  await p.keyboard.down('Alt'); await p.mouse.click(800, 400); await p.keyboard.up('Alt'); await p.waitForTimeout(300);
  check(await G(() => __ak.game.view.markers.some(m => m.flare)), 'alt+click puts a flare on the map');
  // tech tree in game
  await p.click('#btnTree'); await p.waitForTimeout(400); await p.click('#techTabs button[data-b="town_center"]'); await p.waitForTimeout(200);
  check(/Imperial/.test(await G(() => document.querySelector('#techBody').innerText)), 'in-game tech tree lists the Imperial Age');
  await p.click('#techClose');
  // the monument
  await G(() => { const g = __ak.game, m = g.W.monument; g.centerOn(m.x, m.y); g.select([m.id]); }); await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(SP, 'rules_monument.png') });
  check(/Monumen/.test(await G(() => document.querySelector('#info').innerText)), 'monument selectable with info');
  console.log(errs.length ? 'errors:\n' + errs.slice(0, 12).join('\n') : 'no page errors');
  if (errs.length) fail++;
  await b.close();
  console.log(fail ? `${fail} browser rules check(s) failed` : 'browser rules OK'); process.exit(fail ? 1 : 0);
})();
