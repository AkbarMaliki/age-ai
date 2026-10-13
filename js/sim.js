// Deterministic RTS simulation (no rendering). Fixed tick; commands are queued and applied at tick start
// so the same code can later run in lockstep online. Coordinates are in tiles; tile (i, j) spans [i, i+1) x [j, j+1).
import { UNITS, BUILDINGS, TECHS, RESOURCES, RATE, CARRY, START_RES, POP_LIMIT, RES, GAIA, TREASURES, MARKET, XP, CARDS, MILITARY, DAY, SEASONS, TER, FORMATIONS, CIVS, RELICS, START_PRESETS, WONDER_TIME, KOTH_TIME, LIFE, NAMES } from './data.js';

export const TICK = 0.1;            // game-seconds per tick
const SQ2 = Math.SQRT2;

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------------------------------------------------------------- world
const newMods = () => ({ gather: { food: 0, wood: 0, gold: 0, stone: 0, iron: 0 }, fish: 0, vilSpeed: 0, ma: 0, pa: 0, fee: 0, nightWork: 0, upkeep: 0, buildSpeed: 0, bldHp: 0, repair: 0,
  infHp: 0, cavSpeed: 0, archAtk: 0, trainSpeed: 0, towerAtk: 0, milHp: 0, trickle: 0, wallCost: 0, gunpowderCost: 0, techCost: 0 });
// opts: night = 'full' (villagers rest at night) | 'visual' | 'off'; season = key of SEASONS
export function createWorld({ size, terrain, players, seed = 1, opts = {} }) {
  const season = SEASONS[opts.season] ? opts.season : 'semi';
  const W = {
    t: 0, tick: 0, size, terrain, occ: new Int32Array(size * size), focc: new Int32Array(size * size), road: new Uint8Array(size * size), roadVer: 0,
    ents: new Map(), dyn: new Map(), ugrid: new Map(), nextId: 1,
    players: players.map((p, i) => ({ id: i, name: p.name, color: p.color, ai: !!p.ai, team: p.team ?? i, res: { ...((START_PRESETS[opts.startRes] || {}).res || START_RES) }, age: 1, pop: 0, popCap: 0, techs: new Set(), alive: true,
      vis: new Uint8Array(size * size), exp: new Uint8Array(size * size), stats: newStats(), housed: false, deck: p.deck || null, style: p.style || null,
      xp: 0, nextXp: XP.first, ships: 0, shipsEarned: 0, cards: [], shipment: null, mods: newMods(), sv: 0, spec: {}, hungry: false, spyUntil: 0, spyCd: 0, civ: CIVS[p.civ] ? p.civ : null })),
    cmds: [], ev: [], rnd: rng(seed), seed, paths: 0, nodes: 0, winner: -1, unreach: new Map(),
    market: { ...MARKET.base },
    opts: { night: opts.night || 'full', season, relicWin: !!opts.relicWin, life: opts.life !== false && opts.life !== 'off', victory: opts.victory || 'conquest', treaty: (+opts.treaty || 0) * 60, popLimit: +opts.popLimit || POP_LIMIT },
    wonders: new Map(), reseed: {}, season: SEASONS[season], frozen: !!SEASONS[season].frozen,
    night: false, day: 1, rainUntil: 0, weatherT: 90,
  };
  for (const P of W.players) {                 // civilization: lasting bonuses, start, unique unit at the Castle
    const cv = P.civ && CIVS[P.civ]; if (!cv) continue;
    if (cv.mods) applyMods(P, cv.mods);
    for (const r of RES) if (cv.start && cv.start[r]) P.res[r] += cv.start[r];
    P.spec.unique = cv.unique;
  }
  W.gaia = { id: GAIA, name: 'Alam', color: 'none', gaia: true, team: -1, res: { ...START_RES }, age: 1, pop: 0, popCap: 0, techs: new Set(), alive: true, stats: newStats(), mods: newMods(), sv: 0, spec: {} };
  return W;
}
// per-player war statistics (stats panel + end screen). killed / lost = units, razed / bldLost = buildings,
// vilKilled = enemy villagers slain, killVal / lostVal = resource value destroyed / lost, gres = gathered per resource,
// tr = units trained per type, treasures = chests collected
export function newStats() {
  return { units: 0, killed: 0, lost: 0, gathered: 0, built: 0, razed: 0, bldLost: 0, vilKilled: 0, killVal: 0, lostVal: 0, treasures: 0,
    gres: Object.fromEntries(RES.map(r => [r, 0])), tr: {}, trades: 0, repaired: 0, fished: 0, hungryDays: 0, shipsSunk: 0, techs: 0, healed: 0, bells: 0, converted: 0, relics: 0 };
}
// ---- Home City experience (AoE3): enough XP earns a shipment
export function addXp(W, P, n) {
  if (!P || P.gaia || !(n > 0)) return;
  P.xp += n;
  while (P.xp >= P.nextXp) { P.ships++; P.shipsEarned++; P.nextXp += XP.first + XP.step * P.shipsEarned; W.ev.push({ k: 'shipready', owner: P.id }); }
}
export function cardOk(P, id) {
  const c = CARDS[id]; return !!c && P.age >= c.age && (!P.deck || P.deck.includes(id)) && (c.repeat || !P.cards.includes(id));
}
// ---- market prices (shared by all players, like AoE2)
export const marketFee = (P) => Math.max(0.05, (P.techs.has('guilds') ? MARKET.feeGuilds : MARKET.fee) + P.mods.fee);
export const buyPrice = (W, P, r) => Math.round(W.market[r] * (1 + marketFee(P)));
export const sellPrice = (W, P, r) => Math.round(W.market[r] * (1 - marketFee(P)));
// buildings that keep a player in the game (walls, gates, farms, houses and foundations alone don't)
export const keepsAlive = (e) => e.hp > 0 && (e.kind === 'unit' ? !UNITS[e.type].animal : e.kind === 'building' && e.built && !BUILDINGS[e.type].wall && !BUILDINGS[e.type].gate && !['farm', 'house'].includes(e.type));
// a foundation nobody has started building can't be attacked (enemies used to fixate on fresh foundations)
export const targetable = (e) => !(e.kind === 'building' && !e.built && e.progress <= 0.001) && !e.inside;
export const costVal = (c) => RES.reduce((s, r) => s + ((c && c[r]) || 0), 0);
export const idx = (W, i, j) => j * W.size + i;
export const pl = (W, owner) => owner === GAIA ? W.gaia : W.players[owner];
export const isAnimal = (e) => e && e.kind === 'unit' && !!UNITS[e.type].animal;
const passive = (e) => isAnimal(e) && ['herd', 'flee', 'fight'].includes(UNITS[e.type].animal);   // not auto-targeted
export const inb = (W, i, j) => i >= 0 && j >= 0 && i < W.size && j < W.size;
const tileAt = (W, x, y) => idx(W, Math.min(W.size - 1, Math.max(0, Math.floor(x))), Math.min(W.size - 1, Math.max(0, Math.floor(y))));

// ---------------------------------------------------------------- derived stats (techs, doctrines, cards, specialists)
export function stat(W, owner, type) {
  const P = pl(W, owner);
  if (!P.sc || P.scv !== P.sv) { P.sc = {}; P.bc = {}; P.scv = P.sv; }
  let s = P.sc[type]; if (s) return s;
  const d = UNITS[type]; s = { ...d, bonus: { ...(d.bonus || {}) } }; P.sc[type] = s;
  if (P.gaia || d.animal) return s;
  const T = P.techs, M = P.mods, c = d.cls, mil = MILITARY(type);
  if (type === 'villager') {
    if (T.has('loom')) { s.hp += 15; s.ma += 1; s.pa += 2; }
    if (T.has('wheelbarrow')) s.speed *= 1.1;
    s.speed *= 1 + M.vilSpeed;
    if (T.has('doc_fortress')) { s.ma++; s.pa++; }
  }
  if (c === 'infantry' || c === 'cavalry') { if (T.has('forging')) s.atk++; if (T.has('iron_casting')) s.atk++; }
  if (c === 'infantry') {
    if (T.has('scale_mail')) { s.ma++; s.pa++; } if (T.has('chain_mail')) { s.ma++; s.pa += 2; }
    s.hp *= 1 + M.infHp;
    if (T.has('drill')) s.hp *= 1.15;
    if (T.has('doc_legion')) { s.hp *= 1.2; s.ma++; s.time *= 0.75; if (s.bonus.cavalry) s.bonus.cavalry += 5; }
    if (T.has('doc_formation')) s.pa++;
  }
  if (c === 'cavalry' || d.mounted) {        // horse archers ride with the cavalry upgrades
    if (T.has('scale_barding')) { s.ma++; s.pa++; } if (T.has('chain_barding')) { s.ma++; s.pa += 2; }
    if (T.has('doc_cavalry')) { s.atk += 2; s.hp *= 1.15; s.speed *= 1.1; }
    if (T.has('husbandry')) s.speed *= 1.1;
    s.speed *= 1 + M.cavSpeed;
  }
  if (c === 'archer') {
    if (T.has('fletching') && type !== 'gunner') { s.atk++; s.range++; s.los++; }
    if (T.has('bodkin') && type !== 'gunner') { s.atk++; s.range++; s.los++; }
    if (T.has('padded_archer')) { s.ma++; s.pa++; }
    s.atk += M.archAtk;
    if (T.has('doc_archers')) { s.range++; s.acc = Math.min(1, (s.acc || 1) + 0.15); s.bonus.infantry = (s.bonus.infantry || 0) + 1; s.time *= 0.75; }
    if (T.has('doc_formation')) { s.ma++; s.pa++; }
    if (T.has('thumb_ring') && s.proj !== 'bullet') { s.reload *= 0.85; s.acc = Math.min(1, (s.acc || 1) + 0.05); }
    if (T.has('parthian') && s.proj !== 'bullet') s.kite = true;            // hit and run
  }
  if (s.heal && T.has('medicine')) s.heal *= 1.5;
  // unit lines (AoE2 upgrades): every researched 'up' for this type adds its stats; the newest name wins
  for (const t of T) { const up = TECHS[t].up; if (!up || !up.types.includes(type)) continue;
    s.hp += up.hp || 0; s.atk += up.atk || 0; s.ma += up.ma || 0; s.pa += up.pa || 0; if (up.range) { s.range += up.range; s.los += up.range; }
    if (up.splash) s.splash = (s.splash || 0) + up.splash; if (up.vsBuilding) s.vsBuilding = (s.vsBuilding || 0) + up.vsBuilding;
    for (const c in up.bonus || {}) s.bonus[c] = (s.bonus[c] || 0) + up.bonus[c];
    if (!up.base || up.base === type) s.name = up.name;
    if (up.look && up.look[type]) s.sprite = up.look[type]; }          // the line also looks the part (render only)
  if (type === 'villager' && T.has('hand_cart')) s.speed *= 1.1;
  if (type === 'monk') { if (T.has('fervor')) s.speed *= 1.15; if (T.has('sanctity')) s.hp *= 1.5; if (T.has('illumination')) s.faith *= 0.5; }
  const cv = P.civ && CIVS[P.civ];
  if (cv) {
    const cs = cv.stat && cv.stat[c], us = cv.unitStat && cv.unitStat[type];
    for (const m of [cs, us]) if (m) { if (m.reload) s.reload *= m.reload; if (m.hp) s.hp *= m.hp; if (m.speed) s.speed *= m.speed; }
  }
  if (s.proj && T.has('ballistics')) s.acc = Math.min(1, (s.acc || 1) + 0.12);
  if (c === 'siege' && T.has('doc_blitz')) s.atk *= 1.2;
  if (c === 'ship' && T.has('careening')) { s.pa++; if (type === 'transport_ship') s.capacity += 5; }
  if (mil) {
    s.ma += M.ma; s.pa += M.pa; s.hp *= 1 + M.milHp; s.time *= 1 - M.trainSpeed;
    if (T.has('conscription')) s.time /= 1.33;
    if (T.has('doc_blitz')) { s.speed *= 1.12; s.vsBuilding = (s.vsBuilding || 0) + 4; }
  }
  s.hp = Math.round(s.hp);
  return s;
}
// buildings: hp / armour / attack after techs and cards
export function bstat(W, owner, type) {
  const P = pl(W, owner);
  if (!P.sc || P.scv !== P.sv) { P.sc = {}; P.bc = {}; P.scv = P.sv; }
  let s = P.bc[type]; if (s) return s;
  const d = BUILDINGS[type]; s = { ...d }; P.bc[type] = s;
  if (P.gaia) return s;
  const T = P.techs, M = P.mods;
  let hp = 1 + M.bldHp; if (T.has('masonry')) { hp += 0.15; s.ma++; s.pa++; } if (T.has('doc_fortress')) hp += 0.25;
  s.hp = Math.round(d.hp * hp);
  if (d.attack) {
    const a = { ...d.attack };
    if (T.has('fletching')) { a.atk++; a.range++; } if (T.has('bodkin')) { a.atk++; a.range++; }
    if (T.has('gunpowder')) a.atk += 2; if (T.has('doc_fortress')) { a.atk += 2; a.range++; }
    a.atk += M.towerAtk; a.acc = T.has('ballistics') ? 1 : 0.9;
    if (type === 'watch_tower' && T.has('guard_tower')) { a.atk += 2; a.range++; s.hp += 500; s.name = 'Menara Pengawal'; }
    if (type === 'watch_tower' && T.has('keep')) { a.atk += 3; a.range++; s.hp += 800; s.name = 'Benteng Menara'; }
    s.attack = a;
  }
  return s;
}
// techs / cards changed something: rebuild the stat cache and stretch the hit points of what's already on the field
function bumpStats(W, P) {
  P.sv++;
  for (const e of W.dyn.values()) {
    if (e.owner !== P.id) continue;
    const mx = e.kind === 'unit' ? stat(W, P.id, e.type).hp : e.kind === 'building' ? bstat(W, P.id, e.type).hp : 0;
    if (mx && mx !== e.maxHp) { e.hp = Math.max(1, e.hp * mx / e.maxHp); e.maxHp = mx; }
  }
}
export const costOf = (P, type) => {          // building cost after card discounts
  const c = BUILDINGS[type].cost; if (!(BUILDINGS[type].wall || BUILDINGS[type].gate) || !P.mods.wallCost) return c;
  return Object.fromEntries(Object.entries(c).map(([r, n]) => [r, Math.round(n * (1 + P.mods.wallCost))]));
};
export const techCost = (P, tech) => {
  const t = TECHS[tech], c = t.cost, f = (tech === 'gunpowder' ? 1 + P.mods.gunpowderCost : 1) * (t.toAge ? 1 : 1 - P.mods.techCost);
  if (f === 1) return c;
  return Object.fromEntries(Object.entries(c).map(([r, n]) => [r, Math.round(n * f)]));
};
export const techTime = (P, tech) => TECHS[tech].time * (TECHS[tech].toAge ? 1 : 1 - P.mods.techCost);
// specialist that replaces a base unit line once researched; 'unique' = the civilization's Castle unit
export const trainType = (P, type) => (P.spec && P.spec[type]) || type;
// unit price after civilization discounts
export const unitCost = (P, type) => {
  const c = UNITS[type].cost, f = P.civ && CIVS[P.civ] && CIVS[P.civ].cost && CIVS[P.civ].cost[type];
  return f ? Object.fromEntries(Object.entries(c).map(([r, n]) => [r, Math.round(n * f)])) : c;
};

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
  W.occ[idx(W, i, j)] = r.id; W.regionDirty = W.regionDirtyW = true; return r;
}
export function addBuilding(W, owner, type, i, j, built = false, opts = {}) {
  const d = BUILDINGS[type], bs = bstat(W, owner, type);
  const w = d.len && opts.axis === 'y' ? 1 : (d.len || d.n), h = d.len && opts.axis === 'y' ? d.len : d.n;
  const b = add(W, { kind: 'building', type, owner, x: i, y: j, w, h, axis: opts.axis || 'x', hp: built ? bs.hp : 1, maxHp: bs.hp, progress: built ? 1 : 0, built,
    queue: [], rally: null, cool: 0, nb: 0, food: type === 'farm' && W.players[owner] ? farmFood(W.players[owner]) : d.food || 0, placedAt: W.t, age: W.players[owner] ? W.players[owner].age : 1 });
  if (d.block) {
    for (let a = 0; a < w; a++) for (let c = 0; c < h; c++) { const k = idx(W, i + a, j + c); if (d.pen && c >= h - d.pen) { W.focc[k] = b.id; continue; } W.occ[k] = b.id; if (W.road[k]) { W.road[k] = 0; W.roadVer++; } }   // a barn's yard stays walkable
    W.regionDirty = W.regionDirtyW = true;
    // units standing on the new footprint step out of it (they used to get trapped inside and jitter forever)
    for (const u of W.dyn.values()) if (u.kind === 'unit' && u.x >= i - 0.3 && u.x < i + w + 0.3 && u.y >= j - 0.3 && u.y < j + h - (d.pen || 0) + 0.3) { unstick(W, u); u.path = null; }
  } else for (let a = 0; a < w; a++) for (let c = 0; c < h; c++) W.focc[idx(W, i + a, j + c)] = b.id;   // walkable footprints (farms) on their own grid
  if (built) onBuilt(W, b, true);
  return b;
}
export function addUnit(W, owner, type, x, y) {
  const d = UNITS[type], P = pl(W, owner), s = stat(W, owner, type);
  const u = add(W, { kind: 'unit', type, owner, x, y, px: x, py: y, hp: s.hp, maxHp: s.hp, dir: 90, anim: 'idle', aT: 0, order: null, path: null, cool: 0, carry: null, task: null, scan: 0, stuck: 0, home: [x, y],
    nav: !!d.naval, form: null, lastAtk: -99 });
  if (d.capacity) u.cargo = [];
  if (d.convert) u.faith = 1;
  if (!d.animal && owner !== GAIA) { P.pop++; P.stats.units++; P.stats.tr[type] = (P.stats.tr[type] || 0) + 1; }
  return u;
}
// King of the Hill: the monument in the middle (x, y = centre; tx, ty = top-left tile of its 3x3 footprint)
export function addMonument(W, i, j) { return W.monument = add(W, { kind: 'monument', type: 'monument', x: i + 1.5, y: j + 1.5, tx: i, ty: j, w: 3, h: 3, team: -1, owner: -1, since: 0 }); }
// a relic lying on the ground (x, y = tile of its sprite); carrier = monk id, inBld = monastery id
export function addRelic(W, i, j) { return add(W, { kind: 'relic', type: 'relic', x: i, y: j, w: 1, h: 1, carrier: 0, inBld: 0 }); }
export function addTreasure(W, type, i, j, amount) {
  return add(W, { kind: 'treasure', type, x: i, y: j, w: 1, h: 1, amount, guards: [] });
}
function onBuilt(W, b, silent) {
  const d = BUILDINGS[b.type], P = W.players[b.owner];
  b.built = true; b.progress = 1; b.hp = Math.max(b.hp, 1); if (silent) b.hp = b.maxHp;
  if (d.pop) P.popCap = Math.min(W.opts.popLimit || POP_LIMIT, P.popCap + d.pop);
  if (d.wonder && !silent) { W.wonders.set(b.id, W.t); W.ev.push({ k: 'wonderbuilt', owner: b.owner, secs: WONDER_TIME }); }
  if (!silent) { P.stats.built++; addXp(W, P, costVal(d.cost) * XP.build); W.ev.push({ k: 'built', x: b.x + b.w / 2, y: b.y + b.h / 2, owner: b.owner, type: b.type }); }
  if (!silent || b.type !== 'town_center') buildRoad(W, b);
  if (b.type === 'town_center') plaza(W, b);
}
// a paved square right round a Town Center (the heart of the town plan; also a road for speed)
function plaza(W, b) {
  let n = 0;
  for (let j = b.y - 1; j <= b.y + b.h; j++) for (let i = b.x - 1; i <= b.x + b.w; i++) {
    if (!inb(W, i, j) || (i >= b.x && i < b.x + b.w && j >= b.y && j < b.y + b.h)) continue;
    const k = idx(W, i, j); if (W.occ[k] || W.road[k] || W.terrain[k] === TER.WATER || W.terrain[k] === TER.ROCK) continue;
    W.road[k] = b.owner + 1; n++;
  }
  if (n) W.roadVer++;
}

