// Deterministic RTS simulation (no rendering). Fixed tick; commands are queued and applied at tick start
// so the same code can later run in lockstep online. Coordinates are in tiles; tile (i, j) spans [i, i+1) x [j, j+1).
import { UNITS, BUILDINGS, TECHS, RESOURCES, RATE, CARRY, START_RES, POP_LIMIT, RES, GAIA, TREASURES, MARKET, XP, CARDS } from './data.js';

export const TICK = 0.1;            // game-seconds per tick
const SQ2 = Math.SQRT2;

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- world
export function createWorld({ size, terrain, players, seed = 1 }) {
  const W = {
    t: 0, tick: 0, size, terrain, occ: new Int32Array(size * size), ents: new Map(), dyn: new Map(), ugrid: new Map(), nextId: 1,
    players: players.map((p, i) => ({ id: i, name: p.name, color: p.color, ai: !!p.ai, team: p.team ?? i, res: { ...START_RES }, age: 1, pop: 0, popCap: 0, techs: new Set(), alive: true,
      vis: new Uint8Array(size * size), exp: new Uint8Array(size * size), stats: newStats(), housed: false,
      xp: 0, nextXp: XP.first, ships: 0, shipsEarned: 0, cards: [], shipment: null, mods: { gather: { food: 0, wood: 0, gold: 0, stone: 0 }, vilSpeed: 0, ma: 0, pa: 0, fee: 0 } })),
    cmds: [], ev: [], rnd: rng(seed), seed, paths: 0, nodes: 0, winner: -1, unreach: new Map(),
    market: { ...MARKET.base },
  };
  W.gaia = { id: GAIA, name: 'Alam', color: 'none', gaia: true, team: -1, res: { ...START_RES }, age: 1, pop: 0, popCap: 0, techs: new Set(), alive: true, stats: newStats() };
  return W;
}
// per-player war statistics (stats panel + end screen). killed / lost = units, razed / bldLost = buildings,
// vilKilled = enemy villagers slain, killVal / lostVal = resource value destroyed / lost, gres = gathered per resource,
// tr = units trained per type, treasures = chests collected
export function newStats() {
  return { units: 0, killed: 0, lost: 0, gathered: 0, built: 0, razed: 0, bldLost: 0, vilKilled: 0, killVal: 0, lostVal: 0, treasures: 0,
    gres: { food: 0, wood: 0, gold: 0, stone: 0 }, tr: {}, trades: 0 };
}
// ---- Home City experience (AoE3): enough XP earns a shipment
export function addXp(W, P, n) {
  if (!P || P.gaia || !(n > 0)) return;
  P.xp += n;
  while (P.xp >= P.nextXp) { P.ships++; P.shipsEarned++; P.nextXp += XP.first + XP.step * P.shipsEarned; W.ev.push({ k: 'shipready', owner: P.id }); }
}
export function cardOk(P, id) {
  const c = CARDS[id]; return !!c && P.age >= c.age && (c.repeat || !P.cards.includes(id));
}
// ---- market prices (shared by all players, like AoE2)
export const marketFee = (P) => Math.max(0.05, (P.techs.has('guilds') ? MARKET.feeGuilds : MARKET.fee) + P.mods.fee);
export const buyPrice = (W, P, r) => Math.round(W.market[r] * (1 + marketFee(P)));
export const sellPrice = (W, P, r) => Math.round(W.market[r] * (1 - marketFee(P)));
// buildings that keep a player in the game (walls, gates, farms, houses and foundations alone don't)
export const keepsAlive = (e) => e.hp > 0 && (e.kind === 'unit' ? !UNITS[e.type].animal : e.kind === 'building' && e.built && !BUILDINGS[e.type].wall && !BUILDINGS[e.type].gate && !['farm', 'house'].includes(e.type));
const costVal = (c) => RES.reduce((s, r) => s + ((c && c[r]) || 0), 0);
export const idx = (W, i, j) => j * W.size + i;
export const pl = (W, owner) => owner === GAIA ? W.gaia : W.players[owner];
export const isAnimal = (e) => e && e.kind === 'unit' && !!UNITS[e.type].animal;
const passive = (e) => isAnimal(e) && ['herd', 'flee', 'fight'].includes(UNITS[e.type].animal);   // not auto-targeted
export const inb = (W, i, j) => i >= 0 && j >= 0 && i < W.size && j < W.size;

function add(W, e) { e.id = W.nextId++; W.ents.set(e.id, e); if (e.kind !== 'res' || e.type === 'carcass') W.dyn.set(e.id, e); return e; }
export function del(W, id) { W.ents.delete(id); W.dyn.delete(id); }
// units bucketed on a coarse grid once per tick: neighbourhood queries stay cheap on big maps
const GC = 8;
function buildGrid(W) {
  const g = W.ugrid; g.clear();
  for (const e of W.dyn.values()) if (e.kind === 'unit') { const k = Math.floor(e.x / GC) + Math.floor(e.y / GC) * 1024; let a = g.get(k); if (!a) g.set(k, a = []); a.push(e); }
}
export function unitsNear(W, x, y, r, fn) {
  const i0 = Math.floor((x - r) / GC), i1 = Math.floor((x + r) / GC), j0 = Math.floor((y - r) / GC), j1 = Math.floor((y + r) / GC);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const a = W.ugrid.get(i + j * 1024); if (a) for (const e of a) if (W.ents.has(e.id)) fn(e); }
}
export function addResource(W, type, i, j, variant = 0) {
  const r = add(W, { kind: 'res', type, x: i, y: j, w: 1, h: 1, amount: RESOURCES[type].amount, max: RESOURCES[type].amount, variant });
  W.occ[idx(W, i, j)] = r.id; W.regionDirty = true; return r;
}
export function addBuilding(W, owner, type, i, j, built = false, opts = {}) {
  const d = BUILDINGS[type];
  const w = d.len && opts.axis === 'y' ? 1 : (d.len || d.n), h = d.len && opts.axis === 'y' ? d.len : d.n;
  const b = add(W, { kind: 'building', type, owner, x: i, y: j, w, h, axis: opts.axis || 'x', hp: built ? d.hp : 1, maxHp: d.hp, progress: built ? 1 : 0, built,
    queue: [], rally: null, cool: 0, nb: 0, food: d.food || 0, placedAt: W.t });
  if (d.block) { for (let a = 0; a < w; a++) for (let c = 0; c < h; c++) W.occ[idx(W, i + a, j + c)] = b.id; W.regionDirty = true; }
  if (built) onBuilt(W, b, true);
  return b;
}
export function addUnit(W, owner, type, x, y) {
  const d = UNITS[type], P = pl(W, owner);
  const u = add(W, { kind: 'unit', type, owner, x, y, px: x, py: y, hp: d.hp, maxHp: d.hp, dir: 90, anim: 'idle', aT: 0, order: null, path: null, cool: 0, carry: null, task: null, scan: 0, stuck: 0, home: [x, y] });
  if (type === 'villager' && P.techs.has('loom')) { u.hp += 15; u.maxHp += 15; }
  if (!d.animal && owner !== GAIA) { P.pop++; P.stats.units++; P.stats.tr[type] = (P.stats.tr[type] || 0) + 1; }
  return u;
}
export function addTreasure(W, type, i, j, amount) {
  return add(W, { kind: 'treasure', type, x: i, y: j, w: 1, h: 1, amount, guards: [] });
}
function onBuilt(W, b, silent) {
  const d = BUILDINGS[b.type], P = W.players[b.owner];
  b.built = true; b.progress = 1; b.hp = Math.max(b.hp, 1); if (silent) b.hp = d.hp;
  if (d.pop) P.popCap = Math.min(POP_LIMIT, P.popCap + d.pop);
  if (!silent) { P.stats.built++; addXp(W, P, costVal(d.cost) * XP.build); W.ev.push({ k: 'built', x: b.x + b.w / 2, y: b.y + b.h / 2, owner: b.owner, type: b.type }); }
}

