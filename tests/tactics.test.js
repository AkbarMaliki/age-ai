// Checks for the strategy / tactics layer: age paths, town bell + garrison arrows, healers, stances, hit-and-run,
// flank bonus, the pike upgrade and the research discount.     node tests/tactics.test.js
import { generate } from '../js/map.js';
import { step, command, addUnit, addBuilding, placementOk, alive, techOk, techCost, stat, nearestFree, dmgOf, unitCost } from '../js/sim.js';
import { TECHS, UNITS } from '../js/data.js';

let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const world = () => {
  const W = generate({ size: 112, seed: 9, type: 'padang', opts: { season: 'semi', night: 'off' }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }] });
  for (const P of W.players) { for (const r in P.res) P.res[r] = 9000; P.exp.fill(1); P.popCap = 200; }
  return W;
};
const run = (W, sec) => { for (let i = 0; i < sec * 10; i++) { step(W); W.ev.length = 0; } };
const tcOf = (W, pid) => W.ents.get(W.players[pid].tc);
const near = (W, pid, type, dx = 4, dy = 6) => { const tc = tcOf(W, pid); const f = nearestFree(W, tc.x + dx, tc.y + dy, pid, 8); return addUnit(W, pid, type, f[0] + 0.5, f[1] + 0.5); };
// a finished building of ours on the first free spot around the Town Center
const put = (W, pid, type) => { const tc = tcOf(W, pid); for (let r = 5; r < 30; r++) for (let a = 0; a < 24; a++) { const i = Math.round(tc.x + Math.cos(a / 24 * 6.283) * r), j = Math.round(tc.y + Math.sin(a / 24 * 6.283) * r); if (placementOk(W, pid, type, i, j)) return addBuilding(W, pid, type, i, j, true); } };
const finish = (W, pid, tech) => { const tc = tcOf(W, pid); command(W, { t: 'research', pid, bid: tc.id, tech }); run(W, TECHS[tech].time + 2); };