// ---------------------------------------------------------------- roads: every finished building gets a lane to the town
// (Town Center / Castle, else the nearest road). Roads speed walking up and draw the town as it grows.
function buildRoad(W, b) {
  const d = BUILDINGS[b.type]; if (d.wall || d.gate || d.water || b.type === 'farm' || b.owner < 0) return;
  let hub = null, hd = 1e9;
  for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === b.owner && e.built && e !== b && (e.type === 'town_center' || e.type === 'castle')) { const dd = distTo(e, b.x + b.w / 2, b.y + b.h / 2); if (dd < hd) { hd = dd; hub = e; } }
  if (!hub || hd > 40) return;
  const door = (e) => { const i = Math.floor(e.x + e.w / 2), j = e.y + e.h; return passable(W, i, j) ? [i, j] : nearestFree(W, e.x + e.w / 2, e.y + e.h + 0.5, -1, 3); };
  const a = door(b), z = door(hub); if (!a || !z) return;
  const S = W.size, onRoad = (i, j) => W.road[j * S + i];
  const goal = (i, j) => (i === z[0] && j === z[1]) || (onRoad(i, j) && Math.hypot(i - a[0], j - a[1]) > 3);
  const p = findPath(W, -1, a[0] + 0.5, a[1] + 0.5, goal, z[0] + 0.5, z[1] + 0.5, 6000, false, true);
  if (!p.complete) return;
  let n = 0;
  const mark = (i, j) => { if (inb(W, i, j) && !W.occ[j * S + i] && W.terrain[j * S + i] !== TER.WATER && !W.road[j * S + i]) { W.road[j * S + i] = b.owner + 1; n++; } };     // owner + 1: the road takes its kingdom's look
  mark(a[0], a[1]);
  for (const [x, y] of p.raw) mark(Math.floor(x), Math.floor(y));
  if (n) { W.roadVer++; W.ev.push({ k: 'road', owner: b.owner }); }
}

// ---------------------------------------------------------------- passability / geometry
// nav = ships (open water only); land units cross water only when it is frozen. Mountains (ROCK) block everyone.
export function passable(W, i, j, owner = -1, nav = false) {
  if (!inb(W, i, j)) return false;
  const k = idx(W, i, j), ter = W.terrain[k];
  if (nav) { if (ter !== TER.WATER || W.frozen) return false; }
  else if (ter === TER.ROCK || (ter === TER.WATER && !W.frozen)) return false;
  const e = W.occ[k]; if (!e) return true;
  const o = W.ents.get(e); if (!o) { W.occ[k] = 0; return true; }
  return !nav && !!(o.kind === 'building' && BUILDINGS[o.type].gate && o.built && !o.locked && (o.owner === owner || (owner >= 0 && o.owner >= 0 && W.players[o.owner].team === W.players[owner].team)));
}
// distance from point to an entity's footprint (units: centre distance)
export function distTo(e, x, y) {
  if (e.kind === 'unit') return Math.hypot(e.x - x, e.y - y);
  const dx = Math.max(e.x - x, 0, x - (e.x + e.w)), dy = Math.max(e.y - y, 0, y - (e.y + e.h));
  return Math.hypot(dx, dy);
}
export const center = (e) => e.kind === 'unit' ? [e.x, e.y] : [e.x + e.w / 2, e.y + e.h / 2];
export const alive = (W, id) => { const e = W.ents.get(id); return e && (e.kind !== 'unit' || e.hp > 0) && (e.kind !== 'building' || e.hp > 0) && (e.kind !== 'res' || e.amount > 0) ? e : null; };
// treaty: no fighting between players until it runs out (nature stays hostile)
const enemies = (W, a, b) => a !== b && pl(W, a).team !== pl(W, b).team && !(a >= 0 && b >= 0 && W.opts.treaty && W.t < W.opts.treaty);
export const isEnemy = (W, a, b) => enemies(W, a, b);
export const onHill = (W, x, y) => W.terrain[tileAt(W, x, y)] === TER.HILL;
// connected walkable regions (gates count as open), one map for land and one for water
function regions(W, nav = false) {
  const key = nav ? 'regionW' : 'region', dk = nav ? 'regionDirtyW' : 'regionDirty', tk = nav ? 'regionTW' : 'regionT';
  if (W[key] && (!W[dk] || W.t - W[tk] < 1.0) && W[key + 'F'] === W.frozen) return W[key];
  const S = W.size, R = W[key] || (W[key] = new Int32Array(S * S)); R.fill(0);
  const open = (k) => {
    const ter = W.terrain[k];
    if (nav ? (ter !== TER.WATER || W.frozen) : (ter === TER.ROCK || (ter === TER.WATER && !W.frozen))) return false;
    const o = W.occ[k]; if (!o) return true; const e = W.ents.get(o); return !e || (!nav && e.kind === 'building' && BUILDINGS[e.type].gate);
  };
  let lab = 0; const q = new Int32Array(S * S);
  for (let k0 = 0; k0 < S * S; k0++) {
    if (R[k0] || !open(k0)) continue;
    lab++; let h = 0, t = 0; q[t++] = k0; R[k0] = lab;
    while (h < t) { const k = q[h++], i = k % S, j = (k / S) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ni = i + di, nj = j + dj; if (ni < 0 || nj < 0 || ni >= S || nj >= S) continue;
        const nk = nj * S + ni; if (R[nk] || !open(nk)) continue; if (di && dj && (!open(j * S + ni) || !open(nj * S + i))) continue; R[nk] = lab; q[t++] = nk; } }
  }
  W[key + 'F'] = W.frozen; W[dk] = false; W[tk] = W.t;
  return R;
}
export function regionAt(W, x, y, nav = false) {
  const R = regions(W, nav), S = W.size; let i = Math.floor(x), j = Math.floor(y);
  if (inb(W, i, j) && R[j * S + i]) return R[j * S + i];
  for (let r = 1; r <= 2; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const a = i + di, b = j + dj; if (inb(W, a, b) && R[b * S + a]) return R[b * S + a]; }
  return 0;
}
// can unit u stand somewhere within `reach` of target t?
export function canReach(W, u, t, reach) {
  const nav = !!u.nav, r0 = regionAt(W, u.x, u.y, nav); if (!r0) return true;
  const R = regions(W, nav), S = W.size;
  const x0 = Math.floor((t.kind === 'unit' ? t.x : t.x) - reach - 1), x1 = Math.floor((t.kind === 'unit' ? t.x : t.x + t.w) + reach + 1);
  const y0 = Math.floor((t.kind === 'unit' ? t.y : t.y) - reach - 1), y1 = Math.floor((t.kind === 'unit' ? t.y : t.y + t.h) + reach + 1);
  // same test as the path goal (goalNear), so "reachable" really means a path can end there
  const ok = t.kind === 'unit' ? (i, j) => Math.hypot(i + 0.5 - t.x, j + 0.5 - t.y) <= Math.max(reach, 1.0) : (i, j) => distTo(t, i + 0.5, j + 0.5) <= Math.max(reach, NEAR);
  for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) { if (!inb(W, i, j) || R[j * S + i] !== r0) continue; if (ok(i, j)) return true; }
  return false;
}
// targets a side has found to be unreachable (walled in, deep in a forest, out at sea) are skipped for a while
export const unreachable = (W, id, owner) => (W.unreach.get(id * 16 + owner + 1) || 0) > W.t;
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
// cost: hills cost more to climb, roads less. raw = keep the unsmoothed tile path (roads use it)
export function findPath(W, owner, sx, sy, goal, tx, ty, maxNodes = 0, nav = false, raw = false) {
  // long trips: weighted A* (explores far fewer nodes on open maps) and a bigger node allowance
  const far = Math.hypot(tx - sx, ty - sy), hw = far > 24 ? 1.8 : 1.15;
  if (!maxNodes) maxNodes = Math.min(W.size > 200 ? 16000 : 9000, 2500 + far * 45);
  const N = W.size * W.size, S = W.size, T = W.terrain, Rd = W.road;
  if (!G.g || G.g.length !== N) { G.g = new Float32Array(N); G.from = new Int32Array(N); G.stamp = new Uint32Array(N); }
  G.cur++; const st = G.cur;
  let si = Math.floor(sx), sj = Math.floor(sy);
  if (!passable(W, si, sj, owner, nav)) { const f = nearestFree(W, sx, sy, owner, 3, nav); if (f) { si = f[0]; sj = f[1]; } }
  const s = idx(W, si, sj);
  const h = (i, j) => { const dx = Math.abs(i + 0.5 - tx), dy = Math.abs(j + 0.5 - ty); return Math.max(dx, dy) + (SQ2 - 1) * Math.min(dx, dy); };
  const open = new Heap(); G.g[s] = 0; G.from[s] = -1; G.stamp[s] = st; open.push(s, h(si, sj) * hw);
  let best = s, bestH = h(si, sj), n = 0, found = -1;
  while (open.size && n++ < maxNodes) {
    const k = open.pop(), i = k % S, j = (k / S) | 0;
    if (goal(i, j)) { found = k; break; }
    const hk = h(i, j); if (hk < bestH) { bestH = hk; best = k; }
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj; if (!passable(W, ni, nj, owner, nav)) continue;
      if (di && dj && (!passable(W, i + di, j, owner, nav) || !passable(W, i, j + dj, owner, nav))) continue;
      const nk = nj * S + ni, ter = T[nk];
      const ng = G.g[k] + (di && dj ? SQ2 : 1) * (nav ? 1 : ter === TER.HILL ? 1.45 : Rd[nk] ? 0.85 : 1);
      if (G.stamp[nk] === st && G.g[nk] <= ng) continue;
      G.stamp[nk] = st; G.g[nk] = ng; G.from[nk] = k; open.push(nk, ng + h(ni, nj) * hw);
    }
  }
  W.paths++; W.nodes += n;
  const end = found >= 0 ? found : best;
  const pts = []; for (let k = end; k !== -1 && k !== s; k = G.from[k]) pts.push([k % S + 0.5, ((k / S) | 0) + 0.5]);
  pts.reverse();
  return { pts: smooth(W, owner, sx, sy, pts, nav), raw: raw ? pts : null, complete: found >= 0, exhausted: found < 0 && open.size === 0 };
}
function lineFree(W, owner, x0, y0, x1, y1, nav = false) {
  const d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / 0.3);
  for (let s = 1; s <= n; s++) { const x = x0 + (x1 - x0) * s / n, y = y0 + (y1 - y0) * s / n;
    if (!passable(W, Math.floor(x), Math.floor(y), owner, nav) || !passable(W, Math.floor(x + 0.22), Math.floor(y + 0.22), owner, nav) || !passable(W, Math.floor(x - 0.22), Math.floor(y - 0.22), owner, nav)
      || !passable(W, Math.floor(x + 0.22), Math.floor(y - 0.22), owner, nav) || !passable(W, Math.floor(x - 0.22), Math.floor(y + 0.22), owner, nav)) return false; }
  return true;
}
function smooth(W, owner, sx, sy, pts, nav) {
  if (pts.length < 3) return pts;
  const out = []; let ax = sx, ay = sy, i = 0;
  while (i < pts.length) {
    let j = Math.min(pts.length - 1, i + 10);            // bounded look-ahead keeps long paths linear
    while (j > i && !lineFree(W, owner, ax, ay, pts[j][0], pts[j][1], nav)) j--;
    out.push(pts[j]); ax = pts[j][0]; ay = pts[j][1]; i = j + 1;
  }
  return out;
}
export function nearestFree(W, x, y, owner, R = 6, nav = false) {
  const ci = Math.floor(x), cj = Math.floor(y);
  let best = null, bd = 1e9;
  for (let r = 0; r <= R; r++) {
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !passable(W, i, j, owner, nav)) continue;
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
export function canTrain(W, pid, type) {
  const d = UNITS[type], P = W.players[pid]; if (!d) return false;
  return P.age >= d.age && (!d.needsTech || P.techs.has(d.needsTech) || (P.spec && P.spec.unique === type));   // a civ's unique unit skips its research
}
export function placementOk(W, pid, type, i, j, axis = 'x') {
  const d = BUILDINGS[type], P = W.players[pid];
  const w = d.len && axis === 'y' ? 1 : (d.len || d.n), h = d.len && axis === 'y' ? d.len : d.n;
  for (let a = 0; a < w; a++) for (let c = 0; c < h; c++) {
    const ii = i + a, jj = j + c; if (!inb(W, ii, jj)) return false;
    const k = idx(W, ii, jj), ter = W.terrain[k];
    if (W.occ[k] || !P.exp[k] || ter === TER.ROCK) return false;
    if (d.water ? ter !== TER.WATER : ter === TER.WATER) return false;
    if (W.focc[k] && W.ents.has(W.focc[k])) return false;     // nothing goes on top of a farm (farmers got trapped under houses)
  }
  if (d.water) {     // a dock needs a shore next to it
    let shore = false;
    for (let a = -1; a <= w && !shore; a++) for (let c = -1; c <= h && !shore; c++) { const ii = i + a, jj = j + c; if ((a < 0 || a >= w || c < 0 || c >= h) && inb(W, ii, jj) && W.terrain[idx(W, ii, jj)] !== TER.WATER && W.terrain[idx(W, ii, jj)] !== TER.ROCK) shore = true; }
    if (!shore) return false;
  }
  return true;
}
export function techOk(W, pid, tech, bld) {
  const t = TECHS[tech], P = W.players[pid];
  if (P.techs.has(tech) || P.age < t.age) return false;
  if (t.toAge && P.age !== t.toAge - 1) return false;
  if (t.after && !P.techs.has(t.after)) return false;
  if (t.group && [...P.techs].some(x => TECHS[x].group === t.group)) return false;          // exclusive choice already made
  for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === pid && e.queue.some(q => q.tech === tech || (t.group && TECHS[q.tech || ''] && TECHS[q.tech].group === t.group))) return false;
  if (t.reqCount) { const have = new Set(); for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === pid && e.built && t.reqFrom.includes(e.type)) have.add(e.type); if (have.size < t.reqCount) return false; }
  return true;
}

