// Underground mines: villagers go down, dig the ore the mine is set to, carry it to town; 6 at a time; the deposit runs
// out and the mine caves in; the AI digs one when the ore round its towns is gone.   node tests/mines.test.js
import { generate } from '../js/map.js';
import { step, command, addUnit, addBuilding, nearestFree, damage } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { BUILDINGS } from '../js/data.js';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const run = (W, s, ais = []) => { for (let n = 0; n < s * 10; n++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; } };

{
  const W = generate({ size: 112, seed: 8, type: 'padang', opts: { night: 'off', life: false }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }] });
  const P = W.players[0]; P.exp.fill(1); P.age = 2;
  for (const e of [...W.ents.values()]) if (e.kind === 'res' && ['gold', 'stone', 'iron'].includes(e.type)) { W.ents.delete(e.id); W.dyn.delete(e.id); }     // no ore on the surface
  const tc = W.ents.get(P.tc), f = nearestFree(W, tc.x + 9, tc.y + 2, 0, 8);
  const m = addBuilding(W, 0, 'mine_shaft', f[0], f[1], true);
  check(m.left === BUILDINGS.mine_shaft.shaft && m.ore === 'gold', `a new mine holds ${m.left} ore, digging gold`);
  const vils = []; for (let k = 0; k < 9; k++) { const g = nearestFree(W, m.x - 1, m.y + 4, 0, 6); vils.push(addUnit(W, 0, 'villager', g[0] + 0.5, g[1] + 0.5)); }
  command(W, { t: 'smart', pid: 0, ids: vils.map(v => v.id), target: m.id, x: m.x + 1, y: m.y + 1 });
  run(W, 8);
  const under = vils.filter(v => v.inside === m.id).length;
  check(under === 6, `six miners went underground, the rest wait (${under} inside)`);
  const g0 = P.res.gold; run(W, 90);
  check(P.res.gold > g0 + 120, `gold carried to the town (+${Math.round(P.res.gold - g0)})`);
  check(m.left < BUILDINGS.mine_shaft.shaft, `the deposit shrinks (${Math.round(m.left)} left)`);
  command(W, { t: 'ore', pid: 0, bid: m.id, ore: 'stone' }); const s0 = P.res.stone; run(W, 90);
  check(P.res.stone > s0 + 100, `switched to stone: stone comes in (+${Math.round(P.res.stone - s0)})`);
  m.left = 20; run(W, 30);
  check(!W.ents.has(m.id), 'the exhausted mine caved in');
  check(vils.every(v => !v.inside), 'everyone came back up');
}
// ---- the AI digs a mine when the ore round its town is gone
{
  const W = generate({ size: 128, seed: 5, type: 'padang', players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red', ai: true }] });
  for (const e of [...W.ents.values()]) if (e.kind === 'res' && ['gold', 'stone', 'iron'].includes(e.type)) { W.ents.delete(e.id); W.dyn.delete(e.id); }
  const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
  let shafts = 0, miners = 0;
  let dug = 0;
  for (let m = 0; m < 45 && !(shafts && miners >= 3 && dug > 150); m++) {
    run(W, 60, ais);
    shafts = [...W.dyn.values()].filter(e => e.kind === 'building' && e.type === 'mine_shaft' && e.built).length;
    miners = [...W.dyn.values()].filter(e => e.kind === 'unit' && e.inside && W.ents.get(e.inside)?.type === 'mine_shaft').length;
    dug = Math.max(...W.players.map(p => p.stats.gres.gold + p.stats.gres.stone + p.stats.gres.iron));
  }
  check(shafts > 0, `the AI dug ${shafts} mine(s) by minute ${Math.round(W.t / 60)}`);
  check(miners >= 3, `its villagers work underground (${miners})`);
  check(dug > 150, `ore dug from its mines (${Math.round(dug)})`);
  console.log('     gold', W.players.map(p => Math.round(p.res.gold)), 'stone', W.players.map(p => Math.round(p.res.stone)), 'gathered gold', W.players.map(p => Math.round(p.stats.gres.gold)));
}
console.log(fails ? `${fails} mine checks FAILED` : 'all mine checks passed');
process.exit(fails ? 1 : 0);
