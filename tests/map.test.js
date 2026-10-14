// Map generator check: every map type x player count -> per-player home resources, seat positions, generation time.
//   node tests/map.test.js [seeds=3]      env SIZES=224,288,360,440,560 for the menu sizes
import { generate, MAP_KEYS, homeResources } from '../js/map.js';
import { passable } from '../js/sim.js';
const seeds = +(process.argv[2] || 3);
let worstGap = 0, cut = 0;
// can every town walk to the first one? (8-dir flood fill over passable tiles, starting just below each town centre)
const linked = (W) => { const S = W.size, seen = new Uint8Array(S * S), [x0, y0] = W.players[0].start, q = [(y0 + 3) * S + x0]; seen[q[0]] = 1;
  for (let h = 0; h < q.length; h++) { const i = q[h] % S, j = (q[h] / S) | 0; for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const k = (j + b) * S + i + a; if (!seen[k] && passable(W, i + a, j + b) && passable(W, i + a, j) && passable(W, i, j + b)) { seen[k] = 1; q.push(k); } } }
  return W.players.every(P => seen[(P.start[1] + 3) * S + P.start[0]]); };
for (const type of MAP_KEYS) for (const np of [2, 3, 4]) for (let s = 1; s <= seeds; s++) {
  const size = (process.env.SIZES ? process.env.SIZES.split(',').map(Number) : [112, 144, 180])[s % (process.env.SIZES ? process.env.SIZES.split(',').length : 3)], t0 = performance.now();      // SIZES=224,288,... to check the menu sizes
  const W = generate({ size, seed: s * 7919 + np, type, players: Array.from({ length: np }, (_, i) => ({ name: 'P' + i, color: 'c' + i })) });
  const ms = performance.now() - t0;
  const home = W.players.map(P => homeResources(W, P.start[0], P.start[1]));
  const gap = {}; const ok = W.map.water === 'islands' ? W.frozen || !linked(W) : linked(W);     // winter ice may join islands if (!ok) cut++;
  for (const k of ['wood', 'gold', 'stone', 'food', 'iron']) { const v = home.map(h => h[k]); gap[k] = Math.round(100 * (1 - Math.min(...v) / Math.max(...v))); worstGap = Math.max(worstGap, gap[k]); if (gap[k] > 20) console.log('   !! gap', type, np, size, k, gap[k]); }
  console.log(`${type.padEnd(8)} ${np}p ${size} ${ms.toFixed(0).padStart(4)}ms seats ${W.players.map(P => P.start.join(',')).join(' ')}  wood ${home.map(h => h.wood / 100).join('/')} gold ${home.map(h => h.gold).join('/')} stone ${home.map(h => h.stone).join('/')} food ${home.map(h => h.food).join('/')} iron ${home.map(h => h.iron).join('/')}  gap% ${JSON.stringify(gap)}${ok ? '' : (W.map.water === 'islands' ? '  !! ISLANDS TOUCH' : '  !! TOWNS NOT CONNECTED')}`);
}
console.log('worst per-resource gap between players:', worstGap + '%', '| maps with cut-off towns:', cut);
if (worstGap > 25 || cut) process.exit(1);