function applyCmd(W, c) {
  CMD = { user: true, q: !!c.q };
  try { applyCmd0(W, c); } finally { CMD = { user: false, q: false }; }
}
function applyCmd0(W, c) {
  const P = W.players[c.pid]; if (!P || !P.alive) return;
  switch (c.t) {
    case 'move': {
      const us = own(W, c.pid, c.ids); formation(W, us, c.x, c.y, (u, x, y, gs) => setOrder(W, u, { t: 'move', x, y, amove: !!c.amove, gs }), c.form);
      if (us.length) W.ev.push({ k: 'ack', owner: c.pid, x: c.x, y: c.y, type: us[0].type, move: 1 });
      break;
    }
    case 'form': { for (const u of own(W, c.pid, c.ids)) u.form = FORMATIONS[c.f] ? c.f : null; break; }
    case 'smart': {
      let us = own(W, c.pid, c.ids); const tgt = c.target ? alive(W, c.target) : null;
      if (!us.length) break;
      if (tgt && tgt.kind === 'building' && BUILDINGS[tgt.type].pen && tgt.owner === c.pid && tgt.built) {      // livestock into the barn's yard
        for (const u of us.filter(u => UNITS[u.type].animal === 'herd')) { const [x, y] = penSpot(W, tgt, u.id); setOrder(W, u, { t: 'move', x, y }); u.toPen = tgt.id; }
        us = us.filter(u => UNITS[u.type].animal !== 'herd'); if (!us.length) break;
      }
      if (!tgt) {
        const ships = us.filter(u => u.cargo && u.cargo.length && !passable(W, Math.floor(c.x), Math.floor(c.y), u.owner, true));
        for (const s of ships) setOrder(W, s, { t: 'unload', x: c.x, y: c.y });
        const rest = us.filter(u => !ships.includes(u));
        if (rest.length) applyCmd(W, { t: 'move', pid: c.pid, ids: rest.map(u => u.id), x: c.x, y: c.y });
        break;
      }
      const rest = [];
      for (const u of us) {
        const vil = u.type === 'villager', s = stat(W, u.owner, u.type);
        if (isAnimal(u)) { rest.push(u); continue; }
        if (tgt.kind === 'treasure') { setOrder(W, u, { t: 'move', x: tgt.x + 0.5, y: tgt.y + 0.5 }); continue; }
        if (vil && tgt.kind === 'unit' && UNITS[tgt.type].food) { setOrder(W, u, { t: 'attack', id: tgt.id, hunt: true }); continue; }   // hunt / slaughter
        if (tgt.kind === 'unit' && isAnimal(tgt) && tgt.owner === u.owner) { rest.push(u); continue; }
        if (tgt.kind === 'unit' && tgt.owner === u.owner && tgt.cargo && tgt.nav && !u.nav) { setOrder(W, u, { t: 'board', id: tgt.id }); continue; }   // climb aboard a transport
        if (s.convert && tgt.kind === 'relic') { setOrder(W, u, { t: 'relic', id: tgt.id }); continue; }
        if (s.convert && u.relic && tgt.kind === 'building' && tgt.owner === u.owner && BUILDINGS[tgt.type].relics) { setOrder(W, u, { t: 'relic', id: u.relic, to: tgt.id }); continue; }
        if (s.convert && tgt.kind === 'unit' && enemies(W, tgt.owner, u.owner) && convertible(tgt)) { setOrder(W, u, { t: 'convert', id: tgt.id }); continue; }
        if (s.heal && tgt.kind === 'unit' && !enemies(W, tgt.owner, u.owner) && !isAnimal(tgt) && tgt.id !== u.id) { setOrder(W, u, { t: 'heal', id: tgt.id }); continue; }
        if (tgt.kind === 'relic') { setOrder(W, u, { t: 'move', x: tgt.x + 0.5, y: tgt.y + 1.5 }); continue; }
        if (s.trade && tgt.kind === 'building' && (BUILDINGS[tgt.type].market && !u.nav || tgt.type === 'dock' && u.nav) && tgt.built && !enemies(W, tgt.owner, u.owner)) {
          const home = (u.homeB && alive(W, u.homeB)) || nearestOwn(W, u, u.nav ? 'dock' : 'market', tgt.id);
          if (home && home.id !== tgt.id) { setOrder(W, u, { t: 'trade', home: home.id, dest: tgt.id, leg: 1 }); continue; }
        }
        if (!vil && MILITARY(u.type) && (tgt.kind === 'building' || tgt.type === 'ram') && tgt.owner === u.owner && canGarrison(W, u, tgt)) { setOrder(W, u, { t: 'garrison', id: tgt.id }); continue; }
        if (tgt.kind === 'unit' || tgt.kind === 'building') {
          if (enemies(W, tgt.owner, u.owner)) {
            if (!targetable(tgt) || (!s.atk && !UNITS[u.type].packs) || (u.type === 'ram' && tgt.kind !== 'building')) { rest.push(u); continue; }
            setOrder(W, u, { t: 'attack', id: tgt.id }); continue;
          }
          if (vil && tgt.kind === 'building' && tgt.owner === u.owner) {
            if (!tgt.built) { setOrder(W, u, { t: 'build', id: tgt.id }); continue; }
            if (tgt.type === 'farm') { setOrder(W, u, { t: 'gather', id: tgt.id }); continue; }
            if (u.carry && u.carry.n > 0 && (BUILDINGS[tgt.type].drop || []).includes(u.carry.res)) { setOrder(W, u, { t: 'drop', id: tgt.id, then: null }); continue; }
            if (tgt.hp < tgt.maxHp) { setOrder(W, u, { t: 'repair', id: tgt.id }); continue; }
          }
        }
        if (tgt.kind === 'res' && (vil || (s.fisher && tgt.type === 'fish'))) { setOrder(W, u, { t: 'gather', id: tgt.id }); continue; }
        if (s.fisher && tgt.kind === 'building' && tgt.owner === u.owner && tgt.type === 'dock' && u.carry && u.carry.n > 0) { setOrder(W, u, { t: 'drop', id: tgt.id, then: null }); continue; }
        rest.push(u);
      }
      if (rest.length) formation(W, rest, c.x, c.y, (u, x, y, gs) => setOrder(W, u, { t: 'move', x, y, gs }), c.form);
      // a transport sails to the coast next to the boarding party (like AoE2)
      const boarders = us.filter(u => u.order && u.order.t === 'board');
      if (boarders.length && tgt.nav && (!tgt.order || tgt.order.t === 'move')) {
        const bx = boarders.reduce((a, u) => a + u.x, 0) / boarders.length, by = boarders.reduce((a, u) => a + u.y, 0) / boarders.length;
        const coast = coastNear(W, bx, by, tgt.owner); if (coast) setOrder(W, tgt, { t: 'move', x: coast[0], y: coast[1] });
      }
      W.ev.push({ k: 'ack', owner: c.pid, x: c.x, y: c.y, type: us[0].type, tgt: tgt.kind });
      break;
    }
    case 'unload': { for (const s of own(W, c.pid, c.ids)) if (s.cargo && s.cargo.length) setOrder(W, s, { t: 'unload', x: c.x, y: c.y }); break; }
    case 'place': {
      const d = BUILDINGS[c.type]; if (!d || !canBuild(W, c.pid, c.type)) break;
      const tiles = c.tiles || [[c.i, c.j]], cost = costOf(P, c.type);
      let made = [];
      for (const [i, j] of tiles) {
        if (!canAfford(P, cost) || !placementOk(W, c.pid, c.type, i, j, c.axis)) continue;
        pay(P, cost); made.push(addBuilding(W, c.pid, c.type, i, j, false, { axis: c.axis }));
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
      const type = trainType(P, c.type), d = UNITS[type], bd = BUILDINGS[b.type];
      const cost = d && unitCost(P, type);
      if (!d || !(bd.trains || []).includes(c.type) || !canTrain(W, c.pid, type) || b.queue.length >= 5 || !canAfford(P, cost)) break;
      pay(P, cost); b.queue.push({ unit: type, t: 0, cost });
      break;
    }
    case 'research': {
      const b = alive(W, c.bid); if (!b || b.owner !== c.pid || !b.built) break;
      const t = TECHS[c.tech], cost = t && techCost(P, c.tech); if (!t || t.at !== b.type || !techOk(W, c.pid, c.tech, b) || !canAfford(P, cost) || b.queue.length >= 5) break;
      pay(P, cost); b.queue.push({ tech: c.tech, t: 0, cost });
      break;
    }
    case 'cancel': {
      const b = alive(W, c.bid); if (!b || b.owner !== c.pid) break;
      const q = b.queue[c.i]; if (!q) break;
      refund(P, q.cost || (q.unit ? UNITS[q.unit].cost : TECHS[q.tech].cost)); b.queue.splice(c.i, 1);
      break;
    }
    case 'rally': { const b = alive(W, c.bid); if (b && b.owner === c.pid) b.rally = { x: c.x, y: c.y, id: c.target || 0 }; break; }
    case 'trade': {      // market: buy or sell one lot (100) of a resource for gold
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
    case 'ability': {    // Akademi: send spies -> enemy positions for 30 s and an intelligence report
      const b = alive(W, c.bid); if (!b || b.owner !== c.pid || !b.built || BUILDINGS[b.type].ability !== 'spy' || !P.techs.has('spy_network') || W.t < P.spyCd) break;
      P.spyUntil = W.t + 30; P.spyCd = W.t + 120;
      W.ev.push({ k: 'spy', owner: c.pid, report: spyReport(W, c.pid) });
      break;
    }
    case 'resign': resign(W, c.pid); break;
    case 'stop': for (const u of own(W, c.pid, c.ids)) { setOrder(W, u, null); u.oq = null; } break;
    // garrison into a building (TC, castle, towers) or infantry into a ram; ungarrison lets everyone out
    case 'garrison': { const b = alive(W, c.target); if (!b) break; for (const u of own(W, c.pid, c.ids)) if (canGarrison(W, u, b)) setOrder(W, u, { t: 'garrison', id: b.id }); break; }
    case 'ungarrison': { const b = alive(W, c.bid); if (!b || b.owner !== c.pid) break; for (const u of W.dyn.values()) if (u.kind === 'unit' && u.inside === b.id && u.order && u.order.t === 'garrison') { leaveHome(W, u); u.order = null; } break; }
    case 'pack': for (const u of own(W, c.pid, c.ids)) if (UNITS[u.type].packs && !(u.packT > 0)) { u.packT = 4; u.packTo = UNITS[u.type].packs; u.path = null; } break;
    case 'lock': { const b = alive(W, c.bid); if (b && b.owner === c.pid && BUILDINGS[b.type].gate) { b.locked = !b.locked; W.regionDirty = true; } break; }
    case 'reseed': {       // pre-pay farms: an exhausted farm is replanted on the spot (mill queue)
      const cost = costOf(P, 'farm'), n = W.reseed[c.pid] || 0;
      for (let k = 0; k < Math.min(5, c.n | 0); k++) if (canAfford(P, cost) && (W.reseed[c.pid] || 0) < 40) { pay(P, cost); W.reseed[c.pid] = (W.reseed[c.pid] || 0) + 1; }
      if (c.n < 0 && n > 0) { refund(P, cost, 1); W.reseed[c.pid] = n - 1; }
      break;
    }
    case 'fishtrap': {     // a dock lays a fish trap in open water nearby
      const b = alive(W, c.bid), cost = { wood: 100 }; if (!b || b.owner !== c.pid || b.type !== 'dock' || !b.built || P.age < 2 || !canAfford(P, cost)) break;
      let spot = null;
      for (let r = 3; r <= 14 && !spot; r++) for (let k = 0; k < r * 6 && !spot; k++) {
        const a = k / (r * 6) * Math.PI * 2, i = Math.round(b.x + 1 + Math.cos(a) * r), j = Math.round(b.y + 1 + Math.sin(a) * r);
        let ok = true; for (let dj = -1; dj <= 1 && ok; dj++) for (let di = -1; di <= 1 && ok; di++) ok = passable(W, i + di, j + dj, c.pid, true);
        if (ok) spot = [i, j];
      }
      if (!spot) break;
      pay(P, cost); const f = addResource(W, 'fish', spot[0], spot[1]); f.amount = f.max = 700; f.trap = true; f.owner = c.pid;
      W.ev.push({ k: 'fishtrap', owner: c.pid, x: spot[0] + 0.5, y: spot[1] + 0.5 });
      break;
    }
    case 'tribute': {      // send resources to another player (20% lost on the way)
      const Q = W.players[c.to], n = Math.floor(+c.n || 0); if (!Q || !Q.alive || c.to === c.pid || !RES.includes(c.res) || n <= 0 || P.res[c.res] < n) break;
      P.res[c.res] -= n; Q.res[c.res] += Math.floor(n * 0.8); W.ev.push({ k: 'tribute', owner: c.pid, to: c.to, res: c.res, n: Math.floor(n * 0.8) });
      break;
    }
    case 'flare': W.ev.push({ k: 'flare', owner: c.pid, x: +c.x, y: +c.y }); break;
    // patrol between where each unit stands and the point; guard (follow) a friendly unit; bombard a spot
    case 'patrol': {
      const us = own(W, c.pid, c.ids).filter(u => MILITARY(u.type) && stat(W, u.owner, u.type).atk > 0);
      const pts = Array.isArray(c.pts) ? c.pts.slice(0, 16).map(p => [+p[0], +p[1]]).filter(p => isFinite(p[0]) && isFinite(p[1])) : null;
      us.forEach((u, k) => setOrder(W, u, pts && pts.length >= 2 ? { t: 'patrol', pts, i: Math.floor(k * pts.length / us.length), guard: !!c.guard } : { t: 'patrol', ax: u.x, ay: u.y, bx: c.x, by: c.y, leg: 1 }));
      break;
    }
    case 'follow': { const t = alive(W, c.target); if (!t || t.kind !== 'unit') break; for (const u of own(W, c.pid, c.ids)) if (u !== t && !u.nav) setOrder(W, u, enemies(W, t.owner, u.owner) ? { t: 'attack', id: t.id } : { t: 'follow', id: t.id }); break; }
    case 'ground': for (const u of own(W, c.pid, c.ids)) if (stat(W, u.owner, u.type).splash) setOrder(W, u, { t: 'ground', x: c.x, y: c.y }); break;
    // stance: agresif (default: chase what it sees) | bertahan (fight, then return to its post) | diam (stand ground) | pasif (never auto-attack)
    case 'stance': for (const u of own(W, c.pid, c.ids)) if (MILITARY(u.type) && STANCES.includes(c.s)) { u.stance = c.s === 'agresif' ? undefined : c.s; if (u.order && u.order.auto) setOrder(W, u, null); } break;
    // town bell: every villager runs into the nearest shelter (Town Center, castle, tower, house) and adds arrows; ring again to go back to work
    case 'bell': {
      if (!!P.bell === !!c.on) break;
      P.bell = !!c.on;
      if (P.bell) { P.stats.bells++; restVillagers(W, P, true); W.ev.push({ k: 'bell', owner: P.id, on: true }); break; }
      for (const u of W.dyn.values()) if (u.kind === 'unit' && u.owner === P.id && u.bell) {
        u.bell = false; if (restNow(W, P)) continue;                       // it is night anyway: they stay in
        leaveHome(W, u); if (u.order && u.order.t === 'rest') setOrder(W, u, u.saved && u.saved.t !== 'idle' ? u.saved : null); u.saved = null;
      }
      W.ev.push({ k: 'bell', owner: P.id, on: false });
      break;
    }
    case 'delete': {
      const e = W.ents.get(c.id); if (!e || e.owner !== c.pid) break;
      if (e.kind === 'building' && !e.built) refund(P, costOf(P, e.type), 1 - e.progress);
      damage(W, e, 1e9, null);
      break;
    }
  }
}
// lay a group out around the target point. f = formation key; tempur puts melee in front and ranged / siege behind.
// Formations (other than a single unit or 'garis') march at the pace of their slowest member (gs).
function formation(W, us, x, y, fn, force) {
  const n = us.length; if (!n) return;
  if (n === 1) { fn(us[0], x, y); return; }
  const f = force || us[0].form || 'garis';
  const sp = f === 'menyebar' ? 1.5 : f === 'kotak' ? 0.65 : 0.75;
  const cols = f === 'kotak' ? Math.ceil(Math.sqrt(n)) : f === 'garis' ? Math.ceil(Math.sqrt(n * 1.6)) : Math.ceil(Math.sqrt(n * 2));
  const cx = us.reduce((s, u) => s + u.x, 0) / n, cy = us.reduce((s, u) => s + u.y, 0) / n;
  const ang = Math.atan2(y - cy, x - cx);
  const fx = Math.cos(ang), fy = Math.sin(ang), rx = -fy, ry = fx;
  const gs = f !== 'garis' ? Math.min(...us.map(u => stat(W, u.owner, u.type).speed)) : 0;
  const rank = (u) => { const c = stat(W, u.owner, u.type).cls; return f !== 'tempur' ? 0 : c === 'infantry' ? 0 : c === 'cavalry' ? 1 : c === 'archer' ? 2 : c === 'siege' ? 3 : 1; };
  const order = [...us].sort((a, b) => rank(a) - rank(b) || Math.hypot(b.x - x, b.y - y) - Math.hypot(a.x - x, a.y - y));
  const slots = [];
  for (let k = 0; k < n; k++) { const r = Math.floor(k / cols), c = k % cols - (Math.min(cols, n - r * cols) - 1) / 2; slots.push([x + rx * c * sp - fx * r * sp, y + ry * c * sp - fy * r * sp]); }
  if (f === 'tempur') { order.forEach((u, k) => fn(u, slots[k][0], slots[k][1], gs)); return; }
  // otherwise: nearest free slot for each unit, farthest units first
  const left = new Set(slots.map((_, i) => i));
  for (const u of order) {
    let bi = -1, bd = 1e9; for (const i of left) { const d = Math.hypot(slots[i][0] - u.x, slots[i][1] - u.y); if (d < bd) { bd = d; bi = i; } }
    left.delete(bi); fn(u, slots[bi][0], slots[bi][1], gs);
  }
}
export const STANCES = ['agresif', 'bertahan', 'diam', 'pasif'];
let CMD = { user: false, q: false };          // while a player command is applied: is it shift-queued?
export function setOrder(W, u, o) {
  if (CMD.user) {
    if (CMD.q && o && (u.order || (u.oq && u.oq.length))) { (u.oq ||= []).push(o); return; }
    u.oq = null;
  } u.order = o; u.path = null; u.wait = 0; if (o && o.t !== 'gather' && o.t !== 'drop' && u.type === 'villager' && o.t !== 'build' && o.t !== 'repair') u.task = o.t === 'attack' ? null : u.task; }

// ---------------------------------------------------------------- tick
export function step(W) {
  for (const c of W.cmds.splice(0)) applyCmd(W, c);
  W.t += TICK; W.tick++; W.paths = 0; W.nodes = 0;
  if (W.tick % 10 === 0) dayTick(W);
  const list = [...W.dyn.values()];
  for (const e of list) if (e.kind === 'unit') { e.px = e.x; e.py = e.y; }
  buildGrid(W);
  if (W.tick % 5 === 0) formationTick(W);
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
  for (const P of W.players) {
    if (!P.alive) continue;
    if (P.shipment && (P.shipment.t -= TICK) <= 0) deliver(W, P);
    if (P.mods.trickle) { P.res.gold += P.mods.trickle * TICK; P.stats.gathered += P.mods.trickle * TICK; P.stats.gres.gold += P.mods.trickle * TICK; }
  }
  if (W.tick % 10 === 0) for (const r in W.market) { const b = MARKET.base[r]; W.market[r] += Math.sign(b - W.market[r]) * Math.min(Math.abs(b - W.market[r]), MARKET.drift * 10 * TICK); }
  if (W.tick % 4 === 0) updateVision(W);
  if (W.tick % 10 === 0) checkVictory(W);
  if (W.tick % 10 === 5) { relicTick(W); ruleTick(W); }
  if (W.tick % 10 === 7) { barnTick(W); if (W.opts.life) lifeTick(W); }
}

// ---------------------------------------------------------------- day / night, food upkeep, weather
export const timeOfDay = (W) => (W.t % DAY.len) / DAY.len;
function dayTick(W) {
  if (W.opts.night !== 'off') {
    const night = timeOfDay(W) >= 1 - DAY.night;
    if (night !== W.night) {
      W.night = night;
      W.midnight = false;
      if (night) { W.ev.push({ k: 'dusk' }); if (W.opts.night === 'full') for (const P of W.players) if (P.alive) restVillagers(W, P); }
      else { W.day++; W.ev.push({ k: 'dawn', day: W.day }); for (const P of W.players) if (P.alive) { wakeVillagers(W, P); upkeep(W, P); } }
    }
  }
  if (W.night && !W.midnight && timeOfDay(W) >= MIDNIGHT) {       // the late shift ends
    W.midnight = true;
    if (W.opts.night === 'full') for (const P of W.players) if (P.alive && worksAtNight(W, P)) restVillagers(W, P);
  }
  // weather: showers come and go (more in autumn); snowfall in winter is purely visual
  if ((W.weatherT -= 1) <= 0) {
    W.weatherT = 60 + W.rnd() * 60;
    const p = W.season.rain ?? 0.15;
    if (W.t > W.rainUntil && W.rnd() < p) { W.rainUntil = W.t + 50 + W.rnd() * 70; W.ev.push({ k: 'weather', rain: true, snow: !!W.season.snow }); }
  }
}
export const raining = (W) => W.t < W.rainUntil;
// every dawn the people eat; an empty granary makes them hungry (slower work) for the day
function upkeep(W, P) {
  const per = DAY.upkeep * Math.max(0, 1 + P.mods.upkeep) * (P.techs.has('granary') ? 0.6 : 1);
  const need = Math.ceil(P.pop * per);
  if (P.res.food >= need) { P.res.food -= need; P.hungry = false; W.ev.push({ k: 'upkeep', owner: P.id, food: need }); }
  else { P.res.food = 0; P.hungry = true; P.stats.hungryDays++; W.ev.push({ k: 'hungry', owner: P.id, food: need }); }
  for (const u of W.dyn.values()) if (u.kind === 'unit' && u.owner === P.id && u.hu !== undefined) { u.hu = P.hungry ? Math.min(u.hu, 35) : 100; if (u.slept >= 25) u.en = Math.max(u.en, 90); u.slept = 0; }     // breakfast (or not), a night's sleep
}
// torches (tech or card): a late shift — villagers keep working by torchlight until midnight, then go in too
const worksAtNight = (W, P) => P.mods.nightWork || P.techs.has('torches');
export const MIDNIGHT = 1 - DAY.night / 2;
// villagers of P should be indoors right now
export const restNow = (W, P) => !!P.bell || (W.night && W.opts.night === 'full' && (!worksAtNight(W, P) || timeOfDay(W) >= MIDNIGHT));
// dusk: gatherers and idle villagers walk home and go inside for the night (hidden, safe); builders and soldiers carry on.
// Each house shelters 5, a Town Center 15; when every home is full they squeeze into the nearest one anyway.
const ROOM = { house: 5, town_center: 15, castle: 20, watch_tower: 5 };      // shelters (night, town bell)
function restVillagers(W, P, all = false) {
  if (!restNow(W, P)) return;
  const homes = [...W.dyn.values()].filter(e => e.kind === 'building' && e.owner === P.id && e.built && ROOM[e.type]);
  if (!homes.length) return;
  const used = new Map();
  for (const u of W.dyn.values()) {
    if (u.kind !== 'unit' || u.owner !== P.id || (u.type !== 'villager' && u.type !== 'child') || u.inside || (u.order && u.order.t === 'rest') || (u.order && !all && !['gather', 'drop', 'build', 'repair'].includes(u.order.t))) continue;
    let h = null, hd = 1e9, any = null, ad = 1e9;
    for (const b of homes) { const dd = distTo(b, u.x, u.y); if (dd < ad) { ad = dd; any = b; } if ((used.get(b.id) || 0) < ROOM[b.type] && dd < hd) { hd = dd; h = b; } }
    const own = u.homeId && W.ents.get(u.homeId); if (own && own.built && !P.bell) h = own;          // families sleep at home
    h = h || any; used.set(h.id, (used.get(h.id) || 0) + 1);
    u.saved = u.order && u.order.t !== 'attack' && u.order.t !== 'move' ? u.order : { t: 'idle' };
    const tav = !P.bell && u.type === 'villager' && (u.fu ?? 100) < 70 && tavernFor(W, u);      // a drink at the tavern on the way home
    setOrder(W, u, tav ? { t: 'visit', id: tav.id, why: 'tavern', then: { t: 'rest', id: h.id } } : { t: 'rest', id: h.id }); if (P.bell) u.bell = true;
  }
}
function goHome(W, u) {
  let h = null, hd = 1e9;
  for (const b of W.dyn.values()) if (b.kind === 'building' && b.owner === u.owner && b.built && ROOM[b.type]) { const dd = distTo(b, u.x, u.y); if (dd < hd) { hd = dd; h = b; } }
  if (h) { u.saved = { t: 'idle' }; setOrder(W, u, { t: 'rest', id: h.id }); }
}
function leaveHome(W, u) {
  if (!u.inside) return;
  const h = W.ents.get(u.inside); u.inside = 0;
  if (h && h.kind === 'building') { const f = nearestFree(W, h.x + h.w / 2, h.y + h.h + 0.5, u.owner, 4); if (f) { u.x = u.px = f[0] + 0.5; u.y = u.py = f[1] + 0.5; } }   // step out of the door
  else if (h && h.kind === 'unit') { const f = nearestFree(W, h.x, h.y, u.owner, 4); if (f) { u.x = u.px = f[0] + 0.5; u.y = u.py = f[1] + 0.5; } }
}
function wakeVillagers(W, P) {
  if (P.bell) return;                                  // the town bell still rings: stay inside
  for (const u of W.dyn.values()) if (u.kind === 'unit' && u.owner === P.id && u.saved) {
    u.bell = false;
    leaveHome(W, u);
    if (u.order && u.order.t === 'rest') setOrder(W, u, u.saved.t === 'idle' ? null : u.saved);
    u.saved = null;
  }
}

// ---------------------------------------------------------------- formations: bonuses from who stands next to whom
function formationTick(W) {
  for (const u of W.dyn.values()) {
    if (u.kind !== 'unit' || !u.form || u.form === 'garis') { if (u.fb) u.fb = null; continue; }
    const s = stat(W, u.owner, u.type), P = W.players[u.owner], k2 = P && P.techs.has('doc_formation') ? 2 : 1;
    let melee = 0, ranged = 0, near = 0;
    unitsNear(W, u.x, u.y, 3.2, (v) => {
      if (v === u || v.owner !== u.owner || v.form !== u.form || Math.hypot(v.x - u.x, v.y - u.y) > 3.2) return;
      const c = stat(W, v.owner, v.type).cls; near++;
      if (c === 'infantry' || c === 'cavalry') melee++; else if (c === 'archer' || c === 'siege') ranged++;
    });
    const fb = { ma: 0, pa: 0, miss: 0, speed: 1, vsCav: 0 };
    if (u.form === 'tempur') {
      if ((s.cls === 'archer' || s.cls === 'siege') && melee >= 2) fb.pa = 2 * k2;               // shielded by the front rank
      if ((s.cls === 'infantry' || s.cls === 'cavalry') && ranged >= 1) fb.ma = 1 * k2;
    } else if (u.form === 'kotak') { if (near >= 3) { fb.ma = 1 * k2; fb.pa = 1 * k2; fb.vsCav = 3 * k2; } fb.speed = 0.85; }
    else if (u.form === 'menyebar') { fb.miss = Math.min(0.6, 0.35 * k2); fb.ma = -1; }
    u.fb = fb;
  }
}

// ---------------------------------------------------------------- movement
const capOf = (W, u) => (u.type === 'fishing_boat' ? 15 : CARRY) + (u.type === 'villager' && W.players[u.owner].techs.has('wheelbarrow') ? 3 : 0) + (u.type === 'villager' && W.players[u.owner].techs.has('hand_cart') ? 4 : 0);
// a new / reseeded farm holds this much food (mill techs)
export const farmFood = (P) => BUILDINGS.farm.food + (P.techs.has('horse_collar') ? 75 : 0) + (P.techs.has('heavy_plow') ? 125 : 0) + (P.techs.has('crop_rotation') ? 175 : 0);
function speedOf(W, u) {
  let sp = stat(W, u.owner, u.type).speed;
  const o = u.order; if (o && o.gs) sp = Math.min(sp, o.gs);
  if (u.fb) sp *= u.fb.speed;
  if (u.relic) sp *= RELICS.speed;
  if (u.type === 'ram' && W.garr) sp *= 1 + 0.08 * (W.garr.get(u.id) || 0);
  if (!u.nav) { const k = tileAt(W, u.x, u.y); if (W.terrain[k] === TER.HILL) sp *= 0.72; else if (W.road[k]) sp *= 1.15; if (W.season.speed) sp *= W.season.speed; if (u.wr !== undefined) sp *= 0.7 + 0.3 * Math.min(1, u.wr); }
  return sp;
}
export const NEAR = 0.8;   // standing on any of the 8 tiles around a footprint counts as 'at' it
const SLACK = 0.35;        // extra reach once there, so a crowd jostling at a corner still drops / works / builds
const hunting = (u, t) => u.type === 'villager' && isAnimal(t);
function reachOf(W, u, t) {
  const s = stat(W, u.owner, u.type);
  let r = s.range || (hunting(u, t) ? 2.5 : 0);
  if (r && !u.nav && onHill(W, u.x, u.y)) r += 1;                  // high ground
  return r ? r : (t && t.kind === 'unit' ? 0.6 + (s.cls === 'cavalry' ? 0.2 : 0) : NEAR);
}
// los: night shortens sight (buildings keep their torches), rain dims it, dry season widens it
function losOf(W, e) {
  if (e.kind === 'building') return e.built ? BUILDINGS[e.type].los : 2;
  let r = stat(W, e.owner, e.type).los;
  if (W.night && W.opts.night !== 'off') r = Math.max(2, r * DAY.nightLos);
  if (raining(W)) r -= 1;
  if (W.season.los) r += W.season.los;
  if (!e.nav && onHill(W, e.x, e.y)) r += 1;
  return r;
}

function moveAlong(W, u, tx, ty, goal, exact = false) {
  // returns true when standing at the goal
  const nav = !!u.nav;
  if (!u.path || u.repath <= 0) {
    if (W.paths > 10 || W.nodes > 25000) { return false; }       // per-tick pathfinding budget
    u.path = findPath(W, u.owner, u.x, u.y, goal, tx, ty, 0, nav); u.pi = 0;
    if (globalThis.PATHDBG) { const k = u.type + ":" + (u.order && u.order.t) + (u.path.complete ? "" : u.path.exhausted ? ":EXH" : ":FAIL"); globalThis.PATHDBG[k] = (globalThis.PATHDBG[k] || 0) + 1; }      // diagnostics (tests)
    u.repath = (exact ? 6 : 10) + W.rnd() * 2;
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
  if (u.pi === pts.length - 1 && !passable(W, Math.floor(wx), Math.floor(wy), u.owner, nav)) {   // final point inside a footprint: stop at the edge
    if (goal(Math.floor(u.x), Math.floor(u.y))) return true;
  }
  if (d <= sp + 1e-6) {
    if (passable(W, Math.floor(wx), Math.floor(wy), u.owner, nav) || u.pi < pts.length - 1) { u.x = wx; u.y = wy; }
    u.pi++;
    if (u.pi >= pts.length) return true;
  } else {
    const nx = u.x + dx / d * sp, ny = u.y + dy / d * sp;
    if (passable(W, Math.floor(nx), Math.floor(ny), u.owner, nav)) { u.x = nx; u.y = ny; u.stuck = 0; }
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

// ---------------------------------------------------------------- units
function unitTick(W, u) {
  const d = UNITS[u.type], s = stat(W, u.owner, u.type);
  u.aT += TICK; if (u.cool > 0) u.cool -= TICK;
  if (d.animal || u.owner === GAIA) gaiaTick(W, u, d);
  if (u.hitAt !== undefined) { u.hitAt -= TICK; if (u.hitAt <= 0) { const t = alive(W, u.hitTgt); if (t && distTo(t, u.x, u.y) <= reachOf(W, u, t) + 0.6) damage(W, t, dmgOf(W, u, t), u); u.hitAt = undefined; } }
  const k = tileAt(W, u.x, u.y);
  if ((W.occ[k] || (u.nav ? W.terrain[k] !== TER.WATER : W.terrain[k] === TER.WATER && !W.frozen)) && !passable(W, Math.floor(u.x), Math.floor(u.y), u.owner, u.nav)) { unstick(W, u); u.path = null; }   // never stay inside a footprint (or in the water)
  if (!u.order && u.oq && u.oq.length) { u.order = u.oq.shift(); u.path = null; }     // next shift-queued order
  if (u.inside && (!u.order || (u.order.t !== 'rest' && u.order.t !== 'garrison' && u.order.t !== 'visit'))) leaveHome(W, u);
  if (u.type === 'child' && !u.order && (W.tick + u.id) % 15 === 0) childTick(W, u);
  if (u.order && u.order.wander && u.order.t === 'move' && (u.stuck > 12 || (u.order.t0w ??= W.t) < W.t - 25)) { u.order = null; u.path = null; u.anim = 'idle'; }      // a stroll that leads nowhere ends
  if (d.packs) {          // trebuchet: 4 s to pack / unpack; it fires only unpacked and moves only packed
    if (u.packT > 0) { u.packT -= TICK; u.anim = 'idle'; u.path = null; if (u.packT <= 0) { u.type = u.packTo; u.anim = 'idle'; W.ev.push({ k: 'pack', x: u.x, y: u.y, owner: u.owner }); } return; }
    const o = u.order, t = o && o.id ? alive(W, o.id) : null, tx = t ? center(t)[0] : o && o.x, ty = t ? center(t)[1] : o && o.y;
    const far = o && tx !== undefined ? (t ? distTo(t, u.x, u.y) : Math.hypot(tx - u.x, ty - u.y)) : 0, R = UNITS.trebuchet.range;
    if (u.type === 'trebuchet' && o && ((o.t !== 'attack' && o.t !== 'ground') || far > R + 0.5)) { u.packT = 4; u.packTo = 'trebuchet_p'; return; }
    if (u.type === 'trebuchet_p' && o && (o.t === 'attack' || o.t === 'ground') && far <= R - 0.5) { u.packT = 4; u.packTo = 'trebuchet'; u.path = null; return; }
    if (u.type === 'trebuchet' && !o) { u.anim = u.anim === 'attack' && u.aT < 1 ? 'attack' : 'idle'; }
  }
  if (s.convert && u.faith < 1) u.faith = Math.min(1, u.faith + TICK / s.faith);
  if (!u.order && (u.type === 'villager' || u.type === 'child') && (W.tick + u.id) % 20 === 0 && restNow(W, W.players[u.owner])) goHome(W, u);   // idle or just trained after dusk
  if (u.hp < u.maxHp && u.owner >= 0 && W.t - (u.hitT ?? -99) > 8 && MILITARY(u.type) && W.players[u.owner].techs.has('medicine')) u.hp = Math.min(u.maxHp, u.hp + 0.4 * TICK);
  const o = u.order;
  if (!o) {
    u.anim = u.anim === 'attack' && u.aT < 0.8 ? 'attack' : 'idle';
    if (s.heal) { u.scan -= TICK; if (u.scan <= 0 && !u.relic) { u.scan = 0.6; const t = woundedNear(W, u, losOf(W, u)); if (t) setOrder(W, u, { t: 'heal', id: t.id, auto: true }); } return; }
    if (u.type !== 'villager' && !d.animal && u.owner !== GAIA && s.atk > 0 && u.stance !== 'pasif') {
      u.scan -= TICK;
      if (u.scan <= 0) {
        u.scan = 0.8;
        const t = findEnemy(W, u, u.stance === 'diam' ? Math.max(1.3, s.range || 0) + 0.3 : Math.max(losOf(W, u), s.range || 0));
        if (t) setOrder(W, u, { t: 'attack', id: t.id, auto: true, gx: u.x, gy: u.y });
      }
    }
    return;
  }
  switch (o.t) {
    case 'move': {
      if (o.amove && s.atk > 0) { u.scan -= TICK; if (u.scan <= 0) { u.scan = 0.6; const t = findEnemy(W, u, Math.max(losOf(W, u), s.range || 0)); if (t) { u.order = { t: 'attack', id: t.id, resume: o }; u.path = null; return; } } }
      if (moveAlong(W, u, o.x, o.y, (i, j) => Math.abs(i + 0.5 - o.x) < 0.6 && Math.abs(j + 0.5 - o.y) < 0.6, true)) { u.order = null; u.anim = 'idle'; }
      else if (u.path && u.path.exhausted && u.pi >= u.path.pts.length - 1) { u.order = null; u.anim = 'idle'; }
      else if (o.flee || (o.home && d.animal)) u.anim = 'run';
      break;
    }
    case 'attack': {
      const t = alive(W, o.id);
      if (!t || t.kind === 'res' || !targetable(t) || (t.kind === 'unit' && !o.auto && pl(W, u.owner).vis && !pl(W, u.owner).vis[tileAt(W, t.x, t.y)]) || (t.kind === 'unit' && u.owner >= 0 && hiddenFrom(W, t, u.owner))) {
        if (o.hunt) { const c = carcassNear(W, o.lx ?? u.x, o.ly ?? u.y); if (c) { setOrder(W, u, { t: 'gather', id: c.id, kind: 'carcass' }); return; } }
        u.order = o.resume || null; u.path = null; return;
      }
      o.lx = t.x; o.ly = t.y;
      if (o.auto && distTo(t, u.x, u.y) > losOf(W, u) + 3 + (s.range || 0)) { u.order = o.resume || null; u.path = null; return; }
      const reach = reachOf(W, u, t);
      if (s.explode && distTo(t, u.x, u.y) <= reach + 0.4) { explode(W, u, s); return; }       // demolition ship
      if (o.auto && u.stance === 'diam' && distTo(t, u.x, u.y) > reach + 0.2) { u.order = null; u.path = null; return; }          // stand ground
      if (o.defend && Math.hypot(u.x - o.gx, u.y - o.gy) > 5) { u.order = o.resume || null; u.path = null; return; }        // a villager doesn't chase far
      if (o.auto && u.stance === 'bertahan' && o.gx !== undefined && Math.hypot(u.x - o.gx, u.y - o.gy) > 6) { setOrder(W, u, { t: 'move', x: o.gx, y: o.gy }); return; }   // back to the post
      // hit and run: a mounted archer (or any archer with Taktik Parthia) steps away from melee while reloading
      if (s.kite && (u.kiteT || 0) <= 0 && u.cool > 0.25 && (W.tick + u.id) % 3 === 0) { const th = meleeThreat(W, u, 1.9); if (th) { u.kiteT = 0.6; u.kx = u.x - th.x; u.ky = u.y - th.y; } }
      if (u.kiteT > 0) {
        u.kiteT -= TICK; const L = Math.hypot(u.kx, u.ky) || 1, sp = speedOf(W, u) * TICK, nx = u.x + u.kx / L * sp, ny = u.y + u.ky / L * sp;
        if (passable(W, Math.floor(nx), Math.floor(ny), u.owner, u.nav)) { u.x = nx; u.y = ny; face(u, u.kx, u.ky); u.anim = 'walk'; u.path = null; break; }
        u.kiteT = 0;
      }
      if (distTo(t, u.x, u.y) <= reach) {
        u.path = null; faceTo(u, t);
        if (s.minRange && distTo(t, u.x, u.y) < s.minRange) { u.order = o.resume || null; return; }
        if (u.cool <= 0) { attack(W, u, t); u.cool = s.reload; }
        else if (u.anim !== 'attack' || u.aT > 0.9) u.anim = 'idle';
      } else {
        const dd = distTo(t, u.x, u.y);
        if (t.kind === 'unit' && dd < 2.5 && lineFree(W, u.owner, u.x, u.y, t.x, t.y, u.nav)) {
          const sp = speedOf(W, u) * TICK, kk = Math.min(sp, dd - reach * 0.8) / dd;
          u.x += (t.x - u.x) * kk; u.y += (t.y - u.y) * kk; face(u, t.x - u.x, t.y - u.y); u.anim = 'walk'; u.path = null;
          break;
        }
        if (t.kind === 'unit' && u.path && u.path.pts.length && (u.chaseT = (u.chaseT || 0) - TICK) <= 0) { const last = u.path.pts[u.path.pts.length - 1]; if (Math.hypot(last[0] - t.x, last[1] - t.y) > Math.max(1.2, 0.25 * Math.hypot(t.x - u.x, t.y - u.y))) { u.path = null; u.chaseT = 0.6; } }
        const [cx, cy] = center(t);
        if (!u.path && !canReach(W, u, t, reach)) { markUnreachable(W, t.id, u.owner); u.order = o.resume || null; return; }
        if (moveAlong(W, u, cx, cy, goalNear(W, t, reach))) u.path = null;
        else if (u.path && (u.path.exhausted || u.fails >= 3)) { markUnreachable(W, t.id, u.owner); u.fails = 0; u.order = o.resume || null; u.path = null; }
      }
      break;
    }
    case 'convert': {      // a monk works on an enemy for 4-10 s (needs full faith), then the unit changes sides
      const t = alive(W, o.id);
      if (!t || t.kind !== 'unit' || !enemies(W, t.owner, u.owner) || !convertible(t) || u.relic) { u.order = null; u.anim = 'idle'; break; }
      const d2 = Math.hypot(t.x - u.x, t.y - u.y);
      if (d2 > s.convert + (o.t0 !== undefined ? 3 : 0.3)) { o.t0 = undefined; moveAlong(W, u, t.x, t.y, (i, j) => Math.hypot(i + 0.5 - t.x, j + 0.5 - t.y) <= s.convert - 0.5); break; }
      u.path = null; faceTo(u, t);
      if (u.faith < 1) { u.anim = 'idle'; break; }
      if (o.t0 === undefined) { o.t0 = W.t; o.dur = 4 + W.rnd() * 6; }
      u.anim = 'attack';
      if (u.aT > 1.3) { u.aT = 0; W.ev.push({ k: 'chant', x: t.x, y: t.y, owner: u.owner }); }
      if (W.t - o.t0 >= o.dur) { const from = t.owner; changeOwner(W, t, u.owner); u.faith = 0; u.order = null; W.players[u.owner].stats.converted++; W.ev.push({ k: 'convert', x: t.x, y: t.y, owner: u.owner, from, type: t.type }); }
      break;
    }
    case 'garrison': {     // walk in, then stay inside (hidden, healing slowly); towers / TC / castle shoot more arrows
      const b = alive(W, o.id);
      if (!b || b.owner !== u.owner) { leaveHome(W, u); u.order = null; break; }
      if (u.inside) { u.anim = 'idle'; u.path = null; if (b.kind === 'unit') { u.x = u.px = b.x; u.y = u.py = b.y; } else if (u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + TICK); break; }
      const at = b.kind === 'unit' ? Math.hypot(b.x - u.x, b.y - u.y) <= 1.6 : distTo(b, u.x, u.y) <= NEAR + SLACK + 0.6;
      if (at) { if ((W.garr && W.garr.get(b.id) || 0) >= garrisonCap(b)) { u.order = null; break; } u.inside = b.id; u.path = null; W.ev.push({ k: 'enter', owner: u.owner, x: u.x, y: u.y }); }
      else if (b.kind === 'unit') moveAlong(W, u, b.x, b.y, (i, j) => Math.hypot(i + 0.5 - b.x, j + 0.5 - b.y) < 1.4);
      else moveAlong(W, u, ...center(b), goalNear(W, b, NEAR));
      break;
    }
    case 'trade': {        // leg 1: to the other market; leg 0: back home with the gold
      const home = alive(W, o.home), dest = alive(W, o.dest);
      if (!home || !dest || !dest.built || enemies(W, dest.owner, u.owner) || home.owner !== u.owner) { u.order = null; u.anim = 'idle'; break; }
      const tgt = o.leg ? dest : home;
      if (distTo(tgt, u.x, u.y) <= NEAR + SLACK + (u.nav ? 1.6 : 0.5)) {
        if (o.leg) { const [ax, ay] = center(home), [bx, by] = center(dest); u.goldLoad = Math.round(Math.hypot(ax - bx, ay - by) * (dest.owner === u.owner ? 0.9 : 1.3)); }
        else if (u.goldLoad) { const P = W.players[u.owner]; P.res.gold += u.goldLoad; P.stats.gathered += u.goldLoad; P.stats.gres.gold += u.goldLoad; W.ev.push({ k: 'tradegold', owner: u.owner, x: u.x, y: u.y, n: u.goldLoad }); u.goldLoad = 0; }
        o.leg = 1 - o.leg; u.path = null;
      } else moveAlong(W, u, ...center(tgt), goalNear(W, tgt, NEAR + (u.nav ? 1 : 0)));
      break;
    }
    case 'relic': {        // fetch a relic, then carry it into the nearest monastery of ours
      const r = W.ents.get(u.relic || o.id);
      if (!r || r.kind !== 'relic') { u.order = null; u.relic = 0; break; }
      if (!u.relic) {
        if (r.carrier || r.inBld) { u.order = null; u.anim = 'idle'; break; }
        if (Math.hypot(r.x + 0.5 - u.x, r.y + 0.5 - u.y) <= 1.3) { r.carrier = u.id; u.relic = r.id; u.path = null; W.ev.push({ k: 'relicpick', x: u.x, y: u.y, owner: u.owner }); }
        else moveAlong(W, u, r.x + 0.5, r.y + 0.5, (i, j) => Math.hypot(i - r.x, j - r.y) <= 1.0);
        break;
      }
      let m = o.to ? alive(W, o.to) : null;
      if (!m || !m.built || m.owner !== u.owner) {
        m = null; let bd = 1e9;
        for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === u.owner && e.built && BUILDINGS[e.type].relics) { const dd = distTo(e, u.x, u.y); if (dd < bd) { bd = dd; m = e; } }
        if (!m) { u.anim = 'idle'; break; }           // no monastery yet: keep holding it
        o.to = m.id;
      }
      if (distTo(m, u.x, u.y) <= NEAR + SLACK + 0.3) {
        r.carrier = 0; r.inBld = m.id; u.relic = 0; u.order = null; u.anim = 'idle';
        W.players[u.owner].stats.relics++; W.ev.push({ k: 'relic', x: m.x + m.w / 2, y: m.y + m.h / 2, owner: u.owner });
      } else moveAlong(W, u, ...center(m), goalNear(W, m, NEAR));
      break;
    }
    case 'patrol': {
      if (u.scan === undefined || (u.scan -= TICK) <= 0) { u.scan = 0.6; const t = findEnemy(W, u, Math.max(losOf(W, u), s.range || 0)); if (t) { u.order = { t: 'attack', id: t.id, resume: o, auto: true }; u.path = null; return; } }
      const [px, py] = o.pts ? o.pts[o.i % o.pts.length] : o.leg ? [o.bx, o.by] : [o.ax, o.ay];
      if (Math.hypot(u.x - px, u.y - py) < 0.8 || moveAlong(W, u, px, py, (i, j) => Math.abs(i + 0.5 - px) < 0.8 && Math.abs(j + 0.5 - py) < 0.8, true) || (u.path && u.path.exhausted && u.pi >= u.path.pts.length - 1)) { if (o.pts) o.i = (o.i + 1) % o.pts.length; else o.leg = 1 - o.leg; u.path = null; }
      break;
    }
    case 'follow': {       // stay close to a friend and fight whatever comes near it
      const t = alive(W, o.id);
      if (!t || t.kind !== 'unit' || enemies(W, t.owner, u.owner)) { u.order = null; u.anim = 'idle'; break; }
      if (s.atk > 0 && (u.scan === undefined || (u.scan -= TICK) <= 0)) { u.scan = 0.6; const e = findEnemy(W, t, 5); if (e && distTo(e, u.x, u.y) < losOf(W, u) + 2) { u.order = { t: 'attack', id: e.id, resume: o, auto: true }; u.path = null; return; } }
      if (Math.hypot(t.x - u.x, t.y - u.y) > 2.6) { if (!u.path || (u.fT = (u.fT || 0) - TICK) <= 0) { u.fT = 1; u.path = null; } moveAlong(W, u, t.x, t.y, (i, j) => Math.hypot(i + 0.5 - t.x, j + 0.5 - t.y) < 2); }
      else { u.path = null; u.anim = 'idle'; }
      break;
    }
    case 'ground': {       // siege bombards a spot (splash), e.g. a crowd behind a wall
      const d2 = Math.hypot(o.x - u.x, o.y - u.y);
      if (d2 > (s.range || 1)) { moveAlong(W, u, o.x, o.y, (i, j) => Math.hypot(i + 0.5 - o.x, j + 0.5 - o.y) <= (s.range || 1) - 0.5); break; }
      u.path = null; face(u, o.x - u.x, o.y - u.y);
      if (u.cool <= 0) {
        u.cool = s.reload; u.anim = 'attack'; u.aT = 0;
        W.ev.push({ k: s.proj === 'ball' ? 'cannon' : 'shoot', x: u.x, y: u.y, owner: u.owner, tx: o.x, ty: o.y });
        const ox = (W.rnd() - 0.5) * 1.2, oy = (W.rnd() - 0.5) * 1.2;
        setTimeoutTick(W, 0.4, () => { if (alive(W, u.id)) spawnArrow(W, u.owner, u.x, u.y, 1.1, o.x + ox, o.y + oy, 0, s.atk, s.proj || 'ball', s); });
      } else if (u.anim !== 'attack' || u.aT > 0.9) u.anim = 'idle';
      break;
    }
    case 'heal': {
      const t = alive(W, o.id);
      if (!t || t.kind !== 'unit' || t.inside || t.hp >= t.maxHp || enemies(W, t.owner, u.owner) || (o.auto && distTo(t, u.x, u.y) > losOf(W, u) + 3) || u.fails >= 6) { u.order = null; u.anim = 'idle'; u.fails = 0; u.path = null; break; }     // a patient out of reach is given up
      if (Math.hypot(t.x - u.x, t.y - u.y) <= (s.healRange || 4)) {
        u.path = null; faceTo(u, t); u.anim = 'attack';
        const h = Math.min(s.heal * TICK, t.maxHp - t.hp); t.hp += h; W.players[u.owner].stats.healed += h;
        if (u.aT > 1.2) { u.aT = 0; W.ev.push({ k: 'heal', x: t.x, y: t.y, owner: u.owner }); }
      } else moveAlong(W, u, t.x, t.y, (i, j) => Math.hypot(i + 0.5 - t.x, j + 0.5 - t.y) <= (s.healRange || 4) - 0.5);
      break;
    }
    case 'gather': villagerGather(W, u, o); break;
    case 'drop': villagerDrop(W, u, o); break;
    case 'build': villagerBuild(W, u, o); break;
    case 'repair': villagerRepair(W, u, o); break;
    case 'rest': {
      const h = alive(W, o.id);
      if (!h) { leaveHome(W, u); u.order = null; u.anim = 'idle'; break; }     // the house burnt down: out into the night
      if (u.inside) { u.anim = 'idle'; u.path = null; break; }
      if (distTo(h, u.x, u.y) <= NEAR + SLACK + 0.6) { u.path = null; u.anim = 'idle'; u.inside = h.id; W.ev.push({ k: 'enter', owner: u.owner, x: u.x, y: u.y }); }
      else moveAlong(W, u, ...center(h), goalNear(W, h, NEAR));
      break;
    }
    case 'visit': {      // a well or water to drink, the tavern, the hospital; then carry on with what they were doing
      const b = o.id ? alive(W, o.id) : null;
      const done = () => { leaveHome(W, u); u.order = null; u.anim = 'idle'; if (o.then && (!o.then.id || W.ents.has(o.then.id))) setOrder(W, u, o.then); };
      if (o.id && !b) { done(); break; }
      if (!o.at) {
        const reached = b ? distTo(b, u.x, u.y) <= NEAR + SLACK + 0.6 : Math.hypot(o.x - u.x, o.y - u.y) <= 1.6;
        if (reached) { o.at = W.t; u.path = null; u.anim = 'idle'; if (b && o.why !== 'drink') { u.inside = b.id; W.ev.push({ k: 'enter', owner: u.owner, x: u.x, y: u.y }); } }
        else { if (b) moveAlong(W, u, ...center(b), goalNear(W, b, NEAR)); else moveAlong(W, u, o.x, o.y, (i, j) => Math.hypot(i + 0.5 - o.x, j + 0.5 - o.y) <= 1.5); if (u.stuck > 30) done(); }
        break;
      }
      u.anim = 'idle'; u.path = null; const P = W.players[u.owner], stay = W.t - o.at;
      if (o.why === 'drink') { if (stay >= LIFE.drinkTime) { u.th = 100; done(); } }
      else if (o.why === 'tavern') {
        if (stay >= LIFE.tavernTime) {
          u.fu = Math.min(100, (u.fu ?? 50) + LIFE.tavernFun * (P.techs.has('brewery') ? 1.5 : 1)); u.lastTavern = W.t;
          if (P.res.food >= LIFE.tavernMeal) { P.res.food -= LIFE.tavernMeal; u.hu = Math.min(100, (u.hu ?? 50) + 30); }
          u.th = 100; done();
        }
      } else if (o.why === 'cure') { if ((!u.sick && (u.he ?? 100) >= 70) || stay > 240) done(); }
      else done();
      break;
    }
    case 'board': {      // walk to a transport and climb aboard
      const sh = alive(W, o.id);
      if (!sh || sh.owner !== u.owner || !sh.cargo || sh.cargo.length >= stat(W, sh.owner, sh.type).capacity) { u.order = null; u.anim = 'idle'; break; }
      if (Math.hypot(sh.x - u.x, sh.y - u.y) <= 2.4) { embark(W, sh, u); break; }
      // walk to the shore by the ship (it is sailing in); wait there if it isn't reachable yet
      if (!u.path || u.repath <= 0) { if (!canReach(W, u, sh, 2.2)) { const c = coastNear(W, sh.x, sh.y, u.owner); if (c && !sh.order && Math.hypot(sh.x - c[0], sh.y - c[1]) > 0.8) setOrder(W, sh, { t: 'move', x: c[0], y: c[1] }); if (c) { const f = nearestFree(W, c[0], c[1], u.owner, 2); if (f && Math.hypot(f[0] + 0.5 - u.x, f[1] + 0.5 - u.y) > 1) moveAlong(W, u, f[0] + 0.5, f[1] + 0.5, (i, j) => i === f[0] && j === f[1]); else u.anim = 'idle'; } break; } }
      moveAlong(W, u, sh.x, sh.y, (i, j) => Math.hypot(i + 0.5 - sh.x, j + 0.5 - sh.y) <= 2.2);
      break;
    }
    case 'unload': {     // sail to the coast near (x, y) and put everyone ashore
      if (!u.cargo || !u.cargo.length) { u.order = null; break; }
      const shore = (i, j) => { for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) if (passable(W, i + a, j + b, u.owner)) return true; return false; };
      if (Math.hypot(u.x - o.x, u.y - o.y) < 4 && shore(Math.floor(u.x), Math.floor(u.y))) { disembark(W, u, o.x, o.y); u.order = null; break; }
      if (moveAlong(W, u, o.x, o.y, (i, j) => shore(i, j) && Math.hypot(i + 0.5 - o.x, j + 0.5 - o.y) < 6)) { disembark(W, u, o.x, o.y); u.order = null; }
      else if (u.path && u.path.exhausted) { if (shore(Math.floor(u.x), Math.floor(u.y))) disembark(W, u, o.x, o.y); u.order = null; }
      break;
    }
  }
}
// nearest open-water tile touching land around (x, y)
export function coastNear(W, x, y, owner) {
  for (let r = 0; r < 24; r++) for (let k = 0; k < Math.max(1, r * 8); k++) {
    const a = k / Math.max(1, r * 8) * Math.PI * 2, i = Math.round(x + Math.cos(a) * r), j = Math.round(y + Math.sin(a) * r);
    if (!passable(W, i, j, owner, true)) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (passable(W, i + di, j + dj, owner)) return [i + 0.5, j + 0.5];
  }
  return null;
}
function embark(W, sh, u) {
  if (u.cargo && u.cargo.length) return;
  sh.cargo.push(u); W.ents.delete(u.id); W.dyn.delete(u.id); u.order = null; u.path = null; u.aboard = sh.id;
  W.ev.push({ k: 'board', owner: u.owner, x: sh.x, y: sh.y });
}
function disembark(W, sh, x, y) {
  const out = [];
  for (const u of sh.cargo) {
    const f = nearestFree(W, sh.x, sh.y, u.owner, 4) || nearestFree(W, x, y, u.owner, 6); if (!f) { out.push(u); continue; }
    u.x = u.px = f[0] + 0.5; u.y = u.py = f[1] + 0.5; u.aboard = 0; u.order = null; u.path = null;
    W.ents.set(u.id, u); W.dyn.set(u.id, u);
  }
  sh.cargo = out;
  W.ev.push({ k: 'unload', owner: sh.owner, x: sh.x, y: sh.y });
}
function unstick(W, u) {
  if (!passable(W, Math.floor(u.x), Math.floor(u.y), u.owner, u.nav)) { const f = nearestFree(W, u.x, u.y, u.owner, 8, u.nav); if (f) { u.x = u.px = f[0] + 0.5; u.y = u.py = f[1] + 0.5; } }
}
// ninjas can't be seen by an enemy unless something of theirs stands right next to them (or the ninja just struck)
export function hiddenFrom(W, e, pid) {
  if (e.kind !== 'unit' || e.owner === pid || !stat(W, e.owner, e.type).stealth || W.t - (e.lastAtk || -99) < 3) return false;
  let seen = false;
  unitsNear(W, e.x, e.y, 2.5, (v) => { if (!seen && v.owner === pid && Math.hypot(v.x - e.x, v.y - e.y) <= 2.5) seen = true; });
  if (seen) return false;
  for (let j = Math.floor(e.y) - 2; j <= e.y + 2 && !seen; j++) for (let i = Math.floor(e.x) - 2; i <= e.x + 2 && !seen; i++) { if (!inb(W, i, j)) continue; const b = W.ents.get(W.occ[idx(W, i, j)]); if (b && b.kind === 'building' && b.owner === pid) seen = true; }
  return !seen;
}
// garrison: who fits where (towers take foot soldiers and villagers, the TC / castle anyone on foot or horse, a ram 4 infantry)
const garrisonCap = (b) => b.kind === 'unit' ? (b.type === 'ram' ? 4 : 0) : BUILDINGS[b.type].garrison || 0;
function canGarrison(W, u, b) {
  if (!b || b.owner !== u.owner || u.nav || UNITS[u.type].cls === 'siege' || isAnimal(u) || u.inside) return false;
  if (b.kind === 'unit') return b.type === 'ram' && UNITS[u.type].cls === 'infantry';
  if (!b.built || !garrisonCap(b)) return false;
  return b.type !== 'watch_tower' || UNITS[u.type].cls !== 'cavalry';
}
const nearestOwn = (W, u, type, not) => { let best = null, bd = 1e9; for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === u.owner && e.type === type && e.built && e.id !== not) { const d = distTo(e, u.x, u.y); if (d < bd) { bd = d; best = e; } } return best; };
// a demolition ship blows up: heavy damage to every enemy around (ships, buildings, units), and it sinks
function explode(W, u, s) {
  const r = s.explode;
  for (const e of [...W.dyn.values()]) {
    if ((e.kind !== 'unit' && e.kind !== 'building') || e.hp <= 0 || !enemies(W, e.owner, u.owner) || isAnimal(e)) continue;
    const dd = e.kind === 'unit' ? Math.hypot(e.x - u.x, e.y - u.y) : distTo(e, u.x, u.y); if (dd > r) continue;
    damage(W, e, s.atk * (e.kind === 'unit' && !e.nav ? 0.5 : 1), u);
  }
  W.ev.push({ k: 'boom', x: u.x, y: u.y, owner: u.owner }); damage(W, u, 1e9, null);
}
// what a monk can turn: soldiers and villagers (not buildings, siege, ships, monks or animals)
const convertible = (t) => t.kind === 'unit' && !isAnimal(t) && t.owner >= 0 && t.type !== 'monk' && !UNITS[t.type].hero && !UNITS[t.type].naval && UNITS[t.type].cls !== 'siege' && !t.inside;
// a unit changes sides (conversion): population, hit points scaled to the new owner's upgrades, orders forgotten
function changeOwner(W, e, pid) {
  const A = W.players[e.owner], B = W.players[pid];
  A.pop--; A.stats.lost++; B.pop++;
  e.owner = pid; e.order = null; e.oq = null; e.path = null; e.stance = undefined; e.form = null; e.fb = null; e.saved = null; e.bell = false;
  const mx = stat(W, pid, e.type).hp; e.hp = Math.max(1, e.hp / e.maxHp * mx); e.maxHp = mx;
}
// villagers struck in melee fight back, and up to three workmates close by pitch in; they don't chase far
// (5 tiles from where it started) and go back to what they were doing afterwards (order.resume).
// Not against archers (can't catch them), not when badly hurt, not while running to shelter from the town bell.
function villagerDefend(W, v, src) {
  const a = alive(W, src.id);
  if (!a || a.kind !== 'unit' || !enemies(W, a.owner, v.owner) || stat(W, a.owner, a.type).range || v.inside || UNITS[a.type].naval) return;
  const P = W.players[v.owner];
  const join = (u) => {
    if (u.hp < u.maxHp * 0.25 || u.inside || (u.order && (u.order.t === 'attack' || (u.order.t === 'rest' && P.bell)))) return false;
    setOrder(W, u, { t: 'attack', id: a.id, auto: true, defend: true, gx: u.x, gy: u.y, resume: u.order || null }); return true;
  };
  if (!join(v)) return;
  let helpers = 0;
  unitsNear(W, v.x, v.y, 3, (e) => { if (helpers < 3 && e !== v && e.owner === v.owner && e.type === 'villager' && Math.hypot(e.x - v.x, e.y - v.y) <= 3 && join(e)) helpers++; });
}
// the nearest hurt friendly soldier (or villager) a healer can see
function woundedNear(W, u, r) {
  let best = null, bd = 1e9;
  unitsNear(W, u.x, u.y, r, (e) => {
    if (e.id === u.id || e.hp >= e.maxHp || e.hp <= 0 || e.inside || isAnimal(e) || enemies(W, e.owner, u.owner) || e.owner < 0 || UNITS[e.type].naval || UNITS[e.type].cls === 'siege') return;
    const dd = Math.hypot(e.x - u.x, e.y - u.y) - (1 - e.hp / e.maxHp) * 3; if (dd < bd) { bd = dd; best = e; }
  });
  return best;
}
// an enemy melee fighter closing in (hit-and-run units back off from it)
function meleeThreat(W, u, r) {
  let best = null, bd = r;
  unitsNear(W, u.x, u.y, r, (e) => {
    if (e.hp <= 0 || !enemies(W, e.owner, u.owner) || isAnimal(e) || e.inside) return;
    const es = stat(W, e.owner, e.type); if (es.range || !es.atk) return;
    const dd = Math.hypot(e.x - u.x, e.y - u.y); if (dd < bd) { bd = dd; best = e; }
  });
  return best;
}
function findEnemy(W, u, r) {
  let best = null, bd = 1e9; const vis = W.players[u.owner].vis, s = stat(W, u.owner, u.type), bldOnly = u.type === 'ram' || u.type === 'trebuchet';
  const consider = (e) => {
    if ((e.kind !== 'unit' && e.kind !== 'building') || e.hp <= 0 || passive(e) || !enemies(W, e.owner, u.owner) || unreachable(W, e.id, u.owner) || !targetable(e)) return;
    if (bldOnly && e.kind !== 'building') return;
    const dd = distTo(e, u.x, u.y); if (dd > r) return;
    const [cx, cy] = center(e); if (!vis[tileAt(W, cx, cy)]) return;
    if (e.kind === 'unit' && hiddenFrom(W, e, u.owner)) return;
    if (!s.range && !u.nav && e.kind === 'unit' && e.nav) return;              // melee can't reach ships
    if (u.nav && !s.range) return;
    const bonus = s.bonus && e.kind === 'unit' ? (s.bonus[stat(W, e.owner, e.type).cls] || 0) : 0;
    const ec = e.kind === 'unit' ? stat(W, e.owner, e.type).cls : '';
    const dive = s.cls === 'cavalry' && !s.range && (ec === 'archer' || ec === 'siege' || ec === 'support') ? 2 : 0;
    const score = dd + (e.kind === 'building' ? (bldOnly ? 0 : 6) : 0) + (e.kind === 'unit' && e.type === 'villager' ? 1 : 0) - Math.min(4, bonus * 0.4) - dive;
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
// damage of one hit: attack - armour (with formation, high ground, class bonuses, charges)
export function dmgOf(W, a, t) {
  const s = stat(W, a.owner, a.type); const rg = s.range || hunting(a, t);
  let atk = s.atk * (a.wr !== undefined ? 0.8 + 0.2 * Math.min(1, a.wr) : 1);       // tired, sick or miserable soldiers hit softer
  let arm;
  if (t.kind === 'unit') {
    const ts = stat(W, t.owner, t.type), fb = t.fb;
    arm = (rg ? ts.pa : ts.ma) + (fb ? (rg ? fb.pa : fb.ma) : 0);
  } else { const bs = bstat(W, t.owner, t.type); arm = rg ? bs.pa : bs.ma; }
  if (s.charge && W.t - (a.lastAtk || -99) > 8) atk += s.charge;                  // lancer: the first strike of a charge
  let dmg = Math.max(1, atk - arm);
  if (t.kind === 'unit') { const c = stat(W, t.owner, t.type).cls; if (s.bonus && s.bonus[c]) dmg += s.bonus[c]; if (a.fb && a.fb.vsCav && c === 'cavalry') dmg += a.fb.vsCav; }
  if (s.vsBuilding && t.kind === 'building') dmg += s.vsBuilding;      // melee soldiers / siege can actually knock buildings down
  if (t.kind === 'building' && a.type === 'villager') dmg = Math.max(1, dmg * 0.5);
  if (!a.nav && onHill(W, a.x, a.y) && !onHill(W, ...center(t))) dmg *= 1.25;   // high ground
  if (!rg && t.kind === 'unit' && t.dir !== undefined && !isAnimal(t)) {           // struck from the side or behind
    const dx = a.x - t.x, dy = a.y - t.y, ang = (Math.atan2((dx + dy) / 2, dx - dy) * 180 / Math.PI + 360) % 360;
    const off = Math.abs(((ang - t.dir) % 360 + 540) % 360 - 180);
    if (off > 100) dmg *= s.cls === 'cavalry' && pl(W, a.owner).techs?.has('flank_tactics') ? 1.5 : 1.25;
  }
  return dmg;
}
const PROJ = { arrow: 7, fire: 7, bullet: 22, ball: 6, javelin: 8 };
function attack(W, u, t) {
  const s = stat(W, u.owner, u.type);
  u.anim = 'attack'; u.aT = 0;
  if (s.range || hunting(u, t)) {
    const [cx, cy] = center(t);
    let acc = s.acc || 1; if (raining(W) && s.proj !== 'ball') acc *= 0.85; if (t.fb && t.fb.miss) acc *= 1 - t.fb.miss;
    const hit = W.rnd() < acc || t.kind === 'building';
    const ox = hit ? 0 : (W.rnd() - 0.5) * 1.6, oy = hit ? 0 : (W.rnd() - 0.5) * 1.6;
    const ptype = s.proj || 'spear';
    W.ev.push({ k: ptype === 'bullet' ? 'gunshot' : ptype === 'ball' ? 'cannon' : 'shoot', x: u.x, y: u.y, owner: u.owner, tx: cx, ty: cy });
    const dmg = dmgOf(W, u, t);
    u.lastAtk = W.t;
    setTimeoutTick(W, ptype === 'bullet' ? 0.15 : 0.5, () => { if (alive(W, u.id)) spawnArrow(W, u.owner, u.x, u.y, 1.1, cx + ox, cy + oy, hit ? t.id : 0, dmg, ptype, s); });
  } else {
    u.hitAt = 0.45 * s.reload * 0.5; u.hitTgt = t.id;
    W.ev.push({ k: 'swing', x: u.x, y: u.y, owner: u.owner, type: u.type });
    setTimeoutTick(W, u.hitAt + 0.05, () => { u.lastAtk = W.t; });
  }
}
function setTimeoutTick(W, s, fn) { add(W, { kind: 'timer', t: s, fn }); }
function spawnArrow(W, owner, x, y, z, tx, ty, tid, dmg, ptype = 'arrow', s = null) {
  const dist = Math.hypot(tx - x, ty - y);
  add(W, { kind: 'proj', owner, x, y, z, sx: x, sy: y, tx, ty, tid, dmg, t: 0, T: Math.max(ptype === 'bullet' ? 0.08 : 0.25, dist / (PROJ[ptype] || 7)), arc: ptype === 'bullet' ? 0 : 0.25 * dist, ptype, spear: ptype === 'spear', splash: s && s.splash, fire: s && s.fire });
}
function projTick(W, p) {
  p.t += TICK; const k = Math.min(1, p.t / p.T);
  p.px = p.x; p.py = p.y;
  p.x = p.sx + (p.tx - p.sx) * k; p.y = p.sy + (p.ty - p.sy) * k; p.z = 1.1 * (1 - k) + 4 * p.arc / Math.max(1, Math.hypot(p.tx - p.sx, p.ty - p.sy)) * k * (1 - k) * 2;
  if (k >= 1) {
    const t = p.tid ? alive(W, p.tid) : null;
    if (t && distTo(t, p.x, p.y) < 1.0) {
      damage(W, t, p.dmg, { owner: p.owner, kind: 'proj' });
      if (p.fire && t.kind === 'building' && W.ents.has(t.id)) { t.burn = W.t + 8; t.burnBy = p.owner; }
    }
    if (p.splash) {     // cannon ball: half damage around the impact
      unitsNear(W, p.x, p.y, p.splash, (e) => { if (e !== t && e.hp > 0 && enemies(W, e.owner, p.owner) && !isAnimal(e) && Math.hypot(e.x - p.x, e.y - p.y) <= p.splash) damage(W, e, p.dmg * 0.5, { owner: p.owner, kind: 'proj' }); });
      W.ev.push({ k: 'boom', x: p.x, y: p.y });
    }
    W.ev.push({ k: t ? (p.ptype === 'bullet' ? 'bullethit' : 'arrowhit') : 'arrowmiss', x: p.x, y: p.y, water: !t && W.terrain[tileAt(W, p.x, p.y)] === TER.WATER });
    del(W, p.id);
  }
}
export function damage(W, t, dmg, src) {
  if (t.kind === 'res') return;
  t.hp -= dmg; t.hitT = W.t;
  if (src && src.owner !== undefined && src.owner !== t.owner) { const [hx, hy] = center(t); W.ev.push({ k: 'hit', x: hx, y: hy, owner: t.owner }); }
  if (src && t.kind === 'unit' && t.type !== 'villager' && src.id && alive(W, src.id) && stat(W, t.owner, t.type).atk > 0 && (!t.order || (isAnimal(t) && t.order.t !== 'attack')) && t.stance !== 'pasif'
    && (t.stance !== 'diam' || distTo(src, t.x, t.y) <= reachOf(W, t, src) + 0.2)) setOrder(W, t, { t: 'attack', id: src.id, auto: true, gx: t.x, gy: t.y });
  if (src && src.id && t.kind === 'unit' && t.type === 'villager' && t.hp > 0) villagerDefend(W, t, src);
  if (t.kind === 'unit' && UNITS[t.type].animal === 'flee' && src) t.scan = 0;   // deer bolt immediately
  if (t.hp > 0) return;
  const P = pl(W, t.owner), S = src && src.owner !== undefined && src.owner !== t.owner && W.players[src.owner] ? W.players[src.owner].stats : null;
  const bld = t.kind === 'building', val = costVal(bld ? BUILDINGS[t.type].cost : UNITS[t.type].cost);
  if (S && !isAnimal(t)) { if (bld) S.razed++; else { S.killed++; if (t.type === 'villager') S.vilKilled++; if (UNITS[t.type].naval) S.shipsSunk++; } S.killVal += val; addXp(W, W.players[src.owner], val * XP.kill); }
  if (!(bld && t.type === 'farm' && !src)) { if (bld) P.stats.bldLost++; else P.stats.lost++; P.stats.lostVal += val; }   // exhausted farms aren't losses
  del(W, t.id);
  if (t.kind === 'unit') {
    if (!UNITS[t.type].animal && t.owner !== GAIA) P.pop--;
    if (t.cargo && t.cargo.length) { for (const c of t.cargo) { P.pop--; P.stats.lost++; } t.cargo = []; }     // the transport went down with everyone aboard
    const food = t.meat ? Math.round(t.meat) : UNITS[t.type].food;
    if (food) add(W, { kind: 'res', type: 'carcass', animal: t.type, x: t.x - 0.5, y: t.y - 0.5, w: 1, h: 1, amount: food, max: food, dir: t.dir, variant: 0 });
    else add(W, { kind: 'corpse', type: t.type, owner: t.owner, x: t.x, y: t.y, dir: t.dir, t: 0, skin: skinOf(t), sk: t.id % 2 });
    W.ev.push({ k: 'die', x: t.x, y: t.y, owner: t.owner, type: t.type });
  } else {
    const d = BUILDINGS[t.type];
    for (let a = 0; a < t.w; a++) for (let c = 0; c < t.h; c++) { const k = idx(W, t.x + a, t.y + c); if (W.occ[k] === t.id) W.occ[k] = 0; if (W.focc[k] === t.id) W.focc[k] = 0; }
    W.regionDirty = true; W.regionDirtyW = true;
    if (t.built && d.pop) P.popCap = Math.max(0, P.popCap - d.pop);
    if (t.type !== 'farm') add(W, { kind: 'rubble', n: Math.min(4, Math.max(t.w, t.h)), x: t.x + t.w / 2, y: t.y + t.h / 2, t: 0 });
    W.ev.push({ k: 'collapse', x: t.x + t.w / 2, y: t.y + t.h / 2, owner: t.owner, type: t.type, n: t.w, hit: !!src });
    for (const q of t.queue) { const c = q.cost || (q.unit ? UNITS[q.unit].cost : TECHS[q.tech].cost); for (const r of RES) P.res[r] += c[r] || 0; }
  }
}

// ---------------------------------------------------------------- villagers (and fishing boats)
const RES_TYPE = { tree: 'wood', gold: 'gold', stone: 'stone', iron: 'iron', berry: 'food', farm: 'food', carcass: 'food', fish: 'food' };
export function skinOf(u) {
  if (u.type !== 'villager') return u.type;
  return u.task || 'villager';
}
const TASK_SKIN = { tree: 'vil_lumber', gold: 'vil_gold', stone: 'vil_stone', iron: 'vil_gold', berry: 'vil_forage', farm: 'vil_farm', carcass: 'vil_hunt', fish: 'vil_forage' };
const WORK_ANIM = { tree: 'chop', gold: 'mine', stone: 'mine', iron: 'mine', berry: 'forage', farm: 'farm', carcass: 'hunt', fish: 'forage' };
function rateOf(W, u, kind, src) {
  const P = W.players[u.owner], S = W.season;
  let r = RATE[kind];
  if (u.type === 'fishing_boat') r = 0.5;
  if (kind === 'carcass' && src && src.animal === 'sheep') r = 0.33;   // shepherding is slower than hunting
  if (kind === 'tree' && P.techs.has('double_bit_axe')) r *= 1.2;
  if (kind === 'gold' && P.techs.has('gold_mining')) r *= 1.15;
  if (kind === 'iron' && P.techs.has('iron_smelting')) r *= 1.2;
  if (kind === 'fish') { r *= 1 + P.mods.fish; if (P.techs.has('gillnets')) r *= 1.25; }
  if (kind === 'farm' && S.farm) r *= S.farm;
  if (kind === 'carcass' && S.hunt) r *= S.hunt;
  if (P.hungry) r *= DAY.hungry;
  if (W.night && W.opts.night === 'full' && u.type === 'villager') r *= P.mods.nightWork ? 1 : 0.7;      // working by torchlight
  return r * (1 + P.mods.gather[RES_TYPE[kind]]) * (u.wr ?? 1);
}
export function openSide(W, e, nav = false) {
  if (e.type === 'carcass') return true;
  for (let j = e.y - 1; j <= e.y + e.h; j++) for (let i = e.x - 1; i <= e.x + e.w; i++) if (passable(W, i, j, -1, nav)) return true;
  return false;
}
// known: optional explored-tiles mask (the AI only goes for resources it has actually seen)
export function nearestResource(W, kind, x, y, r = 10, owner = -1, skip = null, known = null, nav = false) {
  let best = null, bd = 1e9;
  for (const e of W.ents.values()) {
    if (skip && skip.has(e.id)) continue;
    if (owner >= 0 && unreachable(W, e.id, owner)) continue;
    const k = e.kind === 'res' ? e.type : (e.kind === 'building' && e.type === 'farm' && e.built && e.owner === owner ? 'farm' : null);
    if (k !== kind || (e.kind === 'res' && e.amount <= 0)) continue;
    const dd = distTo(e, x, y); if (dd >= bd || dd > r) continue;
    if (known && !known[idx(W, Math.floor(e.x), Math.floor(e.y))]) continue;
    if (k === 'farm' && e.farmer && alive(W, e.farmer) && alive(W, e.farmer).order?.id === e.id) continue;
    if (e.kind === 'res' && !openSide(W, e, nav)) continue;
    bd = dd; best = e;
  }
  return best;
}
export function nearestDrop(W, owner, res, x, y, boat = false) {
  let best = null, bd = 1e9;
  for (const e of W.dyn.values()) {
    if (e.kind !== 'building' || e.owner !== owner || !e.built) continue;
    if (boat ? e.type !== 'dock' : !(BUILDINGS[e.type].drop || []).includes(res)) continue;
    const dd = distTo(e, x, y); if (dd < bd) { bd = dd; best = e; }
  }
  return best;
}
function villagerGather(W, u, o) {
  let r = alive(W, o.id);
  const boat = u.type === 'fishing_boat', nav = !!u.nav;
  const kindOf = (e) => e.kind === 'res' ? e.type : 'farm';
  if (r && r.kind === 'building' && (r.type !== 'farm' || !r.built || r.food <= 0)) r = null;
  if (r && boat && r.type !== 'fish') r = null;
  if (!r) {
    const k = o.kind; const n = k && nearestResource(W, k, u.x, u.y, boat ? 14 : 8, u.owner, null, null, nav);
    if (n) { o.id = n.id; o.kind = kindOf(n); u.path = null; return; }
    u.order = null; u.anim = 'idle'; if (u.carry && u.carry.n > 0) { const dsite = nearestDrop(W, u.owner, u.carry.res, u.x, u.y, boat); if (dsite) u.order = { t: 'drop', id: dsite.id, then: null }; } return;
  }
  const kind = kindOf(r); o.kind = kind;
  if (u.fails >= 2 && kind !== 'farm') {
    o.skip = o.skip || new Set(); o.skip.add(r.id); u.fails = 0; u.path = null; markUnreachable(W, r.id, u.owner);   // remembered, so nobody else is sent there either
    const n = nearestResource(W, kind, u.x, u.y, 10, u.owner, o.skip, null, nav); if (n) { o.id = n.id; return; }
    u.order = null; return;
  }
  const res = RES_TYPE[kind];
  u.task = TASK_SKIN[kind];
  if (u.carry && u.carry.res !== res && u.carry.n > 0) u.carry = null;      // switching resource drops the load (like AoE2)
  if (u.carry && u.carry.n >= capOf(W, u)) {
    const dsite = nearestDrop(W, u.owner, res, u.x, u.y, boat);
    if (dsite) { u.order = { t: 'drop', id: dsite.id, then: { t: 'gather', id: r.id, kind } }; u.path = null; } else { u.anim = 'idle'; }
    return;
  }
  const reach = kind === 'farm' ? 0 : kind === 'fish' ? NEAR + 0.4 : NEAR;
  const inside = kind === 'farm' && u.x > r.x && u.x < r.x + r.w && u.y > r.y && u.y < r.y + r.h;
  if (inside || (kind !== 'farm' && distTo(r, u.x, u.y) <= reach + SLACK)) {
    u.path = null;
    if (kind === 'farm') { r.farmer = u.id; if (!u.farmSpot) u.farmSpot = 1; } else faceTo(u, r);
    if (kind === 'farm') face(u, Math.cos(W.t * 0.3) * 0.5, 1);
    u.anim = boat ? 'work' : WORK_ANIM[kind];
    const amt = rateOf(W, u, kind, r) * TICK;
    if (!u.carry) u.carry = { res, n: 0 };
    u.carry.k = kind;
    if (kind === 'farm') { const take = Math.min(amt, r.food); r.food -= take; u.carry.n += take; if (u.aT > 1.15) { u.aT = 0; W.ev.push({ k: 'farm', x: u.x, y: u.y, owner: u.owner }); } if (r.food <= 0 && (W.reseed[r.owner] || 0) > 0) { W.reseed[r.owner]--; r.food = farmFood(W.players[r.owner]); W.ev.push({ k: 'reseed', x: r.x + 1.5, y: r.y + 1.5, owner: r.owner }); }
      if (r.food <= 0) { W.ev.push({ k: 'farmdone', x: r.x + 1.5, y: r.y + 1.5, owner: r.owner }); damage(W, r, 1e9, null); } }
    else {
      const take = Math.min(amt, r.amount); r.amount -= take; u.carry.n += take; if (kind === 'tree' && !r.felled) { r.felled = true; W.ev.push({ k: 'treefall', x: r.x + 0.5, y: r.y + 0.5 }); }
      if (u.aT > (kind === 'tree' ? 0.9 : kind === 'fish' ? 2.2 : 1.0)) { u.aT = 0; W.ev.push({ k: kind === 'tree' ? 'chop' : kind === 'berry' ? 'forage' : kind === 'carcass' ? 'hunt' : kind === 'fish' ? 'fish' : 'mine', res: kind, x: u.x, y: u.y, owner: u.owner, tx: r.x + 0.5, ty: r.y + 0.5 }); }
      if (kind === 'fish') W.players[u.owner].stats.fished += take;
      if (r.amount <= 0) { del(W, r.id); if (kind !== 'carcass') { W.occ[idx(W, r.x, r.y)] = 0; W.regionDirty = true; W.regionDirtyW = true; } if (kind === 'tree') add(W, { kind: 'corpse', type: 'stump', owner: -1, x: r.x + 0.5, y: r.y + 0.5, t: 0 }); }
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
    if (u.carry && u.carry.n > 0 && !boat) u.anim = 'carry';
  }
}
function villagerDrop(W, u, o) {
  const b = alive(W, o.id), boat = u.type === 'fishing_boat';
  if (!b || !b.built) { const d2 = u.carry && nearestDrop(W, u.owner, u.carry.res, u.x, u.y, boat); if (d2) { o.id = d2.id; u.path = null; } else { u.order = o.then; } return; }
  if (distTo(b, u.x, u.y) <= NEAR + SLACK + (boat ? 0.6 : 0)) {
    if (u.carry) { const P = W.players[u.owner]; const n = Math.floor(u.carry.n + 1e-6); P.res[u.carry.res] += n; u.carry.n -= n; W.ev.push({ k: 'deposit', res: u.carry.res, x: u.x, y: u.y, owner: u.owner }); if (u.carry.n < 0.01) u.carry = null; }
    u.order = o.then; u.path = null;
    if (!u.order) u.anim = 'idle';
  } else {
    const [cx, cy] = center(b);
    moveAlong(W, u, cx, cy, goalNear(W, b, NEAR + (boat ? 0.5 : 0))); if (!boat) u.anim = 'carry';
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
      const auto = { lumber_camp: 'tree', mining_camp: 'gold', mill: 'berry', farm: 'farm', dock: 'fish' }[done.type];
      if (auto === 'farm') { u.order = { t: 'gather', id: done.id, kind: 'farm' }; return; }
      if (auto) { let n = nearestResource(W, auto, done.x + done.w / 2, done.y + done.h / 2, 10, u.owner); if (!n && auto === 'gold') n = nearestResource(W, 'stone', done.x + 1, done.y + 1, 10) || nearestResource(W, 'iron', done.x + 1, done.y + 1, 10); if (n) { u.order = { t: 'gather', id: n.id }; return; } }
    }
    // otherwise help with the nearest unfinished foundation of ours close by
    let best = null, bd = 12;
    for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === u.owner && !e.built && !unreachable(W, e.id, u.owner)) { const dd = distTo(e, u.x, u.y); if (dd < bd) { bd = dd; best = e; } }
    if (best) { u.order = { t: 'build', id: best.id }; u.task = 'vil_build'; }
    return;
  }
  u.task = 'vil_build';
  const d = BUILDINGS[b.type];
  if (distTo(b, u.x, u.y) <= NEAR + SLACK) {
    u.path = null; faceTo(u, b); u.anim = 'build';
    b.builders = (b.builders || 0) + 1;
    const n = Math.max(1, b.nb || 1);
    const rate = (n + 2) / (3 * d.time) / n * (1 + W.players[u.owner].mods.buildSpeed) * (u.wr ?? 1);
    const before = b.progress;
    b.progress = Math.min(1, b.progress + rate * TICK);
    b.hp = Math.min(b.maxHp, b.hp + (b.progress - before) * b.maxHp);
    if (u.aT > 0.55) { u.aT = 0; W.ev.push({ k: 'hammer', x: u.x, y: u.y, owner: u.owner }); }
    if (b.progress >= 1) onBuilt(W, b);
  } else {
    // a foundation nobody can walk up to (walled in by trees, cut off by a new building): give up on it
    if (u.fails >= 3 && !canReach(W, u, b, NEAR)) {
      markUnreachable(W, b.id, u.owner); u.fails = 0; u.path = null;
      const next = (o.chain || []).map(id => alive(W, id)).find(x => x && !x.built && x.id !== b.id && !unreachable(W, x.id, u.owner));
      if (next) o.id = next.id; else { u.order = null; u.task = null; u.anim = 'idle'; }
      return;
    }
    const [cx, cy] = center(b);
    moveAlong(W, u, cx, cy, goalNear(W, b, NEAR));
  }
}
// repair: hit points back for half the building's cost per hit point (AoE2), faster with more hands
function villagerRepair(W, u, o) {
  const b = alive(W, o.id), P = W.players[u.owner];
  if (!b || b.kind !== 'building' || !b.built || b.hp >= b.maxHp || b.owner !== u.owner) { u.order = null; u.anim = 'idle'; u.task = null; return; }
  u.task = 'vil_build';
  if (distTo(b, u.x, u.y) <= NEAR + SLACK) {
    u.path = null; faceTo(u, b); u.anim = 'build';
    b.repairers = (b.repairers || 0) + 1;
    const d = BUILDINGS[b.type], n = Math.max(1, b.nr || 1);
    const rate = b.maxHp / Math.max(25, d.time) * 1.2 * (n + 2) / (3 * n) * (1 + P.mods.repair);
    const hp = Math.min(rate * TICK, b.maxHp - b.hp), f = 0.5 * hp / b.maxHp;
    const cost = {}; for (const r in d.cost) cost[r] = d.cost[r] * f;
    if (!canAfford(P, cost)) { u.order = null; u.anim = 'idle'; W.ev.push({ k: 'repairstop', owner: u.owner, x: u.x, y: u.y }); return; }
    pay(P, cost); b.hp += hp; P.stats.repaired += hp;
    if (u.aT > 0.55) { u.aT = 0; W.ev.push({ k: 'hammer', x: u.x, y: u.y, owner: u.owner }); }
  } else moveAlong(W, u, ...center(b), goalNear(W, b, NEAR));
}

// ---------------------------------------------------------------- buildings
function buildingTick(W, b) {
  const d = BUILDINGS[b.type], P = W.players[b.owner];
  b.nb = b.builders || 0; b.builders = 0; b.nr = b.repairers || 0; b.repairers = 0;
  if (!b.built) return;
  if (b.burn && W.t < b.burn) damage(W, b, 3 * TICK, { owner: b.burnBy, kind: 'fire' });
  if (!W.ents.has(b.id)) return;
  if (d.market && P.techs.has('trade_route')) { P.res.gold += MARKET.tradeGold * TICK; P.stats.gathered += MARKET.tradeGold * TICK; P.stats.gres.gold += MARKET.tradeGold * TICK; }
  if (b.cool > 0) b.cool -= TICK;
  const q = b.queue[0];
  if (q) {
    if (q.unit) {
      if (P.pop + 1 > P.popCap) { if (!P.housed) W.ev.push({ k: 'housed', owner: b.owner }); P.housed = true; }
      else { P.housed = false; q.t += TICK; if (q.t >= stat(W, b.owner, q.unit).time) { b.queue.shift(); spawn(W, b, q.unit); } }
    } else {
      q.t += TICK;
      if (q.t >= techTime(P, q.tech)) { b.queue.shift(); finishTech(W, b, q.tech); }
    }
  }
  const atk = d.attack && bstat(W, b.owner, b.type).attack;
  if (atk && b.cool <= 0) {
    const t = nearestEnemyUnit(W, b, atk.range);
    if (t) {
      b.cool = atk.reload;
      const [cx, cy] = center(b), ts = stat(W, t.owner, t.type);
      const g = (W.garrK && W.garrK.get(b.id)) || { a: 0, v: 0, i: 0 };     // garrison: archers shoot, infantry a little, villagers a little (civic defence more)
      const extra = Math.min(10, Math.min(5, Math.floor(g.v / (P.techs.has('civic_defense') ? 2 : 4))) + g.a + Math.floor(g.i / 2));
      for (let k = 0; k < (atk.arrows || 1) + extra; k++) {
        const arm = ts.pa + (t.fb ? t.fb.pa : 0);
        const hit = W.rnd() < atk.acc * (raining(W) ? 0.85 : 1) * (t.fb && t.fb.miss ? 1 - t.fb.miss : 1);
        spawnArrow(W, b.owner, cx + (k - 1) * 0.4, cy, 3.5, t.x + (W.rnd() - 0.5) * (hit ? 0.3 : 1.6), t.y + (W.rnd() - 0.5) * (hit ? 0.3 : 1.6), hit ? t.id : 0, Math.max(1, atk.atk - arm), 'arrow');
      }
      W.ev.push({ k: 'shoot', x: cx, y: cy, owner: b.owner });
    }
  }
}
function nearestEnemyUnit(W, b, r) {
  let best = null, bd = 1e9; const [cx, cy] = center(b);
  unitsNear(W, cx, cy, r + Math.max(b.w, b.h), (e) => {
    if (e.kind !== 'unit' || passive(e) || !enemies(W, e.owner, b.owner) || hiddenFrom(W, e, b.owner)) return;
    const dd = distTo(b, e.x, e.y); if (dd <= r && dd < bd) { bd = dd; best = e; }
  });
  return best;
}
function spawn(W, b, type) {
  const nav = !!UNITS[type].naval, bdef = BUILDINGS[b.type];
  if (bdef.pen && UNITS[type].animal) {        // bought livestock appears in the yard
    const [x, y] = penSpot(W, b, b.id * 7 + W.tick); const u = addUnit(W, b.owner, type, x, y); u.pen = b.id; u.home = [x, y];
    W.ev.push({ k: 'trained', x: u.x, y: u.y, owner: b.owner, type }); return;
  }
  const rx = b.rally ? b.rally.x : b.x + b.w / 2, ry = b.rally ? b.rally.y : b.y + b.h + 1;
  // free tile on the perimeter nearest to the rally point
  let best = null, bd = 1e9;
  for (let i = b.x - 1; i <= b.x + b.w; i++) for (let j = b.y - 1; j <= b.y + b.h; j++) {
    if (i >= b.x && i < b.x + b.w && j >= b.y && j < b.y + b.h) continue;
    if (!passable(W, i, j, b.owner, nav)) continue;
    let dd = Math.hypot(i + 0.5 - rx, j + 0.5 - ry);
    if (nav) { let open = 0; for (let c = -2; c <= 2; c++) for (let a = -2; a <= 2; a++) if (passable(W, i + a, j + c, b.owner, true)) open++; dd -= open * 0.8; }   // ships launch into open water, not a puddle by the pier
    if (dd < bd) { bd = dd; best = [i, j]; }
  }
  if (!best) best = nearestFree(W, b.x + b.w / 2, b.y + b.h / 2, b.owner, 8, nav);
  if (!best) return;
  const u = addUnit(W, b.owner, type, best[0] + 0.5, best[1] + 0.5);
  face(u, 0.3, 1); if (UNITS[type].trade) u.homeB = b.id;
  W.ev.push({ k: 'trained', x: u.x, y: u.y, owner: b.owner, type });
  if (b.rally) {
    const t = b.rally.id ? alive(W, b.rally.id) : null;
    if (t && (type === 'villager' || UNITS[type].fisher) && (t.kind === 'res' || (t.kind === 'building' && t.type === 'farm'))) setOrder(W, u, { t: 'gather', id: t.id });
    else if (t && t.kind === 'building' && t.owner !== b.owner) setOrder(W, u, { t: 'attack', id: t.id });
    else setOrder(W, u, { t: 'move', x: b.rally.x, y: b.rally.y });
  } else if (UNITS[type].fisher) { const f = nearestResource(W, 'fish', u.x, u.y, 14, b.owner, null, null, true); if (f) setOrder(W, u, { t: 'gather', id: f.id }); }
}
function finishTech(W, b, tech) {
  const P = W.players[b.owner], t = TECHS[tech];
  P.techs.add(tech); P.stats.techs++; addXp(W, P, costVal(t.cost) * XP.tech);
  if (t.toAge) { P.age = t.toAge; W.ev.push({ k: 'age', owner: b.owner, age: P.age }); }
  else W.ev.push({ k: 'tech', owner: b.owner, tech });
  if (tech === 'horse_collar') for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === b.owner && e.type === 'farm') e.food += 75;
  if (t.mods) applyMods(P, t.mods);
  if (t.farmFood) for (const e of W.dyn.values()) if (e.kind === 'building' && e.owner === b.owner && e.type === 'farm') e.food += t.farmFood;
  for (const r of RES) if (t.give && t.give[r]) P.res[r] += t.give[r];
  if (t.units) giftUnits(W, P, t.units);
  if (t.spec) {      // the whole line retrains into the specialist (AoE2-style upgrade)
    const [from, to] = t.spec; P.spec[from] = to;
    for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner === P.id && e.type === from) { const f = e.hp / e.maxHp; e.type = to; const s = stat(W, P.id, to); e.maxHp = s.hp; e.hp = Math.max(1, s.hp * f); }
    W.ev.push({ k: 'spec', owner: P.id, from, to });
  }
  bumpStats(W, P);
}

// ---------------------------------------------------------------- misc
function separate(W) {
  // light separation so groups don't stack on one point (cheap tile buckets)
  const buckets = new Map(); W.garr = new Map(); W.garrK = new Map();
  for (const e of [...W.dyn.values()]) {
    if (e.kind === 'timer') { e.t -= TICK; if (e.t <= 0) { del(W, e.id); e.fn(); } continue; }
    if (e.kind === 'unit' && e.inside) {
      W.garr.set(e.inside, (W.garr.get(e.inside) || 0) + 1);
      const c = UNITS[e.type].cls, k = c === 'archer' ? 'a' : c === 'villager' ? 'v' : 'i'; const g = W.garrK.get(e.inside) || { a: 0, v: 0, i: 0 }; g[k]++; W.garrK.set(e.inside, g);
    }
    if (e.kind !== 'unit' || e.inside) continue;
    const k = Math.floor(e.x) + Math.floor(e.y) * 4096; let a = buckets.get(k); if (!a) buckets.set(k, a = []); a.push(e);
  }
  for (const [k, a] of buckets) {
    const i0 = k % 4096, j0 = Math.floor(k / 4096);
    for (const u of a) {
      if (u.anim === 'walk' || u.anim === 'carry' || u.anim === 'run') continue;     // only settle units that stand still
      const rad = u.nav ? 0.9 : 0.42;
      let fx = 0, fy = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const b = buckets.get(i0 + di + (j0 + dj) * 4096); if (!b) continue;
        for (const v of b) { if (v === u || !!v.nav !== !!u.nav) continue; const dx = u.x - v.x, dy = u.y - v.y, dd = Math.hypot(dx, dy); if (dd < rad && dd > 1e-4) { fx += dx / dd * (rad - dd); fy += dy / dd * (rad - dd); } else if (dd <= 1e-4) { fx += (u.id % 7 - 3) * 0.01; fy += (u.id % 5 - 2) * 0.01; } }
      }
      if (fx || fy) { const nx = u.x + fx * 0.5, ny = u.y + fy * 0.5; if (passable(W, Math.floor(nx), Math.floor(ny), u.owner, u.nav)) { u.x = nx; u.y = ny; } }
    }
  }
}
function updateVision(W) {
  const S = W.size;
  for (const P of W.players) P.vis.fill(0);
  const mark = (P, cx, cy, rr) => {
    const i0 = Math.max(0, Math.floor(cx - rr)), i1 = Math.min(S - 1, Math.floor(cx + rr)), j0 = Math.max(0, Math.floor(cy - rr)), j1 = Math.min(S - 1, Math.floor(cy + rr));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 <= rr * rr) { const k = j * S + i; P.vis[k] = 1; P.exp[k] = 1; }
  };
  const spies = W.players.filter(P => P.alive && P.spyUntil > W.t);
  for (const e of W.dyn.values()) {
    if (e.kind !== 'unit' && e.kind !== 'building') continue;
    const [cx, cy] = center(e);
    for (const Q of spies) if (e.owner >= 0 && W.players[e.owner].team !== Q.team) mark(Q, cx, cy, 1.5);     // spies report enemy positions
    const P = W.players[e.owner]; if (!P) continue;
    mark(P, cx, cy, losOf(W, e) + (e.kind === 'building' ? Math.max(e.w, e.h) / 2 : 0));
  }
  // allies share vision
  for (const P of W.players) for (const Q of W.players) if (P !== Q && P.team === Q.team) for (let k = 0; k < S * S; k++) if (Q.vis[k]) { P.vis[k] = 1; P.exp[k] = 1; }
}
// what spies bring home: army make-up, buildings, age and the paths each enemy committed to
export function spyReport(W, pid) {
  const me = W.players[pid], out = [];
  for (const Q of W.players) {
    if (Q.team === me.team || !Q.alive) continue;
    const army = {}, bld = {}; let vil = 0;
    for (const e of W.dyn.values()) {
      if (e.owner !== Q.id) continue;
      if (e.kind === 'unit') { if (e.type === 'villager') vil++; else if (MILITARY(e.type)) army[e.type] = (army[e.type] || 0) + 1; }
      else if (e.kind === 'building' && e.built) bld[e.type] = (bld[e.type] || 0) + 1;
    }
    out.push({ id: Q.id, name: Q.name, age: Q.age, vil, army, bld, techs: [...Q.techs].filter(t => TECHS[t].group || TECHS[t].spec || t === 'gunpowder'), res: { ...Q.res }, t: W.t });
  }
  return out;
}
// conquest: a player is out once no units and no working buildings remain (walls, gates, farms, houses and unfinished
// foundations don't count), or when they resign
function ruleTick(W) {
  if (W.opts.treaty && !W.treatyOver && W.t >= W.opts.treaty) { W.treatyOver = true; W.ev.push({ k: 'treatyend' }); }
  if (W.winner >= 0) return;
  const win = (team, kind) => {
    for (const P of W.players) if (P.alive && P.team !== team) { P.alive = false; W.ev.push({ k: 'defeated', owner: P.id }); }
    W.winner = team; W.ev.push({ k: 'victory', team, [kind]: true });
  };
  for (const [id, t0] of W.wonders) {               // a wonder that stands long enough wins
    const b = alive(W, id); if (!b) { W.wonders.delete(id); W.ev.push({ k: 'wonderlost' }); continue; }
    if (W.t - t0 >= WONDER_TIME) return win(W.players[b.owner].team, 'wonder');
  }
  if (W.opts.victory === 'regicide') for (const P of W.players) if (P.alive && P.king && !alive(W, P.king)) {
    P.alive = false; W.ev.push({ k: 'defeated', owner: P.id, regicide: true });
    for (const e of [...W.dyn.values()]) if (e.owner === P.id && (e.kind === 'unit' || e.kind === 'building')) damage(W, e, 1e9, null);
  }
  if (W.opts.victory === 'prosper') for (const P of W.players) if (P.alive) {     // Prosperity: a thriving kingdom wins
    if ((P.prosper || 0) >= LIFE.prosperWin) { if (!P.prosperSince) { P.prosperSince = W.t; W.ev.push({ k: 'prosperhold', owner: P.id, secs: KOTH_TIME }); } if (W.t - P.prosperSince >= KOTH_TIME) return win(P.team, 'prosper'); }
    else if (P.prosperSince) { P.prosperSince = 0; W.ev.push({ k: 'prosperlost', owner: P.id }); }
  }
  const m = W.monument;
  if (m) {                                          // king of the hill: units of one team alone around the monument take it
    const teams = new Set();
    unitsNear(W, m.x, m.y, 5, (e) => { if (e.owner >= 0 && e.hp > 0 && !e.inside && !isAnimal(e) && Math.hypot(e.x - m.x, e.y - m.y) <= 5) teams.add(W.players[e.owner].team); });
    if (teams.size === 1) { const t = [...teams][0]; if (m.team !== t) { m.team = t; m.since = W.t; m.owner = W.players.find(P => P.team === t && P.alive)?.id ?? -1; W.ev.push({ k: 'kothcapture', owner: m.owner, team: t, secs: KOTH_TIME }); } }
    if (m.team !== undefined && m.team >= 0 && W.t - m.since >= KOTH_TIME) return win(m.team, 'koth');
  }
}
// ================================================================ daily life
// Every person (villagers, children, soldiers, monks) has needs from 0 to 100: hunger (fed at dawn from the granary,
// meals at the tavern), thirst (wells, rivers and lakes, the Town Center), energy (sleep at home at night), fun
// (the tavern, the monastery, the market) and health (falls when starving, parched, exhausted or sick; at 0 they die).
// Needs set the work rate `u.wr`; the thirsty walk to water, the sick to the hospital, the bored to the tavern.
// Plagues break out in crowded, dry towns and spread person to person. Couples in a house have children who grow up
// into villagers. The miserable may leave the kingdom. All of it feeds the Prosperity index (and its victory).
const isPerson = (u) => { const d = UNITS[u.type]; return !!d && !d.animal && !d.naval && d.cls !== 'siege' && d.cls !== 'trade' && !d.packs && u.owner >= 0; };
const SHELTER = { house: 5 };
function initLife(W, u) {
  const h = (u.id * 2654435761) >>> 0, vil = u.type === 'villager' || u.type === 'child';
  u.sex = vil ? (u.id % 2 ? 'f' : 'm') : 'm';
  u.nm = h % NAMES[u.sex].length; if (u.fam === undefined) u.fam = (h >>> 7) % NAMES.fam.length;
  u.ag0 = u.type === 'child' ? 0 : vil ? 16 + (h >>> 3) % 26 : 18 + (h >>> 4) % 20; u.born = W.t;
  u.hu = 100; u.th = 100; u.en = 100; u.fu = 80; u.he = 100; u.sick = 0; u.wr = 1;
}
export const personName = (u) => u.nm === undefined ? '' : `${NAMES[u.sex][u.nm]} ${NAMES.fam[u.fam]}`;
export const personAge = (W, u) => Math.floor((u.ag0 ?? 20) + (W.t - (u.born ?? W.t)) / DAY.len);
function waterGrid(W) {
  if (W.waterNear) return W.waterNear;
  const S = W.size, g = new Uint8Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) if (W.terrain[j * S + i] === TER.WATER) for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) { const ii = i + a, jj = j + b; if (ii >= 0 && jj >= 0 && ii < S && jj < S && W.terrain[jj * S + ii] !== TER.WATER) g[jj * S + ii] = 1; }
  return (W.waterNear = g);
}
function tavernFor(W, u) {
  let best = null, bd = 1e9; const cnt = W.tavernUse || {};
  for (const b of W.dyn.values()) if (b.kind === 'building' && b.owner === u.owner && b.built && BUILDINGS[b.type].tavern && (cnt[b.id] || 0) < BUILDINGS[b.type].tavern) { const dd = distTo(b, u.x, u.y); if (dd < bd && dd < 45) { bd = dd; best = b; } }
  if (best) (W.tavernUse ||= {})[best.id] = (cnt[best.id] || 0) + 1;
  return best;
}
// the nearest drinking place: a well, the Town Center, or the shore of a river / lake
function waterFor(W, u, wells) {
  let best = null, bd = 1e9;
  for (const b of wells) { const dd = distTo(b, u.x, u.y); if (dd < bd) { bd = dd; best = { id: b.id }; } }
  const g = waterGrid(W), S = W.size, ui = Math.floor(u.x), uj = Math.floor(u.y);
  for (let r = 1; r < Math.min(bd, 18); r++) for (let k = 0; k < r * 8; k++) {
    const a = k / (r * 8) * Math.PI * 2, i = Math.round(ui + Math.cos(a) * r), j = Math.round(uj + Math.sin(a) * r);
    if (i >= 0 && j >= 0 && i < S && j < S && g[j * S + i] && passable(W, i, j, u.owner)) { if (r < bd) return { x: i + 0.5, y: j + 0.5 }; }
  }
  return best;
}
// guard posts round a player's Town Center (the town watch walks them in turn)
export function townRing(W, pid, R = 13, n = 8) {
  const P = W.players[pid], tc = P && (W.ents.get(P.tc) || [...W.dyn.values()].find(e => e.kind === 'building' && e.owner === pid && e.type === 'town_center'));
  if (!tc) return [];
  const cx = tc.x + tc.w / 2, cy = tc.y + tc.h / 2, out = [];
  for (let k = 0; k < n; k++) {
    const a = k / n * Math.PI * 2, f = nearestFree(W, cx + Math.cos(a) * R, cy + Math.sin(a) * R, pid, 4);
    if (f && regionAt(W, f[0] + 0.5, f[1] + 0.5) === regionAt(W, cx, cy + tc.h / 2 + 1)) out.push([f[0] + 0.5, f[1] + 0.5]);
  }
  return out;
}
export function penSpot(W, b, seed) {
  const d = BUILDINGS[b.type], h = (seed * 2654435761) >>> 0;
  return [b.x + 0.6 + (h % 100) / 100 * (b.w - 1.2), b.y + b.h - d.pen + 0.5 + ((h >>> 8) % 100) / 100 * (d.pen - 1)];
}
function childTick(W, u) {
  const P = W.players[u.owner];
  if (W.t - (u.born ?? W.t) >= LIFE.growUp) {        // grown up: a new villager of the family
    u.type = 'villager'; const s = stat(W, u.owner, 'villager'); u.hp = u.maxHp = s.hp; u.ag0 = 16; u.born = W.t;
    W.ev.push({ k: 'grownup', owner: u.owner, x: u.x, y: u.y, name: personName(u) }); return;
  }
  if (restNow(W, P)) return;
  const h = u.homeId && W.ents.get(u.homeId), [hx, hy] = h ? [h.x + h.w / 2, h.y + h.h + 1] : u.home;
  if (W.rnd() < 0.5) for (let k = 0; k < 4; k++) { const x = hx + (W.rnd() - 0.5) * 6, y = hy + (W.rnd() - 0.5) * 6; if (passable(W, Math.floor(x), Math.floor(y), u.owner) && regionAt(W, x, y) === regionAt(W, u.x, u.y)) { setOrder(W, u, { t: 'move', x, y, wander: true }); return; } }      // only where they can walk to
}
// livestock: animals in a barn yard fatten and give milk / wool (with or without the daily-life rules)
function barnTick(W) {
  for (const P of W.players) {
    if (!P.alive) continue;
    const T = P.techs, barns = [];
    for (const b of W.dyn.values()) if (b.kind === 'building' && b.owner === P.id && b.built && BUILDINGS[b.type].pen) barns.push(b);
    const fod = T.has('fodder') ? 1.5 : 1;
    for (const b of barns) {
      let inPen = 0; const d = BUILDINGS[b.type];
      for (const a of W.dyn.values()) {
        if (a.kind !== 'unit' || a.owner !== P.id || UNITS[a.type].animal !== 'herd') continue;
        if (!a.pen && a.x >= b.x && a.x < b.x + b.w && a.y >= b.y + b.h - d.pen && a.y < b.y + b.h && inPen < d.penCap) { a.pen = b.id; a.home = [a.x, a.y]; W.ev.push({ k: 'penned', owner: P.id, x: a.x, y: a.y }); }
        if (a.pen !== b.id) continue; inPen++;
        const A = UNITS[a.type]; a.meat = Math.min(A.fat, (a.meat || A.food) + (A.fat - A.food) / 240 * fod);
        const milk = A.milk * fod; P.res.food += milk; P.stats.gathered += milk; P.stats.gres.food += milk;
      }
      b.herd = inPen;
    }
  }
}
function lifeTick(W) {
  W.tavernUse = {};
  for (const P of W.players) {
    if (!P.alive) continue;
    const T = P.techs, nightFull = W.opts.night === 'full';
    const wells = [], taverns = [], hospitals = [], houses = [], barns = [], monas = [], markets = [], tcs = [];
    for (const b of W.dyn.values()) if (b.kind === 'building' && b.owner === P.id && b.built) {
      const d = BUILDINGS[b.type];
      if (d.well) wells.push(b); if (d.tavern) taverns.push(b); if (d.hospital) hospitals.push(b); if (SHELTER[b.type]) houses.push(b);
      if (d.pen) barns.push(b); if (b.type === 'monastery') monas.push(b); if (d.market) markets.push(b); if (b.type === 'town_center') { tcs.push(b); wells.push(b); }
    }
    const near = (list, u, r) => list.some(b => distTo(b, u.x, u.y) <= r);
    const wg = waterGrid(W), people = [], residents = new Map();
    for (const u of W.dyn.values()) if (u.kind === 'unit' && u.owner === P.id && isPerson(u)) { if (u.nm === undefined) initLife(W, u); people.push(u); }
    // homes: every villager / child belongs to a house with room (5 each)
    for (const u of people) if (u.homeId) { const h = W.ents.get(u.homeId); if (h && h.built && h.owner === P.id) residents.set(h.id, (residents.get(h.id) || 0) + 1); else u.homeId = 0; }
    for (const u of people) if (!u.homeId && (u.type === 'villager' || u.type === 'child')) {
      let best = null, bd = 1e9; for (const h of houses) if ((residents.get(h.id) || 0) < SHELTER.house) { const dd = distTo(h, u.x, u.y); if (dd < bd) { bd = dd; best = h; } }
      if (best) { u.homeId = best.id; residents.set(best.id, (residents.get(best.id) || 0) + 1); }
    }
    let sumFu = 0, sumHe = 0, sumNeed = 0, sick = 0, homeless = 0, n = 0;
    const funRate = LIFE.fun * (T.has('minstrels') ? 0.65 : 1), herb = T.has('herbalism');
    for (const u of people) {
      const vil = u.type === 'villager', o = u.order, working = o && ['gather', 'drop', 'build', 'repair'].includes(o.t), resting = u.inside && o && o.t === 'rest';
      // energy: sleep restores it (best in your own home); work drains it. Without a night cycle nobody tires.
      if (!nightFull || u.type === 'child') u.en = 100;
      else if (resting) { u.en = Math.min(100, u.en + (u.inside === u.homeId ? LIFE.sleep : LIFE.sleepRough)); u.slept = (u.slept || 0) + 1; }
      else if (!vil) u.en = u.inside ? Math.min(100, u.en + LIFE.sleep) : !o || o.t === 'patrol' && !u.path ? Math.min(100, u.en + LIFE.restIdle) : Math.max(0, u.en - LIFE.energyMarch);     // soldiers: rest when idle or garrisoned
      else u.en = Math.max(0, u.en - (working ? LIFE.energyWork : LIFE.energyIdle));
      u.hu = Math.max(0, u.hu - LIFE.hunger);
      // water: near a well, the Town Center or a shore they drink as they go
      if (near(wells, u, BUILDINGS.well.well) || wg[idx(W, Math.min(W.size - 1, Math.floor(u.x)), Math.min(W.size - 1, Math.floor(u.y)))] || u.inside) u.th = Math.min(100, u.th + 8);
      else u.th = Math.max(0, u.th - LIFE.thirst * (W.season.snow ? 0.7 : W.opts.season === 'kemarau' ? 1.35 : 1));
      u.fu = Math.max(0, u.fu - (vil || u.type === 'child' ? funRate : LIFE.funSoldier) + (near(monas, u, 7) ? 0.12 : 0) + (near(markets, u, 6) ? 0.06 : 0) + (u.type === 'child' ? 0.06 : 0));
      // health
      const cured = near(hospitals, u, BUILDINGS.hospital.hospital) || (o && o.why === 'cure' && u.inside);
      let dh = 0;
      if (u.hu < 15) dh -= 0.3; if (u.th < 15) dh -= 0.35; if (u.en < 8) dh -= 0.08;
      if (u.sick) { dh -= cured ? -0.5 : herb ? 0.07 : 0.13; u.sick = Math.max(0, u.sick - (cured ? 3 : 1) * (herb ? 1.4 : 1)); if (!u.sick) { u.immune = W.t + 900; W.ev.push({ k: 'cured', owner: P.id, x: u.x, y: u.y }); } }
      else if (u.hu > 45 && u.th > 45 && u.en > 25) dh += cured ? 0.4 : 0.08;
      u.he = Math.max(0, Math.min(100, u.he + dh));
      if (u.he <= 0) { const why = u.sick ? 'sakit' : u.hu < 15 ? 'kelaparan' : u.th < 15 ? 'kehausan' : 'kelelahan'; W.ev.push({ k: 'lifedeath', owner: P.id, x: u.x, y: u.y, name: personName(u), why }); damage(W, u, 1e6, null); continue; }
      // how well they work / fight
      u.wr = Math.max(0.35, Math.min(1.08, 1 - (u.en < 25 ? 0.25 : 0) - (u.hu < 25 ? 0.2 : 0) - (u.th < 25 ? 0.2 : 0) - (u.fu < 20 ? 0.15 : 0) - (u.sick ? 0.4 : 0) + (u.fu > 80 && u.he > 80 ? 0.08 : 0)));
      // behaviour: drink, get cured, have a drink at the tavern (when there is no night to do it at dusk)
      const busy = o && (o.t === 'visit' || o.t === 'rest' || o.t === 'garrison' || o.t === 'attack' || o.t === 'board' || o.t === 'trade');
      if (!busy && !restNow(W, P) && u.type !== 'child' && !u.inside) {
        const keep = o && !o.auto && !o.wander ? o : null;
        if (u.th < 22) { const w = waterFor(W, u, wells); if (w) setOrder(W, u, { t: 'visit', id: w.id, x: w.x, y: w.y, why: 'drink', then: keep }); }
        else if (u.sick && hospitals.length && u.he < 85) { let hb = hospitals[0]; for (const b of hospitals) if (distTo(b, u.x, u.y) < distTo(hb, u.x, u.y)) hb = b; setOrder(W, u, { t: 'visit', id: hb.id, why: 'cure', then: keep }); }
        else if (u.fu < (nightFull ? 15 : 30) && W.t - (u.lastTavern || -999) > 150) { const tv = tavernFor(W, u); if (tv) setOrder(W, u, { t: 'visit', id: tv.id, why: 'tavern', then: keep }); }
      }
      // desertion: deeply unhappy villagers may leave the kingdom
      if (vil && u.fu < LIFE.desertFun) { u.low = (u.low || 0) + 1; if (u.low > 120 && (P.life ? P.life.fun : 50) < 30 && W.rnd() < 0.008) { W.ev.push({ k: 'desert', owner: P.id, x: u.x, y: u.y, name: personName(u) }); P.pop--; P.stats.lost++; del(W, u.id); continue; } } else u.low = 0;
      if (!u.homeId && (vil || u.type === 'child')) homeless++;
      if (u.sick) sick++;
      sumFu += u.fu; sumHe += u.he; sumNeed += Math.min(u.hu, u.th); n++;
    }
    // disease: outbreaks in crowded, dry towns; contagion between people standing close (any kingdom)
    if (W.tick % 300 === 7 && n >= 8) {
      const covered = houses.length ? houses.filter(h => near(wells, h, BUILDINGS.well.well + 1) || wg[idx(W, h.x, h.y)]).length / houses.length : 1;
      const p = LIFE.outbreak * (1 + homeless / 6 + (1 - covered) * 1.5 + (W.season.snow ? 0.4 : 0)) * (T.has('sanitation') ? 0.5 : 1) * (hospitals.length ? 0.7 : 1) * 30 / 30;
      if (W.rnd() < p) { const v = people[Math.floor(W.rnd() * people.length)]; if (v && !v.sick && !(v.immune > W.t)) { v.sick = LIFE.sickTime; W.ev.push({ k: 'outbreak', owner: P.id, x: v.x, y: v.y, name: personName(v) }); } }
    }
    for (const u of people) if (u.sick && W.ents.has(u.id) && !u.inside) {
      if (W.rnd() < LIFE.spread * (T.has('quarantine') ? 0.4 : 1)) {
        let tgt = null; unitsNear(W, u.x, u.y, 1.6, (e) => { if (!tgt && e !== u && e.owner >= 0 && isPerson(e) && !e.sick && !e.inside && e.nm !== undefined && !(e.immune > W.t) && Math.hypot(e.x - u.x, e.y - u.y) <= 1.6) tgt = e; });
        if (tgt && tgt.he > 70 && W.rnd() < 0.5) tgt = null;          // a healthy body fights it off
        if (tgt) { tgt.sick = LIFE.sickTime; if (tgt.owner !== u.owner) W.ev.push({ k: 'contagion', owner: tgt.owner, x: tgt.x, y: tgt.y }); }
      }
    }
    // families: a couple at home has a child now and then (needs room, food, health and some joy)
    if (W.tick % (LIFE.birthEvery * 10) === 7) for (const h of houses) {
      const fam = people.filter(u => u.homeId === h.id); if (fam.length >= SHELTER.house || P.pop + 1 > P.popCap || P.res.food < 50) continue;
      const adults = fam.filter(u => u.type === 'villager' && personAge(W, u) >= 18 && personAge(W, u) <= 45);
      const dad = adults.find(u => u.sex === 'm'), mom = adults.find(u => u.sex === 'f');
      if (!dad || !mom || dad.he < 50 || mom.he < 50 || (dad.fu + mom.fu) / 2 < 40 || dad.sick || mom.sick) continue;
      if (W.rnd() >= LIFE.birthP) continue;
      const f = nearestFree(W, h.x + h.w / 2, h.y + h.h + 0.5, P.id, 3); if (!f) continue;
      P.res.food -= 50;
      const c = addUnit(W, P.id, 'child', f[0] + 0.5, f[1] + 0.5); c.fam = dad.fam; initLife(W, c); c.homeId = h.id; c.home = [c.x, c.y];
      if (!mom.inside) mom.fam = dad.fam;
      P.stats.births = (P.stats.births || 0) + 1;
      W.ev.push({ k: 'birth', owner: P.id, x: c.x, y: c.y, name: personName(c), fam: NAMES.fam[dad.fam] });
    }
    // the state of the kingdom
    const amen = Math.min(1, (houses.length ? houses.filter(h => near(wells, h, BUILDINGS.well.well + 1) || wg[idx(W, h.x, h.y)]).length / houses.length : 0.5) * 0.4 + (taverns.length ? 0.2 : 0) + (hospitals.length ? 0.15 : 0) + (barns.length ? 0.1 : 0) + (markets.length ? 0.1 : 0) + (monas.length ? 0.05 : 0));
    const L = P.life = { n, fun: n ? sumFu / n : 0, health: n ? sumHe / n : 0, need: n ? sumNeed / n : 0, sick, homeless, amen, births: P.stats.births || 0 };
    P.prosper = Math.round(L.fun * 0.22 + L.health * 0.22 + L.need * 0.16 + amen * 100 * 0.2 + Math.min(1, P.pop / (0.6 * (W.opts.popLimit || POP_LIMIT))) * 100 * 0.1 + (P.age - 1) / 3 * 100 * 0.1);
  }
}

