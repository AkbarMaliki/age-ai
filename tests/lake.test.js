// Big maps: an army sent at a town across the great lake walks round it (the coarse route map) instead of giving up
// on the shore. Before the fix about half of such an army stood idle at the water.   node tests/lake.test.js [size]
import { generate } from '../js/map.js';
import { step, addUnit, addBuilding, nearestFree, command, passable } from '../js/sim.js';
const size = +(process.argv[2] || 440);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const W = generate({ size, seed: 3, type: 'danau', players: [0, 1, 2, 3].map(i => ({ name: 'ABCD'[i], color: ['blue', 'red', 'green', 'yellow'][i], ai: true, team: i })) });
const C = size / 2; let r = 0; while (!passable(W, Math.round(C - r), Math.round(C), 0)) r++; let r2 = 0; while (!passable(W, Math.round(C + r2), Math.round(C), 0)) r2++;
ok(r + r2 > 60, `a great lake in the middle (${r + r2} tiles across)`);
const from = nearestFree(W, C - r - 6, C, 0, 6), to = nearestFree(W, C + r2 + 12, C, 1, 8), target = addBuilding(W, 1, 'barracks', to[0], to[1], true);
const us = []; for (let k = 0; k < 40; k++) { const f = nearestFree(W, from[0] - (k % 8), from[1] - 3 + (k / 8 | 0), 0, 8); us.push(addUnit(W, 0, ['knight', 'militia'][k % 2], f[0] + 0.5, f[1] + 0.5)); }
command(W, { t: 'smart', pid: 0, ids: us.map(u => u.id), target: target.id });
let idle = 0, s = 0;
for (s = 1; s <= 420 && W.ents.has(target.id); s++) { for (let k = 0; k < 10; k++) step(W); W.ev.length = 0; if (s === 90) idle = us.filter(u => W.ents.has(u.id) && !u.order).length; }
ok(idle === 0, `no soldier gives up at the shore (${idle} idle after 90 s)`);
ok(!W.ents.has(target.id), `the army walked round the lake and razed the target (${s} s)`);
console.log(fails ? `${fails} lake check(s) FAILED` : 'all lake checks passed'); process.exit(fails ? 1 : 0);