// ---------------------------------------------------------------- passability / geometry
export function passable(W, i, j, owner = -1) {
  if (!inb(W, i, j)) return false;
  const k = idx(W, i, j);
  if (W.terrain[k] === 3) return false;               // water
  const e = W.occ[k]; if (!e) return true;
  const o = W.ents.get(e); if (!o) { W.occ[k] = 0; return true; }
  return o.kind === 'building' && BUILDINGS[o.type].gate && o.owner === owner && o.built;
}
// distance from point to an entity's footprint (units: centre distance)
export function distTo(e, x, y) {
  if (e.kind === 'unit') return Math.hypot(e.x - x, e.y - y);
  const dx = Math.max(e.x - x, 0, x - (e.x + e.w)), dy = Math.max(e.y - y, 0, y - (e.y + e.h));
  return Math.hypot(dx, dy);
}
export const center = (e) => e.kind === 'unit' ? [e.x, e.y] : [e.x + e.w / 2, e.y + e.h / 2];
export const alive = (W, id) => { const e = W.ents.get(id); return e && (e.kind !== 'unit' || e.hp > 0) && (e.kind !== 'building' || e.hp > 0) && (e.kind !== 'res' || e.amount > 0) ? e : null; };
const enemies = (W, a, b) => a !== b && pl(W, a).team !== pl(W, b).team;
// connected walkable regions (gates count as open): lets us reject unreachable targets without running A*
function regions(W) {
  if (W.region && (!W.regionDirty || W.t - W.regionT < 1.0)) return W.region;
  const S = W.size, R = W.region || (W.region = new Int32Array(S * S)); R.fill(0);
  const open = (k) => { if (W.terrain[k] === 3) return false; const o = W.occ[k]; if (!o) return true; const e = W.ents.get(o); return !e || (e.kind === 'building' && BUILDINGS[e.type].gate); };
  let lab = 0; const q = new Int32Array(S * S);
  for (let k0 = 0; k0 < S * S; k0++) {
    if (R[k0] || !open(k0)) continue;
    lab++; let h = 0, t = 0; q[t++] = k0; R[k0] = lab;
    while (h < t) { const k = q[h++], i = k % S, j = (k / S) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= S || nj >= S) continue;
        const nk = nj * S + ni; if (R[nk] || !open(nk)) continue; if (di && dj && (!open(j * S + ni) || !open(nj * S + i))) continue; R[nk] = lab; q[t++] = nk; } }
  }
  W.regionDirty = false; W.regionT = W.t; return R;
}
function regionAt(W, x, y) {
  const R = regions(W), S = W.size; let i = Math.floor(x), j = Math.floor(y);
  if (inb(W, i, j) && R[j * S + i]) return R[j * S + i];
  for (let r = 1; r <= 2; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = i + di, b = j + dj; if (inb(W, a, b) && R[b * S + a]) return R[b * S + a]; }
  return 0;
}
// can unit u stand somewhere within `reach` of target t?
export function canReach(W, u, t, reach) {
  const r0 = regionAt(W, u.x, u.y); if (!r0) return true;
  const R = regions(W), S = W.size;
  const x0 = Math.floor((t.kind === 'unit' ? t.x : t.x) - reach - 1), x1 = Math.floor((t.kind === 'unit' ? t.x : t.x + t.w) + reach + 1);
  const y0 = Math.floor((t.kind === 'unit' ? t.y : t.y) - reach - 1), y1 = Math.floor((t.kind === 'unit' ? t.y : t.y + t.h) + reach + 1);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { if (!inb(W, i, j) || R[j * S + i] !== r0) continue; if (distTo(t, i + 0.5, j + 0.5) <= Math.max(reach, NEAR) + 0.5) return true; }
  return false;
}
// targets a side has found to be unreachable (walled in, deep in a forest) are skipped for a while
const unreachable = (W, id, owner) => (W.unreach.get(id * 16 + owner + 1) || 0) > W.t;
const markUnreachable = (W, id, owner) => W.unreach.set(id * 16 + owner + 1, W.t + 25);

// ---------------------------------------------------------------- pathfinding (A*, 8-dir, no corner cutting)
class Heap {   // binary min-heap on two flat arrays (no per-node allocations)
  constructor() { this.f = []; this.n = []; this.size = 0; }
  push(n, f) { const F = this.f, Nn = this.n; let i = this.size++; while (i > 0) { const p = (i - 1) >> 1; if (F[p] <= f) break; F[i] = F[p]; Nn[i] = Nn[p]; i = p; } F[i] = f; Nn[i] = n; }
  pop() {
    const F = this.f, Nn = this.n, top = Nn[0], n = --this.size; if (n <= 0) return top;
    const f = F[n], v = Nn[n]; let i = 0;
    for (;;) { const l = 2 * i + 1; if (l >= n) break; const r = l + 1, m = r < n && F[r] < F[l] ? r : l; if (F[m] >= f) break; F[i] = F[m]; Nn[i] = Nn[m]; i = m; }
    F[i] = f; Nn[i] = v; return top;
  }
}
const G = { g: null, from: null, stamp: null, cur: 0 };
export function findPath(W, owner, sx, sy, goal, tx, ty, maxNodes = 0) {
  // long trips: weighted A* (explores far fewer nodes on open maps) and a bigger node allowance
  const far = Math.hypot(tx - sx, ty - sy), hw = far > 24 ? 1.8 : 1.15;
  if (!maxNodes) maxNodes = Math.min(9000, 2500 + far * 45);
  const N = W.size * W.size;
  if (!G.g || G.g.length !== N) { G.g = new Float32Array(N); G.from = new Int32Array(N); G.stamp = new Uint32Array(N); }
  G.cur++; const st = G.cur;
  let si = Math.floor(sx), sj = Math.floor(sy);
  if (!passable(W, si, sj, owner)) { const f = nearestFree(W, sx, sy, owner, 3); if (f) { si = f[0]; sj = f[1]; } }
  const s = idx(W, si, sj);
  const h = (i, j) => { const dx = Math.abs(i + 0.5 - tx), dy = Math.abs(j + 0.5 - ty); return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy); };
  const open = new Heap(); G.g[s] = 0; G.from[s] = -1; G.stamp[s] = st; open.push(s, h(si, sj) * hw);
  let best = s, bestH = h(si, sj), n = 0, found = -1;
  while (open.size && n++ < maxNodes) {
    const k = open.pop(), i = k % W.size, j = (k / W.size) | 0;
    if (goal(i, j)) { found = k; break; }
    const hk = h(i, j); if (hk < bestH) { bestH = hk; best = k; }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj; if (!passable(W, ni, nj, owner)) continue;
      if (di && dj && (!passable(W, i + di, j, owner) || !passable(W, i, j + dj, owner))) continue;
      const nk = idx(W, ni, nj), ng = G.g[k] + (di && dj ? SQ2 : 1);
      if (G.stamp[nk] === st && G.g[nk] <= ng) continue;
      G.stamp[nk] = st; G.g[nk] = ng; G.from[nk] = k; open.push(nk, ng + h(ni, nj) * hw);
    }
  }
  W.paths++; W.nodes += n;
  const end = found >= 0 ? found : best;
  const pts = []; for (let k = end; k !== -1 && k !== s; k = G.from[k]) pts.push([k % W.size + 0.5, ((k / W.size) | 0) + 0.5]);
  pts.reverse();
  return { pts: smooth(W, owner, sx, sy, pts), complete: found >= 0, exhausted: found < 0 && open.size === 0 };
}
function lineFree(W, owner, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.3);
  for (let s = 1; s <= n; s++) { const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n;
    if (!passable(W, Math.floor(x), Math.floor(y), owner) || !passable(W, Math.floor(x + 0.22), Math.floor(y + 0.22), owner) || !passable(W, Math.floor(x - 0.22), Math.floor(y - 0.22), owner)
      || !passable(W, Math.floor(x + 0.22), Math.floor(y - 0.22), owner) || !passable(W, Math.floor(x - 0.22), Math.floor(y + 0.22), owner)) return false; }
  return true;
}
function smooth(W, owner, sx, sy, pts) {
  if (pts.length < 3) return pts;
  const out = []; let ax = sx, ay = sy, i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 10);            // bounded look-ahead keeps long paths linear
    while (j > i && !lineFree(W, owner, ax, ay, pts[j][0], pts[j][1])) j--;
    out.push(pts[j]); ax = pts[j][0]; ay = pts[j][1]; i = j + 1;
  }
  return out;
}
export function nearestFree(W, x, y, owner, R = 6) {
  const ci = Math.floor(x), cj = Math.floor(y);
  let best = null, bd = 1e9;
  for (let r = 0; r <= R; r++) {
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !passable(W, i, j, owner)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - y); if (d < bd) { bd = d; best = [i, j]; }
    }
    if (best) return best;
  }
  return null;
}