function relicTick(W) {
  const held = new Map(); let total = 0;
  for (const r of W.dyn.values()) {
    if (r.kind !== 'relic') continue; total++;
    if (r.carrier) {
      const m = alive(W, r.carrier);
      if (!m || m.relic !== r.id) { r.carrier = 0; r.x = Math.floor(r.dx ?? r.x); r.y = Math.floor(r.dy ?? r.y); W.ev.push({ k: 'relicdrop', x: r.x, y: r.y }); }
      else { r.dx = m.x; r.dy = m.y; }
    }
    if (r.inBld) {
      const b = alive(W, r.inBld);
      if (!b) { const f = nearestFree(W, r.x, r.y, -1, 4) || [r.x, r.y]; r.inBld = 0; r.x = f[0]; r.y = f[1]; continue; }     // monastery gone: the relic falls out
      r.x = b.x + b.w / 2 - 0.5; r.y = b.y + b.h / 2 - 0.5;
      const P = W.players[b.owner]; P.res.gold += RELICS.gold; P.stats.gathered += RELICS.gold; P.stats.gres.gold += RELICS.gold;
      const tm = P.team; held.set(tm, (held.get(tm) || 0) + 1);
    }
  }
  if (!W.opts.relicWin || !total || W.winner >= 0) return;
  const owner = [...held.entries()].find(([, n]) => n === total);
  if (!owner) { if (W.relicHold) W.ev.push({ k: 'relicbroken', team: W.relicHold.team }); W.relicHold = null; return; }
  if (!W.relicHold || W.relicHold.team !== owner[0]) { W.relicHold = { team: owner[0], since: W.t }; W.ev.push({ k: 'relichold', team: owner[0], secs: RELICS.win }); }
  else if (W.t - W.relicHold.since >= RELICS.win) {
    for (const P of W.players) if (P.alive && P.team !== owner[0]) { P.alive = false; W.ev.push({ k: 'defeated', owner: P.id, relic: true }); }
    W.winner = owner[0]; W.ev.push({ k: 'victory', team: W.winner, relic: true });
  }
}
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
// a shipment reaches the Town Center: resources, units at the TC (ships at a dock), map knowledge or a lasting bonus
function applyMods(P, m) {
  for (const r in m.gather || {}) P.mods.gather[r] += m.gather[r];
  for (const k in m) if (k !== 'gather') P.mods[k] = (P.mods[k] || 0) + m[k];
}
function deliver(W, P) {
  const c = CARDS[P.shipment.card]; P.shipment = null;
  for (const r of RES) if (c.give && c.give[r]) P.res[r] += c.give[r];
  if (c.mod) { applyMods(P, c.mod); bumpStats(W, P); }
  if (c.reveal === 'map') P.exp.fill(1);
  if (c.reveal === 'enemy') for (const Q of W.players) if (Q.team !== P.team && Q.start) { const [sx, sy] = Q.start; for (let j = sy - 10; j <= sy + 10; j++) for (let i = sx - 10; i <= sx + 10; i++) if (inb(W, i, j)) P.exp[idx(W, i, j)] = 1; }
  const [cx, cy] = giftUnits(W, P, c.units || []);
  W.ev.push({ k: 'shipment', owner: P.id, card: c.id, x: cx, y: cy - 1 });
}
// units handed out at the Town Center (cards, age paths); ships appear at a dock
function giftUnits(W, P, list) {
  let tc = W.ents.get(P.tc); if (!tc || tc.kind !== 'building' || tc.hp <= 0) tc = [...W.dyn.values()].find(e => e.kind === 'building' && e.owner === P.id && e.type === 'town_center' && e.built);
  const dock = [...W.dyn.values()].find(e => e.kind === 'building' && e.owner === P.id && e.type === 'dock' && e.built);
  const [cx, cy] = tc ? [tc.x + tc.w / 2, tc.y + tc.h + 1] : (P.start || [W.size / 2, W.size / 2]);
  for (const [type0, n] of list) {
    const type = trainType(P, type0), nav = !!UNITS[type].naval;
    const [ox, oy] = nav ? (dock ? [dock.x + 1.5, dock.y + 1.5] : [cx, cy]) : [cx, cy];
    for (let k = 0; k < n; k++) {
      const f = nearestFree(W, ox + (k % 4) - 1.5, oy + Math.floor(k / 4), P.id, nav ? 10 : 6, nav);
      if (!f) { if (nav) P.res.wood += UNITS[type].cost.wood || 0; continue; }       // no water nearby: the timber is sent instead
      const u = addUnit(W, P.id, type, f[0] + 0.5, f[1] + 0.5); face(u, 0.3, 1);
      if (UNITS[type].fisher) { const fr = nearestResource(W, 'fish', u.x, u.y, 14, P.id, null, null, true); if (fr) setOrder(W, u, { t: 'gather', id: fr.id }); }
    }
  }
  return [cx, cy];
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
    if (e.owner === GAIA || isAnimal(e) || e.hp <= 0 || e.nav || unreachable(W, e.id, GAIA)) return;
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
  if (kind === 'herd' && u.pen) {        // in a barn yard: graze inside the fence
    const b = alive(W, u.pen); if (!b || b.owner !== u.owner) { u.pen = 0; return; }
    if (!u.order && W.rnd() < 0.12) { const [x, y] = penSpot(W, b, u.id * 13 + W.tick); setOrder(W, u, { t: 'move', x, y, wander: true }); }
    return;
  }
  if (kind === 'herd') {                 // sheep: taken by whoever comes near (unless its owner is close too)
    let best = null, bd = 4, ownNear = false;
    unitsNear(W, u.x, u.y, 5, (e) => {
      if (e.owner === GAIA || isAnimal(e) || e.hp <= 0 || e.nav) return;
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
  if (kind === 'predator') {             // wolf: stalks villagers (more boldly at night)
    if (u.order && u.order.t === 'attack') return;
    const t = nearestPrey(W, u, d.los + (W.night ? 2 : 0), u.x, u.y, true);
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
  unitsNear(W, cx, cy, 1.4, (e) => { if (!taker && e.owner !== GAIA && !isAnimal(e) && !e.nav && e.hp > 0 && Math.hypot(e.x - cx, e.y - cy) <= 1.4) taker = e; });
  if (taker) {
    const P = W.players[taker.owner], T = TREASURES[tr.type];
    P.res[T.res] += tr.amount; P.stats.gathered += tr.amount; P.stats.gres[T.res] += tr.amount; P.stats.treasures++; addXp(W, P, tr.amount * XP.treasure);
    W.ev.push({ k: 'treasure', owner: taker.owner, x: cx, y: cy, type: tr.type, amount: tr.amount });
    del(W, tr.id);
  }
}
