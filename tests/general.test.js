// The general (Panglima): one of a kind, inspires soldiers near him; outnumbered wounded soldiers break and run;
// when he falls his men near him break.   node tests/general.test.js [seed]
import { generate } from '../js/map.js';
import { step, addUnit, nearestFree, canTrain, dmgOf, damage } from '../js/sim.js';
const seed = +(process.argv[2] || 4);
const W = generate({ size: 112, seed, type: 'padang', players: [0, 1].map(i => ({ name: ['Biru', 'Merah'][i], color: ['blue', 'red'][i], ai: true, team: i })) });
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const run = (s) => { for (let k = 0; k < s * 10; k++) { step(W); W.ev.length = 0; } };
for (const P of W.players) P.age = 3;
const [bx, by] = W.players[0].start, at = (dx, dy, o) => { const f = nearestFree(W, bx + dx, by + dy, o, 6); return [f[0] + 0.5, f[1] + 0.5]; };
ok(canTrain(W, 0, 'general'), 'a general can be trained in the Castle Age');
const g = addUnit(W, 0, 'general', ...at(12, 0, 0));
ok(!canTrain(W, 0, 'general'), 'only one general at a time');
const near = addUnit(W, 0, 'militia', ...at(13, 1, 0)), far = addUnit(W, 0, 'militia', ...at(-14, -12, 0)), target = addUnit(W, 1, 'militia', ...at(16, 2, 1));
run(1);
ok(near.insp > W.t && !(far.insp > W.t), 'soldiers near the general are inspired, far ones are not');
ok(dmgOf(W, near, target) > dmgOf(W, far, target), `inspired soldiers hit harder (${dmgOf(W, near, target).toFixed(1)} vs ${dmgOf(W, far, target).toFixed(1)})`);
// a lone wounded soldier among many enemies breaks
const lone = addUnit(W, 0, 'spearman', ...at(-20, 14, 0)); lone.hp = lone.maxHp * 0.3;
for (let k = 0; k < 8; k++) addUnit(W, 1, 'knight', ...at(-18 + (k % 3), 15 + (k >> 2), 1));
let routed = false; for (let s = 0; s < 40 && lone.hp > 0 && !routed; s++) { lone.hitT = W.t; run(0.5); routed = lone.routUntil > W.t; }
ok(routed, 'a wounded soldier badly outnumbered breaks and runs');
// the general falls: men near him break
const men = []; for (let k = 0; k < 12; k++) { const u = addUnit(W, 0, 'militia', ...at(12 + (k % 4), 3 + (k >> 2), 0)); men.push(u); }
run(0.3); let ev = null; W.ev.length = 0;            // (the unit grid is rebuilt each tick)
damage(W, g, 9999, { owner: 1, kind: 'melee' });
for (const e of W.ev) if (e.k === 'generaldie') ev = e; W.ev.length = 0;
const broke = men.filter(u => u.routUntil > W.t - 1).length;
ok(ev && ev.name, `the general's death is announced (${ev && ev.name})`);
ok(broke >= 2, `men near the fallen general broke (${broke} of 12)`);
console.log(fails ? `${fails} general check(s) FAILED` : 'all general checks passed'); process.exit(fails ? 1 : 0);
