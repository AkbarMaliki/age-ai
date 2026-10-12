// Naval mechanics check on an island map: dock placement, fishing boats, transport board -> sail -> unload, warship fire.
//   node tests/naval.test.js
import { generate } from '../js/map.js';
import { step, command, placementOk, addBuilding, addUnit, regionAt, nearestFree, alive } from '../js/sim.js';
const W = generate({ size: 144, seed: 21, type: 'kepulauan', opts: { season: 'semi', night: 'off' }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }] });
const P = W.players[0], [sx, sy] = P.start, run = (sec) => { for (let i = 0; i < sec * 10; i++) { step(W); W.ev.length = 0; } };
P.exp.fill(1); for (const r in P.res) P.res[r] = 5000; P.age = 2; P.popCap = 100;
let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
// 1. dock on the nearest shore
let dock = null;
for (let r = 4; r < 40 && !dock; r++) for (let a = 0; a < 32 && !dock; a++) { const i = Math.round(sx + Math.cos(a / 32 * 6.28) * r), j = Math.round(sy + Math.sin(a / 32 * 6.28) * r); if (placementOk(W, 0, 'dock', i, j)) dock = addBuilding(W, 0, 'dock', i, j, true); }
check(!!dock, 'dock placed on the shore');
// 2. boats
command(W, { t: 'train', pid: 0, bid: dock.id, type: 'fishing_boat' }); command(W, { t: 'train', pid: 0, bid: dock.id, type: 'transport_ship' });
run(80);
const boat = [...W.dyn.values()].find(e => e.type === 'fishing_boat'), tr = [...W.dyn.values()].find(e => e.type === 'transport_ship');
check(!!boat && !!tr, 'fishing boat and transport trained');
const food0 = P.res.food; run(90);
check(P.res.food > food0, `fishing boat brought food (${Math.round(P.res.food - food0)})`);
// 3. board five soldiers
const men = []; for (let k = 0; k < 5; k++) { const f = nearestFree(W, sx + 3, sy + 3 + k * 0.5, 0, 6); men.push(addUnit(W, 0, 'militia', f[0] + 0.5, f[1] + 0.5)); }
command(W, { t: 'smart', pid: 0, ids: men.map(u => u.id), target: tr.id, x: tr.x, y: tr.y });
run(150);
check(tr.cargo.length === 5, `5 soldiers aboard (got ${tr.cargo.length})`);
// 4. sail to the enemy island and unload
const [ex, ey] = W.players[1].start;
command(W, { t: 'unload', pid: 0, ids: [tr.id], x: ex, y: ey });
run(200);
const landed = men.filter(u => W.ents.has(u.id));
check(tr.cargo.length === 0 && landed.length === 5, `unloaded (${landed.length} ashore)`);
check(landed.every(u => regionAt(W, u.x, u.y) === regionAt(W, ex, ey + 3)), 'they stand on the enemy island');
// 5. a warship shoots at units on the shore
const ws = addUnit(W, 0, 'war_ship', tr.x, tr.y);
const target = addUnit(W, 1, 'archer', landed[0].x, landed[0].y);
const hp0 = target.hp; command(W, { t: 'smart', pid: 0, ids: [ws.id], target: target.id, x: target.x, y: target.y });
run(20);
check(!alive(W, target.id) || target.hp < hp0, 'warship hits a unit on the shore');
console.log(fail ? `${fail} naval check(s) failed` : 'all naval checks passed');
if (fail) process.exit(1);
