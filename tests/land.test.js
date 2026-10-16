// Bela Wilayah: a patrol or the town watch answers an enemy that sets foot on our land (and that we can see), even far
// outside its own sight; it leaves alone what is outside our land, keeps after an intruder while it is on our land, and
// goes back to its rounds afterwards.     node tests/land.test.js
import { generate } from '../js/map.js';
import { step, command, addUnit, nearestFree, townRing, LAND_R } from '../js/sim.js';

let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const world = () => {
  const W = generate({ size: 144, seed: 6, type: 'padang', opts: { season: 'semi', night: 'off', life: false }, players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red' }] });
  for (const P of W.players) { for (const r in P.res) P.res[r] = 20000; P.exp.fill(1); P.popCap = P.popRaw = P.popLim = 200; P.age = 2; }
  for (const e of [...W.dyn.values()]) if (e.kind === 'unit' && (e.owner === -1 || (e.owner === 1 && e.type !== 'villager'))) { W.ents.delete(e.id); W.dyn.delete(e.id); }     // no wolves, no scout of our own
  return W;
};
const unit = (W, pid, type, x, y) => { const f = nearestFree(W, x, y, pid, 10); return addUnit(W, pid, type, f[0] + 0.5, f[1] + 0.5); };
const run = (W, sec, each) => { const ev = []; for (let i = 0; i < sec * 10; i++) { step(W); ev.push(...W.ev); W.ev.length = 0; if (each && each()) break; } return ev; };
// a patrol on the west of our town, an enemy (that never fights back) somewhere, one of our villagers next to it so we see it
const scene = (dx, dy, opts = {}) => {
  const W = world(), tc = W.ents.get(W.players[1].tc), cx = tc.x + tc.w / 2, cy = tc.y + tc.h / 2;
  const s = unit(W, 1, 'spearman', cx - 12, cy);
  if (opts.stance) command(W, { t: 'stance', pid: 1, ids: [s.id], s: opts.stance });
  if (opts.guard) command(W, { t: 'patrol', pid: 1, ids: [s.id], pts: townRing(W, 1, 12, 8).filter(p => p[0] < cx), guard: true });
  else command(W, { t: 'patrol', pid: 1, ids: [s.id], x: cx - 12, y: cy + 3 });
  const foe = unit(W, 0, 'scout', cx + dx, cy + dy); foe.stance = 'pasif';
  unit(W, 1, 'villager', foe.x + 1.5, foe.y + 0.5);
  run(W, 0.5);
  return { W, s, foe, cx, cy, land: W.terr[Math.floor(foe.y) * W.size + Math.floor(foe.x)] === 2, far: Math.hypot(foe.x - s.x, foe.y - s.y) };
};

// ---- 1. an enemy on our land, far outside the patrol's sight: the patrol goes for it, says so, and kills it
{
  const { W, s, foe, land, far } = scene(11, 2);
  check(land && far > 12 && far < LAND_R, `the enemy stands on our land, ${far.toFixed(1)} tiles from the patrol (out of its sight)`);
  let went = false; const ev = run(W, 60, () => { if (s.order && s.order.t === 'attack' && s.order.id === foe.id && s.order.land) went = true; return !W.ents.has(foe.id); });
  check(went, 'the patrol answers the intruder');
  check(ev.some(e => e.k === 'intruder' && e.owner === 1 && e.foe === 0), 'the player hears that the patrol is on its way');
  check(!W.ents.has(foe.id), 'the intruder is beaten');
  run(W, 2); check(s.order && s.order.t === 'patrol', `then back to the rounds (${s.order && s.order.t})`);
}
// ---- 2. the town watch does the same
{
  const { W, s, foe } = scene(11, -3, { guard: true });
  let went = false; run(W, 20, () => { if (s.order && s.order.t === 'attack' && s.order.id === foe.id) went = true; return went; });
  check(went, 'the town watch answers an intruder across town');
}
// ---- 3. outside our land: none of the patrol's business
{
  const { W, s, foe, land, far } = scene(-12, 22);
  check(!land && far < LAND_R, `the enemy is near (${far.toFixed(1)} tiles) but outside our land`);
  let went = false; run(W, 20, () => { if (s.order && s.order.t === 'attack' && s.order.id === foe.id) went = true; });
  check(!went, 'the patrol keeps to its rounds');
}
// ---- 4. stand ground: the patrol stays put
{
  const { W, s, foe } = scene(11, 2, { stance: 'diam' });
  let went = false; run(W, 20, () => { if (s.order && s.order.t === 'attack' && s.order.id === foe.id) went = true; });
  check(!went, 'a patrol told to stand its ground does not leave it');
}
console.log(fail ? `\n${fail} FAILED` : '\nall land checks passed'); process.exit(fail ? 1 : 0);
