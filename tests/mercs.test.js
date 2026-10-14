// Mercenary camps: placed at random away from the towns, hired only once found (and paid, on cooldown, no enemy near),
// the five companies' skills, the helping hand for a kingdom far behind, and the AI's use of both.
//   node tests/mercs.test.js [seed]
import { generate } from '../js/map.js';
import { step, addUnit, nearestFree, command, hireWhy, dmgOf, damage } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { MERCS, UNITS } from '../js/data.js';
const seed = +(process.argv[2] || 7);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const world = (size = 224, np = 2) => generate({ size, seed, type: 'padang', players: Array.from({ length: np }, (_, i) => ({ name: 'ABCD'[i], color: ['blue', 'red', 'green', 'yellow'][i], ai: true, team: i })) });
const run = (W, s) => { for (let k = 0; k < s * 10; k++) { step(W); W.ev.length = 0; } };
// 1) placement
{
  const W = world(224, 4), camps = [...W.dyn.values()].filter(e => e.kind === 'camp');
  ok(camps.length >= 4, `camps on the map (${camps.length})`);
  ok(new Set(camps.map(c => c.faction)).size === Math.min(5, camps.length), 'every company appears before any repeats');
  ok(camps.every(c => W.players.every(P => Math.hypot(c.x - P.start[0], c.y - P.start[1]) >= 26)), 'camps lie away from the towns');
}
// 2) hiring rules
const W = world(224, 2), P = W.players[0], camp = [...W.dyn.values()].find(e => e.kind === 'camp'), F = MERCS[camp.faction];
ok(hireWhy(W, 0, camp) === 'Kamp belum ditemukan', 'a camp must be found first');
for (let j = camp.y - 6; j < camp.y + 8; j++) for (let i = camp.x - 6; i < camp.x + 8; i++) P.exp[j * W.size + i] = 1;
ok(hireWhy(W, 0, camp) === 'Butuh Zaman Feodal', 'found, but the Dark Age is too early');
P.age = 2; P.res.gold = 2000; P.res.food = 2000; P.res.iron = 500; P.popCap = 100;
ok(hireWhy(W, 0, camp) === '', `then it can be hired (${F.name})`);
const g0 = P.res.gold; command(W, { t: 'hire', pid: 0, camp: camp.id }); run(W, 0.2);
const band = [...W.dyn.values()].filter(e => e.kind === 'unit' && e.owner === 0 && e.type === F.unit);
ok(band.length === F.n && band.every(u => Math.hypot(u.x - camp.x, u.y - camp.y) < 8), `${F.n} ${UNITS[F.unit].name} appear at the camp`);
ok(P.res.gold === g0 - F.cost.gold, 'they were paid for');
ok(/Siap lagi/.test(hireWhy(W, 0, camp)), 'the camp waits before hiring out again');
const W2 = world(224, 2), c2 = [...W2.dyn.values()].find(e => e.kind === 'camp'), P2 = W2.players[0];
P2.exp.fill(1); P2.age = 2; P2.res.gold = P2.res.food = 2000; P2.res.iron = 500; P2.popCap = 100;
for (let k = 0; k < 3; k++) { const f = nearestFree(W2, c2.x + 3 + k, c2.y + 3, 1, 4); addUnit(W2, 1, 'knight', f[0] + 0.5, f[1] + 0.5); }
run(W2, 0.1); ok(hireWhy(W2, 0, c2) === 'Ada pasukan musuh di dekat kamp', 'enemy soldiers at the camp block hiring');
// 3) skills
{
  const W = world(224, 2), [bx, by] = W.players[0].start, at = (dx, o) => { const f = nearestFree(W, bx + 16 + dx, by + 16, o, 5); return [f[0] + 0.5, f[1] + 0.5]; };
  const s = addUnit(W, 0, 'sumpit', ...at(0, 0)), t = addUnit(W, 1, 'militia', ...at(3, 1)); t.stance = 'pasif';
  command(W, { t: 'smart', pid: 0, ids: [s.id], target: t.id }); run(W, 4);
  ok(t.poisonUntil > W.t - 1, 'Racun: a blowgun dart poisons');
  const hp0 = t.hp; command(W, { t: 'stop', pid: 0, ids: [s.id] }); run(W, 2);
  ok(t.hp < hp0 - 3, `the poison keeps hurting after the shooting stops (-${(hp0 - t.hp).toFixed(1)} HP in 2 s)`);
  const pen = addUnit(W, 0, 'penembak', ...at(-4, 0)), gun = addUnit(W, 0, 'gunner', ...at(-5, 0)), arm = addUnit(W, 1, 'knight', ...at(6, 1));
  ok(dmgOf(W, pen, arm) > dmgOf(W, gun, arm) - 1 + 1, `Tembus Zirah: armour ignored (${dmgOf(W, pen, arm).toFixed(1)} vs a plain gunner ${dmgOf(W, gun, arm).toFixed(1)})`);
  const r = addUnit(W, 0, 'perampok', ...at(-8, 0)), v = addUnit(W, 1, 'villager', ...at(-7, 1)); W.players[1].res.gold = 100; const mine0 = W.players[0].res.gold;
  damage(W, v, 2, r); ok(W.players[1].res.gold === 97 && W.players[0].res.gold === mine0 + 3, 'Rampas: a raider\'s blow steals gold');
  const b = addUnit(W, 0, 'biksu', ...at(-10, 0)); b.hp = 40; run(W, 5); ok(b.hp > 46, `Tenaga Dalam: a fighting monk heals himself (${b.hp.toFixed(0)} HP)`);
  ok(UNITS.biksu.noConvert && UNITS.bayaran.charge > 0, 'monks resist conversion; sellswords charge');
}
// 4) the helping hand
{
  const W = world(224, 2); W.t = 1300;
  for (const e of [...W.dyn.values()]) if (e.kind === 'unit' && e.owner === 1 && e.type === 'villager') { if (W.players[1].pop > 2) damage(W, e, 999, null); }
  for (let k = 0; k < 30; k++) { const f = nearestFree(W, W.players[0].start[0] + 4 + (k % 6), W.players[0].start[1] + 6 + (k / 6 | 0), 0, 5); addUnit(W, 0, 'knight', f[0] + 0.5, f[1] + 0.5); }
  run(W, 31);
  const o = W.players[1].mercOffer;
  ok(!!o, `a kingdom far behind is offered help (${o && o.n} ${o && UNITS[MERCS[o.faction].unit].name})`);
  ok(!W.players[0].mercOffer, 'the strong one is not');
  ok((W.chron || []).some(c => c.kind === 'mercoffer'), 'the offer is told in the chronicle');
  const before = [...W.dyn.values()].filter(e => e.kind === 'unit' && e.owner === 1).length;
  command(W, { t: 'mercaccept', pid: 1 }); run(W, 0.2);
  const after = [...W.dyn.values()].filter(e => e.kind === 'unit' && e.owner === 1).length;
  ok(o && after - before === o.n && !W.players[1].mercOffer, `accepted: the band arrives for free (+${after - before})`);
}
// 5) the AI: takes the helping hand, hires at war
{
  const W = world(224, 3), ais = W.players.map((p, i) => new AI(W, i, 'hard'));
  for (let n = 0; n < 50 * 600; n++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; }
  const k = {}; for (const c of W.chron || []) k[c.kind] = (k[c.kind] || 0) + 1;
  const mercs = [...W.dyn.values()].filter(e => e.kind === 'unit' && e.merc).length;
  console.log('   chronicle:', JSON.stringify(k), 'mercenaries alive', mercs);
  ok((k.hire || 0) + (k.mercarrive || 0) > 0, 'by minute 50 the computer kingdoms hired or took mercenaries');
  ok(!(k.mercoffer > 0) || k.mercarrive > 0, 'offers made to computer kingdoms were taken');
}
console.log(fails ? `${fails} mercenary check(s) FAILED` : 'all mercenary checks passed'); process.exit(fails ? 1 : 0);
