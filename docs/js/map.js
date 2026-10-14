// Random land maps. Every game rolls a map type (open plains, dense forest, big lake, river valley, rich mines), a random
// rotation and a random seat for each player. Fairness: each player's home resources follow one shared, randomly rolled
// layout (relative to the direction of the map centre), the map-wide features are copied around the centre once per
// seat (rotational symmetry), and a final pass tops up any player that still ends up short of wood, gold, stone or food.
import { createWorld, addResource, addBuilding, addUnit, addTreasure, addRelic, addMonument, rng, idx, del } from './sim.js?v=20261014113000';
import { GAIA, TREASURES, RESOURCES, UNITS, TER, SEASONS, CIVS } from './data.js?v=20261014113000';

export const T_GRASS = TER.GRASS, T_DIRT = TER.DIRT, T_FOREST = TER.FOREST, T_WATER = TER.WATER, T_GRASS2 = TER.GRASS2, T_HILL = TER.HILL, T_ROCK = TER.ROCK;

// forests / loose = per 80x80 of map area, hunt / mid / wolves / treasures = multipliers, wood = home woodline size
export const MAP_TYPES = {
  padang: { name: 'Padang Terbuka', desc: 'Lapang, hutan kecil tersebar, banyak buruan.', forests: 10, forestR: [2.5, 5], loose: 80, water: 'ponds', hunt: 1.4, mid: 1, wolves: 1.2, treasures: 1.2, wood: 1, dirt: 0.64, grass2: 0.33 },
  rimba: { name: 'Rimba Lebat', desc: 'Hutan rapat di mana-mana, kayu melimpah, jalur sempit.', forests: 24, forestR: [4, 8], loose: 140, water: 'none', hunt: 0.8, mid: 0.7, wolves: 1.5, treasures: 1, wood: 1.25, dirt: 0.74, grass2: 0.42 },
  danau: { name: 'Danau Besar', desc: 'Danau luas di tengah peta memaksa jalan memutar.', forests: 13, forestR: [3, 6], loose: 70, water: 'lake', hunt: 1.1, mid: 1, wolves: 1, treasures: 1, wood: 1, dirt: 0.68, grass2: 0.3 },
  sungai: { name: 'Lembah Sungai', desc: 'Sungai memisahkan para pemain; seberangi lewat arungan dangkal.', forests: 13, forestR: [3, 6], loose: 70, water: 'river', hunt: 1, mid: 1, wolves: 1, treasures: 1.1, wood: 1, dirt: 0.7, grass2: 0.35 },
  tambang: { name: 'Bukit Tambang', desc: 'Emas dan batu melimpah di tengah — wilayah rebutan.', forests: 12, forestR: [3, 6], loose: 60, water: 'ponds', hunt: 0.9, mid: 2.6, wolves: 1, treasures: 1.3, wood: 0.9, dirt: 0.58, grass2: 0.3, rich: true, hills: 3 },
  pegunungan: { name: 'Pegunungan', desc: 'Punggung gunung tak bisa dilewati, hanya lewat celah. Bukit memberi keuntungan tempat tinggi.', forests: 11, forestR: [3, 6], loose: 70, water: 'ponds', hunt: 1, mid: 1.2, wolves: 1.2, treasures: 1.2, wood: 1, dirt: 0.66, grass2: 0.36, hills: 6, ridges: true },
  kepulauan: { name: 'Kepulauan', desc: 'Setiap kerajaan di pulaunya sendiri. Bangun Dermaga dan Kapal Angkut untuk menyerang!', forests: 9, forestR: [3, 5], loose: 50, water: 'islands', hunt: 0.9, mid: 0.8, wolves: 0.6, treasures: 0.8, wood: 1, dirt: 0.7, grass2: 0.33, fish: 2 },
};
export const MAP_KEYS = Object.keys(MAP_TYPES);

function noise2(r, size, scale) {
  const g = (size / scale | 0) + 2, v = new Float32Array(g * g);
  for (let k = 0; k < v.length; k++) v[k] = r();
  const s = (t) => t * t * (3 - 2 * t);
  // wraps around, so stretched lookups (x * 2, x * 3) stay inside the grid instead of returning NaN
  return (x, y) => { x /= scale; y /= scale; const fx = s(x - Math.floor(x)), fy = s(y - Math.floor(y)), m = g - 1, i = ((Math.floor(x) % m) + m) % m, j = ((Math.floor(y) % m) + m) % m;
    const a = v[j * g + i], b = v[j * g + i + 1], c = v[(j + 1) * g + i], d = v[(j + 1) * g + i + 1]; return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy; };
}