// ---------------------------------------------------------------- commands (validated, queued)
export function command(W, c) { W.cmds.push(c); }
function own(W, pid, ids) { return ids.map(id => W.ents.get(id)).filter(e => e && e.kind === 'unit' && e.owner === pid && e.hp > 0); }
export const canAfford = (P, cost) => RES.every(r => (P.res[r] || 0) >= (cost[r] || 0));
const pay = (P, cost) => { for (const r of RES) P.res[r] -= cost[r] || 0; };
const refund = (P, cost, f = 1) => { for (const r of RES) P.res[r] += Math.floor((cost[r] || 0) * f); };
export function hasBuilt(W, pid, type) { for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === pid && e.type === type && e.built) return true; return false; }
export function canBuild(W, pid, type) {
  const d = BUILDINGS[type], P = W.players[pid];
  if (P.age < d.age) return false;
  return !(d.needs || []).some(t => !hasBuilt(W, pid, t));
}
export function placementOk(W, pid, type, i, j, axis = 'x') {
  const d = BUILDINGS[type], P = W.players[pid];
  const w = d.len && axis === 'y' ? 1 : (d.len || d.n), h = d.len && axis === 'y' ? d.len : d.n;
  for (let a = 0; a < w; a++) for (let c = 0; c < h; c++) {
    const ii = i + a, jj = j + c; if (!inb(W, ii, jj)) return false;
    const k = idx(W, ii, jj);
    if (W.terrain[k] === 3 || W.occ[k] || !P.exp[k]) return false;
    if (!d.block) { for (const e of W.dyn.values()) if (e.kind === 'building' && !BUILDINGS[e.type].block && ii >= e.x && ii < e.x + e.w && jj >= e.y && jj < e.y + e.h) return false; }
  }
  return true;
}
export function techOk(W, pid, tech, bld) {
  const t = TECHS[tech], P = W.players[pid];
  if (P.techs.has(tech) || P.age < t.age) return false;
  if (t.toAge && P.age !== t.toAge - 1) return false;
  for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === pid && e.queue.some(q => q.tech === tech)) return false;
  if (t.reqCount) { const have = new Set(); for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === pid && e.built && t.reqFrom.includes(e.type)) have.add(e.type); if (have.size < t.reqCount) return false; }
  return true;
}

function applyCmd(W, c) {
  const P = W.players[c.pid]; if (!P || !P.alive) return;
  switch (c.t) {
    case 'move': {
      const us = own(W, c.pid, c.ids); formation(W, us, c.x, c.y, (u, x, y) => setOrder(W, u, { t: 'move', x, y, amove: !!c.amove }));
      if (us.length) W.ev.push({ k: 'ack', owner: c.pid, x: c.x, y: c.y, type: us[0].type, move: 1 });
      break;
    }
    case 'smart': {
      const us = own(W, c.pid, c.ids); const tgt = c.target ? alive(W, c.target) : null;
      if (!us.length) break;
      if (!tgt) { applyCmd(W, { t: 'move', pid: c.pid, ids: c.ids, x: c.x, y: c.y }); break; }
      const rest = [];
      for (const u of us) {
        const vil = u.type === 'villager';
        if (isAnimal(u)) { rest.push(u); continue; }
        if (tgt.kind === 'treasure') { setOrder(W, u, { t: 'move', x: tgt.x + 0.5, y: tgt.y + 0.5 }); continue; }
        if (vil && tgt.kind === 'unit' && UNITS[tgt.type].food) { setOrder(W, u, { t: 'attack', id: tgt.id, hunt: true }); continue; }   // hunt / slaughter
        if (tgt.kind === 'unit' && isAnimal(tgt) && tgt.owner === u.owner) { rest.push(u); continue; }
        if (tgt.kind === 'unit' || tgt.kind === 'building') {
          if (enemies(W, tgt.owner, u.owner)) { setOrder(W, u, { t: 'attack', id: tgt.id }); continue; }
          if (vil && tgt.kind === 'building' && tgt.owner === u.owner) {
            if (!tgt.built) { setOrder(W, u, { t: 'build', id: tgt.id }); continue; }
            if (tgt.type === 'farm') { setOrder(W, u, { t: 'gather', id: tgt.id }); continue; }
            if (u.carry && u.carry.n > 0 && (BUILDINGS[tgt.type].drop || []).includes(u.carry.res)) { setOrder(W, u, { t: 'drop', id: tgt.id, then: null }); continue; }
          }
        }
        if (tgt.kind === 'res' && vil) { setOrder(W, u, { t: 'gather', id: tgt.id }); continue; }
        rest.push(u);
      }
      if (rest.length) formation(W, rest, c.x, c.y, (u, x, y) => setOrder(W, u, { t: 'move', x, y }));
      W.ev.push({ k: 'ack', owner: c.pid, x: c.x, y: c.y, type: us[0].type, tgt: tgt.kind });
      break;
    }
    case 'place': {
      const d = BUILDINGS[c.type]; if (!d || !canBuild(W, c.pid, c.type)) break;
      const tiles = c.tiles || [[c.i, c.j]];
      let made = [];
      for (const [i, j] of tiles) {
        if (!canAfford(P, d.cost) || !placementOk(W, c.pid, c.type, i, j, c.axis)) continue;
        pay(P, d.cost); made.push(addBuilding(W, c.pid, c.type, i, j, false, { axis: c.axis }));
      }
      if (made.length) {
        const us = own(W, c.pid, c.ids || []).filter(u => u.type === 'villager');
        us.forEach((u, k) => setOrder(W, u, { t: 'build', id: made[k % made.length].id, chain: made.map(b => b.id) }));
        W.ev.push({ k: 'place', owner: c.pid, x: made[0].x, y: made[0].y });
      }
      break;
    }
    case 'train': {
      const b = alive(W, c.bid); if (!b || b.owner !== c.pid || !b.built) break;
      const d = UNITS[c.type], bd = BUILDINGS[b.type];
      if (!d || !(bd.trains || []).includes(c.type) || P.age < d.age || b.queue.length >= 5 || !canAfford(P, d.cost)) break;
      pay(P, d.cost); b.queue.push({ unit: c.type, t: 0 });
      break;
    }
    case 'research': {
      const b = alive(W, c.bid); if (!b || b.owner !== c.pid || !b.built) break;
      const t = TECHS[c.tech]; if (!t || t.at !== b.type || !techOk(W, c.pid, c.tech, b) || !canAfford(P, t.cost) || b.queue.length >= 5) break;
      pay(P, t.cost); b.queue.push({ tech: c.tech, t: 0 });
      break;
    }
    case 'cancel': {
      const b = alive(W, c.bid); if (!b || b.owner !== c.pid) break;
      const q = b.queue[c.i]; if (!q) break;
      refund(P, q.unit ? UNITS[q.unit].cost : TECHS[q.tech].cost); b.queue.splice(c.i, 1);
      break;
    }
    case 'rally': { const b = alive(W, c.bid); if (b && b.owner === c.pid) b.rally = { x: c.x, y: c.y, id: c.target || 0 }; break; }
    case 'trade': {      // market: buy or sell one lot (100) of food / wood / stone for gold
      const b = alive(W, c.bid); if (!b || b.owner !== c.pid || !b.built || !BUILDINGS[b.type].market || !MARKET.base[c.res]) break;
      if (c.buy) { const g = buyPrice(W, P, c.res); if (P.res.gold < g) break; P.res.gold -= g; P.res[c.res] += MARKET.lot; W.market[c.res] = Math.min(MARKET.max, W.market[c.res] + MARKET.step); }
      else { if (P.res[c.res] < MARKET.lot) break; P.res[c.res] -= MARKET.lot; P.res.gold += sellPrice(W, P, c.res); W.market[c.res] = Math.max(MARKET.min, W.market[c.res] - MARKET.step); }
      P.stats.trades++; W.ev.push({ k: 'trade', owner: c.pid, x: b.x + b.w / 2, y: b.y + b.h / 2, res: c.res, buy: !!c.buy });
      break;
    }
    case 'card': {       // send a Home City shipment (one at a time)
      if (P.ships < 1 || P.shipment || !cardOk(P, c.card)) break;
      P.ships--; P.cards.push(c.card); P.shipment = { card: c.card, t: XP.travel };
      W.ev.push({ k: 'shipsent', owner: c.pid, card: c.card });
      break;
    }
    case 'resign': resign(W, c.pid); break;
    case 'stop': for (const u of own(W, c.pid, c.ids)) setOrder(W, u, null); break;
    case 'delete': {
      const e = W.ents.get(c.id); if (!e || e.owner !== c.pid) break;
      if (e.kind === 'building' && !e.built) refund(P, BUILDINGS[e.type].cost, 1 - e.progress);
      damage(W, e, 1e9, null);
      break;
    }
  }
}
function formation(W, us, x, y, fn) {
  const n = us.length; if (!n) return;
  if (n === 1) { fn(us[0], x, y); return; }
  const cols = Math.ceil(Math.sqrt(n)), sp = 0.75;
  const cx = us.reduce((s, u) => s + u.x, 0) / n, cy = us.reduce((s, u) => s + u.y, 0) / n;
  const ang = Math.atan2(y - cy, x - cx);
  const fx = Math.cos(ang), fy = Math.sin(ang), rx = -fy, ry = fx;
  const slots = [];
  for (let k = 0; k < n; k++) { const r = Math.floor(k / cols), c = k % cols - (cols - 1) / 2; slots.push([x + rx * c * sp - fx * r * sp, y + ry * c * sp - fy * r * sp]); }
  // fast units front, ranged behind: assign greedily by distance
  const left = new Set(slots.map((_, i) => i));
  for (const u of [...us].sort((a, b) => Math.hypot(b.x - x, b.y - y) - Math.hypot(a.x - x, a.y - y))) {
    let bi = -1, bd = 1e9; for (const i of left) { const d = Math.hypot(slots[i][0] - u.x, slots[i][1] - u.y); if (d < bd) { bd = d; bi = i; } }
    left.delete(bi); fn(u, slots[bi][0], slots[bi][1]);
  }
}
export function setOrder(W, u, o) { u.order = o; u.path = null; u.wait = 0; if (o && o.t !== 'gather' && o.t !== 'drop' && u.type === 'villager' && o.t !== 'build') u.task = o.t === 'attack' ? null : u.task; }

