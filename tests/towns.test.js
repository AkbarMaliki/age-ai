// Expansion towns: every Town Center after the first raises the population limit, and the AI grows its new towns
// (houses, camps, fields, a well...) instead of leaving a lone Town Center.   node tests/towns.test.js
import { generate } from '../js/map.js';
import { step, addBuilding, nearestFree, popLimit, canBuild, damage } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { TOWN_POP } from '../js/data.js';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
const run = (W, s, ais = []) => { for (let n = 0; n < s * 10; n++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; } };
const tcsOf = (W, p) => [...W.dyn.values()].filter(e => e.kind === 'building' && e.owner === p && e.type === 'town_center' && e.built);

// ---- 1. the limit grows with every new town, and shrinks when a town falls
{
  const W = generate({ size: 128, seed: 4, type: 'padang', opts: { popLimit: 125 }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }] });
  run(W, 1); const P = W.players[0], base = popLimit(W, P);
  check(base === 125 && P.popLim === 125, `one town: limit ${P.popLim}`);
  for (let k = 0; k < 40; k++) { const f = nearestFree(W, 30 + (k % 8) * 3, 30 + Math.floor(k / 8) * 3, 0, 6); addBuilding(W, 0, 'house', f[0], f[1], true); }
  check(P.popCap === 125, `40 more houses still stop at the limit (${P.popCap}, room ${P.popRaw})`);
  const f = nearestFree(W, 90, 40, 0, 10); const t2 = addBuilding(W, 0, 'town_center', f[0], f[1], true); run(W, 0.2);
  check(P.popLim === 125 + TOWN_POP && P.popCap === 125 + TOWN_POP, `a second town: limit ${P.popLim}, cap ${P.popCap}`);
  damage(W, t2, 1e6); run(W, 0.5);
  check(P.popLim === 125 && P.popCap === 125, `the town falls: limit back to ${P.popLim}`);
  P.age = 4; check(canBuild(W, 0, 'town_center'), 'Imperial Age: more towns allowed');
}
// ---- 2. the AI's new town is built up
{
  const W = generate({ size: 160, seed: 3, type: 'padang', players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red', ai: true }] });
  const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
  let best = null;
  for (let m = 0; m < 50 && !best; m++) {
    run(W, 60, ais);
    for (const p of [0, 1]) {
      const tcs = tcsOf(W, p); if (tcs.length < 2) continue;
      const main = W.players[p].tc, town = tcs.find(t => t.id !== main) || tcs[1];
      const near = [...W.dyn.values()].filter(e => e.owner === p && e.kind === 'building' && e !== town && Math.hypot(e.x - town.x - 2, e.y - town.y - 2) < 20);
      const folk = [...W.dyn.values()].filter(e => e.owner === p && e.type === 'villager' && Math.hypot(e.x - town.x - 2, e.y - town.y - 2) < 22).length;
      if (W.t - (town.bornT ??= W.t) > 600) best = { p, near, folk, lim: W.players[p].popLim, pop: W.players[p].pop };
    }
  }
  check(!!best, `a second town stood for 10 minutes (minute ${Math.round(W.t / 60)})`);
  if (best) {
    const kinds = {}; for (const b of best.near) kinds[b.type] = (kinds[b.type] || 0) + 1;
    console.log('     around the new town:', JSON.stringify(kinds), `| villagers there ${best.folk} | pop ${best.pop}/${best.lim}`);
    check(best.near.length >= 6 && (kinds.house || 0) >= 2, `the new town has ${best.near.length} buildings round it`);
    check(best.folk >= 4, `people live and work in the new town (${best.folk})`);
    check(best.lim > (W.opts.popLimit || 125), `the kingdom's limit grew (${best.lim})`);
  }
}
console.log(fails ? `${fails} town checks FAILED` : 'all town checks passed');
process.exit(fails ? 1 : 0);
