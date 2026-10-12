// Browser test (Playwright + system Chrome). Run the game server first (start.bat or: node server.cjs 8772).
//   node tests/browser/freecam.cjs [outDir]      env BASE=http://localhost:8772/ (e.g. 8791 to test a docs/ build)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => localStorage.setItem('ak_opts', JSON.stringify({ diff: 'normal', color: 'blue', size: 112, seed: 5, players: 2, name: '', mode: 'watch' })));
  await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay'); await p.waitForTimeout(4000);
  const cam = () => p.evaluate(() => [Math.round(__ak.game.view.cam.x), Math.round(__ak.game.view.cam.y)]);
  const c0 = await cam();
  await p.mouse.move(800, 400); await p.mouse.down(); await p.mouse.move(500, 250, { steps: 10 }); await p.mouse.up();
  const c1 = await cam();
  await p.keyboard.down('d'); await p.waitForTimeout(700); await p.keyboard.up('d');
  const c2 = await cam();
  await p.mouse.click(1300, 820); await p.waitForTimeout(300);
  const c3 = await cam(); await p.waitForTimeout(9000); const c4 = await cam();
  await p.keyboard.press('c'); await p.waitForTimeout(6000); const c5 = await cam();
  console.log('start', c0, 'drag', c1, 'D key', c2, 'minimap', c3, 'after 9s (should stay)', c4, 'autocam on', c5, 'auto?', await p.evaluate(() => __ak.game.autoCam));
  console.log(errs.join('\n') || 'no errors'); await b.close();
})();