export function generate({ size = 80, players, seed = 7, type = 'random', opts = {} }) {
  const r = rng(seed);
  const key = MAP_TYPES[type] ? type : MAP_KEYS[(r() * MAP_KEYS.length) | 0], M = MAP_TYPES[key];
  const seasonKey = SEASONS[opts.season] ? opts.season : Object.keys(SEASONS)[(r() * 4) | 0], SE = SEASONS[seasonKey];
  const U = (a, b) => a + r() * (b - a);
  const terrain = new Uint8Array(size * size);
  const n1 = noise2(r, size, 9), n2 = noise2(r, size, 4);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = n1(i, j) * 0.7 + n2(i, j) * 0.3;
    terrain[j * size + i] = v > M.dirt ? T_DIRT : v < M.grass2 ? T_GRASS2 : T_GRASS;
  }
  const W = createWorld({ size, terrain, players, seed, opts: { ...opts, season: seasonKey } });
  const np = players.length, C = size / 2, step = 2 * Math.PI / np, area = (size / 80) ** 2;
  // seats on a circle with a random rotation; players get a random seat
  const a0 = r() * Math.PI * 2, R0 = size * U(0.3, 0.35);
  const polar = (q, rel, d) => [C + Math.cos(a0 + q * step + rel) * d, C + Math.sin(a0 + q * step + rel) * d];
  const seats = [...Array(np).keys()];
  for (let k = np - 1; k > 0; k--) { const m = (r() * (k + 1)) | 0; [seats[k], seats[m]] = [seats[m], seats[k]]; }
  const starts = seats.map(q => polar(q, 0, R0).map(Math.round));
  const inMap = (x, y, m = 3) => x >= m && y >= m && x < size - m && y < size - m;
  const reserved = new Uint8Array(size * size);
  const reserve = (cx, cy, rad, v = 1) => { for (let j = Math.floor(cy - rad); j <= cy + rad; j++) for (let i = Math.floor(cx - rad); i <= cx + rad; i++) if (i >= 0 && j >= 0 && i < size && j < size && Math.hypot(i - cx, j - cy) <= rad) reserved[j * size + i] = v; };
  for (const [x, y] of starts) reserve(x, y, 12);

  // ---- water
  const paintWater = (cx, cy, rad, shore = 1.4) => {
    for (let j = Math.floor(cy - rad - 3); j <= cy + rad + 3; j++) for (let i = Math.floor(cx - rad - 3); i <= cx + rad + 3; i++) {
      if (i < 0 || j < 0 || i >= size || j >= size || reserved[j * size + i] === 2) continue;
      const d = Math.hypot(i - cx, j - cy) + (n2(i * 3, j * 3) - 0.5) * 3;
      if (d < rad) terrain[j * size + i] = T_WATER; else if (d < rad + shore && terrain[j * size + i] !== T_WATER) terrain[j * size + i] = T_DIRT;
    }
    reserve(cx, cy, rad + 2);
  };
  if (M.water === 'ponds') {
    if (r() < 0.6) paintWater(C + U(-3, 3), C + U(-3, 3), U(3.5, 5.5));
    const rel = U(0.35, 0.65) * step, d = size * U(0.22, 0.4), rad = U(2.5, 3.8);
    for (let q = 0; q < np; q++) { const [x, y] = polar(q, rel, d); if (inMap(x, y, 6)) paintWater(x, y, rad); }
  } else if (M.water === 'lake') paintWater(C + U(-2, 2), C + U(-2, 2), size * U(0.11, 0.15), 2);
  else if (M.water === 'islands') {
    const Ri = size * Math.min(0.24, 0.26 * Math.sin(Math.PI / np)), land = new Uint8Array(size * size);
    const disk = (cx, cy, rad, keepOff = 0) => { for (let j = Math.floor(cy - rad - 3); j <= cy + rad + 3; j++) for (let i = Math.floor(cx - rad - 3); i <= cx + rad + 3; i++) if (i >= 0 && j >= 0 && i < size && j < size && Math.hypot(i - cx, j - cy) + (n2(i * 3, j * 3) - 0.5) * 4 < rad && (!keepOff || starts.every(([x, y]) => Math.hypot(i - x, j - y) > keepOff))) land[j * size + i] = 1; };
    for (const [x, y] of starts) disk(x, y, Ri);
    const isl = 1 + Math.round(np * Math.sqrt(area) * 0.5);           // small neutral islets with mines between the players
    for (let q = 0; q < np; q++) { const rel = step / 2, d = size * 0.2; const [x, y] = polar(q, rel, d); if (isl > 1 && inMap(x, y, 8)) disk(x, y, size * 0.06, Ri + 6); }     // islets never touch a player's island
    for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) { const k = j * size + i; if (!land[k]) { terrain[k] = T_WATER; reserved[k] = Math.max(reserved[k], 1); } else if (terrain[k] === T_WATER) terrain[k] = T_DIRT; }
    // sandy shores
    for (let j = 1; j < size - 1; j++) for (let i = 1; i < size - 1; i++) { const k = j * size + i; if (land[k] && (!land[k - 1] || !land[k + 1] || !land[k - size] || !land[k + size])) terrain[k] = T_DIRT; }
  }
  else if (M.water === 'river') {
    // one river arm between each pair of neighbouring seats, from the centre to the map edge; shallow fords cross it
    const half = U(2.1, 2.8), amp = U(1.5, 3.5), freq = U(0.08, 0.16), ph = r() * 6.28;
    const fords = size >= 144 ? [U(0.3, 0.42), U(0.66, 0.8)] : [U(0.4, 0.6)];       // fraction of the way from centre to edge
    for (let q = 0; q < np; q++) {
      const a = a0 + (q + 0.5) * step, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
      for (let t = 0; t < size * 0.75; t += 0.35) {
        const off = Math.sin(t * freq + ph) * amp * Math.min(1, t / 12), x = C + dx * t + nx * off, y = C + dy * t + ny * off;
        if (!inMap(x, y, -2)) break;
        const ford = (np > 2 && t < 3) || fords.some(f => Math.abs(t - f * size * 0.5) < 1.6);   // 3+ players: the arms meet at a shallow hub
        for (let j = Math.floor(y - half - 2); j <= y + half + 2; j++) for (let i = Math.floor(x - half - 2); i <= x + half + 2; i++) {
          if (i < 0 || j < 0 || i >= size || j >= size) continue;
          const d = Math.hypot(i + 0.5 - x, j + 0.5 - y), k = j * size + i;
          if (ford) { if (d < half + 0.8) { terrain[k] = T_DIRT; reserved[k] = 2; } }
          else if (d < half && reserved[k] !== 2) terrain[k] = T_WATER;
          else if (d < half + 1.2 && terrain[k] !== T_WATER) terrain[k] = T_DIRT;
          if (d < half + 2 && !reserved[k]) reserved[k] = 1;
        }
      }
    }
  }

  // ---- relief: rolling hills (slow to climb, high ground bonus) and, on 'pegunungan', impassable ridges with passes
  const hillAt = (cx, cy, rad) => {
    for (let j = Math.floor(cy - rad); j <= cy + rad; j++) for (let i = Math.floor(cx - rad); i <= cx + rad; i++) {
      if (!inMap(i, j, 1)) continue; const k = j * size + i;
      if (terrain[k] === T_WATER || reserved[k] === 2 || Math.hypot(i - cx, j - cy) + (n2(i * 2.5, j * 2.5) - 0.5) * 3 > rad) continue;
      if (starts.some(([x, y]) => Math.hypot(i - x, j - y) < 10)) continue;
      terrain[k] = T_HILL;
    }
  };
  const nh = Math.round((M.hills ?? 2) * area / np);
  for (let k = 0; k < nh; k++) { const rel = r() * step, d = size * U(0.12, 0.46), rad = U(2.5, 5.5); for (let q = 0; q < np; q++) hillAt(...polar(q, rel, d), rad); }
  if (M.ridges) {
    // a mountain ridge between each pair of seats, broken by two passes
    for (let q = 0; q < np; q++) {
      const a = a0 + (q + 0.5) * step, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx, gaps = [U(0.25, 0.4), U(0.6, 0.8)];
      for (let t = size * 0.08; t < size * 0.6; t += 0.4) {
        const x = C + dx * t + nx * Math.sin(t * 0.13) * 3, y = C + dy * t + ny * Math.sin(t * 0.13) * 3;
        if (!inMap(x, y, 1)) break;
        const gap = gaps.some(g => Math.abs(t - g * size * 0.5) < 2.5);
        for (let j = Math.floor(y - 3); j <= y + 3; j++) for (let i = Math.floor(x - 3); i <= x + 3; i++) {
          if (!inMap(i, j, 0)) continue; const k = j * size + i, dd = Math.hypot(i + 0.5 - x, j + 0.5 - y);
          if (terrain[k] === T_WATER || starts.some(([sx, sy]) => Math.hypot(i - sx, j - sy) < 13)) continue;
          if (gap) { if (dd < 2.2) { terrain[k] = T_HILL; reserved[k] = 2; } }
          else if (dd < 1.6 + (n2(i * 3, j * 3) - 0.5) * 1.2 && reserved[k] !== 2) { terrain[k] = T_ROCK; reserved[k] = 1; }
          else if (dd < 3 && terrain[k] !== T_ROCK) terrain[k] = T_HILL;
        }
      }
    }
  }
  const free = (i, j) => i >= 1 && j >= 1 && i < size - 1 && j < size - 1 && !W.occ[idx(W, i, j)] && terrain[idx(W, i, j)] !== T_WATER && terrain[idx(W, i, j)] !== T_ROCK && reserved[j * size + i] !== 2;
  const tree = (i, j) => { addResource(W, 'tree', i, j, (r() * 3) | 0); terrain[j * size + i] = T_FOREST; };
  const forest = (cx, cy, rad, dens = 0.92) => {
    for (let j = Math.floor(cy - rad); j <= cy + rad; j++) for (let i = Math.floor(cx - rad); i <= cx + rad; i++) {
      if (!free(i, j) || reserved[j * size + i]) continue;
      const d = Math.hypot(i - cx, j - cy) + (n2(i * 2, j * 2) - 0.5) * 3.5;
      if (d < rad && r() < dens) tree(i, j);
    }
  };
  const cluster = (type, cx, cy, n) => {
    const placed = []; const q = [[Math.round(cx), Math.round(cy)]];
    for (let guard = 0; q.length && placed.length < n && guard < 400; guard++) {
      const [i, j] = q.splice((r() * q.length) | 0, 1)[0];
      if (!free(i, j)) continue;
      addResource(W, type, i, j, (r() * 2) | 0); placed.push([i, j]);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) q.push([i + a, j + b]);
    }
    for (const [i, j] of placed) if (terrain[j * size + i] !== T_HILL) terrain[j * size + i] = T_DIRT;
    return placed.length;
  };
  const unreserve = (cx, cy, rad) => { for (let j = Math.floor(cy - rad); j <= cy + rad; j++) for (let i = Math.floor(cx - rad); i <= cx + rad; i++) if (i >= 0 && j >= 0 && i < size && j < size && reserved[j * size + i] === 1) reserved[j * size + i] = 0; };

  // ---- one home layout, rolled once and shared by every player (angles are relative to the way to the map centre)
  const sg = r() < 0.5 ? 1 : -1;
  const L = {
    berry: [sg * U(0.6, 1.2), U(6.5, 7.8)], gold: [-sg * U(0.6, 1.2), U(8.5, 10)], stone: [-sg * U(1.9, 2.4), U(9.5, 11)],
    gold2: [sg * U(2.0, 2.6), U(14, 17)], iron: [-sg * U(2.6, 3.0), U(15, 19)],
    woods: [[Math.PI + U(-0.35, 0.35), U(13, 15.5), U(5.5, 7) * M.wood], [sg * U(1.35, 1.7), U(14.5, 17), U(3.8, 5) * M.wood]],
    sheep: U(-0.4, 0.4), boar: [sg * U(2.4, 2.9), -sg * U(2.6, 3.0)], deer: [U(-1.4, 1.4), U(19, 23)], extraSheep: [sg * U(1.5, 2.3), -sg * U(1.4, 2.2)],
    trFood: [sg * U(0.8, 1.5), U(20, 26)], trWood: [-sg * U(0.8, 1.5), U(23, 29)],
  };
  if (r() < 0.6) L.woods.push([-sg * U(1.4, 1.8), U(15, 18), U(3.5, 4.5) * M.wood]);
  const homes = starts.map(([sx, sy]) => { const toC = Math.atan2(C - sy, C - sx); return (ang, d) => [sx + Math.cos(toC + ang) * d, sy + Math.sin(toC + ang) * d]; });
  homes.forEach((at) => {
    cluster('berry', ...at(...L.berry), 6);
    cluster('gold', ...at(...L.gold), 7);
    cluster('gold', ...at(...L.gold2), 5);
    cluster('stone', ...at(...L.stone), 6);
    cluster('iron', ...at(...L.iron), 5);
    for (const [ang, d, rad] of L.woods) { const [fx, fy] = at(ang, d); unreserve(fx, fy, rad); forest(fx, fy, rad); }
  });
  homes.forEach((at, p) => {     // a few lone trees around each town
    const [sx, sy] = starts[p], [bx, by] = at(...L.berry);
    for (let k = 0; k < 6; k++) { const a = r() * 6.28, d = 9 + r() * 4; const i = Math.round(sx + Math.cos(a) * d), j = Math.round(sy + Math.sin(a) * d); if (free(i, j) && Math.hypot(i - bx, j - by) > 2) tree(i, j); }
  });

  // ---- map-wide features, copied around the centre once per seat
  const perSeat = (n) => Math.max(0, Math.round(n * area / np));
  for (let k = 0; k < perSeat(M.forests); k++) {
    const rel = r() * step, d = size * U(0.06, 0.48), rad = U(...M.forestR), dens = U(0.8, 0.92);
    for (let q = 0; q < np; q++) { const [x, y] = polar(q, rel, d); if (inMap(x, y)) forest(x, y, rad, dens); }
  }
  for (let k = 0; k < perSeat(M.loose); k++) {
    const rel = r() * step, d = size * U(0.04, 0.5);
    for (let q = 0; q < np; q++) { const [x, y] = polar(q, rel, d), i = Math.round(x), j = Math.round(y); if (inMap(i, j, 1) && free(i, j) && !reserved[j * size + i]) tree(i, j); }
  }
  // neutral gold / stone between the players (lots in the centre on 'tambang')
  const mids = Math.max(1, Math.round(M.mid * Math.sqrt(area)));
  for (let k = 0; k < mids; k++) {
    const rel = r() * step, d = size * (M.rich ? U(0.08, 0.2) : U(0.12, 0.26)), n = M.rich ? 7 : 6, t = ['gold', 'stone', 'iron'][k % 3];
    for (let q = 0; q < np; q++) { const [x, y] = polar(q, rel, d); if (inMap(x, y, 6)) cluster(t, x, y, n); }
  }
  if (M.rich) cluster('gold', C, C, 10);

  // ---- fish: every player gets the same number of shoals in the water closest to home (shore fish for villagers,
  // deeper shoals for boats), plus a few out in open water
  const shoal = (i, j) => { let n = 0; for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const ii = i + a, jj = j + b; if (inMap(ii, jj, 1) && terrain[jj * size + ii] === T_WATER && !W.occ[idx(W, ii, jj)] && reserved[jj * size + ii] !== 2 && r() < 0.8) { addResource(W, 'fish', ii, jj, (r() * 2) | 0); n++; } } return n; };
  const farFromBasesP = (x, y, m) => starts.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > m);
  const fishPer = Math.round((M.fish || 1) * (M.water === 'none' ? 0 : 3));
  if (fishPer) starts.forEach(([sx, sy]) => {
    const cand = [];
    for (let j = Math.max(1, sy - 34); j < Math.min(size - 1, sy + 34); j += 2) for (let i = Math.max(1, sx - 34); i < Math.min(size - 1, sx + 34); i += 2) {
      const d = Math.hypot(i - sx, j - sy); if (d < 9 || d > 34 || terrain[j * size + i] !== T_WATER || reserved[j * size + i] === 2) continue;
      cand.push([d + r() * 6, i, j]);
    }
    cand.sort((a, b) => a[0] - b[0]);
    let placed = 0; const used = [];
    for (const [, i, j] of cand) { if (placed >= fishPer) break; if (used.some(([a, b]) => Math.hypot(a - i, b - j) < 6)) continue; if (shoal(i, j)) { placed++; used.push([i, j]); } }
  });
  if (M.water === 'islands') for (let k = 0; k < Math.round(4 * area); k++) { const i = (r() * size) | 0, j = (r() * size) | 0; if (terrain[j * size + i] === T_WATER && farFromBasesP(i, j, 14)) shoal(i, j); }

  // ---- towns
  starts.forEach(([sx, sy], p) => {
    const tc = addBuilding(W, p, 'town_center', sx - 2, sy - 2, true);
    const cv = W.players[p].civ && CIVS[W.players[p].civ], nv = 3 + ((cv && cv.start && cv.start.villagers) || 0);
    for (let k = 0; k < nv; k++) addUnit(W, p, 'villager', sx - 1.5 + (k % 3) * 1.2, sy + 3.0 + Math.floor(k / 3) * 1.1);
    addUnit(W, p, 'scout', sx + 3.2, sy + 1.0);
    if (W.opts.victory === 'regicide') W.players[p].king = addUnit(W, p, 'king', sx - 3.2, sy + 1.0).id;      // Regicide: protect him
    W.players[p].start = [sx, sy]; W.players[p].tc = tc.id;
  });
  // ---- wildlife (AoE2): sheep to herd, boar + deer to hunt, wolves to fear
  const spot = (cx, cy, R, tries = 30) => {
    for (let k = 0; k < tries; k++) { const a = r() * 6.28, d = R * Math.sqrt(r()); const i = Math.floor(cx + Math.cos(a) * d), j = Math.floor(cy + Math.sin(a) * d); if (free(i, j)) return [i + 0.5, j + 0.5]; }
    return null;
  };
  const farFromBases = (x, y, m) => starts.every(([sx, sy]) => Math.hypot(x - sx, y - sy) > m);
  const herd = (type, owner, cx, cy, n, R = 1.6) => { for (let k = 0; k < n; k++) { const s = spot(cx, cy, R); if (s) addUnit(W, owner, type, s[0], s[1]); } };
  const deer = Math.max(2, Math.round(4 * M.hunt)), extra = M.hunt >= 1.2 ? 3 : 2;
  homes.forEach((at, p) => {
    herd('sheep', p, ...at(L.sheep, 5.5), 4);                                      // starting sheep under the TC
    for (const ang of L.extraSheep) herd('sheep', GAIA, ...at(ang, 13 + (ang > 0 ? 2 : 4)), extra);
    for (const ang of L.boar) herd('boar', GAIA, ...at(ang, 15), 1, 1);
    herd('deer', GAIA, ...at(...L.deer), deer, 2.4);
    if (M.hunt >= 1.3) herd('deer', GAIA, ...at(-L.deer[0], L.deer[1] + 3), 3, 2.4);
  });
  const wolfPacks = Math.max(1, Math.round(1.5 * M.wolves * Math.sqrt(area)));
  for (let k = 0, n = 0; k < 100 && n < wolfPacks; k++) {
    const rel = r() * step, d = size * U(0.08, 0.48), [x, y] = polar(0, rel, d);
    if (!farFromBases(x, y, 22) || !inMap(x, y, 4)) continue;
    for (let q = 0; q < np; q++) { const [wx, wy] = polar(q, rel, d); if (farFromBases(wx, wy, 20)) herd('wolf', GAIA, wx, wy, 2, 1.5); }
    n++;
  }
  // ---- treasures (AoE3): guarded by bandits, wolves or a bear
  const amount = (t) => { const [lo, hi] = TREASURES[t].amount; return Math.round((lo + r() * (hi - lo)) / 10) * 10; };
  const treasure = (x, y, type, guards, amt) => {
    const s = spot(x, y, 2); if (!s) return;
    const tr = addTreasure(W, type, Math.floor(s[0]), Math.floor(s[1]), amt);
    for (const g of guards) { const q = spot(s[0], s[1], 2.2); if (q) { const u = addUnit(W, GAIA, g, q[0], q[1]); u.home = [s[0], s[1]]; tr.guards.push(u.id); } }
  };
  const aF = amount('food'), aW = amount('wood');
  homes.forEach((at) => { treasure(...at(...L.trFood), 'food', ['wolf', 'wolf'], aF); treasure(...at(...L.trWood), 'wood', ['bandit', 'bandit'], aW); });
  const mid = Math.max(1, Math.round((2 + 2 * Math.sqrt(area)) * M.treasures / np));
  for (let k = 0, n = 0; k < 100 && n < mid; k++) {
    const rel = r() * step, d = size * U(0.08, 0.38), [x, y] = polar(0, rel, d);
    if (!farFromBases(x, y, 26) || !inMap(x, y, 4)) continue;
    const pick = (n + ((r() * 3) | 0)) % 3, type = ['gold', 'stone', 'gold'][pick], amt = amount(type);
    for (let q = 0; q < np; q++) treasure(...polar(q, rel, d), type, [['bear'], ['bandit', 'bandit', 'bandit'], ['bandit', 'bandit', 'wolf']][pick], amt);
    n++;
  }

  // ---- relics (AoE2): one per player at the same spot relative to each base, plus one in the middle of the map
  const relicAt = (x, y) => { const s = spot(x, y, 3, 60); if (s) addRelic(W, Math.floor(s[0]), Math.floor(s[1])); return !!s; };
  for (let k = 0; k < 100; k++) {
    const rel = r() * step, d = size * U(0.18, 0.34), [x, y] = polar(0, rel, d);
    if (!farFromBases(x, y, 24) || !inMap(x, y, 6)) continue;
    if (M.water === 'islands' && !free(Math.floor(x), Math.floor(y))) continue;
    for (let q = 0; q < np; q++) relicAt(...polar(q, rel, d));
    break;
  }
  if (M.water !== 'islands') relicAt(size / 2, size / 2);
  // ---- King of the Hill: the monument on the dry ground nearest the middle
  if (W.opts.victory === 'koth') {
    let mp = null;
    for (let rr = 0; rr < size / 3 && !mp; rr++) for (let k = 0; k < Math.max(1, rr * 6) && !mp; k++) {
      const a = k / Math.max(1, rr * 6) * Math.PI * 2, i = Math.round(size / 2 + Math.cos(a) * rr) - 1, j = Math.round(size / 2 + Math.sin(a) * rr) - 1;
      let ok = true; for (let dj = -1; dj <= 3 && ok; dj++) for (let di = -1; di <= 3 && ok; di++) ok = free(i + di, j + dj);
      if (ok) mp = [i, j];
    }
    if (mp) {
      addMonument(W, mp[0], mp[1]);
      for (const P of W.players) for (let dj = -5; dj <= 7; dj++) for (let di = -5; di <= 7; di++) { const i = mp[0] + di, j = mp[1] + dj; if (i >= 0 && j >= 0 && i < size && j < size && (di - 1) ** 2 + (dj - 1) ** 2 <= 36) P.exp[j * size + i] = 1; }   // everyone knows where the hill is
    }
  }

  if (M.water !== 'islands') connect(W, starts, terrain);
  else for (const P of W.players) P.res.wood += 200;               // islands: timber for the first dock
  for (let pass = 0; pass < 3; pass++) balance(W, starts, { free, forest, cluster, herd, reserved, r });   // dense maps may need several tries
  if (SE.berry) for (const e of W.ents.values()) if (e.kind === 'res' && e.type === 'berry') e.amount = e.max = Math.round(e.amount * SE.berry);
  for (const P of W.players) { P.stats.units = 0; P.stats.tr = {}; }   // count only units trained during the game
  W.map = { type: key, name: M.name, desc: M.desc, seed, water: M.water, season: seasonKey };
  return W;
}