// ---------------------------------------------------------------- tick
export function step(W) {
  for (const c of W.cmds.splice(0)) applyCmd(W, c);
  W.t += TICK; W.tick++; W.paths = 0; W.nodes = 0;
  const list = [...W.dyn.values()];
  for (const e of list) if (e.kind === 'unit') { e.px = e.x; e.py = e.y; }
  buildGrid(W);
  for (const e of list) {
    if (!W.ents.has(e.id)) continue;
    if (e.kind === 'unit') unitTick(W, e);
    else if (e.kind === 'building') buildingTick(W, e);
    else if (e.kind === 'proj') projTick(W, e);
    else if (e.kind === 'corpse') { e.t += TICK; if (e.t > 15) del(W, e.id); }
    else if (e.kind === 'rubble') { e.t += TICK; if (e.t > 40) del(W, e.id); }
    else if (e.kind === 'res' && e.type === 'carcass') { e.amount -= TICK * 0.05; if (e.amount <= 0) del(W, e.id); }   // meat slowly spoils
    else if (e.kind === 'treasure' && W.tick % 5 === 0) treasureTick(W, e);
  }
  separate(W);
  for (const P of W.players) if (P.shipment && P.alive && (P.shipment.t -= TICK) <= 0) deliver(W, P);
  if (W.tick % 10 === 0) for (const r in W.market) { const b = MARKET.base[r]; W.market[r] += Math.sign(b - W.market[r]) * Math.min(Math.abs(b - W.market[r]), MARKET.drift * 10 * TICK); }
  if (W.tick % 4 === 0) updateVision(W);
  if (W.tick % 10 === 0) checkVictory(W);
}

const speedOf = (W, u) => UNITS[u.type].speed * (u.type === 'villager' && W.players[u.owner] ? (W.players[u.owner].techs.has('wheelbarrow') ? 1.1 : 1) * (1 + W.players[u.owner].mods.vilSpeed) : 1);
const capOf = (W, u) => CARRY + (W.players[u.owner].techs.has('wheelbarrow') ? 3 : 0);
export const NEAR = 0.8;   // standing on any of the 8 tiles around a footprint counts as 'at' it
const hunting = (u, t) => u.type === 'villager' && isAnimal(t);
const reachOf = (u, t) => { const r = UNITS[u.type].range || (hunting(u, t) ? 2.5 : 0); return r ? r : (t && t.kind === 'unit' ? 0.6 + (UNITS[u.type].cls === 'cavalry' ? 0.2 : 0) : NEAR); };

