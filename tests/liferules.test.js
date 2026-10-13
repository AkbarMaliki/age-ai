// Daily life rules (v10): thirst + wells, the tavern, sickness + hospital, births and growing up, the barn yard
// (fattening, milk, buying livestock), work rate, the Prosperity victory.     node tests/liferules.test.js
import { generate } from '../js/map.js';
import { step, command, addUnit, addBuilding, placementOk, alive, nearestFree, personName, personAge } from '../js/sim.js';
import { LIFE, UNITS } from '../js/data.js';

let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const world = (o = {}) => {
  const W = generate({ size: 112, seed: 4, type: 'padang', opts: { season: 'semi', night: 'off', ...o }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }] });
  for (const P of W.players) { for (const r in P.res) P.res[r] = 20000; P.exp.fill(1); P.popCap = 200; }
  return W;
};
const run = (W, sec) => { const ev = []; for (let i = 0; i < sec * 10; i++) { step(W); ev.push(...W.ev); W.ev.length = 0; } return ev; };
const tcOf = (W, pid) => W.ents.get(W.players[pid].tc);
const put = (W, pid, type, near, r0 = 5) => { const tc = near || tcOf(W, pid); for (let r = r0; r < 40; r++) for (let a = 0; a < 24; a++) { const i = Math.round(tc.x + Math.cos(a / 24 * 6.283) * r), j = Math.round(tc.y + Math.sin(a / 24 * 6.283) * r); if (placementOk(W, pid, type, i, j)) return addBuilding(W, pid, type, i, j, true); } };
const unit = (W, pid, type, x, y) => { const f = nearestFree(W, x, y, pid, 8); return addUnit(W, pid, type, f[0] + 0.5, f[1] + 0.5); };

