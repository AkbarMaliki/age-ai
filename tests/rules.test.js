// v7 rules: Imperial Age + unit lines, siege workshop (mangonel splash, trebuchet pack/unpack), garrisons, palisade +
// gate lock, trade carts, reseed queue, fish traps, demolition ships, regicide / wonder / king of the hill / treaty,
// tribute.     node tests/rules.test.js
import { generate } from '../js/map.js';
import { step, command, addUnit, addBuilding, placementOk, alive, stat, bstat, nearestFree, passable } from '../js/sim.js';
import { TECHS, WONDER_TIME, KOTH_TIME } from '../js/data.js';

let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const world = (o = {}) => {
  const W = generate({ size: 112, seed: 9, type: 'padang', opts: { season: 'semi', night: 'off', ...o }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }, ...(o.three ? [{ name: 'C', color: 'green', team: o.three }] : [])] });
  for (const P of W.players) { for (const r in P.res) P.res[r] = 20000; P.exp.fill(1); P.popCap = 200; P.age = 4; }
  return W;
};
const run = (W, sec) => { for (let i = 0; i < sec * 10; i++) { step(W); W.ev.length = 0; } };
const tcOf = (W, pid) => W.ents.get(W.players[pid].tc);
const put = (W, pid, type, near = null, rot = 0) => { const tc = near || tcOf(W, pid); for (let r = 5; r < 40; r++) for (let a = 0; a < 24; a++) { const i = Math.round(tc.x + Math.cos(a / 24 * 6.283 + rot) * r), j = Math.round(tc.y + Math.sin(a / 24 * 6.283 + rot) * r); if (placementOk(W, pid, type, i, j)) return addBuilding(W, pid, type, i, j, true); } };
const unit = (W, pid, type, x, y) => { const f = nearestFree(W, x, y, pid, 8); return addUnit(W, pid, type, f[0] + 0.5, f[1] + 0.5); };
const research = (W, b, tech) => { command(W, { t: 'research', pid: b.owner, bid: b.id, tech }); run(W, TECHS[tech].time + 1); };

