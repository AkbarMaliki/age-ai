// Fishing boats keep working when the shoals by their dock run out: they sail to fish seen further away, idle boats
// look again, and the AI raises a dock by distant fish.     node tests/fishing.test.js
import { generate } from '../js/map.js';
import { step, command, addUnit, addBuilding, placementOk, nearestFree, alive, canBuild } from '../js/sim.js';
import { AI } from '../js/ai.js';

let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const W = generate({ size: 144, seed: 21, type: 'kepulauan', opts: { season: 'semi', night: 'off', life: false }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }] });
const P = W.players[0]; P.exp.fill(1); for (const r in P.res) P.res[r] = 5000;
const run = (sec, ais = []) => { for (let i = 0; i < sec * 10; i++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; } };
const fish = [...W.ents.values()].filter(e => e.kind === 'res' && e.type === 'fish');
// a dock on the coast next to a shoal
let dock = null, near = null;
for (const f of fish) { for (let r = 1; r < 6 && !dock; r++) for (let a = 0; a < 16 && !dock; a++) { const i = Math.round(f.x + Math.cos(a / 16 * 6.28) * r), j = Math.round(f.y + Math.sin(a / 16 * 6.28) * r); if (placementOk(W, 0, 'dock', i, j)) { dock = addBuilding(W, 0, 'dock', i, j, true); near = f; } } if (dock) break; }
const far = fish.filter(f => Math.hypot(f.x - dock.x, f.y - dock.y) > 22 && Math.hypot(f.x - dock.x, f.y - dock.y) < 55).sort((a, b) => Math.hypot(a.x - dock.x, a.y - dock.y) - Math.hypot(b.x - dock.x, b.y - dock.y))[0];
check(!!dock && !!far, `dock built by a shoal; another shoal ${far ? Math.round(Math.hypot(far.x - dock.x, far.y - dock.y)) : '?'} tiles away`);
// every shoal within 20 tiles of the dock is (nearly) fished out
for (const f of fish) if (Math.hypot(f.x - dock.x, f.y - dock.y) <= 20) f.amount = 3;
const boats = [0, 1, 2].map(k => { const s = nearestFree(W, dock.x + 1, dock.y + 1, 0, 6, true); return addUnit(W, 0, 'fishing_boat', s[0] + 0.5, s[1] + 0.5); });
command(W, { t: 'smart', pid: 0, ids: boats.map(b => b.id), target: near.id });
const outer = fish.filter(f => Math.hypot(f.x - dock.x, f.y - dock.y) > 20), sum = () => outer.reduce((a, f) => a + Math.max(0, f.amount), 0);
const f0 = P.res.food, a0 = sum(); run(240);
check(sum() < a0 - 20, `boats sailed out to shoals beyond the fished-out ones (${Math.round(a0 - sum())} food fished there)`);
check(P.res.food > f0 + 20, `and brought the catch home (+${Math.round(P.res.food - f0)} food)`);
// idle boats that have fished before look for work again
for (const b of boats) if (alive(W, b.id)) { b.order = null; b.path = null; }
run(5);
check(boats.filter(b => b.order && (b.order.t === 'gather' || b.order.t === 'drop')).length >= 2, 'idle fishing boats go back to fishing by themselves');
// the AI raises a new dock by distant fish when its own shoals are gone
{
  const ai = new AI(W, 0, 'normal'); const d0 = [...W.dyn.values()].filter(e => e.type === 'dock' && e.owner === 0).length;
  run(60, [ai]);
  const d1 = [...W.dyn.values()].filter(e => e.type === 'dock' && e.owner === 0).length;
  check(d1 > d0, `the AI placed a new dock by distant fish (${d0} -> ${d1})`);
}
// ---- winter: the water is ice all game, so nobody builds docks (the AI used to raise useless ones)
{
  const Wf = generate({ size: 144, seed: 21, type: 'kepulauan', opts: { season: 'salju', night: 'off', life: false }, players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red', ai: true }] });
  const ais = Wf.players.map((p, i) => new AI(Wf, i, 'hard'));
  check(!canBuild(Wf, 0, 'dock'), 'frozen water: a dock cannot be built');
  for (let n = 0; n < 12 * 600; n++) { for (const a of ais) a.tick(); step(Wf); Wf.ev.length = 0; }
  const docks = [...Wf.dyn.values()].filter(e => e.kind === 'building' && e.type === 'dock').length;
  check(docks === 0, `frozen winter: no AI docks after 12 minutes (${docks})`);
}
console.log(fail ? `${fail} fishing check(s) failed` : 'all fishing checks passed');
if (fail) process.exit(1);
