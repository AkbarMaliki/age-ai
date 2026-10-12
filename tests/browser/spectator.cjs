// Browser test (Playwright + system Chrome). Run the game server first (start.bat or: node server.cjs 8772).
//   node tests/browser/spectator.cjs [outDir]      env BASE=http://localhost:8772/ (e.g. 8791 to test a docs/ build)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.text()); });
  p.on('requestfailed', r => errs.push('FAIL ' + r.url()));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'hard', color: 'blue', size: 112, seed: 99, players: 3, name: '', mode: 'watch' })));
  await p.reload({ waitUntil: 'networkidle' });
  await p.screenshot({ path: `${SP}/w_menu.png` });
  await p.click('#btnPlay'); await p.waitForTimeout(4000);
  await p.keyboard.press('8');
  const cams = [];
  for (let k = 0; k < 6; k++) { await p.waitForTimeout(5000); cams.push(await p.evaluate(() => { const g = __ak.game; return [Math.round(g.view.cam.x), Math.round(g.view.cam.y), Math.floor(g.W.t), g.speed]; })); }
  console.log('cam/time/speed', JSON.stringify(cams));
  await p.screenshot({ path: `${SP}/w_game.png` });
  await p.keyboard.press('Tab'); await p.waitForTimeout(800);
  console.log('pov', await p.evaluate(() => [__ak.game.me, document.getElementById('spPov').textContent]));
  await p.screenshot({ path: `${SP}/w_pov.png` });
  const smp = await p.evaluate(() => performance.getEntriesByType('resource').filter(r => r.name.includes('/sfx/')).length);
  console.log('sfx files fetched', smp);
  console.log(errs.slice(0, 15).join('\n') || 'no errors');
  await b.close();
})();