function moveAlong(W, u, tx, ty, goal, exact = false) {
  // returns true when standing at the goal
  if (!u.path || u.repath <= 0) {
    if (W.paths > 10 || W.nodes > 25000) { return false; }       // per-tick pathfinding budget
    u.path = findPath(W, u.owner, u.x, u.y, goal, tx, ty); u.pi = 0; u.repath = (exact ? 6 : 10) + W.rnd() * 2;
    if (!u.path.complete) { u.fails = (u.fails || 0) + 1; u.repath = 2.5; } else u.fails = 0;
    if (exact && u.path.complete) u.path.pts.push([tx, ty]);
    else if (u.path.complete && !u.path.pts.length) { const ci = Math.floor(u.x) + 0.5, cj = Math.floor(u.y) + 0.5; u.path.pts.push([ci, cj]); }
  }
  u.repath -= TICK;
  const pts = u.path.pts;
  if (u.pi >= pts.length) return true;
  let [wx, wy] = pts[u.pi];
  let dx = wx - u.x, dy = wy - u.y, d = Math.hypot(dx, dy);
  const sp = speedOf(W, u) * TICK;
  if (u.pi === pts.length - 1 && !passable(W, Math.floor(wx), Math.floor(wy), u.owner)) {   // final point inside a footprint: stop at the edge
    if (goal(Math.floor(u.x), Math.floor(u.y))) return true;
  }
  if (d <= sp + 1e-6) {
    if (passable(W, Math.floor(wx), Math.floor(wy), u.owner) || u.pi < pts.length - 1) { u.x = wx; u.y = wy; }
    u.pi++;
    if (u.pi >= pts.length) return true;
  } else {
    const nx = u.x + dx / d * sp, ny = u.y + dy / d * sp;
    if (passable(W, Math.floor(nx), Math.floor(ny), u.owner)) { u.x = nx; u.y = ny; u.stuck = 0; }
    else { u.stuck += TICK; if (u.stuck > 0.6) { u.path = null; u.stuck = 0; } }
  }
  face(u, dx, dy); u.anim = 'walk';
  return false;
}
export function face(u, dx, dy) {
  if (Math.abs(dx) + Math.abs(dy) < 1e-4) return;
  // screen direction of a world vector (2:1 isometric): sx = (dx - dy), sy = (dx + dy) / 2
  const sx = dx - dy, sy = (dx + dy) / 2;
  u.dir = (Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360;
}
function faceTo(u, e) { const [cx, cy] = center(e); face(u, cx - u.x, cy - u.y); }

function goalNear(W, t, reach) {
  if (t.kind === 'unit') return (i, j) => Math.hypot(i + 0.5 - t.x, j + 0.5 - t.y) <= Math.max(reach, 1.0);
  return (i, j) => distTo(t, i + 0.5, j + 0.5) <= Math.max(reach, NEAR);
}

function unitTick(W, u) {
  const d = UNITS[u.type];
  u.aT += TICK; if (u.cool > 0) u.cool -= TICK;
  if (d.animal || u.owner === GAIA) gaiaTick(W, u, d);
  if (u.hitAt !== undefined) { u.hitAt -= TICK; if (u.hitAt <= 0) { const t = alive(W, u.hitTgt); if (t && distTo(t, u.x, u.y) <= reachOf(u, t) + 0.6) damage(W, t, dmgOf(W, u, t), u); u.hitAt = undefined; } }
  const o = u.order;
  if (!o) {
    u.anim = u.anim === 'attack' && u.aT < 0.8 ? 'attack' : 'idle';
    unstick(W, u);
    if (u.type !== 'villager' && !d.animal && u.owner !== GAIA) { u.scan -= TICK; if (u.scan <= 0) { u.scan = 0.8; const t = findEnemy(W, u, d.los); if (t) setOrder(W, u, { t: 'attack', id: t.id, auto: true }); } }
    else if (u.carry && u.carry.n > 0 && u.lastRes) { /* idle villager keeps carrying */ }
    return;
  }
  switch (o.t) {
    case 'move': {
      if (o.amove) { u.scan -= TICK; if (u.scan <= 0) { u.scan = 0.6; const t = findEnemy(W, u, d.los); if (t) { u.order = { t: 'attack', id: t.id, resume: o }; u.path = null; return; } } }
      if (moveAlong(W, u, o.x, o.y, (i, j) => Math.abs(i + 0.5 - o.x) < 0.6 && Math.abs(j + 0.5 - o.y) < 0.6, true)) { u.order = null; u.anim = 'idle'; }
      else if (u.path && u.path.exhausted && u.pi >= u.path.pts.length - 1) { u.order = null; u.anim = 'idle'; }
      else if (o.flee || (o.home && d.animal)) u.anim = 'run';
      break;
    }
    case 'attack': {
      const t = alive(W, o.id);
      if (!t || t.kind === 'res' || (t.kind === 'unit' && !o.auto && pl(W, u.owner).vis && !pl(W, u.owner).vis[idx(W, Math.floor(t.x), Math.floor(t.y))])) {
        if (o.hunt) { const c = carcassNear(W, o.lx ?? u.x, o.ly ?? u.y); if (c) { setOrder(W, u, { t: 'gather', id: c.id, kind: 'carcass' }); return; } }
        u.order = o.resume || null; u.path = null; return;
      }
      o.lx = t.x; o.ly = t.y;
      if (o.auto && distTo(t, u.x, u.y) > d.los + 3) { u.order = o.resume || null; u.path = null; return; }
      const reach = reachOf(u, t);
      if (distTo(t, u.x, u.y) <= reach) {
        u.path = null; faceTo(u, t);
        if (u.cool <= 0) { attack(W, u, t); u.cool = d.reload; }
        else if (u.anim !== 'attack' || u.aT > 0.9) u.anim = 'idle';
      } else {
        const dd = distTo(t, u.x, u.y);
        if (t.kind === 'unit' && dd < 2.5 && lineFree(W, u.owner, u.x, u.y, t.x, t.y)) {
          const sp = speedOf(W, u) * TICK, k = Math.min(sp, dd - reach * 0.8) / dd;
          u.x += (t.x - u.x) * k; u.y += (t.y - u.y) * k; face(u, t.x - u.x, t.y - u.y); u.anim = 'walk'; u.path = null;
          break;
        }
        if (t.kind === 'unit' && u.path && u.path.pts.length && (u.chaseT = (u.chaseT || 0) - TICK) <= 0) { const last = u.path.pts[u.path.pts.length - 1]; if (Math.hypot(last[0] - t.x, last[1] - t.y) > Math.max(1.2, 0.25 * Math.hypot(t.x - u.x, t.y - u.y))) { u.path = null; u.chaseT = 0.6; } }
        const [cx, cy] = center(t);
        if (!u.path && !canReach(W, u, t, reach)) { markUnreachable(W, t.id, u.owner); u.order = o.resume || null; return; }
        if (moveAlong(W, u, cx, cy, goalNear(W, t, reach))) u.path = null;
        else if (u.path && u.path.exhausted) { markUnreachable(W, t.id, u.owner); u.order = o.resume || null; u.path = null; }
      }
      break;
    }
    case 'gather': villagerGather(W, u, o); break;
    case 'drop': villagerDrop(W, u, o); break;
    case 'build': villagerBuild(W, u, o); break;
  }
}
function unstick(W, u) {
  if (!passable(W, Math.floor(u.x), Math.floor(u.y), u.owner)) { const f = nearestFree(W, u.x, u.y, u.owner, 6); if (f) { u.x = f[0] + 0.5; u.y = f[1] + 0.5; } }
}
function findEnemy(W, u, r) {
  let best = null, bd = 1e9; const vis = W.players[u.owner].vis;
  const consider = (e) => {
    if ((e.kind !== 'unit' && e.kind !== 'building') || e.hp <= 0 || passive(e) || !enemies(W, e.owner, u.owner) || unreachable(W, e.id, u.owner)) return;
    const dd = distTo(e, u.x, u.y); if (dd > r) return;
    const [cx, cy] = center(e); if (!vis[idx(W, Math.min(W.size - 1, Math.floor(cx)), Math.min(W.size - 1, Math.floor(cy)))]) return;
    const score = dd + (e.kind === 'building' ? 6 : 0) + (e.kind === 'unit' && e.type === 'villager' ? 1 : 0);
    if (score < bd) { bd = score; best = e; }
  };
  unitsNear(W, u.x, u.y, r, consider);
  // buildings: scan the occupancy grid around the unit
  const R = Math.ceil(r), ci = Math.floor(u.x), cj = Math.floor(u.y), seen = new Set();
  for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
    if (!inb(W, i, j)) continue; const o = W.occ[idx(W, i, j)]; if (!o || seen.has(o)) continue; seen.add(o);
    const e = W.ents.get(o); if (e && e.kind === 'building') consider(e);
  }
  return best;
}
function dmgOf(W, a, t) {
  const d = UNITS[a.type]; let atk = d.atk; const rg = d.range || hunting(a, t);
  const TP = pl(W, t.owner), soldier = t.kind === 'unit' && t.type !== 'villager' && t.owner !== GAIA && !UNITS[t.type].animal;
  const arm = t.kind === 'unit' ? (rg ? UNITS[t.type].pa : UNITS[t.type].ma) + (t.type === 'villager' && TP.techs.has('loom') ? (rg ? 2 : 1) : 0) + (soldier ? (rg ? TP.mods.pa : TP.mods.ma) : 0) : (rg ? BUILDINGS[t.type].pa : BUILDINGS[t.type].ma);
  let dmg = Math.max(1, atk - arm);
  if (d.bonus && t.kind === 'unit' && d.bonus[UNITS[t.type].cls]) dmg += d.bonus[UNITS[t.type].cls];
  if (d.vsBuilding && t.kind === 'building') dmg += d.vsBuilding;      // melee soldiers can actually knock buildings down (AoE2 bonus vs buildings)
  if (t.kind === 'building' && a.type === 'villager') dmg = Math.max(1, dmg * 0.5);
  return dmg;
}
function attack(W, u, t) {
  const d = UNITS[u.type];
  u.anim = 'attack'; u.aT = 0;
  if (d.range || hunting(u, t)) {
    const [cx, cy] = center(t);
    const hit = W.rnd() < (d.acc || 1) || t.kind === 'building';
    const ox = hit ? 0 : (W.rnd() - 0.5) * 1.6, oy = hit ? 0 : (W.rnd() - 0.5) * 1.6;
    W.ev.push({ k: 'shoot', x: u.x, y: u.y, owner: u.owner });
    const spear = !d.range;
    setTimeoutTick(W, 0.5, () => { if (alive(W, u.id)) spawnArrow(W, u.owner, u.x, u.y, 1.1, cx + ox, cy + oy, hit ? t.id : 0, dmgOf(W, u, t), spear); });
  } else {
    u.hitAt = 0.45 * d.reload * 0.5; u.hitTgt = t.id;
    W.ev.push({ k: 'swing', x: u.x, y: u.y, owner: u.owner, type: u.type });
  }
}
function setTimeoutTick(W, s, fn) { add(W, { kind: 'timer', t: s, fn }); }
function spawnArrow(W, owner, x, y, z, tx, ty, tid, dmg, spear = false) {
  const dist = Math.hypot(tx - x, ty - y);
  add(W, { kind: 'proj', owner, x, y, z, sx: x, sy: y, tx, ty, tid, dmg, t: 0, T: Math.max(0.25, dist / 7), arc: 0.25 * dist, spear });
}
function projTick(W, p) {
  p.t += TICK; const k = Math.min(1, p.t / p.T);
  p.px = p.x; p.py = p.y;
  p.x = p.sx + (p.tx - p.sx) * k; p.y = p.sy + (p.ty - p.sy) * k; p.z = 1.1 * (1 - k) + 4 * p.arc / Math.max(1, Math.hypot(p.tx - p.sx, p.ty - p.sy)) * k * (1 - k) * 2;
  if (k >= 1) {
    const t = p.tid ? alive(W, p.tid) : null;
    if (t && distTo(t, p.x, p.y) < 1.0) damage(W, t, p.dmg, { owner: p.owner, kind: 'proj' });
    W.ev.push({ k: t ? 'arrowhit' : 'arrowmiss', x: p.x, y: p.y });
    del(W, p.id);
  }
}
export function damage(W, t, dmg, src) {
  if (t.kind === 'res') return;
  t.hp -= dmg;
  if (src && src.owner !== undefined && src.owner !== t.owner) { const [hx, hy] = center(t); W.ev.push({ k: 'hit', x: hx, y: hy, owner: t.owner }); }
  if (src && t.kind === 'unit' && t.type !== 'villager' && src.id && alive(W, src.id) && UNITS[t.type].atk > 0 && (!t.order || (isAnimal(t) && t.order.t !== 'attack'))) setOrder(W, t, { t: 'attack', id: src.id, auto: true });
  if (t.kind === 'unit' && UNITS[t.type].animal === 'flee' && src) t.scan = 0;   // deer bolt immediately
  if (t.kind === 'unit' && t.type === 'villager' && src && src.id && t.order && t.order.t !== 'attack' && W.rnd() < 0.02) { /* villagers keep working */ }
  if (t.hp > 0) return;
  const P = pl(W, t.owner), S = src && src.owner !== undefined && src.owner !== t.owner && W.players[src.owner] ? W.players[src.owner].stats : null;
  const bld = t.kind === 'building', val = costVal(bld ? BUILDINGS[t.type].cost : UNITS[t.type].cost);
  if (S && !isAnimal(t)) { if (bld) S.razed++; else { S.killed++; if (t.type === 'villager') S.vilKilled++; } S.killVal += val; addXp(W, W.players[src.owner], val * XP.kill); }
  if (!(bld && t.type === 'farm' && !src)) { if (bld) P.stats.bldLost++; else P.stats.lost++; P.stats.lostVal += val; }   // exhausted farms aren't losses
  del(W, t.id);
  if (t.kind === 'unit') {
    if (!UNITS[t.type].animal && t.owner !== GAIA) P.pop--;
    const food = UNITS[t.type].food;
    if (food) add(W, { kind: 'res', type: 'carcass', animal: t.type, x: t.x - 0.5, y: t.y - 0.5, w: 1, h: 1, amount: food, max: food, dir: t.dir, variant: 0 });
    else add(W, { kind: 'corpse', type: t.type, owner: t.owner, x: t.x, y: t.y, dir: t.dir, t: 0, skin: skinOf(t), sk: t.id % 2 });
    W.ev.push({ k: 'die', x: t.x, y: t.y, owner: t.owner, type: t.type });
  } else {
    const d = BUILDINGS[t.type];
    for (let a = 0; a < t.w; a++) for (let c = 0; c < t.h; c++) if (W.occ[idx(W, t.x + a, t.y + c)] === t.id) W.occ[idx(W, t.x + a, t.y + c)] = 0;
    W.regionDirty = true;
    if (t.built && d.pop) P.popCap = Math.max(0, P.popCap - d.pop);
    if (t.type !== 'farm') add(W, { kind: 'rubble', n: Math.min(4, Math.max(t.w, t.h)), x: t.x + t.w / 2, y: t.y + t.h / 2, t: 0 });
    W.ev.push({ k: 'collapse', x: t.x + t.w / 2, y: t.y + t.h / 2, owner: t.owner, type: t.type, n: t.w, hit: !!src });
    for (const q of t.queue) { const c = q.unit ? UNITS[q.unit].cost : TECHS[q.tech].cost; for (const r of RES) P.res[r] += c[r] || 0; }
  }
}

