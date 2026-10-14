// Town watch (v11): waypoint patrols, the AI keeps a guard at home, a small raid is met by the guard alone, a big one
// brings the field army back.     node tests/guard.test.js
import { generate } from '../js/map.js';
import { step, command, addUnit, nearestFree, townRing } from '../js/sim.js';
import { AI } from '../js/ai.js';

let fail = 0; const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail++; };
const world = () => {
  const W = generate({ size: 144, seed: 6, type: 'padang', opts: { season: 'semi', night: 'off', life: false }, players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red' }] });
  for (const P of W.players) { for (const r in P.res) P.res[r] = 20000; P.exp.fill(1); P.popCap = P.popRaw = P.popLim = 200; P.age = 2; }
  for (const e of [...W.dyn.values()]) if (e.kind === 'unit' && e.owner === -1) { W.ents.delete(e.id); W.dyn.delete(e.id); }     // no wolves to distract the watch
  return W;
};
const run = (W, sec, ais = []) => { for (let i = 0; i < sec * 10; i++) { for (const a of ais) a.tick(); step(W); W.ev.length = 0; } };
const unit = (W, pid, type, x, y) => { const f = nearestFree(W, x, y, pid, 10); return addUnit(W, pid, type, f[0] + 0.5, f[1] + 0.5); };

// ---- 1. a patrol walks a loop of posts
{
  const W = world(); const pts = townRing(W, 1, 13, 8);
  const s = unit(W, 1, 'spearman', pts[0][0], pts[0][1]);
  command(W, { t: 'patrol', pid: 1, ids: [s.id], pts, guard: true });
  const seen = new Set(); for (let i = 0; i < 900; i++) { step(W); W.ev.length = 0; if (s.order && s.order.pts) seen.add(s.order.i); }
  check(pts.length >= 6 && seen.size >= 4, `town rounds: ${pts.length} posts, walked past ${seen.size} of them`);
}
// ---- 2-3. the AI keeps a watch; a small raid is the watch's job, a big one recalls the field army
for (const [n, big] of [[2, false], [14, true]]) {
  const W = world(); const ai = new AI(W, 0, 'hard'); run(W, 4, [ai]);
  const [bx, by] = ai.base, far = [bx + (W.size / 2 - bx) * 1.4, by + (W.size / 2 - by) * 1.4];
  const home = [], field = [];
  for (let k = 0; k < 4; k++) home.push(unit(W, 0, 'archer', bx + 4, by + 5 + k * 0.6));
  for (let k = 0; k < 10; k++) field.push(unit(W, 0, 'militia', far[0], far[1] + k * 0.6));
  run(W, 12, [ai]);
  const guard = ai.guard || new Set();
  if (!big) check(guard.size >= 2 && home.some(u => guard.has(u.id)), `the AI keeps ${guard.size} soldiers as the town watch (archers first)`);
  for (const u of field) { u.order = null; u.x = u.px = far[0] + (u.id % 3); }
  const raid = []; for (let k = 0; k < n; k++) raid.push(unit(W, 1, big ? 'knight' : 'militia', bx + 7, by - 7 + (k % 5) * 0.7));
  run(W, 3, [ai]);
  const back = field.filter(u => u.order && u.order.amove && Math.hypot(u.order.x - bx, u.order.y - by) < 20).length;
  if (big) check(back >= 5, `a big raid (${n} knights) brings the field army home (${back} of ${field.length} turned back)`);
  else check(back === 0 && home.some(u => u.order && (u.order.t === 'attack' || u.order.amove)), `a small raid (${n} militia) is left to the watch (${back} of the field army turned back)`);
}
console.log(fail ? `${fail} guard check(s) failed` : 'all guard checks passed');
if (fail) process.exit(1);
