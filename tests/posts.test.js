// Old forts: one between each pair of neighbouring kingdoms; soldiers alone round one take it, it pays gold and
// watches far; contested, it does not change hands; the AI goes out to take them.   node tests/posts.test.js [seed]
import { generate } from '../js/map.js';
import { step, addUnit, nearestFree, idx, POST } from '../js/sim.js';
import { AI } from '../js/ai.js';
const seed = +(process.argv[2] || 7);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const W = generate({ size: 144, seed, type: 'padang', players: [0, 1, 2, 3].map(i => ({ name: 'ABCD'[i], color: ['blue', 'red', 'green', 'yellow'][i], ai: true, team: i })) });
const posts = [...W.dyn.values()].filter(e => e.kind === 'post');
ok(posts.length === 4, `four forts on a four-player map (${posts.length})`);
const C = W.size / 2, dc = posts.map(p => Math.hypot(p.x - C, p.y - C));
ok(Math.max(...dc) - Math.min(...dc) < 8, `placed fairly, the same distance from the middle (${dc.map(d => d.toFixed(0)).join(', ')})`);
const run = (s) => { for (let k = 0; k < s * 10; k++) { step(W); W.ev.length = 0; } };
const p = posts[0], at = (o, dx) => { const f = nearestFree(W, p.x + dx, p.y + 1, o, 4); return [f[0] + 0.5, f[1] + 0.5]; };
const a = [0, 1, 2].map(k => addUnit(W, 0, 'militia', ...at(0, k * 0.4)));
const g0 = W.players[0].res.gold; run(POST.hold + 2);
ok(p.owner === 0, 'three soldiers alone round the fort take it');
ok(W.players[0].vis[idx(W, Math.floor(p.x + 10), Math.floor(p.y))], 'the fort watches far around');
const g1 = W.players[0].res.gold; run(10);
ok(W.players[0].res.gold - g1 > 5, `it pays gold (+${(W.players[0].res.gold - g1).toFixed(0)} in 10 s)`);
const b = addUnit(W, 1, 'militia', ...at(1, 1.5)); b.stance = 'pasif'; for (const u of a) u.stance = 'pasif';
run(POST.hold + 3);
ok(p.owner === 0, 'contested by an enemy, it does not change hands');
// the AI sends a squad to take the nearest fort
const W2 = generate({ size: 144, seed, type: 'padang', players: [0, 1, 2, 3].map(i => ({ name: 'ABCD'[i], color: ['blue', 'red', 'green', 'yellow'][i], ai: true, team: i })) });
const ais = W2.players.map((q, i) => new AI(W2, i, 'hard'));
for (let n = 0; n < 40 * 600; n++) { for (const x of ais) x.tick(); step(W2); W2.ev.length = 0; }
const held = [...W2.dyn.values()].filter(e => e.kind === 'post' && e.owner >= 0).length;
ok(held >= 2, `by minute 40 the computer kingdoms hold forts (${held} of 4)`);
console.log(fails ? `${fails} fort check(s) FAILED` : 'all fort checks passed'); process.exit(fails ? 1 : 0);