// ---------------------------------------------------------------- villagers
const RES_TYPE = { tree: 'wood', gold: 'gold', stone: 'stone', berry: 'food', farm: 'food', carcass: 'food' };
export function skinOf(u) {
  if (u.type !== 'villager') return u.type;
  return u.task || 'villager';
}
const TASK_SKIN = { tree: 'vil_lumber', gold: 'vil_gold', stone: 'vil_stone', berry: 'vil_forage', farm: 'vil_farm', carcass: 'vil_hunt' };
const WORK_ANIM = { tree: 'chop', gold: 'mine', stone: 'mine', berry: 'forage', farm: 'farm', carcass: 'hunt' };
function rateOf(W, u, kind, src) {
  const P = W.players[u.owner];
  let r = RATE[kind];
  if (kind === 'carcass' && src && src.animal === 'sheep') r = 0.33;   // shepherding is slower than hunting
  if (kind === 'tree' && P.techs.has('double_bit_axe')) r *= 1.2;
  if (kind === 'gold' && P.techs.has('gold_mining')) r *= 1.15;
  return r * (1 + P.mods.gather[RES_TYPE[kind]]);
}
export function openSide(W, e) {
  if (e.type === 'carcass') return true;
  for (let j = e.y - 1; j <= e.y + e.h; j++) for (let i = e.x - 1; i <= e.x + e.w; i++) if (passable(W, i, j)) return true;
  return false;
}
// known: optional explored-tiles mask (the AI only goes for resources it has actually seen)
export function nearestResource(W, kind, x, y, r = 10, owner = -1, skip = null, known = null) {
  let best = null, bd = 1e9;
  for (const e of W.ents.values()) {
    if (skip && skip.has(e.id)) continue;
    if (known && !known[idx(W, Math.floor(e.x), Math.floor(e.y))]) continue;
    const k = e.kind === 'res' ? e.type : (e.kind === 'building' && e.type === 'farm' && e.built && e.owner === owner ? 'farm' : null);
    if (k !== kind || (e.kind === 'res' && e.amount <= 0)) continue;
    if (k === 'farm' && e.farmer && alive(W, e.farmer) && alive(W, e.farmer).order?.id === e.id) continue;
    const dd = distTo(e, x, y); if (dd < bd && dd <= r && (e.kind !== 'res' || openSide(W, e))) { bd = dd; best = e; }
  }
  return best;
}
export function nearestDrop(W, owner, res, x, y) {
  let best = null, bd = 1e9;
  for (const e of W.dyn.values()) {
    if (e.kind !== 'building' || e.owner !== owner || !e.built) continue;
    if (!(BUILDINGS[e.type].drop || []).includes(res)) continue;
    const dd = distTo(e, x, y); if (dd < bd) { bd = dd; best = e; }
  }
  return best;
}
function villagerGather(W, u, o) {
  let r = alive(W, o.id);
  const kindOf = (e) => e.kind === 'res' ? e.type : 'farm';
  if (r && r.kind === 'building' && (r.type !== 'farm' || !r.built || r.food <= 0)) r = null;
  if (!r) {
    const k = o.kind; const n = k && nearestResource(W, k, u.x, u.y, 8, u.owner);
    if (n) { o.id = n.id; o.kind = kindOf(n); u.path = null; return; }
    u.order = null; u.anim = 'idle'; if (u.carry && u.carry.n > 0) { const dsite = nearestDrop(W, u.owner, u.carry.res, u.x, u.y); if (dsite) u.order = { t: 'drop', id: dsite.id, then: null }; } return;
  }
  const kind = kindOf(r); o.kind = kind;
  if (u.fails >= 2 && kind !== 'farm') {
    o.skip = o.skip || new Set(); o.skip.add(r.id); u.fails = 0; u.path = null;
    const n = nearestResource(W, kind, u.x, u.y, 10, u.owner, o.skip); if (n) { o.id = n.id; return; }
    u.order = null; return;
  }
  const res = RES_TYPE[kind];
  u.task = TASK_SKIN[kind];
  if (u.carry && u.carry.res !== res && u.carry.n > 0) u.carry = null;      // switching resource drops the load (like AoE2)
  if (u.carry && u.carry.n >= capOf(W, u)) {
    const dsite = nearestDrop(W, u.owner, res, u.x, u.y);
    if (dsite) { u.order = { t: 'drop', id: dsite.id, then: { t: 'gather', id: r.id, kind } }; u.path = null; } else { u.anim = 'idle'; }
    return;
  }
  const reach = kind === 'farm' ? 0 : NEAR;
  const inside = kind === 'farm' && u.x > r.x && u.x < r.x + r.w && u.y > r.y && u.y < r.y + r.h;
  if (inside || (kind !== 'farm' && distTo(r, u.x, u.y) <= reach)) {
    u.path = null;
    if (kind === 'farm') { r.farmer = u.id; if (!u.farmSpot) u.farmSpot = 1; } else faceTo(u, r);
    if (kind === 'farm') face(u, Math.cos(W.t * 0.3) * 0.5, 1);
    u.anim = WORK_ANIM[kind];
    const amt = rateOf(W, u, kind, r) * TICK;
    if (!u.carry) u.carry = { res, n: 0 };
    u.carry.k = kind;
    if (kind === 'farm') { const take = Math.min(amt, r.food); r.food -= take; u.carry.n += take; if (u.aT > 1.15) { u.aT = 0; W.ev.push({ k: 'farm', x: u.x, y: u.y, owner: u.owner }); } if (r.food <= 0) { W.ev.push({ k: 'farmdone', x: r.x + 1.5, y: r.y + 1.5, owner: r.owner }); damage(W, r, 1e9, null); } }
    else {
      const take = Math.min(amt, r.amount); r.amount -= take; u.carry.n += take; if (kind === 'tree' && !r.felled) { r.felled = true; W.ev.push({ k: 'treefall', x: r.x + 0.5, y: r.y + 0.5 }); }
      if (u.aT > (kind === 'tree' ? 0.9 : 1.0)) { u.aT = 0; W.ev.push({ k: kind === 'tree' ? 'chop' : kind === 'berry' ? 'forage' : kind === 'carcass' ? 'hunt' : 'mine', res: kind, x: u.x, y: u.y, owner: u.owner }); }
      if (r.amount <= 0) { del(W, r.id); if (kind !== 'carcass') { W.occ[idx(W, r.x, r.y)] = 0; W.regionDirty = true; } if (kind === 'tree') add(W, { kind: 'corpse', type: 'stump', owner: -1, x: r.x + 0.5, y: r.y + 0.5, t: 0 }); }
    }
    const st = W.players[u.owner].stats; st.gathered += amt; st.gres[res] += amt; addXp(W, W.players[u.owner], amt * XP.gather);
  } else {
    const [cx, cy] = center(r);
    const goal = kind === 'farm' ? ((i, j) => i >= r.x && i < r.x + r.w && j >= r.y && j < r.y + r.h) : goalNear(W, r, reach);
    const tx = kind === 'farm' ? r.x + 0.6 + (u.id % 3) * 0.9 : cx, ty = kind === 'farm' ? r.y + 0.6 + ((u.id >> 2) % 3) * 0.9 : cy;
    if (moveAlong(W, u, tx, ty, goal, kind === 'farm')) {
      if (kind === 'farm') { u.x = tx; u.y = ty; }
      u.path = null;
    }
    if (u.carry && u.carry.n > 0) u.anim = 'carry';
  }
}
function villagerDrop(W, u, o) {
  const b = alive(W, o.id);
  if (!b || !b.built) { const d2 = u.carry && nearestDrop(W, u.owner, u.carry.res, u.x, u.y); if (d2) { o.id = d2.id; u.path = null; } else { u.order = o.then; } return; }
  if (distTo(b, u.x, u.y) <= NEAR) {
    if (u.carry) { const P = W.players[u.owner]; const n = Math.floor(u.carry.n + 1e-6); P.res[u.carry.res] += n; u.carry.n -= n; W.ev.push({ k: 'deposit', res: u.carry.res, x: u.x, y: u.y, owner: u.owner }); if (u.carry.n < 0.01) u.carry = null; }
    u.order = o.then; u.path = null;
    if (!u.order) u.anim = 'idle';
  } else {
    const [cx, cy] = center(b);
    moveAlong(W, u, cx, cy, goalNear(W, b, NEAR)); u.anim = 'carry';
  }
}
function villagerBuild(W, u, o) {
  let b = alive(W, o.id);
  if (!b || b.built) {
    // next foundation in the chain, else auto-gather near a new drop site (like AoE2)
    const next = (o.chain || []).map(id => alive(W, id)).find(x => x && !x.built);
    if (next) { o.id = next.id; u.path = null; return; }
    const done = W.ents.get(o.id);
    u.order = null; u.task = null; u.anim = 'idle';
    if (done && done.kind === 'building') {
      const auto = { lumber_camp: 'tree', mining_camp: 'gold', mill: 'berry', farm: 'farm' }[done.type];
      if (auto === 'farm') { u.order = { t: 'gather', id: done.id, kind: 'farm' }; return; }
      if (auto) { let n = nearestResource(W, auto, done.x + done.w / 2, done.y + done.h / 2, 10, u.owner); if (!n && auto === 'gold') n = nearestResource(W, 'stone', done.x + 1, done.y + 1, 10); if (n) { u.order = { t: 'gather', id: n.id }; return; } }
    }
    // otherwise help with the nearest unfinished foundation of ours close by
    let best = null, bd = 12;
    for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === u.owner && !e.built) { const dd = distTo(e, u.x, u.y); if (dd < bd) { bd = dd; best = e; } }
    if (best) { u.order = { t: 'build', id: best.id }; u.task = 'vil_build'; }
    return;
  }
  u.task = 'vil_build';
  const d = BUILDINGS[b.type];
  if (distTo(b, u.x, u.y) <= NEAR) {
    u.path = null; faceTo(u, b); u.anim = 'build';
    b.builders = (b.builders || 0) + 1;
    const n = Math.max(1, b.nb || 1);
    const rate = (n + 2) / (3 * d.time) / n;
    const before = b.progress;
    b.progress = Math.min(1, b.progress + rate * TICK);
    b.hp = Math.min(b.maxHp, b.hp + (b.progress - before) * b.maxHp);
    if (u.aT > 0.55) { u.aT = 0; W.ev.push({ k: 'hammer', x: u.x, y: u.y, owner: u.owner }); }
    if (b.progress >= 1) onBuilt(W, b);
  } else {
    const [cx, cy] = center(b);
    moveAlong(W, u, cx, cy, goalNear(W, b, NEAR));
  }
}

