// A finished enemy Wonder: the war commander drops everything and razes it before it wins; the owner guards it.
//   node tests/wonder.test.js [seed]
import { generate } from '../js/map.js';
import { step, addBuilding, addUnit, passable, nearestFree, idx } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { BUILDINGS } from '../js/data.js';
const seed = +(process.argv[2] || 4);
const W = generate({ size: 144, seed, type: 'padang', players: [0, 1].map(i => ({ name: ['Biru', 'Merah'][i], color: ['blue', 'red'][i], ai: true, team: i })) });
const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
// a wonder stands by Merah's town; Biru has an army at home
const [sx, sy] = W.players[1].start, n = BUILDINGS.wonder.n;
let spot = null;
for (let r = 8; r < 30 && !spot; r++) for (let a = 0; a < 24 && !spot; a++) { const i = Math.round(sx + Math.cos(a / 24 * 6.283) * r), j = Math.round(sy + Math.sin(a / 24 * 6.283) * r); let free = true; for (let b = -1; b <= n && free; b++) for (let c = -1; c <= n && free; c++) free = passable(W, i + b, j + c, 1) && !W.occ[idx(W, i + b, j + c)] && !W.road[idx(W, i + b, j + c)]; if (free) spot = [i, j]; }
const wonder = addBuilding(W, 1, 'wonder', spot[0], spot[1], true); W.wonders.set(wonder.id, W.t);
const [bx, by] = W.players[0].start;
for (let k = 0; k < 24; k++) { const f = nearestFree(W, bx + 6 + (k % 6), by + 6 + Math.floor(k / 6), 0, 6); addUnit(W, 0, k % 3 ? 'knight' : 'militia', f[0] + 0.5, f[1] + 0.5); }
const told = [];
for (let s = 0; s < 600 * 10 && W.winner < 0 && W.ents.has(wonder.id); s++) {
  for (const a of ais) a.tick(); step(W);
  for (const e of W.ev) if (e.k === 'war') told.push(`${(W.t / 60).toFixed(1)}m [${W.players[e.owner].name}] ${e.kind}: ${e.text}`);
  W.ev.length = 0;
}
for (const t of told.slice(0, 8)) console.log('   ' + t);
ok(told.some(t => t.includes('] wonder:')), 'Biru\'s commander turned on the wonder');
ok(told.some(t => t.includes('[Merah] hold:')), 'Merah\'s army guards its wonder');
ok(!W.ents.has(wonder.id), `the wonder fell before it could win (minute ${(W.t / 60).toFixed(1)})`);
ok(W.winner !== 1, 'Merah did not win by wonder');
console.log(fails ? `${fails} wonder check(s) FAILED` : 'all wonder checks passed'); process.exit(fails ? 1 : 0);
