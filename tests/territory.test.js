// Territory and expansion (v12): land claimed by Town Centers / castles / outposts, no houses in enemy land (forward
// military bases allowed), +10% gathering at home, one Town Center per age, the AI founds new towns (and colonies by
// ship on the islands).     node tests/territory.test.js
import { generate } from '../js/map.js';
import { step, command, addUnit, addBuilding, placementOk, canBuild, nearestFree, regionAt } from '../js/sim.js';
import { AI } from '../js/ai.js';

let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const world = (type = 'padang', seed = 4, size = 144) => {
  const W = generate({ size, seed, type, opts: { season: 'semi', night: 'off', life: false }, players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red', ai: true }] });
  for (const P of W.players) { for (const r in P.res) P.res[r] = 20000; P.exp.fill(1); P.popCap = P.popRaw = P.popLim = 200; }
  return W;
};
const run = (W, sec, ais = []) => { for (let i = 0; i < sec * 10; i++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; } };
const tcOf = (W, pid) => W.ents.get(W.players[pid].tc);
const spot = (W, pid, type, x, y, r0 = 0) => { for (let r = r0; r < 30; r++) for (let a = 0; a < 24; a++) { const i = Math.round(x + Math.cos(a / 24 * 6.283) * r), j = Math.round(y + Math.sin(a / 24 * 6.283) * r); if (placementOk(W, pid, type, i, j)) return [i, j]; } return null; };

// ---- 1. territory round the Town Centers; no houses in enemy land, a forward barracks is fine
{
  const W = world(); run(W, 1);
  const tc = tcOf(W, 0), k = (tc.y + 2) * W.size + tc.x + 2;
  check(W.terr && W.terr[k] === 1 && W.players[0].terrN > 600, `A holds the land round its Town Center (${W.players[0].terrN} tiles)`);
  let houseOk = false, barracksOk = false;
  for (let r = 6; r < 15; r++) for (let a = 0; a < 16; a++) { const i = Math.round(tc.x + 2 + Math.cos(a / 16 * 6.283) * r), j = Math.round(tc.y + 2 + Math.sin(a / 16 * 6.283) * r); if (W.terr[j * W.size + i] !== 1) continue; if (placementOk(W, 1, 'house', i, j)) houseOk = true; if (placementOk(W, 1, 'barracks', i, j)) barracksOk = true; }
  check(!houseOk && barracksOk, 'B may not build houses in A\'s land, but may raise a forward barracks there');
}
// ---- 2. gathering is faster at home
{
  const W = world(); run(W, 1); const P = W.players[0], tc = tcOf(W, 0);
  const trees = [...W.ents.values()].filter(e => e.kind === 'res' && e.type === 'tree');
  const inT = trees.find(t => W.terr[t.y * W.size + t.x] === 1), outT = trees.find(t => !W.terr[t.y * W.size + t.x] && regionAt(W, t.x + 0.5, t.y + 1.5) === regionAt(W, tc.x, tc.y + 5));
  const gather = (t) => { const f = nearestFree(W, t.x, t.y, 0, 3); const v = addUnit(W, 0, 'villager', f[0] + 0.5, f[1] + 0.5); command(W, { t: 'smart', pid: 0, ids: [v.id], target: t.id }); run(W, 20); const n = (v.carry && v.carry.n) || 0; return n; };
  const a = gather(inT), b = gather(outT);
  check(a > b, `a woodcutter in our own land carries more in 20 s (${a.toFixed(1)} vs ${b.toFixed(1)})`);
}
// ---- 3. one Town Center per age; an outpost claims land
{
  const W = world(); run(W, 1); const P = W.players[0];
  check(!canBuild(W, 0, 'town_center'), 'Dark Age: only the one Town Center');
  P.age = 2; check(canBuild(W, 0, 'town_center'), 'Feudal Age: a second Town Center may be founded');
  const tc = tcOf(W, 0), C = W.size / 2, d = Math.hypot(C - tc.x, C - tc.y), sx = tc.x + (C - tc.x) / d * 26, sy = tc.y + (C - tc.y) / d * 26;
  const before = P.terrN, s = spot(W, 0, 'outpost', sx, sy); addBuilding(W, 0, 'outpost', s[0], s[1], true); run(W, 1.2);
  check(P.terrN > before + 150, `an outpost claims more land (${before} -> ${P.terrN})`);
}
// ---- 4. the AI founds a second town by rich land
{
  const W = generate({ size: 160, seed: 3, type: 'padang', players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red', ai: true }] });
  const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
  let tcs = 0, posts = 0; for (let n = 0; n < 35 * 600 && tcs < 2; n++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; if (n % 600 === 0) { tcs = Math.max(...[0, 1].map(p => [...W.dyn.values()].filter(e => e.owner === p && e.type === 'town_center').length)); posts = [...W.dyn.values()].filter(e => e.type === 'outpost').length; } }
  check(tcs >= 2 && posts >= 1, `the AI expands: a second Town Center (${tcs}) and border posts (${posts}) by minute ${Math.round(W.t / 60)}`);
}
// ---- 5. islands: settlers sail to another island and found a town
{
  const W = world('kepulauan', 21, 144); run(W, 1); const P = W.players[0]; P.age = 2;
  const ai = new AI(W, 0, 'normal'); run(W, 2, [ai]);
  const site = ai.expansionSite(true);
  const dock = (() => { const c = ai.coast(ai.base); const s = spot(W, 0, 'dock', c[0], c[1]); return addBuilding(W, 0, 'dock', s[0], s[1], true); })();
  const f = nearestFree(W, dock.x + 1, dock.y + 1, 0, 6, true); addUnit(W, 0, 'transport_ship', f[0] + 0.5, f[1] + 0.5);
  for (let k = 0; k < 5; k++) { const v = nearestFree(W, ai.base[0], ai.base[1] + 4, 0, 6); addUnit(W, 0, 'villager', v[0] + 0.5, v[1] + 0.5); }
  run(W, 1, [ai]);
  const vils = [...W.dyn.values()].filter(u => u.owner === 0 && u.type === 'villager');
  check(!!site, `a site for a colony on another island (${site})`);
  if (site) {
    ai.startColony(site, vils);
    let colony = null; for (let n = 0; n < 240 * 10 && !colony; n++) { ai.tick(); step(W); for (const e of W.ev) if (e.k === 'colonyland') colony = e; W.ev.length = 0; }
    const home = regionAt(W, ai.base[0], ai.base[1] + 3);
    const tc2 = [...W.dyn.values()].find(e => e.owner === 0 && e.type === 'town_center' && regionAt(W, e.x + 2, e.y + 5) !== home);
    check(!!colony && !!tc2, `settlers landed on another island and laid out a Town Center (${tc2 ? 'at ' + tc2.x + ',' + tc2.y : 'none'})`);
  }
}
console.log(fail ? `${fail} territory check(s) failed` : 'all territory checks passed');
if (fail) process.exit(1);