// ---- 1. age paths: exclusive, with lasting effects
{
  const W = world(), A = W.players[0], B = W.players[1];
  for (const pid of [0, 1]) for (const t of ['barracks', 'mill']) put(W, pid, t);
  const mil0 = [...W.dyn.values()].filter(e => e.owner === 0 && e.type === 'militia').length;
  finish(W, 0, 'feudal_war'); finish(W, 1, 'feudal');
  const mil1 = [...W.dyn.values()].filter(e => e.owner === 0 && e.type === 'militia').length;
  check(A.age === 2 && B.age === 2, 'both reached the Feudal Age through different paths');
  check(mil1 - mil0 === 4 && A.mods.trainSpeed >= 0.15, `Jalan Pedang: +${mil1 - mil0} militia, train speed +${A.mods.trainSpeed}`);
  check(B.mods.gather.wood >= 0.1, 'Jalan Kemakmuran: gathering +10%');
  check(!techOk(W, 0, 'feudal', tcOf(W, 0)) && !techOk(W, 0, 'feudal_wall', tcOf(W, 0)), 'the other Feudal paths are closed');
  put(W, 1, 'archery_range'); put(W, 1, 'blacksmith'); finish(W, 1, 'castle');
  check(techCost(B, 'forging').food < TECHS.forging.cost.food, `Akademi Agung: research discount (${techCost(B, 'forging').food} < ${TECHS.forging.cost.food})`);
}
// ---- 2. town bell: villagers shelter, the TC shoots more arrows; ring again and they go back to work
{
  const W = world(), A = W.players[0];
  const vils = [...W.dyn.values()].filter(e => e.owner === 0 && e.type === 'villager');
  const tree = [...W.ents.values()].find(e => e.kind === 'res' && e.type === 'tree');
  for (const v of vils) command(W, { t: 'smart', pid: 0, ids: [v.id], target: tree.id, x: tree.x, y: tree.y });
  run(W, 5);
  command(W, { t: 'bell', pid: 0, on: true }); run(W, 40);
  const inside = vils.filter(v => v.inside).length;
  check(inside === vils.length, `bell: ${inside}/${vils.length} villagers sheltered`);
  const tc = tcOf(W, 0); const foe = near(W, 1, 'knight'); foe.x = tc.x + 2; foe.y = tc.y + 6; foe.px = foe.x; foe.py = foe.y;
  let arrows = 0; for (let i = 0; i < 40; i++) { step(W); arrows += [...W.dyn.values()].filter(e => e.kind === 'proj' && e.owner === 0 && e.t < 0.11).length; W.ev.length = 0; }
  check(arrows > 1, `the Town Center fires extra arrows with ${inside} inside (${arrows} arrows in 4 s)`);
  command(W, { t: 'bell', pid: 0, on: false }); run(W, 5);
  check(vils.every(v => !v.inside) && vils.filter(v => v.order && v.order.t === 'gather').length >= vils.length - 1, 'bell off: everyone back to gathering');
}
// ---- 3. healer heals a wounded soldier
{
  const W = world(); W.players[0].age = 2;
  const h = near(W, 0, 'healer', 6, 6), m = near(W, 0, 'militia', 7, 6); m.hp = 10;
  run(W, 12);
  check(m.hp > 25, `healer: militia 10 -> ${m.hp.toFixed(1)} HP`);
}
// ---- 4. stances: stand ground does not chase, aggressive does
{
  const W = world();
  const a = near(W, 0, 'militia', 8, 8), b = near(W, 0, 'militia', 8, 10); command(W, { t: 'stance', pid: 0, ids: [b.id], s: 'diam' }); run(W, 1);
  const e = addUnit(W, 1, 'archer', a.x + 2.2, (a.y + b.y) / 2); e.hp = e.maxHp = 500; const bx = b.x, by = b.y;
  run(W, 6);
  check(Math.hypot(b.x - bx, b.y - by) < 0.3, 'stand ground: did not move');
  check(Math.hypot(a.x - e.x, a.y - e.y) < 1.6, 'aggressive: went after the archer');
}
// ---- 5. hit and run: a horse archer keeps away from a militia
{
  const W = world(); W.players[0].age = 3;
  const ha = near(W, 0, 'horse_archer', 10, 10), m = near(W, 1, 'militia', 12, 10); m.hp = 400; m.maxHp = 400;
  let close = 0; for (let i = 0; i < 150; i++) { step(W); W.ev.length = 0; if (Math.hypot(ha.x - m.x, ha.y - m.y) < 1.0) close++; }
  check(alive(W, ha.id) && close < 40, `horse archer kited (in melee range ${close}/150 ticks, hp ${Math.round(ha.hp)})`);
}
// ---- 6. flank: hitting from the side / behind does more
{
  const W = world();
  const t = near(W, 1, 'spearman', 10, 10), a = near(W, 0, 'militia', 9, 10); t.dir = 0;           // facing screen-right (+x, -y)
  a.x = t.x + 0.7; a.y = t.y - 0.7; const df = dmgOf(W, a, t);
  a.x = t.x - 0.7; a.y = t.y + 0.7; const db = dmgOf(W, a, t);
  check(db > df, `flank: from behind ${db.toFixed(2)} > from the front ${df.toFixed(2)}`);
}
// ---- 7. pike upgrade converts the spear line
{
  const W = world(); const P = W.players[0]; P.age = 3;
  const bk = put(W, 0, 'barracks');
  const sp = near(W, 0, 'spearman', 8, 8);
  command(W, { t: 'research', pid: 0, bid: bk.id, tech: 'pikes' }); run(W, TECHS.pikes.time + 2);
  check(sp.type === 'pikeman' && stat(W, 0, 'pikeman').bonus.cavalry >= 22, 'Tombak Panjang: spearmen became pikemen');
}
// ---- 8. villagers defend themselves (and each other), then go back to work; they don't chase archers
{
  const W = world();
  const vils = [...W.dyn.values()].filter(e => e.owner === 0 && e.type === 'villager');
  const tree = [...W.ents.values()].filter(e => e.kind === 'res' && e.type === 'tree').sort((p, q) => Math.hypot(p.x - vils[0].x, p.y - vils[0].y) - Math.hypot(q.x - vils[0].x, q.y - vils[0].y))[0];
  command(W, { t: 'smart', pid: 0, ids: vils.map(v => v.id), target: tree.id, x: tree.x, y: tree.y });
  run(W, 25);
  const v = vils[0], m = addUnit(W, 1, 'militia', v.x + 0.6, v.y); m.hp = 18;
  command(W, { t: 'smart', pid: 1, ids: [m.id], target: v.id }); run(W, 2);
  const fighters = vils.filter(u => u.order && u.order.t === 'attack' && u.order.defend).length;
  check(fighters >= 2, `villagers fight back together (${fighters} of ${vils.length})`);
  run(W, 25);
  check(!alive(W, m.id), 'the attacker was beaten off');
  run(W, 3);
  check(vils.filter(u => alive(W, u.id)).every(u => u.order && u.order.t !== 'attack'), 'and they went back to work (' + vils.map(u => u.order && u.order.t).join(',') + ')');
  const ar = addUnit(W, 1, 'archer', v.x + 3, v.y); command(W, { t: 'smart', pid: 1, ids: [ar.id], target: v.id }); run(W, 6);
  check(!vils.some(u => u.order && u.order.t === 'attack' && u.order.id === ar.id), 'villagers do not chase archers');
}
// ---- 9. monks: convert an enemy, carry a relic into the monastery (gold)
{
  const W = world(); W.players[0].age = 2;
  const mon = put(W, 0, 'monastery'), m = near(W, 0, 'monk', 6, 6);
  const k = addUnit(W, 1, 'knight', m.x + 5, m.y); k.stance = 'pasif';
  command(W, { t: 'smart', pid: 0, ids: [m.id], target: k.id }); run(W, 14);
  check(k.owner === 0 && W.players[0].stats.converted === 1, `monk converted the knight (owner ${k.owner})`);
  const r = [...W.dyn.values()].find(e => e.kind === 'relic');
  m.faith = 1; m.hp = m.maxHp = 9000;            // (wolves roam near relics)
  command(W, { t: 'smart', pid: 0, ids: [m.id], target: r.id });
  for (let i = 0; i < 3000 && !r.inBld; i++) { step(W); W.ev.length = 0; }
  const g0 = W.players[0].res.gold; run(W, 20);
  check(r.inBld === mon.id && W.players[0].res.gold - g0 >= 9, `relic carried to the monastery, +${Math.round(W.players[0].res.gold - g0)} gold in 20 s`);
}
// ---- 10. civilization: unique unit at the castle, price discount
{
  const W = generate({ size: 112, seed: 9, type: 'padang', opts: { season: 'semi', night: 'off' }, players: [{ name: 'A', color: 'blue', civ: 'jepang' }, { name: 'B', color: 'red', civ: 'bizantium' }] });
  for (const P of W.players) { for (const r in P.res) P.res[r] = 9000; P.exp.fill(1); P.popCap = 200; P.age = 3; }
  const c = put(W, 0, 'castle'); command(W, { t: 'train', pid: 0, bid: c.id, type: 'unique' }); run(W, 30);
  check([...W.dyn.values()].some(e => e.owner === 0 && e.type === 'samurai'), 'Jepang trains Samurai at the Castle');
  check(unitCost(W.players[1], 'spearman').food < UNITS.spearman.cost.food, 'Bizantium spearmen are cheaper');
}
// ---- 11. shift-queue, patrol, guard, bombard
{
  const W = world(); W.players[0].age = 3;
  const u = near(W, 0, 'militia', 4, 6), x0 = u.x, y0 = u.y;
  command(W, { t: 'move', pid: 0, ids: [u.id], x: x0 + 5, y: y0 }); command(W, { t: 'move', pid: 0, ids: [u.id], x: x0 + 5, y: y0 + 5, q: true }); run(W, 1);
  check(u.oq && u.oq.length === 1, 'shift: second move queued');
  run(W, 25); check(Math.hypot(u.x - x0 - 5, u.y - y0 - 5) < 1.5, 'queued move done');
  const p = near(W, 0, 'scout', 4, 10); command(W, { t: 'patrol', pid: 0, ids: [p.id], x: p.x + 8, y: p.y }); run(W, 4);
  const far = Math.hypot(p.x - p.order.ax, p.y - p.order.ay); run(W, 10);
  check(p.order && p.order.t === 'patrol' && far > 2, 'patrol keeps going back and forth');
  const v = near(W, 0, 'villager', 2, 8), g = near(W, 0, 'spearman', 4, 8); command(W, { t: 'follow', pid: 0, ids: [g.id], target: v.id });
  command(W, { t: 'move', pid: 0, ids: [v.id], x: v.x + 7, y: v.y }); run(W, 15);
  check(Math.hypot(g.x - v.x, g.y - v.y) < 3.2, 'guard follows its villager');
  W.players[0].techs.add('gunpowder'); const cn = near(W, 0, 'cannon', 6, 4); command(W, { t: 'ground', pid: 0, ids: [cn.id], x: cn.x + 6, y: cn.y }); run(W, 10);
  check([...W.dyn.values()].some(e => e.kind === 'proj' && e.owner === 0) || cn.cool > 0, 'cannon bombards the ground');
}
console.log(fail ? `${fail} tactics check(s) failed` : 'all tactics checks passed');
if (fail) process.exit(1);
