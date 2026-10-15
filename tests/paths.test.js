// Pathfinding stress on big maps: hundreds of long trips between random walkable spots (dense forest, a great lake)
// never throw (a coarse-route fallback once recursed until the stack overflowed) and every path moves things forward.
//   node tests/paths.test.js [size] [trips]
import { generate } from '../js/map.js';
import { findPath, passable, rng } from '../js/sim.js';
const size = +(process.argv[2] || 560), trips = +(process.argv[3] || 700);      // (the old recursion showed on Pegunungan 560 at trip 632)
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
for (const type of ['rimba', 'danau', 'pegunungan']) {
  const W = generate({ size, seed: 11, type, players: [0, 1, 2, 3].map(i => ({ name: 'ABCD'[i], color: ['blue', 'red', 'green', 'yellow'][i], ai: true, team: i })) });
  const r = rng(5), spot = () => { for (;;) { const i = 4 + Math.floor(r() * (size - 8)), j = 4 + Math.floor(r() * (size - 8)); if (passable(W, i, j, 0)) return [i, j]; } };
  let thrown = null, via = 0, empty = 0, done = 0;
  for (let k = 0; k < trips && !thrown; k++) {
    const [a, b] = [spot(), spot()]; if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 60) { k--; continue; }
    try {
      const p = findPath(W, 0, a[0] + 0.5, a[1] + 0.5, (i, j) => i === b[0] && j === b[1], b[0] + 0.5, b[1] + 0.5);
      if (p.via) via++; if (!p.pts.length) empty++; done++;
    } catch (e) { thrown = e; }
    W.paths = 0; W.nodes = 0; W.t += 1;
  }
  ok(!thrown, `${W.map.name} ${size}: ${done} long trips, none threw${thrown ? ' — ' + thrown.message : ''} (${via} by the coarse route)`);
  ok(empty <= done * 0.05, `almost every trip gets a path to walk (${empty} empty)`);
}
console.log(fails ? `${fails} path check(s) FAILED` : 'all path checks passed'); process.exit(fails ? 1 : 0);