// Resources each player can reach easily (within 26 tiles of the town centre).
export function homeResources(W, sx, sy, R = 26) {
  const o = { wood: 0, gold: 0, stone: 0, food: 0, iron: 0 };
  for (const e of W.ents.values()) {
    if (Math.hypot(e.x + 0.5 - sx, e.y + 0.5 - sy) > R) continue;
    if (e.kind === 'res') { const k = RESOURCES[e.type].res; o[k] += e.amount; }
    else if (e.kind === 'unit' && UNITS[e.type].food && UNITS[e.type].animal !== 'guard') o.food += UNITS[e.type].food;
  }
  return o;
}
// top up whoever is clearly short of something compared to the best-off player
function balance(W, starts, { free, forest, cluster, herd, r }) {
  const have = starts.map(([x, y]) => homeResources(W, x, y));
  const spotNear = ([sx, sy], d0, d1) => {
    for (let k = 0; k < 60; k++) { const a = r() * 6.28, d = d0 + r() * (d1 - d0), i = Math.round(sx + Math.cos(a) * d), j = Math.round(sy + Math.sin(a) * d); if (free(i, j) && starts.every(([x, y]) => Math.hypot(i - x, j - y) >= d0 - 1)) return [i, j]; }
    return null;
  };
  for (const res of ['wood', 'gold', 'stone', 'food', 'iron']) {
    const best = Math.max(...have.map(h => h[res]));
    have.forEach((h, p) => {
      const lack = best * 0.88 - h[res]; if (lack <= 0) return;
      let s = spotNear(starts[p], 13, 22);
      if (!s && res !== 'wood') {        // all forest around: clear a glade for the mine / the herd
        const [sx, sy] = starts[p], a = r() * 6.28, ci = Math.round(sx + Math.cos(a) * 16), cj = Math.round(sy + Math.sin(a) * 16);
        for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) { if (i < 1 || j < 1 || i >= W.size - 1 || j >= W.size - 1) continue; const k = j * W.size + i, e = W.ents.get(W.occ[k]); if (e && e.kind === 'res' && e.type === 'tree') { del(W, e.id); W.occ[k] = 0; W.terrain[k] = T_GRASS; } }
        if (free(ci, cj)) s = [ci, cj];
      }
      if (!s) return;
      if (res === 'wood') forest(s[0], s[1], Math.max(2.5, Math.min(6, Math.sqrt(lack / 100 / 2.6))), 0.95);
      else if (res === 'food') herd('deer', GAIA, s[0] + 0.5, s[1] + 0.5, Math.max(1, Math.min(6, Math.round(lack / 140))), 2.4);
      else cluster(res, s[0], s[1], Math.max(2, Math.min(8, Math.round(lack / RESOURCES[res].amount))));
    });
  }
}
// every town must be able to walk to every other one: carve a path through trees / water if not
function connect(W, starts, terrain) {
  const S = W.size, open = (k) => terrain[k] !== T_WATER && terrain[k] !== T_ROCK && !W.occ[k];
  for (let guard = 0; guard < starts.length; guard++) {
    const seen = new Uint8Array(S * S), q = [], k0 = starts[0][1] * S + starts[0][0];
    seen[k0] = 1; q.push(k0);
    for (let h = 0; h < q.length; h++) { const k = q[h], i = k % S, j = (k / S) | 0;
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + a, nj = j + b, nk = nj * S + ni; if (ni < 0 || nj < 0 || ni >= S || nj >= S || seen[nk] || !(open(nk) || W.ents.get(W.occ[nk])?.kind === 'building')) continue; seen[nk] = 1; q.push(nk); } }
    const cut = starts.find(([x, y]) => !seen[(y + 3) * S + x]); if (!cut) return;
    const [x0, y0] = [cut[0], cut[1] + 3], [x1, y1] = [starts[0][0], starts[0][1] + 3], n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= n; s++) {
      const cx = Math.round(x0 + (x1 - x0) * s / n), cy = Math.round(y0 + (y1 - y0) * s / n);
      for (let j = cy - 1; j <= cy + 1; j++) for (let i = cx - 1; i <= cx + 1; i++) {
        if (i < 0 || j < 0 || i >= S || j >= S) continue; const k = j * S + i, e = W.ents.get(W.occ[k]);
        if (terrain[k] === T_WATER || terrain[k] === T_ROCK) terrain[k] = T_DIRT;
        if (e && e.kind === 'res' && e.type === 'tree') { del(W, e.id); W.occ[k] = 0; terrain[k] = T_DIRT; }   // only trees: never cut through a mine
      }
    }
    W.regionDirty = true;
  }
}
