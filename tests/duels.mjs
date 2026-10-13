// Unit balance: equal-value armies of two unit types fight in the open (Castle Age, no upgrades). Prints a matrix of
// the share of value the row type has left when the fight ends (+ = row wins, - = column wins), and each type's
// average.   node tests/duels.mjs [budget] [age]
import { generate } from '../js/map.js';
import { step, command, addUnit, nearestFree, stat, unitCost } from '../js/sim.js';
import { UNITS } from '../js/data.js';
const BUDGET = +(process.argv[2] || 1000), AGE = +(process.argv[3] || 3);
const TYPES = ['militia', 'spearman', 'pikeman', 'samurai', 'ninja', 'archer', 'skirmisher', 'crossbow', 'fire_archer', 'gunner', 'scout', 'knight', 'cataphract', 'lancer', 'horse_archer', 'healer'].filter(t => UNITS[t]);
const val = (c) => (c.food || 0) + (c.wood || 0) + (c.gold || 0) * 1.3 + (c.stone || 0) + (c.iron || 0) * 1.5;
function fight(a, b) {
  const W = generate({ size: 112, seed: 5, type: 'padang', opts: { season: 'semi', night: 'off', life: false }, players: [{ name: 'A', color: 'blue' }, { name: 'B', color: 'red' }] });
  for (const P of W.players) { P.age = AGE; P.exp.fill(1); }
  for (const e of [...W.dyn.values()]) if (e.kind === 'unit') { W.ents.delete(e.id); W.dyn.delete(e.id); }      // no villagers / animals in the way
  // an open spot in the middle
  const cx = 56, cy = 56;
  const army = (pid, type, x) => { const v = val(unitCost(W.players[pid], type)), n = Math.max(1, Math.round(BUDGET / v)); const out = []; for (let k = 0; k < n; k++) { const f = nearestFree(W, x + (k % 3) * 0.8, cy - 4 + Math.floor(k / 3) * 0.8, pid, 10); out.push(addUnit(W, pid, type, f[0] + 0.5, f[1] + 0.5)); } return { out, n, v }; };
  const A = army(0, a, cx - 6), B = army(1, b, cx + 6);
  for (const u of [...A.out, ...B.out]) u.stance = 'agresif';
  const left = (s) => s.out.filter(u => W.ents.has(u.id)).reduce((t, u) => t + u.hp / u.maxHp, 0) / s.n;
  for (let i = 0; i < 1200; i++) {
    // keep them engaged: idle units walk at the enemy
    if (i % 20 === 0) for (const [s, o, pid] of [[A, B, 0], [B, A, 1]]) { const tgt = o.out.find(u => W.ents.has(u.id)); if (!tgt) break; const ids = s.out.filter(u => W.ents.has(u.id) && !u.order).map(u => u.id); if (ids.length) command(W, { t: 'move', pid, ids, x: tgt.x, y: tgt.y, amove: true }); }
    step(W); W.ev.length = 0;
    if (!A.out.some(u => W.ents.has(u.id)) || !B.out.some(u => W.ents.has(u.id))) break;
  }
  return left(A) - left(B);
}
const M = {};
for (const a of TYPES) { M[a] ||= {}; for (const b of TYPES) if (a < b || a === b) { const r = a === b ? 0 : fight(a, b); M[a][b] = r; (M[b] ||= {})[a] = -r; } }
const pad = (s, n) => String(s).padStart(n);
console.log(pad('', 13) + TYPES.map(t => pad(t.slice(0, 6), 7)).join('') + '   avg');
for (const a of TYPES) {
  const row = TYPES.map(b => M[a][b] ?? 0), avg = row.reduce((x, y) => x + y, 0) / (TYPES.length - 1);
  console.log(pad(a, 13) + row.map(v => pad((v >= 0 ? '+' : '') + v.toFixed(2), 7)).join('') + pad(avg.toFixed(2), 7));
}