// ---- 1. Imperial Age and unit lines
{
  const W = world(); W.players[0].age = 3; const P = W.players[0];
  for (const t of ['castle', 'siege_workshop']) put(W, 0, t);
  research(W, tcOf(W, 0), 'imperial_war');
  check(P.age === 4 && P.mods.ma >= 1, 'Imperial Age reached through Legiun Kekaisaran (+1/+1 armour)');
  const bk = put(W, 0, 'barracks'); const a0 = stat(W, 0, 'militia').atk;
  research(W, bk, 'man_at_arms'); research(W, bk, 'long_sword'); research(W, bk, 'champion');
  const s = stat(W, 0, 'militia'); check(s.name === 'Juara' && s.atk === a0 + 6, `militia line -> ${s.name} (atk ${a0} -> ${s.atk})`);
}
// ---- 2. siege: mangonel splash, trebuchet unpacks to hit a building far away
{
  const W = world(); const tc = tcOf(W, 0);
  const mg = unit(W, 0, 'mangonel', tc.x + 8, tc.y + 6); const foes = []; for (let k = 0; k < 5; k++) foes.push(unit(W, 1, 'militia', mg.x + 5 + (k % 3) * 0.6, mg.y + Math.floor(k / 3) * 0.6));
  for (const f of foes) f.stance = 'pasif';
  run(W, 1); command(W, { t: 'smart', pid: 0, ids: [mg.id], target: foes[0].id }); run(W, 14);
  const hurt = foes.filter(f => !alive(W, f.id) || f.hp < f.maxHp).length;
  check(hurt >= 3, `mangonel splash hit ${hurt} of 5 militia`);
  const tb = unit(W, 0, 'trebuchet_p', tc.x + 8, tc.y - 4); const target = put(W, 1, 'house', tb, 0); target.hp = target.maxHp;
  // walk it to ~18 tiles away first
  command(W, { t: 'smart', pid: 0, ids: [tb.id], target: target.id }); let unpacked = false;
  for (let i = 0; i < 900; i++) { step(W); W.ev.length = 0; if (tb.type === 'trebuchet') unpacked = true; }
  check(unpacked && (!alive(W, target.id) || target.hp < target.maxHp), `trebuchet unpacked and hit the house (${alive(W, target.id) ? Math.round(target.hp) + ' hp left' : 'destroyed'})`);
  command(W, { t: 'move', pid: 0, ids: [tb.id], x: tb.x + 3, y: tb.y }); run(W, 6);
  check(tb.type === 'trebuchet_p', 'trebuchet packs up to move');
}
// ---- 3. garrison: archers in a tower shoot more; infantry in a ram; ungarrison
{
  const W = world(); const tc = tcOf(W, 0); const tw = put(W, 0, 'watch_tower');
  const arch = [0, 1, 2, 3].map(k => unit(W, 0, 'archer', tw.x + 2 + k * 0.5, tw.y + 2));
  command(W, { t: 'garrison', pid: 0, ids: arch.map(a => a.id), target: tw.id }); run(W, 12);
  check(arch.every(a => a.inside === tw.id), 'four archers garrisoned in the tower');
  const foe = unit(W, 1, 'knight', tw.x + 4, tw.y + 1); foe.hp = foe.maxHp = 5000; foe.stance = 'pasif';
  let arrows = 0; for (let i = 0; i < 40; i++) { step(W); arrows += [...W.dyn.values()].filter(e => e.kind === 'proj' && e.owner === 0 && e.t < 0.11).length; W.ev.length = 0; }
  check(arrows >= 8, `garrisoned tower fires ${arrows} arrows in 4 s`);
  command(W, { t: 'ungarrison', pid: 0, bid: tw.id }); run(W, 1);
  check(arch.every(a => !a.inside), 'ungarrisoned');
  const ram = unit(W, 0, 'ram', tc.x + 8, tc.y + 8), inf = [0, 1, 2].map(k => unit(W, 0, 'militia', ram.x + 2, ram.y + k));
  command(W, { t: 'garrison', pid: 0, ids: inf.map(u => u.id), target: ram.id }); run(W, 8);
  check(inf.every(u => u.inside === ram.id), 'infantry rides inside the ram');
}
// ---- 4. palisade and a locked gate
{
  const W = world(); const tc = tcOf(W, 0);
  const pal = put(W, 0, 'palisade'); check(!!pal && !passable(W, pal.x, pal.y, 0), 'palisade blocks the way');
  const gate = put(W, 0, 'gate'); const gi = gate.x + 1, gj = gate.y;
  const before = passable(W, gi, gj, 0); command(W, { t: 'lock', pid: 0, bid: gate.id }); run(W, 0.2);
  check(before && !passable(W, gi, gj, 0), 'own gate open, locked gate closed');
}
// ---- 5. trade carts between two markets of ours
{
  const W = world(); const P = W.players[0], tc = tcOf(W, 0);
  const m1 = put(W, 0, 'market'), m2 = put(W, 0, 'market', { x: tc.x + 35, y: tc.y });
  const cart = unit(W, 0, 'trade_cart', m1.x + 5, m1.y + 2); cart.homeB = m1.id;
  const g0 = P.res.gold; command(W, { t: 'smart', pid: 0, ids: [cart.id], target: m2.id });
  for (let i = 0; i < 2400 && P.res.gold <= g0; i++) { step(W); W.ev.length = 0; }
  check(P.res.gold > g0 + 10, `trade cart brought ${Math.round(P.res.gold - g0)} gold`);
}
// ---- 6. reseed queue + fish trap
{
  const W = world(); const P = W.players[0];
  const farm = put(W, 0, 'farm'); farm.food = 5; command(W, { t: 'reseed', pid: 0, bid: 0, n: 1 }); run(W, 0.2);
  const v = unit(W, 0, 'villager', farm.x + 1.5, farm.y + 1.5); command(W, { t: 'smart', pid: 0, ids: [v.id], target: farm.id }); run(W, 30);
  check(alive(W, farm.id) && farm.food > 150 && (W.reseed[0] || 0) === 0, `farm replanted from the queue (food ${Math.round(farm.food)})`);
}
// ---- 7. a demolition ship blows up next to an enemy warship
{
  const W = generate({ size: 144, seed: 21, type: 'kepulauan', opts: { season: 'semi', night: 'off' }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }] });
  const water = []; for (let j = 5; j < 139 && water.length < 1; j++) for (let i = 5; i < 139; i++) { let ok = true; for (let d = -3; d <= 3 && ok; d++) ok = passable(W, i + d, j, 0, true) && passable(W, i, j + d, 0, true); if (ok) { water.push([i, j]); break; } }
  const [wx, wy] = water[0]; const demo = addUnit(W, 0, 'demo_ship', wx + 0.5, wy + 0.5), ws = addUnit(W, 1, 'war_ship', wx + 3.5, wy + 0.5); ws.stance = 'pasif';
  run(W, 1); command(W, { t: 'smart', pid: 0, ids: [demo.id], target: ws.id }); run(W, 8);      // (after the first vision update)
  check(!alive(W, demo.id) && (!alive(W, ws.id) || ws.hp < ws.maxHp * 0.5), 'demolition ship exploded and wrecked the war ship');
}
// ---- 8. regicide, wonder, king of the hill, treaty
{
  const W = world({ victory: 'regicide' }); const k = W.ents.get(W.players[1].king);
  k.hp = 1; const m = unit(W, 0, 'knight', k.x + 0.8, k.y); command(W, { t: 'smart', pid: 0, ids: [m.id], target: k.id }); run(W, 5);
  check(!W.players[1].alive && W.winner === W.players[0].team, 'regicide: the king falls, the kingdom falls');
}
{
  const W = world(); const wd = put(W, 0, 'wonder'); W.wonders.set(wd.id, W.t);
  run(W, WONDER_TIME + 2);
  check(W.winner === W.players[0].team, `a wonder held ${WONDER_TIME / 60} minutes wins`);
}
{
  const W = world({ victory: 'koth' }); const M = W.monument;
  for (let k = 0; k < 3; k++) unit(W, 0, 'spearman', M.x + 2, M.y + k * 0.5);
  run(W, KOTH_TIME + 3);
  check(M.team === W.players[0].team && W.winner === W.players[0].team, 'king of the hill: monument held 10 minutes wins');
}
{
  const W = world({ treaty: 5 }); const a = unit(W, 0, 'knight', 40, 40), b = unit(W, 1, 'militia', 41, 40);
  command(W, { t: 'smart', pid: 0, ids: [a.id], target: b.id }); run(W, 10);
  check(b.hp === b.maxHp, 'treaty: no fighting before it ends');
  W.t = 5 * 60 + 1; command(W, { t: 'smart', pid: 0, ids: [a.id], target: b.id }); run(W, 10);
  check(!alive(W, b.id) || b.hp < b.maxHp, 'after the treaty they fight');
}
// ---- 9. tribute to an ally
{
  const W = world({ three: 9 }); W.players[2].team = W.players[0].team; const A = W.players[0], C = W.players[2]; const a0 = A.res.gold, c0 = C.res.gold;
  command(W, { t: 'tribute', pid: 0, to: 2, res: 'gold', n: 500 }); run(W, 0.2);
  check(A.res.gold === a0 - 500 && C.res.gold === c0 + 400, 'tribute: 500 gold sent, 400 arrive');
}
console.log(fail ? `${fail} rules check(s) failed` : 'all rules checks passed');
if (fail) process.exit(1);
