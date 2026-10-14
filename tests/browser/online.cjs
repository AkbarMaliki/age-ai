// Browser test of the online mode against the real Firebase Realtime Database: two separate browser profiles.
// Host creates a room, the friend opens the share link, host adds an AI and starts; both play; chat; the friend
// reloads mid-game (rejoin + replay). Checks both worlds stay in sync. The room is deleted at the end.
//   node tests/browser/online.cjs [outDir]      env BASE=http://localhost:8772/
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
  const errs = [];
  const mk = async (name, who) => {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${who} PAGEERR ${e.message}`)); p.on('console', m => { if (m.type() === 'error' || /desync/.test(m.text())) errs.push(`${who} ${m.type()}: ${m.text()}`); });
    await p.goto(BASE, { waitUntil: 'networkidle' });
    await p.evaluate((name) => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 112, sizeV: 2, seed: 0, players: 2, name, mode: 'play', map: 'padang', season: 'semi', night: 'full' })), name);
    await p.reload({ waitUntil: 'networkidle' });
    return p;
  };
  const A = await mk('Akbar', 'host'), B = await mk('Teman', 'guest');
  let code = null;
  try {
    await A.click('#btnOnline'); await A.click('#olCreate');
    await A.waitForSelector('#olRoom:not(.hidden)', { timeout: 15000 });
    const link = await A.$eval('#olLink', e => e.value); code = await A.$eval('#olCodeShow', e => e.textContent);
    console.log('room', code, 'link', link);
    // the friend opens the link
    await B.goto(BASE + '?room=' + code, { waitUntil: 'networkidle' });
    await B.waitForSelector('#olRoom:not(.hidden)', { timeout: 15000 });
    await A.waitForFunction(() => document.querySelectorAll('#olSeats tr[data-id]').length === 2, null, { timeout: 15000 });
    await A.click('#olAddBot');
    await A.waitForFunction(() => document.querySelectorAll('#olSeats tr[data-id]').length === 3, null, { timeout: 15000 });
    await B.waitForFunction(() => document.querySelectorAll('#olSeats tr[data-id]').length === 3, null, { timeout: 15000 });
    await A.selectOption('#olCfg select[data-k="size"]', '112');
    await sleep(800);
    await A.screenshot({ path: `${SP}/on_lobby_host.png` }); await B.screenshot({ path: `${SP}/on_lobby_guest.png` });
    console.log('guest sees', (await B.$eval('#olSeats', e => e.innerText)).replace(/\s+/g, ' '), '|', await B.$eval('#olWait', e => e.textContent));
    await A.click('#olStartBtn');
    const inGame = (p) => p.waitForFunction(() => window.__ak && __ak.game && __ak.game.lock, null, { timeout: 60000 });
    await Promise.all([inGame(A), inGame(B)]);
    console.log('both in game');
    const info = (p) => p.evaluate(() => { const g = __ak.game, W = g.W; return { me: g.me, name: W.players[g.me].name, tick: W.tick, host: g.lock.host, desync: g.lock.desync, ais: g.ais.map(a => a.pid), status: g.lock.status(), pop: W.players.map(P => P.pop) }; });
    // the guest trains a villager through the UI path (game.send -> Firebase -> host -> turn)
    await sleep(3000);
    const q = await B.evaluate(() => { const g = __ak.game, W = g.W, tc = W.ents.get(W.players[g.me].tc); g.train(tc, 'villager'); return tc.id; });
    await sleep(4000);
    const qa = await A.evaluate((id) => { const tc = __ak.game.W.ents.get(id); return tc.queue.map(x => x.unit); }, q), qb = await B.evaluate((id) => { const tc = __ak.game.W.ents.get(id); return tc.queue.map(x => x.unit); }, q);
    console.log('guest TC queue seen by host', JSON.stringify(qa), 'by guest', JSON.stringify(qb));
    // chat
    await B.keyboard.press('Enter'); await B.keyboard.type('halo dari teman'); await B.keyboard.press('Enter');
    await sleep(2500);
    console.log('host got chat:', (await A.$eval('#notify', e => e.innerText)).includes('halo dari teman'));
    await sleep(15000);
    const ia = await info(A), ib = await info(B);
    console.log('host', JSON.stringify(ia)); console.log('guest', JSON.stringify(ib));
    // compare worlds at the same tick: hash both when they pass the same tick
    const hashAt = (p, t) => p.evaluate(async (t) => { const { stateHash } = await import('/js/lockstep.js'); const W = __ak.game.W; while (W.tick < t) await new Promise(r => setTimeout(r, 5)); return W.tick === t ? stateHash(W) : 'passed ' + W.tick; }, t);
    const tgt = Math.max(ia.tick, ib.tick) + 40;
    // stop exactly at tgt on both: pause the lockstep loop there
    for (const p of [A, B]) await p.evaluate((t) => { const L = __ak.game.lock, f = L.update.bind(L); L.update = (dt) => { if (__ak.game.W.tick < t) f(dt); }; const tk = L.tickOnce.bind(L); L.tickOnce = () => { if (__ak.game.W.tick < t) tk(); }; }, tgt);
    const [ha, hb] = await Promise.all([hashAt(A, tgt), hashAt(B, tgt)]);
    console.log('state hash at tick', tgt, 'host', ha, 'guest', hb, ha === hb ? 'SAME' : 'DIFFERENT');
    for (const p of [A, B]) await p.evaluate(() => { const L = __ak.game.lock; delete L.update; delete L.tickOnce; });
    await A.screenshot({ path: `${SP}/on_game_host.png` }); await B.screenshot({ path: `${SP}/on_game_guest.png` });
    // the friend reloads the page mid-game -> rejoins and replays every turn
    await B.reload({ waitUntil: 'networkidle' });
    await B.waitForFunction(() => __ak.game && __ak.game.lock && !__ak.game.lock.catching && __ak.game.W.tick > 100, null, { timeout: 90000 });
    await sleep(9000);
    console.log('after rejoin host', JSON.stringify(await info(A))); console.log('after rejoin guest', JSON.stringify(await info(B)));
    await B.screenshot({ path: `${SP}/on_rejoin_guest.png` });
    // the host closes the tab: the friend takes over as host, the AI takes the host's kingdom, the game goes on
    await A.context().close();
    const t1 = await B.evaluate(() => __ak.game.W.tick);
    await B.waitForFunction(() => __ak.game.lock.host, null, { timeout: 30000 });
    await sleep(22000);
    console.log('after the host left', JSON.stringify(await info(B)), 'ticks advanced', (await B.evaluate(() => __ak.game.W.tick)) - t1);
    await B.screenshot({ path: `${SP}/on_newhost.png` });
  } catch (e) { console.log('FAILED', e.message); await A.screenshot({ path: `${SP}/on_fail_host.png` }).catch(() => { }); await B.screenshot({ path: `${SP}/on_fail_guest.png` }).catch(() => { }); }
  // everyone leaves the way the menu does it; the last one out removes the room
  for (const p of [B, A]) if (!p.isClosed()) await p.evaluate(async () => { const g = __ak.game; if (g && g.online) { g.destroy(); await g.online.net.leave(); } }).catch(() => { });
  if (code) { await sleep(1500); console.log('room left in the database:', await B.evaluate(async (code) => (await firebase.database().ref('age/rooms/' + code).get()).exists(), code)); }
  console.log(errs.slice(0, 20).join('\n') || 'no errors');
  await b.close();
})();