// ---------------------------------------------------------------- buildings
function buildingTick(W, b) {
  const d = BUILDINGS[b.type], P = W.players[b.owner];
  b.nb = b.builders || 0; b.builders = 0;
  if (!b.built) return;
  if (d.market && P.techs.has('trade_route')) { P.res.gold += MARKET.tradeGold * TICK; P.stats.gathered += MARKET.tradeGold * TICK; P.stats.gres.gold += MARKET.tradeGold * TICK; }
  if (b.cool > 0) b.cool -= TICK;
  const q = b.queue[0];
  if (q) {
    if (q.unit) {
      if (P.pop + 1 > P.popCap) { if (!P.housed) W.ev.push({ k: 'housed', owner: b.owner }); P.housed = true; }
      else { P.housed = false; q.t += TICK; if (q.t >= UNITS[q.unit].time) { b.queue.shift(); spawn(W, b, q.unit); } }
    } else {
      q.t += TICK;
      if (q.t >= TECHS[q.tech].time) { b.queue.shift(); finishTech(W, b, q.tech); }
    }
  }
  if (d.attack && b.cool <= 0) {
    const t = nearestEnemyUnit(W, b, d.attack.range);
    if (t) {
      b.cool = d.attack.reload;
      const [cx, cy] = center(b);
      for (let k = 0; k < (d.attack.arrows || 1); k++) {
        const arm = t.kind === 'unit' ? UNITS[t.type].pa + (t.type !== 'villager' && W.players[t.owner] && !UNITS[t.type].animal ? W.players[t.owner].mods.pa : 0) : BUILDINGS[t.type].pa;
        spawnArrow(W, b.owner, cx + (k - 1) * 0.4, cy, 3.5, t.x + (W.rnd() - 0.5) * 0.3, t.y + (W.rnd() - 0.5) * 0.3, t.id, Math.max(1, d.attack.atk - arm));
      }
      W.ev.push({ k: 'shoot', x: cx, y: cy, owner: b.owner });
    }
  }
}
function nearestEnemyUnit(W, b, r) {
  let best = null, bd = 1e9; const [cx, cy] = center(b);
  unitsNear(W, cx, cy, r + Math.max(b.w, b.h), (e) => {
    if (e.kind !== 'unit' || passive(e) || !enemies(W, e.owner, b.owner)) return;
    const dd = distTo(b, e.x, e.y); if (dd <= r && dd < bd) { bd = dd; best = e; }
  });
  return best;
}
function spawn(W, b, type) {
  const rx = b.rally ? b.rally.x : b.x + b.w / 2, ry = b.rally ? b.rally.y : b.y + b.h + 1;
  // free tile on the perimeter nearest to the rally point
  let best = null, bd = 1e9;
  for (let i = b.x - 1; i <= b.x + b.w; i++) for (let j = b.y - 1; j <= b.y + b.h; j++) {
    if (i >= b.x && i < b.x + b.w && j >= b.y && j < b.y + b.h) continue;
    if (!passable(W, i, j, b.owner)) continue;
    const dd = Math.hypot(i + 0.5 - rx, j + 0.5 - ry); if (dd < bd) { bd = dd; best = [i, j]; }
  }
  if (!best) best = nearestFree(W, b.x + b.w / 2, b.y + b.h / 2, b.owner, 8);
  if (!best) return;
  const u = addUnit(W, b.owner, type, best[0] + 0.5, best[1] + 0.5);
  face(u, 0.3, 1);
  W.ev.push({ k: 'trained', x: u.x, y: u.y, owner: b.owner, type });
  if (b.rally) {
    const t = b.rally.id ? alive(W, b.rally.id) : null;
    if (t && type === 'villager' && (t.kind === 'res' || (t.kind === 'building' && t.type === 'farm'))) setOrder(W, u, { t: 'gather', id: t.id });
    else if (t && t.kind === 'building' && t.owner !== b.owner) setOrder(W, u, { t: 'attack', id: t.id });
    else setOrder(W, u, { t: 'move', x: b.rally.x, y: b.rally.y });
  }
}
function finishTech(W, b, tech) {
  const P = W.players[b.owner], t = TECHS[tech];
  P.techs.add(tech); addXp(W, P, costVal(t.cost) * XP.tech);
  if (t.toAge) { P.age = t.toAge; W.ev.push({ k: 'age', owner: b.owner, age: P.age }); }
  else W.ev.push({ k: 'tech', owner: b.owner, tech });
  if (tech === 'loom') for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner === b.owner && e.type === 'villager') { e.hp += 15; e.maxHp += 15; }
  if (tech === 'horse_collar') for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === b.owner && e.type === 'farm') e.food += 75;
}

