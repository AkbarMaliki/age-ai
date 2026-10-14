// Browser benchmark (Playwright + system Chrome): war effects under load. A late game, 15 buildings set on fire and two
// armies of 50 (fire archers among them) fighting in view; prints fps at close and far zoom, normal and 8x speed.
// Run the game server first.   node tests/browser/battlefx.cjs [outDir]    env BASE, MOBILE=1 (phone viewport)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/', MOBILE = !!process.env.MOBILE;
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
  const p = await b.newPage(MOBILE ? { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'hard', color: 'blue', size: 180, sizeV: 2, seed: 12, players: 4, name: '', mode: 'watch', night: 'off' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay');
  await p.waitForFunction(() => window.__ak && __ak.game && __ak.game.W, null, { timeout: 60000 }); await p.waitForTimeout(1500);
  await p.evaluate(() => { const g = __ak.game; for (let n = 0; n < 35 * 600; n++) g.tickOnce(false); });
  // stage: the biggest town burns, two armies clash in front of it
  const info = await p.evaluate(async () => {
    const { addUnit, nearestFree } = await import('/js/sim.js');
    const g = __ak.game, W = g.W, P = W.players[0], tc = W.ents.get(P.tc) || [...W.dyn.values()].find(e => e.type === 'town_center' && e.owner === 0);
    const cx = tc.x + 2, cy = tc.y + 2;
    const blds = [...W.dyn.values()].filter(e => e.kind === 'building' && e.owner === 0 && e.built && !['stone_wall', 'palisade', 'gate', 'farm'].includes(e.type)).sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy)).slice(0, 15);
    for (const e of blds) { e.hp = e.maxHp * 0.35; e.burn = W.t + 9999; e.burnBy = 1; }
    let n = 0;
    for (let k = 0; k < 100; k++) { const side = k % 2, f = nearestFree(W, cx + 8 + (side ? 6 : -6) + (k % 10) * 0.4, cy + 8 + Math.floor(k / 10) * 0.8, side, 6); if (!f) continue; addUnit(W, side ? 1 : 0, ['knight', 'militia', side ? 'fire_archer' : 'archer', 'spearman'][k % 4], f[0] + 0.5, f[1] + 0.5); n++; }
    g.centerOn(cx + 8, cy + 8); g.autoCam = false;
    return { burning: blds.length, soldiers: n };
  });
  console.log('staged', JSON.stringify(info));
  const fps = (label) => p.evaluate(async (label) => {
    const t = __ak.app.ticker; let f = 0, worst = 0, last = performance.now(); const cb = () => { f++; const now = performance.now(); worst = Math.max(worst, now - last); last = now; }; t.add(cb);
    await new Promise(r => setTimeout(r, 5000)); t.remove(cb);
    const v = __ak.game.view, live = (pl) => pl ? pl.pool.filter(q => q.life > 0).length : 0;
    return `${label}: fps ${(f / 5).toFixed(0)} worst frame ${worst.toFixed(0)} ms | particles ${live(v.parts)} smoke ${live(v.smoke)} flame ${live(v.flame)} decals ${v.decals ? v.decals.pool.filter(d => d.s.visible).length : 0}`;
  }, label);
  await p.keyboard.press('1'); await p.waitForTimeout(1500);
  console.log(await fps('zoom 1.0, 1x'));
  await p.screenshot({ path: `${SP}/battlefx_close.png` });
  await p.evaluate(() => { const g = __ak.game; g.zoomAt(g.app.screen.width / 2, g.app.screen.height / 2, 0.3); }); await p.waitForTimeout(1500);
  console.log(await fps('zoom 0.3, 1x'));
  await p.screenshot({ path: `${SP}/battlefx_far.png` });
  await p.keyboard.press('8'); await p.waitForTimeout(1000);
  console.log(await fps('zoom 0.3, 8x'));
  console.log(errs.slice(0, 10).join('\n') || 'no errors'); await b.close();
})();
