// Browser test: live score panel (L), clickable notes, the director's slow-motion moment, Kisah Perang (territory replay)
// and a long AI game with diplomacy, generals and forts.   node tests/browser/story.cjs [outDir]   (server running)
const path = require('path');
const { chromium } = require(path.join(__dirname, '..', '..', '..', 'frontier', 'node_modules', 'playwright-core'));
const BASE = process.env.BASE || 'http://localhost:8772/';
const SP = process.argv[2] || path.join(__dirname, 'out'); require('fs').mkdirSync(SP, { recursive: true });
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11'] });
  const p = await b.newPage({ viewport: { width: 1536, height: 760 } });
  const errs = []; p.on('pageerror', e => errs.push('PAGEERR ' + e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.evaluate(() => { localStorage.setItem('ak_opts', JSON.stringify({ diff: 'hard', color: 'blue', size: 144, seed: 21, players: 4, name: '', mode: 'watch' })); localStorage.removeItem('ak_score'); });
  await p.reload({ waitUntil: 'networkidle' }); await p.click('#btnPlay');
  await p.waitForFunction(() => window.__ak && __ak.game && __ak.game.W, null, { timeout: 60000 }); await p.waitForTimeout(1200);
  console.log('score box shown', await p.evaluate(() => !document.getElementById('scoreBox').classList.contains('hidden')));
  const t0 = Date.now();
  await p.evaluate(() => { const g = __ak.game; for (let n = 0; n < 55 * 600 && g.W.winner < 0; n++) g.tickOnce(true); });
  console.log('ff', ((Date.now() - t0) / 1000).toFixed(0) + 's', 'min', await p.evaluate(() => (__ak.game.W.t / 60).toFixed(1)));
  await p.waitForTimeout(1500);
  console.log('score rows', await p.evaluate(() => [...document.querySelectorAll('#scoreBox .sr')].map(r => r.innerText.replace(/\s+/g, ' ')).join(' | ')));
  const W = await p.evaluate(() => { const W = __ak.game.W; const k = {}; for (const c of W.chron || []) k[c.kind] = (k[c.kind] || 0) + 1; return { kinds: k, posts: [...W.dyn.values()].filter(e => e.kind === 'post').map(e => e.owner), generals: [...W.dyn.values()].filter(e => e.type === 'general').length, samples: __ak.game.hist.terrs.length }; });
  console.log('chronicle kinds', JSON.stringify(W.kinds)); console.log('forts', JSON.stringify(W.posts), 'generals', W.generals, 'land samples', W.samples);
  await p.screenshot({ path: `${SP}/story_game.png` });
  // a clickable note moves the camera
  const moved = await p.evaluate(async () => { const g = __ak.game; g.hud.notify('Tes lokasi', 'age', [20, 20]); const n = [...document.querySelectorAll('#notify .note.go')].pop(); const c0 = [g.view.cam.x, g.view.cam.y]; n.click(); await new Promise(r => setTimeout(r, 200)); return Math.hypot(g.view.cam.x - c0[0], g.view.cam.y - c0[1]) > 10; });
  console.log('clickable note moves camera', moved);
  // the director's slow-motion moment
  const slow = await p.evaluate(async () => { const g = __ak.game; if (!g.autoCam) g.toggleAutoCam(); g.slowUntil = 0; const t0 = g.W.t; g.cine(60, 60); await new Promise(r => setTimeout(r, 1200)); const slowRate = (g.W.t - t0) / 1.2; const cine = document.body.classList.contains('cine'); await new Promise(r => setTimeout(r, 2500)); const t1 = g.W.t; await new Promise(r => setTimeout(r, 1200)); return { cine, slowRate: +slowRate.toFixed(2), normalRate: +((g.W.t - t1) / 1.2).toFixed(2) }; });
  console.log('slow motion', JSON.stringify(slow));
  // Kisah Perang
  await p.evaluate(() => __ak.game.story.open()); await p.waitForTimeout(2500);
  console.log('story', await p.evaluate(() => ({ open: !document.getElementById('storyModal').classList.contains('hidden'), frame: __ak.game.story.i, of: __ak.game.hist.terrs.length, log: document.querySelectorAll('#storyLog .ce').length })));
  await p.screenshot({ path: `${SP}/story_map.png` });
  console.log(errs.slice(0, 10).join('\n') || 'no errors'); await b.close();
})();
