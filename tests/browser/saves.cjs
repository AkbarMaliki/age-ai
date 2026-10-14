// Save / load / replay: a game is played for a few minutes with the player's commands coming from an AI "brain"
// through game.send (like clicks), then saved. Loading it (fast-forward) and watching it as a replay must both reach
// the same world state (hash) at the same tick.     node tests/browser/saves.cjs [outDir]   env BASE=http://localhost:8772/
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } }); const errs = [];
  p.on('pageerror', e => errs.push('PAGEERR ' + e.message + ' ' + (e.stack || '').split('\n')[1])); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  const G = (f, a) => p.evaluate(f, a);
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await G(() => { localStorage.clear(); localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 112, sizeV: 2, seed: 0, players: 2, name: 'Uji', mode: 'play', map: 'padang', season: 'semi', night: 'full', civ: 'jepang', relicWin: 'on' })); });
  await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay'); await p.waitForFunction(() => window.__ak && __ak.game, null, { timeout: 90000 });
  // play 8 minutes: the brain's orders go through game.send (recorded) exactly like a player's
  const A = await G(async () => {
    const { AI } = await import('/js/ai.js'); const { stateHash } = await import('/js/lockstep.js');
    const g = __ak.game, W = g.W; g.paused = true;
    const brain = new AI(W, 0, 'hard');
    while (W.tick < 8 * 600) { const n0 = W.cmds.length; brain.tick(); const cs = W.cmds.splice(n0); for (const c of cs) g.send(c); g.tickOnce(false); }
    return { tick: W.tick, hash: stateHash(W), cmds: g.rec.cmds.length, rec: g.record() };
  });
  console.log('played: tick', A.tick, 'commands logged', A.cmds, 'hash', A.hash);
  const id = await G(() => __ak.game.saveGame(null, 'save'));
  console.log('saved as', id, 'size', await G((id) => (localStorage.getItem('ak_save_' + id) || '').length, id));
  // load: fast-forward to the same tick
  await G((id) => __ak.startSaved(__ak.Saves.get(id), 'load'), id);
  await p.waitForFunction(() => __ak.game && !__ak.game.ff && __ak.game.W.tick > 0, null, { timeout: 120000 });
  const L = await G(async () => { const { stateHash } = await import('/js/lockstep.js'); const W = __ak.game.W; return { tick: W.tick, hash: stateHash(W), me: __ak.game.me, watch: __ak.game.watch }; });
  console.log('loaded: tick', L.tick, 'hash', L.hash, L.hash === A.hash && L.tick === A.tick ? 'SAME' : 'DIFFERENT');
  await p.waitForTimeout(800); await p.screenshot({ path: `${SP}/sv_loaded.png` });
  // replay: spectator, run it up to the same tick
  await G((id) => __ak.startSaved(__ak.Saves.get(id), 'watch'), id);
  await p.waitForFunction(() => __ak.game && __ak.game.watch, null, { timeout: 60000 });
  const R = await G(async (t) => { const { stateHash } = await import('/js/lockstep.js'); const g = __ak.game, W = g.W; g.paused = true; while (W.tick < t) g.tickOnce(false); return { tick: W.tick, hash: stateHash(W) }; }, A.tick);
  console.log('replay: tick', R.tick, 'hash', R.hash, R.hash === A.hash ? 'SAME' : 'DIFFERENT');
  await G(() => { __ak.game.paused = false; }); await p.waitForTimeout(1500); await p.screenshot({ path: `${SP}/sv_replay.png` });
  console.log(errs.slice(0, 10).join('\n') || 'no errors'); await b.close();
})();
