// Random land map ("Arabia/Arena"-like): grass with dirt patches, forests, a pond, per-player berries/gold/stone.
import { createWorld, addResource, addBuilding, addUnit, addTreasure, rng, idx } from './sim.js';
import { GAIA, TREASURES } from './data.js';

export const T_GRASS = 0, T_DIRT = 1, T_FOREST = 2, T_WATER = 3, T_GRASS2 = 4;

function noise2(r, size, scale) {
  const g = (size / scale | 0) + 2, v = new Float32Array(g * g);
  for (let k = 0; k < v.length; k++) v[k] = r();
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => { x /= scale; y /= scale; const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = v[j * g + i], b = v[j * g + i + 1], c = v[(j + 1) * g + i], d = v[(j + 1) * g + i + 1]; return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy; };
}

export function generate({ size = 80, players, seed = 7 }) {
  const r = rng(seed);
  const terrain = new Uint8Array(size * size);
  const n1 = noise2(r, size, 9), n2 = noise2(r, size, 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = n1(i, j) * 0.7 + n2(i, j) * 0.3;
    terrain[j * size + i] = v > 0.68 ? T_DIRT : v < 0.3 ? T_GRASS2 : T_GRASS;
  }
  const W = createWorld({ size, terrain, players, seed });
  const np = players.length;
  // start positions on a circle (screen left / right for 2 players)
  const starts = [];
  for (let p = 0; p < np; p++) {
    const a = (np === 2 ? Math.PI * 0.75 : Math.PI * 0.75) + p * 2 * Math.PI / np;
    starts.push([Math.round(size / 2 + Math.cos(a) * size * 0.32), Math.round(size / 2 + Math.sin(a) * size * 0.32)]);
  }
  const reserved = new Uint8Array(size * size);
  const reserve = (cx, cy, rad) => { for (let j = cy - rad; j <= cy + rad; j++) for (let i = cx - rad; i <= cx + rad; i++) if (i >= 0 && j >= 0 && i < size && j < size && Math.hypot(i - cx, j - cy) <= rad) reserved[j * size + i] = 1; };
  for (const [x, y] of starts) reserve(x, y, 12);
  // pond in the middle
  const pc = size / 2 + (r() - 0.5) * 6, pr = 4 + r() * 2;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const d = Math.hypot(i - pc, j - pc * 0.98) + (n2(i * 3, j * 3) - 0.5) * 3;
    if (d < pr) terrain[j * size + i] = T_WATER;
    else if (d < pr + 1.4 && terrain[j * size + i] !== T_WATER) terrain[j * size + i] = T_DIRT;
  }
  reserve(Math.round(pc), Math.round(pc), Math.ceil(pr + 2));
  const free = (i, j) => i >= 1 && j >= 1 && i < size - 1 && j < size - 1 && !W.occ[idx(W, i, j)] && terrain[idx(W, i, j)] !== T_WATER;
  const forest = (cx, cy, rad, dens = 0.92) => {
    for (let j = Math.floor(cy - rad); j <= cy + rad; j++) for (let i = Math.floor(cx - rad); i <= cx + rad; i++) {
      if (!free(i, j) || reserved[j * size + i]) continue;
      const d = Math.hypot(i - cx, j - cy) + (n2(i * 2, j * 2) - 0.5) * 3.5;
      if (d < rad && r() < dens) { addResource(W, 'tree', i, j, (r() * 3) | 0); terrain[j * size + i] = T_FOREST; }
    }
  };
  const cluster = (type, cx, cy, n) => {
    const placed = []; const q = [[Math.round(cx), Math.round(cy)]];
    while (q.length && placed.length < n) {
      const [i, j] = q.splice((r() * q.length) | 0, 1)[0];
      if (!free(i, j)) continue;
      addResource(W, type, i, j, (r() * 2) | 0); placed.push([i, j]);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) q.push([i + a, j + b]);
    }
    for (const [i, j] of placed) terrain[j * size + i] = T_DIRT;
  };
  // per-player resources
  starts.forEach(([sx, sy], p) => {
    const toC = Math.atan2(size / 2 - sy, size / 2 - sx);
    const at = (ang, d) => [sx + Math.cos(toC + ang) * d, sy + Math.sin(toC + ang) * d];
    const [bx, by] = at(1.2, 7); cluster('berry', bx, by, 6);
    const [gx, gy] = at(-1.0, 9); cluster('gold', gx, gy, 7);
    const [g2x, g2y] = at(2.6, 15); cluster('gold', g2x, g2y, 5);
    const [stx, sty] = at(-2.2, 10); cluster('stone', stx, sty, 6);
    // woodline behind the base + a smaller one to the side
    for (const [ang, d, rad] of [[Math.PI, 14, 6.5], [Math.PI * 0.55, 15, 4.5], [-Math.PI * 0.6, 16, 4]]) {
      const [fx, fy] = at(ang, d);
      for (let j = Math.floor(fy - rad); j <= fy + rad; j++) for (let i = Math.floor(fx - rad); i <= fx + rad; i++) if (i >= 0 && j >= 0 && i < size && j < size) reserved[j * size + i] = 0;
      forest(fx, fy, rad);
    }
    for (let k = 0; k < 6; k++) { const a = r() * 6.28, d = 9 + r() * 4; const i = Math.round(sx + Math.cos(a) * d), j = Math.round(sy + Math.sin(a) * d); if (free(i, j) && Math.hypot(i - bx, j - by) > 2) addResource(W, 'tree', i, j, (r() * 3) | 0); }
  });
  // big forests across the map + a few loose trees
  const area = (size / 80) ** 2;
  for (let k = 0; k < Math.round(14 * area); k++) forest(4 + r() * (size - 8), 4 + r() * (size - 8), 3 + r() * 5, 0.85);
  for (let k = 0; k < Math.round(60 * area); k++) { const i = (r() * size) | 0, j = (r() * size) | 0; if (free(i, j) && !reserved[j * size + i]) addResource(W, 'tree', i, j, (r() * 3) | 0); }
  // extra neutral gold/stone around the middle (more on bigger maps)
  for (let k = 0; k < 2 + Math.round(2 * (area - 1)); k++) { const a = r() * 6.28, d = size * (0.12 + r() * 0.12); cluster(k % 2 ? 'stone' : 'gold', size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, 6); }
  // towns
  starts.forEach(([sx, sy], p) => {
    const tc = addBuilding(W, p, 'town_center', sx - 2, sy - 2, true);
    for (let k = 0; k < 3; k++) addUnit(W, p, 'villager', sx - 1.5 + k * 1.2, sy + 3.0);
    addUnit(W, p, 'scout', sx + 3.2, sy + 1.0);
    W.players[p].start = [sx, sy]; W.players[p].tc = tc.id;
  });
  // ---- wildlife (AoE2): sheep to herd, boar + deer to hunt, wolves to fear
  const spot = (cx, cy, R, tries = 30) => {
    for (let k = 0; k < tries; k++) { const a = r() * 6.28, d = R * Math.sqrt(r()); const i = Math.floor(cx + Math.cos(a) * d), j = Math.floor(cy + Math.sin(a) * d); if (free(i, j)) return [i + 0.5, j + 0.5]; }
    return null;
  };
  const farFromBases = (x, y, m) => starts.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > m);
  const herd = (type, owner, cx, cy, n, R = 1.6) => { for (let k = 0; k < n; k++) { const s = spot(cx, cy, R); if (s) addUnit(W, owner, type, s[0], s[1]); } };
  starts.forEach(([sx, sy], p) => {
    const toC = Math.atan2(size / 2 - sy, size / 2 - sx);
    const at = (ang, d) => [sx + Math.cos(toC + ang) * d, sy + Math.sin(toC + ang) * d];
    herd('sheep', p, ...at(0.5, 5.5), 4);                                      // starting sheep under the TC
    for (const ang of [1.6 + r(), -1.6 - r()]) herd('sheep', GAIA, ...at(ang, 13 + r() * 5), 2);
    for (const ang of [2.4 + r() * 0.5, -2.2 - r() * 0.5]) herd('boar', GAIA, ...at(ang, 14 + r() * 3), 1, 1);
    herd('deer', GAIA, ...at(r() < 0.5 ? 1.3 : -1.3, 20 + r() * 4), 4, 2.4);
  });
  const wolves = Math.round(starts.length * 1.5 * Math.sqrt(area));
  for (let k = 0, n = 0; k < 200 && n < wolves; k++) {
    const x = 4 + r() * (size - 8), y = 4 + r() * (size - 8);
    if (!farFromBases(x, y, 22)) continue;
    herd('wolf', GAIA, x, y, 2, 1.5); n++;
  }
  // ---- treasures (AoE3): guarded by bandits, wolves or a bear
  const amount = (t) => { const [lo, hi] = TREASURES[t].amount; return Math.round((lo + r() * (hi - lo)) / 10) * 10; };
  const treasure = (x, y, type, guards) => {
    const s = spot(x, y, 2); if (!s) return;
    const tr = addTreasure(W, type, Math.floor(s[0]), Math.floor(s[1]), amount(type));
    for (const g of guards) { const q = spot(s[0], s[1], 2.2); if (q) { const u = addUnit(W, GAIA, g, q[0], q[1]); u.home = [s[0], s[1]]; tr.guards.push(u.id); } }
  };
  starts.forEach(([sx, sy]) => {
    const toC = Math.atan2(size / 2 - sy, size / 2 - sx);
    for (const [ang, d, type, guards] of [[0.9 + r() * 0.6, 20 + r() * 6, 'food', ['wolf', 'wolf']], [-0.9 - r() * 0.6, 24 + r() * 6, 'wood', ['bandit', 'bandit']]])
      treasure(sx + Math.cos(toC + ang) * d, sy + Math.sin(toC + ang) * d, type, guards);
  });
  const mid = 2 + Math.round(2 * Math.sqrt(area));
  for (let k = 0, n = 0; k < 100 && n < mid; k++) {
    const a = r() * 6.28, d = size * (0.08 + r() * 0.3), x = size / 2 + Math.cos(a) * d, y = size / 2 + Math.sin(a) * d;
    if (!farFromBases(x, y, 26)) continue;
    const pick = n % 3; treasure(x, y, ['gold', 'stone', 'gold'][pick], [['bear'], ['bandit', 'bandit', 'bandit'], ['bandit', 'bandit', 'wolf']][pick]); n++;
  }
  for (const P of W.players) P.stats.units = 0;     // count only units trained during the game
  return W;
}
