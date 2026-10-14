// The war commander defends every town: a raid on a second town brings help from the army, the beaten-off attacker
// gets a counter-attack, and a kingdom far weaker than its enemy goes on the defensive.   node tests/defense.test.js [seed]
import { generate } from '../js/map.js';
import { step, addBuilding, addUnit, passable, nearestFree, idx } from '../js/sim.js';
import { AI } from '../js/ai.js';
const seed = +(process.argv[2] || 4);
const W = generate({ size: 144, seed, type: 'padang', players: [0, 1].map(i => ({ name: ['Biru', 'Merah'][i], color: ['blue', 'red'][i], ai: true, team: i })) });
const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const P0 = W.players[0]; P0.age = 3; W.players[1].age = 3;
const [bx, by] = P0.start, [ex, ey] = W.players[1].start;
// Biru's second town, a third of the way towards Merah
const free5 = (i, j) => { for (let b = -1; b <= 4; b++) for (let c = -1; c <= 4; c++) if (!passable(W, i + b, j + c, 0) || W.occ[idx(W, i + b, j + c)]) return false; return true; };
let spot = null; const ax = bx + (ex - bx) * 0.3, ay = by + (ey - by) * 0.3;
for (let r = 0; r < 20 && !spot; r++) for (let a = 0; a < 16 && !spot; a++) { const i = Math.round(ax + Math.cos(a / 16 * 6.283) * r), j = Math.round(ay + Math.sin(a / 16 * 6.283) * r); if (free5(i, j)) spot = [i, j]; }
const town = addBuilding(W, 0, 'town_center', spot[0], spot[1], true);
for (const P of W.players) P.exp.fill(1);              // both know the map, and Biru's scouts have seen Merah's town
for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === 1) ais[0].known.set(e.id, { x: e.x + e.w / 2, y: e.y + e.h / 2, owner: 1, type: e.type });
for (let k = 0; k < 26; k++) { const f = nearestFree(W, bx + 4 + (k % 6), by + 6 + Math.floor(k / 6), 0, 6); addUnit(W, 0, k % 2 ? 'knight' : 'archer', f[0] + 0.5, f[1] + 0.5); }
const told = [];
const run = (secs) => { for (let s = 0; s < secs * 10 && W.winner < 0; s++) { for (const a of ais) a.tick(); step(W); for (const e of W.ev) if (e.k === 'war') told.push(`${(W.t / 60).toFixed(1)}m [${W.players[e.owner].name}] ${e.kind}: ${e.text}`); W.ev.length = 0; } };
run(5);
// a raid on the second town
for (let k = 0; k < 12; k++) { const f = nearestFree(W, spot[0] + 8 + (k % 4), spot[1] + 8 + Math.floor(k / 4), 1, 6); addUnit(W, 1, 'knight', f[0] + 0.5, f[1] + 0.5); }
const raiders = () => [...W.dyn.values()].filter(e => e.kind === 'unit' && e.owner === 1 && e.type === 'knight' && Math.hypot(e.x - spot[0], e.y - spot[1]) < 30).length;
let helpers = 0;
for (let s = 0; s < 12 && raiders(); s++) { run(10); helpers = Math.max(helpers, [...W.dyn.values()].filter(e => e.kind === 'unit' && e.owner === 0 && e.type !== 'villager' && Math.hypot(e.x - spot[0] - 2, e.y - spot[1] - 2) < 16).length); }
run(30);
for (const t of told) console.log('   ' + t);
ok(helpers >= 8, `soldiers rode to the town under attack (${helpers})`);
ok(raiders() === 0, 'the raid was beaten off');
ok(W.ents.has(town.id), 'the town still stands');
ok(told.some(t => t.includes('[Biru] repel:')), 'the chronicle tells of the beaten-off attack');
ok(told.some(t => t.includes('[Biru] counter:')) || (ais[0].war && ais[0].war.foe === 1), 'a counter-attack on the attacker followed');
// a far weaker kingdom holds
const ai1 = ais[1];
for (let k = 0; k < 40; k++) { const f = nearestFree(W, bx + 3 + (k % 8), by - 6 - Math.floor(k / 8), 0, 8); addUnit(W, 0, 'knight', f[0] + 0.5, f[1] + 0.5); }
W.t = Math.max(W.t, 1320);            // (the posture only changes from minute 20)
for (const e of [...W.dyn.values()]) if (e.kind === 'unit' && e.owner === 0 && e.type === 'knight') ai1.foes.set(e.id, { t: W.t, x: e.x, y: e.y, type: e.type, nav: false, owner: 0 });
ai1.postT = 0; ai1.m = { units: [...W.dyn.values()].filter(e => e.kind === 'unit' && e.owner === 1), bld: [...W.dyn.values()].filter(e => e.kind === 'building' && e.owner === 1) }; ai1.posture();
ok(ai1.stance === 'bertahan', `Merah, far weaker, goes on the defensive (${ai1.warStatus()})`);
console.log(fails ? `${fails} defence check(s) FAILED` : 'all defence checks passed'); process.exit(fails ? 1 : 0);
