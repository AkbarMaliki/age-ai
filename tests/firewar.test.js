// Fire spreads between wooden buildings (stone ones don't burn), villagers repairing put it out faster (a well helps),
// and a long stalemate ends in Perang Total (pacts dissolve, buildings take +50%).   node tests/firewar.test.js [seed]
import { generate } from '../js/map.js';
import { step, addBuilding, addUnit, command, passable, idx, dmgOf, pacted } from '../js/sim.js';
const seed = +(process.argv[2] || 4);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const world = () => generate({ size: 112, seed, type: 'padang', players: [0, 1, 2].map(i => ({ name: 'ABC'[i], color: ['blue', 'red', 'green'][i], ai: true, team: i })) });
const free = (W, i, j, n) => { for (let a = -1; a <= n; a++) for (let c = -1; c <= n; c++) if (!passable(W, i + a, j + c, 0) || W.occ[idx(W, i + a, j + c)]) return false; return true; };
const spot = (W, x, y, n) => { for (let r = 0; r < 30; r++) for (let a = 0; a < 24; a++) { const i = Math.round(x + Math.cos(a / 24 * 6.28) * r), j = Math.round(y + Math.sin(a / 24 * 6.28) * r); if (free(W, i, j, n)) return [i, j]; } };
const run = (W, s) => { for (let k = 0; k < s * 10; k++) { step(W); W.ev.length = 0; } };
// 1) a row of houses next to a burning one, a tower beside them
{
  const W = world(), [bx, by] = W.players[0].start;
  let spread = 0, tower = null;
  for (let r = 0; r < 6; r++) {
    const s0 = spot(W, bx + 10 + r * 9, by + 8, 5); if (!s0) continue;
    const a = addBuilding(W, 0, 'house', s0[0], s0[1], true), b = addBuilding(W, 0, 'house', s0[0] + 2, s0[1], true);
    if (!tower) tower = addBuilding(W, 0, 'watch_tower', s0[0], s0[1] + 2, true);
    a.burn = W.t + 1e4; a.burnBy = 1; a.maxHp = a.hp = 1e5;       // a fire that keeps burning
    run(W, 0.1); for (let k = 0; k < 40 && !(b.burn > W.t); k++) run(W, 1);
    if (b.burn > W.t) spread++;
  }
  ok(spread >= 3, `fire jumped to the next house (${spread} of 6 rows)`);
  ok(!(tower.burn > W.t), 'a stone tower beside the fire does not catch');
}
// 2) dousing: repairers shorten the fire, more with a well
{
  const t = [];
  for (const well of [false, true]) {
    const W = world(), [bx, by] = W.players[0].start, s0 = spot(W, bx + 14, by - 10, 4);
    const h = addBuilding(W, 0, "house", s0[0], s0[1], true); h.maxHp = 1e5; h.hp = 6e4; h.burn = W.t + 60; h.burnBy = 1;
    if (well) { const w = spot(W, s0[0] + 4, s0[1], 1); addBuilding(W, 0, 'well', w[0], w[1], true); }
    const vs = [0, 1, 2].map(k => addUnit(W, 0, 'villager', s0[0] - 1 + k * 0.5, s0[1] - 1));
    command(W, { t: 'smart', pid: 0, ids: vs.map(v => v.id), target: h.id, x: h.x, y: h.y });
    let s = 0; while (h.burn > W.t && s < 70) { run(W, 1); s++; }
    t.push(s);
  }
  ok(t[0] < 55, `villagers put the fire out sooner (${t[0]} s instead of 60)`);
  ok(t[1] < t[0], `faster still with a well nearby (${t[1]} s)`);
}
// 3) Perang Total after a long stalemate
{
  const W = world(); W.pact[0 * 8 + 1] = W.pact[1 * 8 + 0] = 10; run(W, 1);
  ok(pacted(W, 0, 1), 'a pact holds before the stalemate');
  W.t = 4700; W.lastProg = 0; run(W, 1.2);
  ok(!!W.totalWar && (W.chron || []).some(c => c.kind === 'totalwar'), 'twenty minutes without progress: Perang Total is declared');
  ok(!pacted(W, 0, 1), 'every pact dissolves');
  const [bx, by] = W.players[0].start, m = addUnit(W, 1, 'militia', bx, by), tc = [...W.dyn.values()].find(e => e.type === 'town_center' && e.owner === 0);
  const d1 = dmgOf(W, m, tc); W.totalWar = 0; const d0 = dmgOf(W, m, tc);
  ok(d1 > d0 * 1.4, `buildings take more damage in total war (${d1.toFixed(1)} vs ${d0.toFixed(1)})`);
}
console.log(fails ? `${fails} fire/war check(s) FAILED` : 'all fire/war checks passed'); process.exit(fails ? 1 : 0);