// ---------------------------------------------------------------- misc
function separate(W) {
  // light separation so groups don't stack on one point (cheap tile buckets)
  const buckets = new Map();
  for (const e of [...W.dyn.values()]) {
    if (e.kind === 'timer') { e.t -= TICK; if (e.t <= 0) { del(W, e.id); e.fn(); } continue; }
    if (e.kind !== 'unit') continue;
    const k = Math.floor(e.x) + Math.floor(e.y) * 4096; let a = buckets.get(k); if (!a) buckets.set(k, a = []); a.push(e);
  }
  for (const [k, a] of buckets) {
    const i0 = k % 4096, j0 = Math.floor(k / 4096);
    for (const u of a) {
      if (u.anim === 'walk') continue;
      let fx = 0, fy = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const b = buckets.get(i0 + di + (j0 + dj) * 4096); if (!b) continue;
        for (const v of b) { if (v === u) continue; const dx = u.x - v.x, dy = u.y - v.y, dd = Math.hypot(dx, dy); if (dd < 0.42 && dd > 1e-4) { fx += dx / dd * (0.42 - dd); fy += dy / dd * (0.42 - dd); } else if (dd <= 1e-4) { fx += (u.id % 7 - 3) * 0.01; fy += (u.id % 5 - 2) * 0.01; } }
      }
      if (fx || fy) { const nx = u.x + fx * 0.5, ny = u.y + fy * 0.5; if (passable(W, Math.floor(nx), Math.floor(ny), u.owner)) { u.x = nx; u.y = ny; } }
    }
  }
}
function updateVision(W) {
  const S = W.size;
  for (const P of W.players) P.vis.fill(0);
  for (const e of W.dyn.values()) {
    if (e.kind !== 'unit' && e.kind !== 'building') continue;
    const P = W.players[e.owner]; if (!P) continue;
    const r = e.kind === 'unit' ? UNITS[e.type].los : (e.built ? BUILDINGS[e.type].los : 2);
    const [cx, cy] = center(e);
    const rr = r + (e.kind === 'building' ? Math.max(e.w, e.h) / 2 : 0);
    const i0 = Math.max(0, Math.floor(cx - rr)), i1 = Math.min(S - 1, Math.floor(cx + rr)), j0 = Math.max(0, Math.floor(cy - rr)), j1 = Math.min(S - 1, Math.floor(cy + rr));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= rr * rr) { const k = j * S + i; P.vis[k] = 1; P.exp[k] = 1; }
    }
  }
  // allies share vision
  for (const P of W.players) for (const Q of W.players) if (P !== Q && P.team === Q.team) for (let k = 0; k < S * S; k++) if (Q.vis[k]) { P.vis[k] = 1; P.exp[k] = 1; }
}
// conquest: a player is out once no units and no working buildings remain (walls, gates, farms, houses and unfinished
// foundations don't count), or when they resign
function checkVictory(W) {
  const live = new Set();
  for (const e of W.dyn.values()) if (keepsAlive(e)) live.add(e.owner);
  for (const P of W.players) if (P.alive && (!live.has(P.id) || P.resigned)) {
    P.alive = false; P.shipment = null; W.ev.push({ k: 'defeated', owner: P.id, resign: !!P.resigned });
    for (const e of [...W.dyn.values()]) if (e.owner === P.id && (e.kind === 'unit' || e.kind === 'building')) damage(W, e, 1e9, null);   // leftovers crumble
  }
  const teams = new Set(W.players.filter(p => p.alive).map(p => p.team));
  if (teams.size === 1 && W.winner < 0) { W.winner = [...teams][0]; W.ev.push({ k: 'victory', team: W.winner }); }
}

// a player gives up: everything they own crumbles at the next victory check (AoE2 resign)
export function resign(W, pid) { const P = W.players[pid]; if (P && P.alive) { P.resigned = true; checkVictory(W); } }
// a shipment reaches the Town Center: resources, units at the TC, or a lasting bonus
function deliver(W, P) {
  const c = CARDS[P.shipment.card]; P.shipment = null;
  for (const r of RES) if (c.give && c.give[r]) P.res[r] += c.give[r];
  if (c.mod) {
    const m = c.mod; for (const r in m.gather || {}) P.mods.gather[r] += m.gather[r];
    for (const k of ['vilSpeed', 'ma', 'pa', 'fee']) if (m[k]) P.mods[k] += m[k];
  }
  let tc = W.ents.get(P.tc); if (!tc || tc.kind !== 'building' || tc.hp <= 0) tc = [...W.dyn.values()].find(e => e.kind === 'building' && e.owner === P.id && e.type === 'town_center' && e.built);
  const [cx, cy] = tc ? [tc.x + tc.w / 2, tc.y + tc.h + 1] : (P.start || [W.size / 2, W.size / 2]);
  for (const [type, n] of c.units || []) for (let k = 0; k < n; k++) {
    const f = nearestFree(W, cx + (k % 4) - 1.5, cy + Math.floor(k / 4), P.id, 6); if (!f) break;
    face(addUnit(W, P.id, type, f[0] + 0.5, f[1] + 0.5), 0.3, 1);
  }
  W.ev.push({ k: 'shipment', owner: P.id, card: c.id, x: cx, y: cy - 1 });
}

// ---------------------------------------------------------------- nature: animals, bandits, treasures
function carcassNear(W, x, y) {
  let best = null, bd = 2.5;
  for (const e of W.dyn.values()) if (e.kind === 'res' && e.type === 'carcass' && e.amount > 0) { const dd = Math.hypot(e.x + 0.5 - x, e.y + 0.5 - y); if (dd < bd) { bd = dd; best = e; } }
  return best;
}
function nearestPrey(W, u, r, cx = u.x, cy = u.y, preferVil = false) {
  let best = null, bd = 1e9;
  unitsNear(W, cx, cy, r, (e) => {
    if (e.owner === GAIA || isAnimal(e) || e.hp <= 0 || unreachable(W, e.id, GAIA)) return;
    const dd = Math.hypot(e.x - cx, e.y - cy); if (dd > r) return;
    const sc = dd - (preferVil && e.type === 'villager' ? 2 : 0);
    if (sc < bd) { bd = sc; best = e; }
  });
  return best;
}
function wander(W, u, R, p) {
  if (u.order || W.rnd() > p) return;
  const [hx, hy] = u.home || [u.x, u.y];
  for (let k = 0; k < 4; k++) {
    const x = hx + (W.rnd() - 0.5) * 2 * R, y = hy + (W.rnd() - 0.5) * 2 * R;
    if (passable(W, Math.floor(x), Math.floor(y), u.owner)) { setOrder(W, u, { t: 'move', x, y, wander: true }); return; }
  }
}
function gaiaTick(W, u, d) {
  u.scan -= TICK; if (u.scan > 0) return;
  u.scan = 0.5 + W.rnd() * 0.4;
  const kind = d.animal || (d.guard ? 'guard' : null);
  if (kind === 'herd') {                 // sheep: taken by whoever comes near (unless its owner is close too)
    let best = null, bd = 4, ownNear = false;
    unitsNear(W, u.x, u.y, 5, (e) => {
      if (e.owner === GAIA || isAnimal(e) || e.hp <= 0) return;
      const dd = Math.hypot(e.x - u.x, e.y - u.y); if (dd > 5) return;
      if (e.owner === u.owner) ownNear = true;
      if (dd < bd) { bd = dd; best = e; }
    });
    if (best && best.owner !== u.owner && (u.owner === GAIA || !ownNear)) { u.owner = best.owner; u.home = [u.x, u.y]; W.ev.push({ k: 'sheep', owner: best.owner, x: u.x, y: u.y }); }
    if (u.owner === GAIA) wander(W, u, 1.5, 0.08);
    return;
  }
  if (kind === 'flee') {                 // deer: bolt away from anyone close
    const t = nearestPrey(W, u, 3.2);
    if (t && !(u.order && u.order.flee && u.order.t0 > W.t - 2)) {
      const dx = u.x - t.x, dy = u.y - t.y, dd = Math.hypot(dx, dy) || 1;
      let fx = u.x + dx / dd * 5 + (W.rnd() - 0.5) * 2, fy = u.y + dy / dd * 5 + (W.rnd() - 0.5) * 2;
      fx = Math.max(1, Math.min(W.size - 2, fx)); fy = Math.max(1, Math.min(W.size - 2, fy));
      setOrder(W, u, { t: 'move', x: fx, y: fy, flee: true, t0: W.t });
    } else wander(W, u, 3, 0.06);
    return;
  }
  if (kind === 'fight') { wander(W, u, 2, 0.05); return; }        // boar: fights back through damage()
  if (kind === 'predator') {             // wolf: stalks villagers
    if (u.order && u.order.t === 'attack') return;
    const t = nearestPrey(W, u, d.los, u.x, u.y, true);
    if (t) setOrder(W, u, { t: 'attack', id: t.id, auto: true }); else wander(W, u, 6, 0.1);
    return;
  }
  if (kind === 'guard') {                // bear / bandit: protect the treasure at home
    const [hx, hy] = u.home;
    if (Math.hypot(u.x - hx, u.y - hy) > 7 && !(u.order && u.order.home)) { setOrder(W, u, { t: 'move', x: hx, y: hy, home: true }); return; }
    if (u.order && u.order.t === 'attack') return;
    const t = nearestPrey(W, u, 5.5, hx, hy);
    if (t) setOrder(W, u, { t: 'attack', id: t.id, auto: true }); else wander(W, u, 1.5, 0.03);
  }
}
function treasureTick(W, tr) {
  const cx = tr.x + 0.5, cy = tr.y + 0.5;
  tr.guarded = tr.guards.some(id => { const g = alive(W, id); return g && Math.hypot(g.x - cx, g.y - cy) < 9; });
  if (tr.guarded) return;
  let taker = null;
  unitsNear(W, cx, cy, 1.4, (e) => { if (!taker && e.owner !== GAIA && !isAnimal(e) && e.hp > 0 && Math.hypot(e.x - cx, e.y - cy) <= 1.4) taker = e; });
  if (taker) {
    const P = W.players[taker.owner], T = TREASURES[tr.type];
    P.res[T.res] += tr.amount; P.stats.gathered += tr.amount; P.stats.gres[T.res] += tr.amount; P.stats.treasures++; addXp(W, P, tr.amount * XP.treasure);
    W.ev.push({ k: 'treasure', owner: taker.owner, x: cx, y: cy, type: tr.type, amount: tr.amount });
    del(W, tr.id);
  }
}