// ---- 1. names, ages, needs set up on everyone
{
  const W = world(); run(W, 1.2);
  const v = [...W.dyn.values()].find(u => u.owner === 0 && u.type === 'villager');
  check(v && personName(v).split(' ').length === 2 && personAge(W, v) >= 16 && v.hu > 90, `villagers have a name and an age (${personName(v)}, ${personAge(W, v)})`);
}
// ---- 2. far from water they get thirsty, walk to a well and drink
{
  const W = world(); const tc = tcOf(W, 0), dx = Math.sign(W.size / 2 - tc.x) || 1;
  const wl = put(W, 0, 'well', { x: tc.x + dx * 22, y: tc.y }, 0);
  const v = unit(W, 0, 'villager', wl.x + dx * 12, wl.y); run(W, 1.2); v.th = 10;
  const ev = run(W, 25);
  check(v.th > 90, `thirsty villager walked to the well and drank (thirst ${Math.round(v.th)})`);
}
// ---- 3. the tavern lifts spirits
{
  const W = world(); const tv = put(W, 0, 'tavern'); const v = unit(W, 0, 'villager', tv.x + 4, tv.y + 4); run(W, 1.2); v.fu = 5;
  run(W, 3); const went = v.order && v.order.why === 'tavern';
  run(W, LIFE.tavernTime + 15);
  check(went && v.fu > 40, `bored villager visited the tavern (fun ${Math.round(v.fu)})`);
}
// ---- 4. sickness: the hospital cures; without care health falls and work slows
{
  const W = world(); const hs = put(W, 0, 'hospital'); W.players[0].age = 2;
  const a = unit(W, 0, 'villager', hs.x + 3, hs.y + 4), b = unit(W, 0, 'villager', W.size / 2, W.size / 2); run(W, 1.2);
  a.sick = b.sick = LIFE.sickTime; a.he = b.he = 60; run(W, 2);
  check(b.wr < 0.7, `a sick villager works slower (rate ${b.wr.toFixed(2)})`);
  run(W, 70);
  check(!a.sick && a.he > b.he, `the hospital cured its patient (health ${Math.round(a.he)} vs ${Math.round(b.he)} untreated)`);
}
// ---- 5. a family has a child who grows up into a villager
{
  const W = world(); const P = W.players[0]; const h = put(W, 0, 'house');
  for (const u of [...W.dyn.values()]) if (u.owner === 0 && u.type === 'villager') { u.homeId = 0; }
  const m = unit(W, 0, 'villager', h.x + 3, h.y + 3), f = unit(W, 0, 'villager', h.x + 3, h.y + 4); run(W, 1.2);
  const [dad, mom] = m.sex === 'm' ? [m, f] : [f, m]; if (dad.sex === mom.sex) { mom.sex = dad.sex === 'm' ? 'f' : 'm'; }
  for (const u of [m, f]) { u.homeId = h.id; u.ag0 = 25; }
  const tc = tcOf(W, 0);
  let born = null; for (let k = 0; k < 40 && !born; k++) {
    for (const u of [...W.dyn.values()]) if (u.owner === 0 && u.fu !== undefined) { if (u !== m && u !== f) u.homeId = tc.id; u.fu = 90; u.he = 100; }   // everyone else lives in the TC
    const ev = run(W, LIFE.birthEvery); born = ev.find(e => e.k === 'birth'); }
  const kid = born && [...W.dyn.values()].find(u => u.type === 'child' && u.owner === 0);
  check(!!kid && kid.homeId === h.id, `a child was born at home (${born && born.name})`);
  if (kid) { kid.born -= LIFE.growUp; run(W, 3); check(kid.type === 'villager', 'the child grew up into a villager'); }
}
// ---- 6. the barn: bought livestock appears in the yard, fattens and gives milk; sheep sent there stay
{
  const W = world(); const P = W.players[0]; const bn = put(W, 0, 'barn');
  command(W, { t: 'train', pid: 0, bid: bn.id, type: 'cow' }); run(W, UNITS.cow.time + 2);
  const cow = [...W.dyn.values()].find(u => u.type === 'cow' && u.owner === 0);
  check(cow && cow.pen === bn.id, 'a cow bought at the barn stands in its yard');
  const sh = [...W.dyn.values()].find(u => u.type === 'sheep' && u.owner === 0) || unit(W, 0, 'sheep', bn.x - 4, bn.y);
  command(W, { t: 'smart', pid: 0, ids: [sh.id], target: bn.id }); run(W, 20);
  check(sh.pen === bn.id, 'a sheep herded into the barn yard is penned');
  const f0 = P.res.food; run(W, 120);
  check(cow.meat > UNITS.cow.food + 50 && P.res.food > f0, `penned livestock fattens (cow ${Math.round(cow.meat)}) and gives milk (+${Math.round(P.res.food - f0)} food)`);
  const vx = unit(W, 0, 'villager', cow.x + 1, cow.y); command(W, { t: 'smart', pid: 0, ids: [vx.id], target: cow.id }); run(W, 30);
  const carcass = [...W.dyn.values()].find(e => e.type === 'carcass' && e.animal === 'cow');
  check(carcass && carcass.max > UNITS.cow.food, `slaughtered it yields more meat (${carcass && carcass.max})`);
}
// ---- 7. prosperity victory
{
  const W = world({ victory: 'prosper' }); W.players[0].age = 4; run(W, 2);
  W.players[1].age = 1; for (const k of ['tavern', 'hospital', 'barn', 'market', 'monastery']) put(W, 0, k);
  for (let i = 0; i < 6; i++) put(W, 0, 'well');
  for (let i = 0; i < 30; i++) unit(W, 0, 'villager', tcOf(W, 0).x + 2, tcOf(W, 0).y + 6);
  for (let i = 0; i < 8; i++) put(W, 0, 'house');
  run(W, 5); const p0 = W.players[0].prosper;
  for (let k = 0; k < 12 && W.winner < 0; k++) { for (const u of W.dyn.values()) if (u.owner === 0 && u.fu !== undefined) { u.fu = 100; u.hu = 100; u.th = 100; } run(W, 60); }
  check(W.winner === W.players[0].team, `prosperity index ${p0} held for 10 minutes wins`);
}
console.log(fail ? `${fail} life check(s) failed` : 'all life checks passed');
if (fail) process.exit(1);
