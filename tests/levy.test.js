// Wajib Militer Rakyat: villagers take up arms as the kingdom's sword line (with its upgrades), 20 gold each, the same
// person and share of health; back to work for free; the AI arms villagers when its capital is overrun.
//   node tests/levy.test.js [seed]
import { generate } from '../js/map.js';
import { step, addUnit, nearestFree, command, stat, damage } from '../js/sim.js';
import { AI } from '../js/ai.js';
const seed = +(process.argv[2] || 5);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const world = () => generate({ size: 160, seed, type: 'padang', players: [0, 1].map(i => ({ name: ['Biru', 'Merah'][i], color: ['blue', 'red'][i], ai: true, team: i })) });
const run = (W, s) => { for (let k = 0; k < s * 10; k++) { step(W); W.ev.length = 0; } };
{
  const W = world(), P = W.players[0], [bx, by] = P.start;
  const vs = []; for (let k = 0; k < 6; k++) { const f = nearestFree(W, bx + 8 + k, by + 8, 0, 4); vs.push(addUnit(W, 0, 'villager', f[0] + 0.5, f[1] + 0.5)); }
  run(W, 0.5); vs[0].hp = vs[0].maxHp / 2; vs[1].carry = { res: 'wood', n: 8 };
  command(W, { t: 'levy', pid: 0, ids: vs.map(u => u.id) }); run(W, 0.2);
  ok(vs.every(u => u.type === 'villager'), 'without the research nothing happens');
  P.techs.add('levy'); P.techs.add('man_at_arms'); P.techs.add('long_sword'); P.res.gold = 100;
  const nm = vs[0].nm, g0 = P.res.gold;
  command(W, { t: 'levy', pid: 0, ids: vs.map(u => u.id) }); run(W, 0.2);
  const armed = vs.filter(u => u.type === 'militia');
  ok(armed.length === 5 && P.res.gold === g0 - 100, `20 gold each: 100 gold arms 5 of 6 (${armed.length})`);
  ok(stat(W, 0, 'militia').name === 'Pendekar Pedang', `they become the sword line with its upgrades (${stat(W, 0, 'militia').name}, ${vs[2].maxHp} HP)`);
  ok(Math.abs(vs[0].hp / vs[0].maxHp - 0.5) < 0.01 && vs[0].nm === nm, 'the same person, the same share of health');
  ok(!vs[1].carry && armed.every(u => u.levy), 'they drop what they carried and are marked as levies');
  command(W, { t: 'unlevy', pid: 0, ids: vs.map(u => u.id) }); run(W, 0.2);
  ok(vs.every(u => u.type === 'villager') && P.res.gold === g0 - 100, 'back to work, for free');
}
// the AI: its capital overrun -> villagers take up arms; quiet for a minute -> back to work
{
  const W = world(), ais = W.players.map((p, i) => new AI(W, i, 'hard')), P = W.players[0], [bx, by] = P.start;
  P.age = 4; P.techs.add('levy'); P.res.gold = 2000;
  for (let k = 0; k < 30; k++) { const f = nearestFree(W, bx + 4 + (k % 6), by - 6 + (k / 6 | 0), 0, 5); addUnit(W, 0, 'villager', f[0] + 0.5, f[1] + 0.5); }
  for (let n = 0; n < 50; n++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; }
  const raid = []; for (let k = 0; k < 16; k++) { const f = nearestFree(W, bx + 3 + (k % 4), by + 3 + (k / 4 | 0), 1, 5); raid.push(addUnit(W, 1, 'knight', f[0] + 0.5, f[1] + 0.5)); }
  let most = 0; for (let n = 0; n < 200 && most < 4; n++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; most = Math.max(most, [...W.dyn.values()].filter(e => e.owner === 0 && e.levy).length); }      // (the raid ends as soon as they are armed)
  ok(most >= 4, `capital overrun: the computer arms its villagers (${most})`);
  for (const r of raid) if (W.ents.has(r.id)) damage(W, r, 9999, null);
  for (const e of [...W.dyn.values()]) if (e.kind === 'unit' && e.owner === 1 && e.type !== 'villager' && Math.hypot(e.x - bx, e.y - by) < 40) damage(W, e, 9999, null);
  const armed = [...W.dyn.values()].filter(e => e.owner === 0 && e.levy).map(e => e.id);
  for (let n = 0; n < 900; n++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; }
  const left = [...W.dyn.values()].filter(e => e.owner === 0 && e.levy).length, back = armed.filter(id => W.ents.has(id) && W.ents.get(id).type === 'villager').length;
  ok(back >= 3, `survivors are villagers again (${back})`);
  ok(left === 0, `quiet again: the levies went back to work (${left} still armed)`);
  ok((W.chron || []).some(c => c.kind === 'levy') && (W.chron || []).some(c => c.kind === 'unlevy'), 'both told in the chronicle');
}
console.log(fails ? `${fails} levy check(s) FAILED` : 'all levy checks passed'); process.exit(fails ? 1 : 0);
