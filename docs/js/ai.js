// Computer player: AoE2-style build order -> boom -> age up -> army waves.  Uses only sim commands.
// It plays under the fog of war like a human: it only knows enemy buildings, animals, treasures and resources it has
// actually seen (explored tiles / its own vision), so it must scout the map before it can find and attack anyone.
// Its personality comes from its card deck (economy, rush, fortress, scholar, navy); its army, doctrines and specialists
// are picked to counter what its scouts and spies have actually seen of the enemy.
import { UNITS, BUILDINGS, TECHS, GAIA, CARDS, MARKET, MILITARY, POP_LIMIT, DECKS } from './data.js?v=20261012210204';
import { DAY } from './data.js?v=20261012210204';
import { timeOfDay, unreachable, restNow } from './sim.js?v=20261012210204';
import { command, canAfford, placementOk, canBuild, canTrain, techOk, nearestResource, nearestDrop, nearestFree, alive, distTo, idx, hasBuilt, pl, isAnimal, rng, cardOk, buyPrice, sellPrice, stat, trainType, techCost, costOf, spyReport, regionAt, passable, center } from './sim.js?v=20261012210204';

const CELL = 8;   // exploration grid (tiles per cell side)
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };

const DIFF = {
  easy:   { think: 2.0, vil: [18, 24, 28], wave: 12, firstAttack: 900, armyCap: 16, mil: 0.6 },
  normal: { think: 1.0, vil: [22, 30, 38], wave: 9, firstAttack: 660, armyCap: 32, mil: 0.85 },
  hard:   { think: 0.6, vil: [24, 34, 46], wave: 7, firstAttack: 480, armyCap: 50, mil: 1.0 },
};
// personality: tweaks on top of the difficulty
const STYLE = {
  eko:     { vil: 4, attack: 1.2, wave: 1, towers: 1, mix: { inf: 1, arch: 1, cav: 1.2 }, doc1: 'doc_cavalry', doc2: 'doc_formation', iron: 0.08 },
  serbu:   { vil: -4, attack: 0.72, wave: -2, towers: 0, mix: { inf: 1.2, arch: 0.8, cav: 1.3 }, doc1: 'doc_cavalry', doc2: 'doc_blitz', iron: 0.06, early: true },
  benteng: { vil: 0, attack: 1.35, wave: 2, towers: 4, walls: true, mix: { inf: 1.2, arch: 1.4, cav: 0.6 }, doc1: 'doc_legion', doc2: 'doc_fortress', iron: 0.08 },
  ilmu:    { vil: 2, attack: 1.1, wave: 0, towers: 1, mix: { inf: 0.9, arch: 1.5, cav: 0.8 }, doc1: 'doc_archers', doc2: 'doc_formation', iron: 0.14, scholar: true },
  laut:    { vil: 2, attack: 1.05, wave: 0, towers: 1, mix: { inf: 1, arch: 1.4, cav: 0.8 }, doc1: 'doc_archers', doc2: 'doc_blitz', iron: 0.06, navy: true },
};
const CLS = (t) => { const c = UNITS[t] && UNITS[t].cls; return c === 'cavalry' ? 'cav' : c === 'archer' ? 'arch' : c === 'infantry' ? 'inf' : c; };

export class AI {
  constructor(W, pid, diff = 'normal') {
    this.W = W; this.pid = pid; this.D = DIFF[diff] || DIFF.normal; this.next = 1 + pid * 0.37; this.wave = 0; this.lastAttack = 0;
    this.rnd = rng(((W.seed || 1) * 31 + pid * 977) >>> 0);     // own stream: AI choices never disturb the sim's rng
    const P = W.players[pid];
    const deckKey = P.style && DECKS[P.style] ? P.style : Object.keys(DECKS)[(this.rnd() * 5) | 0];
    this.deckKey = deckKey; this.style = DECKS[deckKey].style; this.S = STYLE[this.style];
    if (!P.deck) P.deck = [...DECKS[deckKey].cards];
    P.style = deckKey;
    this.known = new Map();      // enemy buildings seen: id -> { x, y, owner, type }
    this.seen = new Map();       // gaia units seen: id -> { t, x, y, danger } (last sighting)
    this.tries = new Map();      // enemy building id -> [attacks sent, retry after]
    this.foes = new Map();       // enemy units seen: id -> { t, x, y, type, nav } (last sighting; counters + hunting survivors)
    this.tried = new Map();      // exploration cells already targeted: cell -> time
    this.scoutGoal = null; this.lastSweep = -99; this.attacked = 0; this.lastHit = -99; this.intel = null; this.inv = null;
  }
  tick() {
    const W = this.W; if (W.t < this.next) return; this.next = W.t + this.D.think;
    const P = W.players[this.pid]; if (!P.alive) return;
    const mine = { units: [], bld: [] };
    for (const e of W.dyn.values()) { if (e.owner !== this.pid) continue; if (e.kind === 'unit') mine.units.push(e); else if (e.kind === 'building') mine.bld.push(e); }
    this.m = mine; this.P = P;
    this.remember();
    const S = this.S;
    const vils = mine.units.filter(u => u.type === 'villager');
    const army = mine.units.filter(u => MILITARY(u.type) && !u.nav);         // land army
    const fleet = mine.units.filter(u => u.type === 'war_ship');
    const tc = mine.bld.find(b => b.type === 'town_center' && b.built) || mine.bld.find(b => b.type === 'town_center');
    this.base = tc ? [tc.x + 2, tc.y + 2] : (P.start || [W.size / 2, W.size / 2]);
    this.tc = tc;
    const count = (t, any = true) => mine.bld.filter(b => b.type === t && (any || b.built)).length;
    const building = (t) => mine.bld.some(b => b.type === t && !b.built);
    this.count = count;
    const firstAttack = this.D.firstAttack * S.attack;

    // ---- villagers
    const target = Math.max(12, this.D.vil[P.age - 1] + S.vil);
    const ageing = tc && tc.queue.some(q => q.tech && TECHS[q.tech].toAge);
    // dawn brings the food upkeep: keep enough in the granary as night approaches
    this.foodKeep = W.opts.night !== 'off' && (timeOfDay(W) > 0.4 || timeOfDay(W) < 0.03) ? Math.ceil(P.pop * DAY.upkeep * (P.techs.has('granary') ? 0.6 : 1) * Math.max(0, 1 + P.mods.upkeep) * 1.15) + 30 : 0;     // tomorrow's bread is not spent
    if (tc && tc.built && !ageing && vils.length < target && tc.queue.length < 2 && canAfford(P, UNITS.villager.cost) && P.res.food - 50 >= this.foodKeep) command(W, { t: 'train', pid: this.pid, bid: tc.id, type: 'villager' });
    // ---- houses
    const pendingPop = mine.bld.filter(b => !b.built && BUILDINGS[b.type].pop).length * 5;
    if (P.popCap + pendingPop < POP_LIMIT && P.pop + 4 > P.popCap + pendingPop && P.res.wood >= 25 && vils.length) this.build('house', this.base, 4, 10);
    // ---- drop sites and economy buildings
    const vilsOn = (k) => vils.filter(v => v.order && ((v.order.t === 'gather' && v.order.kind === k) || (v.order.t === 'drop' && v.order.then && v.order.then.kind === k) || (k === 'carcass' && v.order.t === 'attack' && v.order.hunt))).length;
    this.vilsOn = vilsOn;
    if (!count('mill') && vils.length >= 6 && P.res.wood >= 100) { const b = this.res('berry', this.base[0], this.base[1], 16); if (b) this.build('mill', [b.x, b.y], 2, 6); }
    if (count('lumber_camp') < Math.min(2, 1 + Math.floor(vilsOn('tree') / 8)) && vils.length >= 7 && P.res.wood >= 100 && !building('lumber_camp')) {
      const t = this.farResourceFromDrop('tree', 'wood'); if (t) this.build('lumber_camp', [t.x, t.y], 2, 6);
    }
    // woodlines recede: when lumberjacks walk far, move the camp up (AoE2 players do this constantly)
    if (building('lumber_camp')) this.needCamp = false;
    if (W.t > (this.lcT || 0) && count('lumber_camp') && count('lumber_camp') < 5 && !building('lumber_camp')) {
      let far = null, fd = 0, sum = 0, n = 0;
      for (const v of vils) {
        const o = v.order && (v.order.t === 'gather' ? v.order : v.order.t === 'drop' ? v.order.then : null); if (!o || o.kind !== 'tree') continue;
        const r = alive(W, o.id); if (!r) continue; const d = nearestDrop(W, this.pid, 'wood', r.x, r.y); const dd = d ? distTo(d, r.x, r.y) : 99;
        sum += dd; n++; if (dd > fd) { fd = dd; far = r; }
      }
      this.lcT = W.t + 5; this.needCamp = n >= 3 && sum / n > 6 && far;
      if (this.needCamp) this.build('lumber_camp', [far.x, far.y], 2, 5);
    }
    if (!count('mining_camp') && vils.length >= 14 && P.res.wood >= 100) { const g = this.res('gold', this.base[0], this.base[1], 22); if (g) this.build('mining_camp', [g.x, g.y], 2, 5); }
    if (P.age >= 2 && count('mining_camp') < 2 && vilsOn('iron') + vilsOn('stone') >= 3 && P.res.wood >= 100 && !building('mining_camp')) { const g = this.res('iron', this.base[0], this.base[1], 26); if (g && (!nearestDrop(W, this.pid, 'iron', g.x, g.y) || distTo(nearestDrop(W, this.pid, 'iron', g.x, g.y), g.x, g.y) > 5)) this.build('mining_camp', [g.x, g.y], 2, 5); }
    if (!count('barracks') && vils.length >= (S.early ? 10 : 12) && P.res.wood >= 175) this.build('barracks', this.base, 6, 12);
    if (P.age >= 2) {
      if (!count('archery_range') && P.res.wood >= 175) this.build('archery_range', this.base, 6, 13);
      if (!count('stable') && P.res.wood >= 200) this.build('stable', this.base, 6, 13);
      if (!count('blacksmith') && vils.length >= 20 && P.res.wood >= 160) this.build('blacksmith', this.base, 6, 13);
      if (!count('academy') && count('blacksmith', false) && vils.length >= (S.scholar ? 22 : 28) && P.res.wood >= 240 && P.res.stone >= 75) this.build('academy', this.base, 7, 15);
    }
    if (P.age >= 3 && !count('castle') && P.res.stone >= 650 && vils.length > 25) this.build('castle', this.base, 7, 14);
    if (!tc && vils.length && canAfford(P, BUILDINGS.town_center.cost)) this.build('town_center', this.base, 0, 10);     // rebuild a lost Town Center
    if (P.age >= 2 && !count('market') && vils.length >= 24 && P.res.wood >= 260) this.build('market', this.base, 8, 15);
    // floating resources: more production so the army can actually be rebuilt
    if (P.age >= 2 && P.res.wood > 900 && P.res.food + P.res.gold > 1500) for (const t of P.age >= 3 ? ['stable', 'archery_range', 'barracks'] : ['archery_range', 'barracks', 'stable']) if (count(t) < 3 && !building(t)) { this.build(t, this.base, 7, 15); break; }
    this.water(vils, fleet);
    this.defense(vils, army);
    this.forwardBase(army);
    // ---- give up when the kingdom can't come back (AoE2 AIs resign too)
    if (this.hopeless(tc, vils, army)) { if (!this.hopeT) this.hopeT = W.t; else if (W.t - this.hopeT > 20) { command(W, { t: 'resign', pid: this.pid }); return; } } else this.hopeT = 0;
    // ---- Home City shipment + market trades + spies
    if (P.ships > 0 && !P.shipment) { const c = this.pickCard(); if (c) command(W, { t: 'card', pid: this.pid, card: c }); }
    if (W.t > (this.mkT || 0)) { this.mkT = W.t + 5; this.trade(); }
    const aca = mine.bld.find(b => b.type === 'academy' && b.built);
    if (aca && P.techs.has('spy_network') && W.t >= P.spyCd && W.t - (this.spyT || -999) > 150) { this.spyT = W.t; command(W, { t: 'ability', pid: this.pid, bid: aca.id }); this.intel = spyReport(W, this.pid); }
    // farms when berries run out
    const berriesLeft = this.res('berry', this.base[0], this.base[1], 16);
    const farms = count('farm');
    const wantFood = Math.round(vils.length * 0.45 / Math.min(1, W.season.farm ?? 1) * (P.hungry ? 1.2 : 1));    // slow winter fields need more farmers
    const idleFarm = this.freeFarm();
    if (count('mill', false) && (!berriesLeft || vilsOn('berry') >= 6) && !idleFarm && farms < Math.min(18, wantFood) && P.res.wood >= 60 + (this.needCamp ? 100 : 0) && mine.bld.filter(b => b.type === 'farm' && !b.built).length < (P.res.wood >= 180 ? 2 : 1)) this.build('farm', this.base, 4, 11);
    // ---- age up + techs
    if (tc && tc.built && !ageing) {
      for (const t of ['feudal', 'castle']) if (techOk(W, this.pid, t, tc) && canAfford(P, TECHS[t].cost) && P.res.food - (TECHS[t].cost.food || 0) >= this.foodKeep && vils.length >= target - 2) command(W, { t: 'research', pid: this.pid, bid: tc.id, tech: t });
      if (vils.length > 14 && !P.techs.has('loom') && techOk(W, this.pid, 'loom', tc) && P.res.gold >= 50 && tc.queue.length < 2) command(W, { t: 'research', pid: this.pid, bid: tc.id, tech: 'loom' });
    }
    this.research();
    // ---- assign idle villagers
    const want = P.age === 1 ? { food: 0.6, wood: 0.4, gold: 0, stone: 0, iron: 0 } : P.age === 2 ? { food: 0.44, wood: 0.29, gold: 0.2, stone: 0.03, iron: S.iron * 0.6 } : { food: 0.4, wood: 0.26, gold: 0.2, stone: 0.06, iron: S.iron };
    if (P.age === 1 && this.planFeudal()) want.gold = 0.04;
    if (S.walls || S.towers > 2) want.stone += 0.04;
    for (const k in want) if (want[k] > 0) want[k] *= Math.max(0.15, Math.min(1.6, 1.4 - P.res[k] / 900));
    // the people eat every dawn: keep a granary
    if (P.res.food < P.pop * 3 + 50 || P.hungry) want.food *= 1.6;
    const now = { food: vilsOn('berry') + vilsOn('farm') + vilsOn('carcass') + vilsOn('fish'), wood: vilsOn('tree'), gold: vilsOn('gold'), stone: vilsOn('stone'), iron: vilsOn('iron') };
    // foundations the builders could not reach are cancelled (refunded) rather than retried forever
    for (const b of mine.bld) if (!b.built && b.progress < 0.05 && unreachable(W, b.id, this.pid)) command(W, { t: 'delete', pid: this.pid, id: b.id });
    const unfinished = mine.bld.filter(b => !b.built && b.id && !b.nb && !unreachable(W, b.id, this.pid));
    const night = restNow(W, P);          // the village sleeps: nobody is sent out until dawn
    for (const v of vils) {
      if (v.order || night) continue;
      if (unfinished.length) { const b = unfinished.shift(); command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: b.id, x: b.x, y: b.y }); continue; }
      const res = Object.keys(want).filter(k => want[k] > 0).sort((a, b) => (now[a] - vils.length * want[a]) - (now[b] - vils.length * want[b]))[0];
      let tgt = null;
      if (res === 'food') { tgt = this.meat(vilsOn('carcass')) || this.res('berry', this.base[0], this.base[1], 16) || this.freeFarm() || this.shoreFish(v); }
      else if (res === 'wood') tgt = this.nearDropRes('tree', 'wood', v);
      else tgt = this.nearDropRes(res, res, v);
      if (!tgt) tgt = this.nearDropRes('tree', 'wood', v);
      if (tgt) { command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: tgt.id, x: tgt.x, y: tgt.y }); now[res]++; }
    }
    // ---- starving (e.g. wolves ate the sheep, everyone ended up on wood): put half the villagers on food
    if (P.res.food < 60 && now.food < Math.ceil(vils.length * 0.3) && W.t > (this.stT || 0)) {
      this.stT = W.t + 6;
      const movers = vils.filter(v => v.order && v.order.t === 'gather' && v.order.kind !== 'farm' && !['berry', 'carcass', 'fish'].includes(v.order.kind)).slice(0, Math.ceil(vils.length * 0.5) - now.food);
      for (const v of movers) { const f = this.meat(vilsOn('carcass')) || this.res('berry', this.base[0], this.base[1], 16) || this.freeFarm() || this.shoreFish(v); if (!f) break; command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: f.id, x: f.x, y: f.y }); now.food++; }
      if (!movers.length || now.food < 1) { if (count('mill', false) && !mine.bld.some(b => b.type === 'farm' && !b.built)) this.build('farm', this.base, 4, 10); }
    }
    // ---- rebalance: move a few gatherers off a resource that is piling up
    const pile = Object.keys(now).find(k => P.res[k] > 900 && now[k] > 3);
    if (pile && W.t > (this.rbT || 0)) { this.rbT = W.t + 4;
      const kinds = { food: ['berry', 'farm', 'carcass', 'fish'], wood: ['tree'], gold: ['gold'], stone: ['stone'], iron: ['iron'] }[pile];
      const movers = vils.filter(v => v.order && v.order.t === 'gather' && kinds.includes(v.order.kind)).slice(0, 2);
      const need = ['wood', 'food', 'gold', 'iron'].filter(k => k !== pile && (k !== 'iron' || P.age >= 2)).sort((a, b) => P.res[a] - P.res[b])[0];
      for (const v of movers) {
        const f = need === 'food' ? (this.freeFarm() || this.res('berry', this.base[0], this.base[1], 16)) : this.nearDropRes(need === 'wood' ? 'tree' : need, need, v);
        if (f) command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: f.id, x: f.x, y: f.y });
      }
    }
    this.repair(vils);
    // ---- military
    if (army.length < this.D.armyCap && (P.age >= 2 || this.threat() || (S.early && vils.length >= 14)) && vils.length >= this.D.vil[0] * 0.7) this.trainArmy(army, ageing, target, vils);
    // ---- treasures: the scout grabs free ones, an idle army clears guarded ones nearby (AoE3)
    if (W.t > (this.thT || 0)) { this.thT = W.t + 3; this.treasureHunt(army); }
    // ---- scouting: one fast unit explores (home ring first, then out towards where enemies may live)
    this.scoutTick(army, fleet);
    // ---- defend / attack (only targets it has discovered)
    if (this.inv && this.invasion(army)) return;
    const threat = this.threat();
    const idleArmy = army.filter(u => (!u.order || u.order.amove) && u.id !== this.explorer);
    if (threat) { const ids = army.filter(u => (!u.order || u.order.t !== 'attack') && u.id !== this.explorer).map(u => u.id); if (ids.length) command(W, { t: 'move', pid: this.pid, ids, x: threat.x, y: threat.y, amove: true }); }
    else {
      if (this.known.size) this.everKnown = true;
      const core = [...this.known.values()].filter(k => !['farm', 'house'].includes(k.type)).length;
      const tgt = this.enemyTarget(), weak = this.everKnown && core <= 3;     // enemy nearly wiped out: finish it with what we have
      const need = Math.max(4, weak ? Math.min(5, this.D.wave + this.wave) : this.D.wave + this.wave + S.wave);
      if (tgt && W.t > firstAttack && idleArmy.length >= need && W.t - this.lastAttack > (weak ? 25 : 60)) {
        if (this.overSea(tgt)) { this.startInvasion(idleArmy, tgt); }
        else {
          const ids = idleArmy.map(u => u.id), form = this.formationFor(idleArmy);
          command(W, { t: 'form', pid: this.pid, ids, f: form });
          command(W, { t: 'move', pid: this.pid, ids, x: tgt[0], y: tgt[1], amove: true, form });
          if (!weak) this.wave = Math.min(this.wave + 2, 10); this.lastAttack = W.t;
          if (tgt[2]) { const tr = this.tries.get(tgt[2]) || [0, 0]; tr[0] = tr[0] >= 3 ? 1 : tr[0] + 1; tr[1] = W.t + 240; this.tries.set(tgt[2], tr); }
        }
      } else if (!this.known.size && idleArmy.length >= 3 && W.t - this.lastSweep > 25) {     // nobody (left) found: soldiers search together
        const ax = idleArmy.reduce((a, u) => a + u.x, 0) / idleArmy.length, ay = idleArmy.reduce((a, u) => a + u.y, 0) / idleArmy.length;
        const g = this.exploreTarget(ax, ay, true) || this.staleTarget(ax, ay);
        if (g) { command(W, { t: 'move', pid: this.pid, ids: idleArmy.map(u => u.id), x: g[0], y: g[1], amove: true }); this.lastSweep = W.t; }
      }
    }
    // the fleet hunts enemy ships, then shells the coast near known enemy buildings
    if (fleet.length >= 3 && W.t > (this.fleetT || 0)) {
      this.fleetT = W.t + 20;
      const ship = [...this.foes.values()].filter(f => f.nav && W.t - f.t < 60)[0];
      const k = ship || [...this.known.values()].find(k => k.type === 'dock') || [...this.known.values()][0];
      if (k) { const f = nearestFree(W, k.x, k.y, this.pid, 6, true); if (f) command(W, { t: 'move', pid: this.pid, ids: fleet.filter(s => !s.order).map(s => s.id), x: f[0] + 0.5, y: f[1] + 0.5, amove: true }); }
    }
  }

  // ---------------------------------------------------------------- what this player knows (fog of war)
  recent(id, s) { const o = this.seen.get(id); return !!o && this.W.t - o.t < s; }
  res(kind, x, y, r) { return nearestResource(this.W, kind, x, y, r, this.pid, null, this.P.exp); }
  remember() {
    const W = this.W, vis = this.P.vis, at = (x, y) => idx(W, Math.min(W.size - 1, Math.max(0, Math.floor(x))), Math.min(W.size - 1, Math.max(0, Math.floor(y))));
    for (const e of W.dyn.values()) {
      if (e.kind === 'building') {
        if (e.owner === this.pid || W.players[e.owner].team === this.P.team || BUILDINGS[e.type].wall) continue;
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        if (vis[at(cx, cy)]) this.known.set(e.id, { x: cx, y: cy, owner: e.owner, type: e.type });
      } else if (e.kind === 'unit' && e.owner === GAIA && vis[at(e.x, e.y)]) this.seen.set(e.id, { t: W.t, x: e.x, y: e.y, danger: !isAnimal(e) || ['predator', 'guard'].includes(UNITS[e.type].animal) });
      else if (e.kind === 'unit' && e.owner !== GAIA && e.owner !== this.pid && !isAnimal(e) && W.players[e.owner].team !== this.P.team && vis[at(e.x, e.y)]) this.foes.set(e.id, { t: W.t, x: e.x, y: e.y, type: e.type, nav: !!e.nav });
    }
    for (const [id, f] of this.foes) if (W.t - f.t > 150 || (W.t > f.t && vis[at(f.x, f.y)] && !W.ents.has(id))) this.foes.delete(id);
    // forget what turned out to be gone (seen destroyed, or its owner is out of the game)
    for (const [id, k] of this.known) if ((vis[at(k.x, k.y)] && !alive(W, id)) || !W.players[k.owner].alive) this.known.delete(id);
    if (this.seen.size > 300) for (const [id, o] of this.seen) if (o.long ? W.t - o.t > 400 : W.t - o.t > 120 || !W.ents.has(id)) this.seen.delete(id);
  }
  // share of the enemy army by class, from sightings (and the latest spy report, which sees everything)
  enemyMix() {
    const c = { inf: 0, arch: 0, cav: 0, siege: 0, n: 0 };
    const add = (t, k = 1) => { const cl = CLS(t); if (c[cl] === undefined) return; c[cl] += k; c.n += k; };
    for (const f of this.foes.values()) if (MILITARY(f.type) && !f.nav) add(f.type);
    if (this.intel && this.W.t - this.intel[0]?.t < 300) for (const r of this.intel) for (const [t, n] of Object.entries(r.army)) add(t, n * 0.5);
    return c;
  }
  // what the enemy committed to (spy reports): doctrines / specialists
  enemyTechs() { const s = new Set(); if (this.intel) for (const r of this.intel) for (const t of r.techs) s.add(t); return s; }
  // desired class weights: counter what we've seen (spear > cav > archer > infantry), lean on our own doctrine
  mixWeights() {
    const e = this.enemyMix(), w = { ...this.S.mix }, P = this.P;
    if (e.n >= 4) { w.inf += 3 * e.cav / e.n; w.cav += 3 * e.arch / e.n; w.arch += 3 * e.inf / e.n; }
    if (P.techs.has('doc_legion')) w.inf += 1.2; if (P.techs.has('doc_cavalry')) w.cav += 1.2; if (P.techs.has('doc_archers')) w.arch += 1.2;
    return w;
  }

  // ---------------------------------------------------------------- research: blacksmith, doctrines, academy, specialists
  research() {
    const W = this.W, P = this.P, S = this.S, mine = this.m;
    const go = (tech, at, spare = 120) => {
      const b = mine.bld.find(x => x.type === at && x.built && x.queue.length < 1); if (!b || !techOk(W, this.pid, tech, b)) return false;
      const c = techCost(P, tech); if (!canAfford(P, c) || P.res.food < (c.food || 0) + Math.max(spare, this.foodKeep)) return false;
      command(W, { t: 'research', pid: this.pid, bid: b.id, tech }); return true;
    };
    if (P.age >= 2) {
      for (const [tech, at] of [['double_bit_axe', 'lumber_camp'], ['horse_collar', 'mill'], ['gold_mining', 'mining_camp'], ['wheelbarrow', 'town_center'], ['iron_smelting', 'mining_camp'], ['granary', 'mill'], ['torches', 'town_center'], ['gillnets', 'dock'], ['guilds', 'market'], ['trade_route', 'market']]) go(tech, at, 150);
      // first doctrine: counter the enemy's main arm if we know it, otherwise our personality
      const e = this.enemyMix();
      const doc1 = e.n >= 5 ? (e.cav > e.arch && e.cav > e.inf ? 'doc_legion' : e.arch > e.inf ? 'doc_cavalry' : 'doc_archers') : S.doc1;
      go(doc1, 'blacksmith', 100);
      const w = this.mixWeights(), main = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0];
      const lines = { inf: ['forging', 'scale_mail', 'iron_casting', 'chain_mail'], cav: ['forging', 'scale_barding', 'iron_casting', 'chain_barding'], arch: ['fletching', 'padded_archer', 'bodkin'] };
      for (const t of [...lines[main], ...lines.arch, ...lines.inf, ...lines.cav]) if (go(t, 'blacksmith', 200)) break;
      go('spy_network', 'academy', 150);
      if (S.walls || S.towers > 2) go('masonry', 'academy', 150);
    }
    if (P.age >= 3) {
      const et = this.enemyTechs(), e = this.enemyMix();
      go(S.doc2 === 'doc_blitz' && et.has('doc_fortress') ? 'doc_formation' : S.doc2, 'academy', 150);
      // specialists: ninjas hunt archers/villagers, samurai crush infantry; katafrak shrug off spears, lancers shred archers
      go(e.n >= 4 && e.arch > e.inf ? 'spec_ninja' : 'spec_samurai', 'academy', 200);
      go(e.n >= 4 && e.inf > e.cav ? 'spec_cataphract' : 'spec_lancer', 'academy', 200);
      go(this.known.size > 8 || S.scholar ? 'spec_fire' : 'spec_crossbow', 'academy', 200);
      if (S.scholar || P.res.iron >= 200 || P.res.gold > 800) go('gunpowder', 'academy', 200);
      go('ballistics', 'academy', 300); go('conscription', 'castle', 300);
    }
  }

  // ---------------------------------------------------------------- army: what to train where
  trainArmy(army, ageing, target, vils) {
    const W = this.W, P = this.P, mine = this.m;
    const w = this.mixWeights(), have = { inf: 0, arch: 0, cav: 0, siege: 0 };
    for (const u of army) { const c = CLS(u.type); if (have[c] !== undefined) have[c]++; }
    const tot = w.inf + w.arch + w.cav, n = Math.max(1, army.length);
    const deficit = (c) => w[c] / tot - have[c] / n;
    const e = this.enemyMix();
    const options = [];
    for (const b of mine.bld) {
      if (!b.built || b.queue.length >= 2) continue;
      if (b.type === 'barracks') {
        const spear = e.n >= 3 && e.cav / e.n > 0.3 || P.techs.has('doc_legion') && this.rnd() < 0.5;
        options.push([b, P.age >= 2 && spear ? 'spearman' : 'militia', deficit('inf')]);
        if (P.age >= 3 && this.siegeWanted(army)) options.push([b, 'ram', 0.3]);
      } else if (b.type === 'archery_range') options.push([b, P.techs.has('gunpowder') && (P.res.iron >= 25 && this.rnd() < 0.4) ? 'gunner' : 'archer', deficit('arch')]);
      else if (b.type === 'stable') options.push([b, P.age >= 3 ? 'knight' : 'scout', deficit('cav')]);
      else if (b.type === 'academy' && P.techs.has('gunpowder') && this.siegeWanted(army)) options.push([b, 'cannon', 0.25]);
    }
    options.sort((a, b) => b[2] - a[2]);
    const reserve = ageing ? 0 : (P.age < 3 && vils.length >= target - 3 ? 500 : 0);    // saving up for the next age
    for (const [b, type0] of options.slice(0, 3)) {
      const type = trainType(P, type0), d = UNITS[type];
      if (!canTrain(W, this.pid, type) || !canAfford(P, d.cost)) continue;
      if (P.res.food - (d.cost.food || 0) < this.foodKeep) continue;                          // tomorrow's upkeep comes first
      if (reserve && P.res.food - (d.cost.food || 0) < reserve * (1 - this.D.mil)) continue;
      command(W, { t: 'train', pid: this.pid, bid: b.id, type: type0 });
    }
  }
  siegeWanted(army) {
    const siege = army.filter(u => UNITS[u.type].cls === 'siege').length;
    return this.known.size > 0 && siege < Math.max(1, Math.floor(army.length / 8));
  }
  // formation for an attack group: shield wall for mixed armies, box vs cavalry, spread vs archers / cannons
  formationFor(units) {
    const e = this.enemyMix(), ranged = units.filter(u => CLS(u.type) === 'arch' || CLS(u.type) === 'siege').length;
    if (e.n >= 4 && (e.arch + e.siege * 2) / e.n > 0.45) return 'menyebar';
    if (e.n >= 4 && e.cav / e.n > 0.45) return 'kotak';
    return ranged >= 2 && ranged < units.length ? 'tempur' : 'garis';
  }

  // ---------------------------------------------------------------- defence: towers, a wall ring with gates, repairs
  defense(vils, army) {
    const W = this.W, P = this.P, S = this.S; if (P.age < 2 || W.t < (this.defT || 0)) return;
    this.defT = W.t + 8;
    const pressed = this.attacked >= 3 && W.t - this.lastHit < 300;
    const towers = this.count('watch_tower'), wantT = S.towers + (pressed ? 2 : 0) + (this.D.think < 1 ? 1 : 0);
    if (towers < wantT && P.res.stone >= 125 + (S.walls ? 60 : 0) && P.res.wood >= 25) {
      // towers watch over the gold / lumber camps first, then the side facing the enemy
      const camps = this.m.bld.filter(b => b.built && ['mining_camp', 'lumber_camp', 'mill'].includes(b.type));
      const c = camps[towers % Math.max(1, camps.length)];
      const at = c && towers < camps.length ? [c.x + 1, c.y + 1] : this.towardEnemy(12);
      this.build('watch_tower', at, 2, 6);
    }
    if ((S.walls || (pressed && this.D.think < 1.5)) && P.res.stone >= 160 && vils.length >= 20) this.wallRing();
  }
  // a ring of stone wall around the town at radius R, with four gates; built a stretch at a time
  wallRing() {
    const W = this.W, P = this.P, [bx, by] = this.base, R = W.size >= 180 ? 20 : 17;
    if (this.m.bld.some(b => (b.type === 'stone_wall' || b.type === 'gate') && !b.built)) return;       // finish the current stretch first
    if (!this.ring) {
      const pts = [], seen = new Set();
      for (let k = 0; k < 360; k++) { const a = k / 360 * Math.PI * 2, i = Math.round(bx + Math.cos(a) * R), j = Math.round(by + Math.sin(a) * R), key = i + ',' + j; if (!seen.has(key)) { seen.add(key); pts.push([i, j, a]); } }
      this.ring = pts; this.ringI = 0; this.gates = [0, 1, 2, 3].map(q => q * Math.PI / 2 + this.rnd() * 0.5);
    }
    const nearGate = (a) => this.gates.some(g => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.13);
    const tiles = [];
    while (this.ringI < this.ring.length && tiles.length < 10) {
      const [i, j, a] = this.ring[this.ringI++];
      if (nearGate(a)) { if (!this.gateDone) this.gateDone = new Set(); const gk = this.gates.findIndex(g => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.13); if (!this.gateDone.has(gk) && P.res.stone >= 30) { this.gateDone.add(gk); const ax = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? 'y' : 'x'; if (placementOk(W, this.pid, 'gate', i, j, ax)) command(W, { t: 'place', pid: this.pid, type: 'gate', i, j, axis: ax, ids: this.builders(2, i, j) }); } continue; }
      if (placementOk(W, this.pid, 'stone_wall', i, j) && !W.road[idx(W, i, j)] && this.walkableBeside(i, j)) tiles.push([i, j]);
    }
    if (tiles.length && canAfford(P, { stone: 5 * tiles.length })) command(W, { t: 'place', pid: this.pid, type: 'stone_wall', tiles, ids: this.builders(2, tiles[0][0], tiles[0][1]) });
    if (this.ringI >= this.ring.length) this.ringI = 0;       // go round again later (fill gaps left by trees, rebuild)
  }
  // a builder from home can stand next to tile (i, j) (walls in the middle of a forest are never finished)
  walkableBeside(i, j) {
    const W = this.W, home = regionAt(W, this.base[0] + 0.5, this.base[1] + 0.5);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (passable(W, i + di, j + dj, this.pid) && regionAt(W, i + di + 0.5, j + dj + 0.5) === home) return true;
    return false;
  }
  builders(n, i, j) {
    if (restNow(this.W, this.P)) return [];
    return this.m.units.filter(u => u.type === 'villager' && (!u.order || u.order.t === 'gather')).sort((a, b) => Math.hypot(a.x - i, a.y - j) - Math.hypot(b.x - i, b.y - j)).slice(0, n).map(v => v.id);
  }
  // damaged buildings get two villagers once no enemy is close
  repair(vils) {
    const W = this.W; if (W.t < (this.repT || 0)) return; this.repT = W.t + 5;
    const hurt = this.m.bld.filter(b => b.built && b.hp < b.maxHp * 0.75 && !BUILDINGS[b.type].wall).sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0];
    if (!hurt || this.threatNear(hurt.x + hurt.w / 2, hurt.y + hurt.h / 2, 9)) return;
    if (vils.filter(v => v.order && v.order.t === 'repair').length >= 3) return;
    const ids = this.builders(2, hurt.x, hurt.y); if (ids.length) command(W, { t: 'smart', pid: this.pid, ids, target: hurt.id, x: hurt.x, y: hurt.y });
  }
  towardEnemy(d) {
    const k = [...this.known.values()].find(k => k.type === 'town_center') || [...this.known.values()][0];
    const [bx, by] = this.base, tx = k ? k.x : this.W.size / 2, ty = k ? k.y : this.W.size / 2, l = Math.hypot(tx - bx, ty - by) || 1;
    return [bx + (tx - bx) / l * d, by + (ty - by) / l * d];
  }
  // big maps, Castle Age: a forward camp (barracks + tower) part-way to the enemy, where new soldiers gather
  forwardBase(army) {
    const W = this.W, P = this.P; if (W.size < 180 || P.age < 3 || !this.known.size || W.t < (this.fbT || 0)) return;
    this.fbT = W.t + 15;
    const k = [...this.known.values()].find(k => k.type === 'town_center') || [...this.known.values()][0];
    if (this.overSea([k.x, k.y])) return;
    const [bx, by] = this.base, f = [bx + (k.x - bx) * 0.45, by + (k.y - by) * 0.45];
    if (Math.hypot(k.x - bx, k.y - by) < 60) return;
    const there = (t) => this.m.bld.some(b => b.type === t && Math.hypot(b.x - f[0], b.y - f[1]) < 10);
    if (!there('barracks') && P.res.wood >= 250) this.build('barracks', f, 0, 7, true);
    else if (!there('watch_tower') && P.res.stone >= 150) this.build('watch_tower', f, 2, 6, true);
    if (!this.fwd) { this.fwd = f; for (const b of this.m.bld) if (b.built && BUILDINGS[b.type].trains && b.type !== 'town_center' && b.type !== 'dock') command(W, { t: 'rally', pid: this.pid, bid: b.id, x: f[0], y: f[1] }); }
  }

  // ---------------------------------------------------------------- water: dock, fishing boats, war fleet, transports
  water(vils, fleet) {
    const W = this.W, P = this.P, S = this.S; if (W.t < (this.watT || 0)) return; this.watT = W.t + 6;
    const island = W.map && W.map.water === 'islands';
    const fish = this.res('fish', this.base[0], this.base[1], island ? 80 : 34);
    if (!this.count('dock') && (fish || island) && vils.length >= (S.navy || island ? 8 : 14) && P.res.wood >= 150) {
      // by the fish if possible, else the nearest shore of our own landmass (on big islands the sea can be 40+ tiles away)
      if (!(fish && this.build('dock', [fish.x, fish.y], 1, 8))) { const sp = this.dockSpot(); if (sp) this.build('dock', sp, 0, 3); }
    }
    const dock = this.m.bld.find(b => b.type === 'dock' && b.built); if (!dock) return;
    const boats = this.m.units.filter(u => u.type === 'fishing_boat').length;
    if (fish && boats < (S.navy ? 6 : 3) && dock.queue.length < 2 && canAfford(P, UNITS.fishing_boat.cost)) command(W, { t: 'train', pid: this.pid, bid: dock.id, type: 'fishing_boat' });
    const enemyShips = [...this.foes.values()].filter(f => f.nav && f.type === 'war_ship' && W.t - f.t < 120).length;
    const wantFleet = P.age >= 2 ? (S.navy ? 5 : 0) + enemyShips + (island ? 3 : 0) : 0;
    if (fleet.length < Math.min(10, wantFleet) && dock.queue.length < 2 && canAfford(P, UNITS.war_ship.cost)) command(W, { t: 'train', pid: this.pid, bid: dock.id, type: 'war_ship' });
    const trans = this.m.units.filter(u => u.type === 'transport_ship').length;
    if (island && P.age >= 2 && trans < 2 && dock.queue.length < 2 && canAfford(P, UNITS.transport_ship.cost)) command(W, { t: 'train', pid: this.pid, bid: dock.id, type: 'transport_ship' });
  }
  // centre of the nearest explored spot where a dock fits and a builder from home can walk up to it
  dockSpot() {
    const W = this.W, [bx, by] = this.base, n = BUILDINGS.dock.n;
    if (this.dockC && W.t < this.dockC.t) return this.dockC.p;
    let p = null;
    for (let r = 3; r < Math.min(110, W.size) && !p; r++) for (let k = 0, m = Math.max(16, Math.round(r * 4)); k < m && !p; k++) {
      const a = k / m * Math.PI * 2, i = Math.round(bx + Math.cos(a) * r - n / 2), j = Math.round(by + Math.sin(a) * r - n / 2);
      if (!placementOk(W, this.pid, 'dock', i, j)) continue;
      let ok = false;
      for (let q = -1; q <= n && !ok; q++) ok = this.walkableBeside(i + q, j - 1) || this.walkableBeside(i + q, j + n) || this.walkableBeside(i - 1, j + q) || this.walkableBeside(i + n, j + q);
      if (ok) p = [i + n / 2, j + n / 2];
    }
    this.dockC = { t: W.t + 20, p }; return p;
  }
  shoreFish(v) { const f = this.res('fish', v.x, v.y, 14); return f && this.W.players[this.pid] && f; }
  // is the target on another landmass (islands): then the army has to sail
  overSea(t) { const W = this.W; return regionAt(W, this.base[0], this.base[1] + 3) !== regionAt(W, t[0], t[1]) && !W.frozen; }
  startInvasion(army, tgt) {
    const ships = this.m.units.filter(u => u.type === 'transport_ship' && !u.order);
    if (!ships.length) return;
    const cap = ships.reduce((s, sh) => s + stat(this.W, this.pid, sh.type).capacity - sh.cargo.length, 0);
    const go = army.slice(0, cap);
    this.inv = { ships: ships.map(s => s.id), units: go.map(u => u.id), tgt, t: this.W.t, state: 'board' };
    this.lastAttack = this.W.t;
  }
  // board -> sail -> land -> attack; gives up after a while if something goes wrong
  invasion(army) {
    const W = this.W, inv = this.inv;
    const ships = inv.ships.map(id => alive(W, id)).filter(Boolean);
    if (!ships.length || W.t - inv.t > 360) { this.inv = null; return false; }
    if (inv.state === 'board') {
      const ashore = inv.units.map(id => W.ents.get(id)).filter(u => u && u.kind === 'unit');
      // park the transports at the nearest coast, then walk everyone aboard
      if (!inv.parked) { inv.parked = true; for (const s of ships) { const c = this.coast(this.base); if (c) command(W, { t: 'move', pid: this.pid, ids: [s.id], x: c[0], y: c[1] }); } }
      let k = 0;
      for (const u of ashore) { const s = ships[k++ % ships.length]; if (!u.order || u.order.t !== 'board') command(W, { t: 'smart', pid: this.pid, ids: [u.id], target: s.id, x: s.x, y: s.y }); }
      if (!ashore.length || W.t - inv.t > 90) { inv.state = 'sail'; for (const s of ships) if (s.cargo.length) command(W, { t: 'unload', pid: this.pid, ids: [s.id], x: inv.tgt[0], y: inv.tgt[1] }); }
      return true;
    }
    if (inv.state === 'sail') {
      if (ships.every(s => !s.cargo.length)) { inv.state = 'land'; inv.t2 = W.t; }
      return true;
    }
    if (inv.state === 'land') {
      const landed = inv.units.map(id => W.ents.get(id)).filter(u => u && u.kind === 'unit');
      if (landed.length) command(W, { t: 'move', pid: this.pid, ids: landed.map(u => u.id), x: inv.tgt[0], y: inv.tgt[1], amove: true });
      this.inv = null; return false;
    }
    return false;
  }
  coast(p) {     // a water tile right next to land near p
    const W = this.W;
    const home = regionAt(W, p[0] + 0.5, p[1] + 0.5);
    for (let r = 2; r < 110; r++) for (let k = 0, m = Math.max(16, r * 3); k < m; k++) {
      const a = k / m * Math.PI * 2, i = Math.round(p[0] + Math.cos(a) * r), j = Math.round(p[1] + Math.sin(a) * r);
      if (!passable(W, i, j, this.pid, true)) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (passable(W, i + di, j + dj, this.pid) && regionAt(W, i + di + 0.5, j + dj + 0.5) === home) return [i + 0.5, j + 0.5];
    }
    return null;
  }

  // ---------------------------------------------------------------- scouting
  // unexplored area worth a look. home = early ring around the base; far = out towards the enemy side of the map
  exploreTarget(fx, fy, far, nav = false) {
    const W = this.W, S = W.size, exp = this.P.exp, n = Math.ceil(S / CELL), [bx, by] = this.base, C = S / 2;
    const homeR = Math.hypot(bx - C, by - C), dangers = [...this.known.values()].filter(k => k.type === 'town_center' || BUILDINGS[k.type].attack);
    const beasts = [...this.seen.values()].filter(o => o.danger && W.t - o.t < (o.long ? 400 : 120));
    for (const e of W.dyn.values()) if (e.kind === 'treasure' && exp[idx(W, e.x, e.y)] && e.guards.some(id => alive(W, id))) beasts.push({ x: e.x + 0.5, y: e.y + 0.5 });   // guards stay by their chest
    const home = regionAt(W, fx, fy, nav);
    let best = null, bs = 1e9;
    for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++) {
      const cell = cj * n + ci; if (W.t - (this.tried.get(cell) ?? -1e9) < (far ? 90 : 45)) continue;
      const x = Math.min(S - 1, ci * CELL + CELL / 2), y = Math.min(S - 1, cj * CELL + CELL / 2);
      let un = 0, all = 0;
      for (let j = cj * CELL + 1; j < Math.min(S, cj * CELL + CELL); j += 2) for (let i = ci * CELL + 1; i < Math.min(S, ci * CELL + CELL); i += 2) { all++; if (!exp[j * S + i]) un++; }
      if (!all || un / all < 0.45) continue;
      const f = nearestFree(W, x, y, this.pid, 4, nav); if (!f || (home && regionAt(W, f[0] + 0.5, f[1] + 0.5, nav) !== home)) continue;   // stay on our landmass / sea
      const db = Math.hypot(x - bx, y - by), df = Math.hypot(x - fx, y - fy);
      let sc;
      if (!far) { if (db > 28) continue; sc = df * 0.8 + Math.abs(db - 16) * 1.5; }
      else sc = df * 0.5 + Math.abs(Math.hypot(x - C, y - C) - homeR) * 0.7 - db * 0.35;
      if (dangers.some(k => Math.hypot(k.x - x, k.y - y) < 11)) sc += 60;      // keep the scout out of arrow range
      if (beasts.some(o => Math.hypot(o.x - x, o.y - y) < 7)) sc += 30;        // ... and away from wolves, bears and bandits,
      else if (beasts.some(o => segDist(o.x, o.y, fx, fy, x, y) < 6)) sc += 40;  // also on the way there
      sc += this.rnd() * 8 - (un / all) * 6;
      if (sc < bs) { bs = sc; best = [f[0] + 0.5, f[1] + 0.5, cell]; }
    }
    if (!best) return null;
    this.tried.set(best[2], W.t);
    return [best[0], best[1]];
  }
  scoutTick(army, fleet) {
    const W = this.W;
    let u = alive(W, this.explorer);
    if (!u || u.owner !== this.pid) {
      // the scout died out there: remember the spot as dangerous for a good while
      if (this.explorer && this.scoutPos) this.seen.set('lost' + Math.round(W.t), { t: W.t, x: this.scoutPos[0], y: this.scoutPos[1], danger: true, long: true });
      // only the fast scout cavalry explores alone (slow soldiers get run down by wolves); they search in groups instead.
      // Nothing left to see on our own island: a ship explores the coasts.
      u = army.find(a => a.type === 'scout' && a.hp >= a.maxHp * 0.5 && (!a.order || a.order.t === 'move')) || null;
      if (!u && !this.known.size && this.homeDone) u = fleet.find(s => !s.order) || this.m.units.find(s => s.type === 'war_ship' || s.type === 'fishing_boat') || null;
      this.explorer = u ? u.id : 0; this.scoutGoal = null; this.scoutPos = null;
      if (!u) { this.replaceScout(); return; }
    }
    this.scoutPos = [u.x, u.y];
    if (!u.nav && this.evade(u)) return;
    // taking hits while already wounded (wolves, a guard, enemy soldiers): break off and ride home
    const hurt = u.hp < (this.scoutHp ?? u.hp) - 0.1 && u.hp < u.maxHp * 0.75; this.scoutHp = u.hp;
    if (hurt && !u.nav && !(this.scoutGoal && this.scoutGoal[3])) { this.scoutGoal = [this.base[0], this.base[1] + 3, W.t + 30, true]; command(W, { t: 'move', pid: this.pid, ids: [u.id], x: this.base[0], y: this.base[1] + 3 }); return; }
    if (u.order && u.order.t === 'attack') return;
    if (u.hp < u.maxHp * 0.4) {             // too wounded to scout on: send it home to guard and get a fresh scout
      command(W, { t: 'move', pid: this.pid, ids: [u.id], x: this.base[0] + 2, y: this.base[1] + 4 }); this.explorer = 0; this.scoutPos = null; this.scoutGoal = null; return;
    }
    const g = this.scoutGoal, arrived = g && Math.hypot(u.x - g[0], u.y - g[1]) < 2.5;
    if (u.order && g && !arrived && W.t < g[2]) return;
    if (u.order && !g) return;                                             // running to a treasure (treasureHunt)
    const far = W.t > 200 || this.homeExplored();
    let t = this.exploreTarget(u.x, u.y, far, u.nav) || (!far ? this.exploreTarget(u.x, u.y, true, u.nav) : null);
    if (!t && !u.nav && !this.known.size && this.W.t > 240) {             // our landmass is mapped: time for a ship
      this.homeDone = true;
      const ship = fleet.find(s => !s.order) || this.m.units.find(s => s.type === 'war_ship' || s.type === 'fishing_boat');
      if (ship) { this.explorer = ship.id; this.scoutGoal = null; command(W, { t: 'stop', pid: this.pid, ids: [ship.id] }); return; }
    }
    if (!t) {          // whole map seen: patrol past known enemy buildings to keep the picture fresh
      const ks = [...this.known.values()]; const k = ks.length ? ks[(this.rnd() * ks.length) | 0] : null;
      t = k ? [k.x + (this.rnd() - 0.5) * 24, k.y + (this.rnd() - 0.5) * 24] : [this.rnd() * W.size, this.rnd() * W.size];
      const f = nearestFree(W, t[0], t[1], this.pid, 5, u.nav); if (!f) return; t = [f[0] + 0.5, f[1] + 0.5];
    }
    this.scoutGoal = [t[0], t[1], W.t + 45];
    command(W, { t: 'move', pid: this.pid, ids: [u.id], x: t[0], y: t[1] });
  }
  // scout micro: wolves, guards or enemy soldiers closing in -> ride away from them (the scout outruns all of them)
  evade(u) {
    const W = this.W, vis = this.P.vis; let dx = 0, dy = 0, n = 0;
    for (const e of W.dyn.values()) {
      if (e.kind !== 'unit' || e.owner === this.pid || e.hp <= 0) continue;
      const d = Math.hypot(e.x - u.x, e.y - u.y); if (d > 5 || !vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) continue;
      const hostile = e.owner === GAIA ? !isAnimal(e) || ['predator', 'guard'].includes(UNITS[e.type].animal) : W.players[e.owner].team !== this.P.team && e.type !== 'villager';
      if (!hostile) continue;
      dx += (u.x - e.x) / Math.max(0.5, d); dy += (u.y - e.y) / Math.max(0.5, d); n++;
    }
    if (!n) return false;
    const l = Math.hypot(dx, dy) || 1, f = nearestFree(W, u.x + dx / l * 9, u.y + dy / l * 9, this.pid, 4); if (!f) return false;
    this.scoutGoal = [f[0] + 0.5, f[1] + 0.5, W.t + 6];
    command(W, { t: 'move', pid: this.pid, ids: [u.id], x: f[0] + 0.5, y: f[1] + 0.5 });
    return true;
  }
  // lost the scout: a new scout cavalry from the stable (Feudal+), or in the Dark Age a party of 3 militia to search together
  replaceScout() {
    const W = this.W, P = this.P; if (W.t < 240 || W.t < (this.rsT || 0)) return;
    const party = this.m.units.filter(u => u.type === 'militia').length;
    const type = P.age >= 2 ? 'scout' : !this.known.size && W.t > 420 && party < 3 ? 'militia' : null; if (!type) return;
    const b = this.m.bld.find(x => x.type === UNITS[type].from && x.built && x.queue.length < 2);
    if (b && canAfford(P, UNITS[type].cost) && P.res.food - (UNITS[type].cost.food || 0) >= (this.foodKeep || 0)) { command(W, { t: 'train', pid: this.pid, bid: b.id, type }); this.rsT = W.t + (type === 'scout' ? 90 : 10); }
  }
  homeExplored() {
    const W = this.W, S = W.size, [bx, by] = this.base; let un = 0, all = 0;
    for (let a = 0; a < 24; a++) for (const d of [10, 15, 20]) { const i = Math.floor(bx + Math.cos(a / 24 * 6.283) * d), j = Math.floor(by + Math.sin(a / 24 * 6.283) * d); if (i < 0 || j < 0 || i >= S || j >= S) continue; all++; if (!this.P.exp[j * S + i]) un++; }
    return un <= all * 0.08;
  }
  meat(hunters) {
    // carcasses first (shared by up to 5), then sheep, then deer close to home
    const W = this.W, [bx, by] = this.base; let best = null, bd = 1e9;
    for (const e of W.dyn.values()) {
      let sc = null;
      if (e.kind === 'res' && e.type === 'carcass' && e.amount > 10 && this.P.exp[idx(W, Math.floor(e.x + 0.5), Math.floor(e.y + 0.5))]) sc = Math.hypot(e.x - bx, e.y - by);
      else if (e.kind === 'unit' && e.type === 'sheep' && (e.owner === this.pid || (e.owner === GAIA && this.recent(e.id, 60)))) sc = Math.hypot(e.x - bx, e.y - by) + 4;
      else if (e.kind === 'unit' && e.type === 'deer' && this.P.age === 1 && this.recent(e.id, 60)) sc = Math.hypot(e.x - bx, e.y - by) + 8;
      if (sc === null || sc > 18 || unreachable(W, e.id, this.pid)) continue;
      if (e.kind === 'res') { let n = 0; for (const v of this.m.units) if (v.order && v.order.id === e.id) n++; if (n >= 5) continue; }
      if (sc < bd) { bd = sc; best = e; }
    }
    return best;
  }
  treasureHunt(army) {
    const W = this.W, [bx, by] = this.base;
    const busy = (u) => u.order && (u.order.t === 'attack' || u.order.amove);
    let near = null, nd = 1e9;
    for (const e of W.dyn.values()) if (e.kind === 'treasure' && this.P.exp[idx(W, e.x, e.y)]) { const d = Math.hypot(e.x - bx, e.y - by); if (d < nd && d < 45) { nd = d; near = e; } }
    if (!near) return;
    if (this.overSea([near.x, near.y])) return;
    const free = !near.guarded;
    if (free) {
      // no runner into beasts seen near the chest, and never a wounded / retreating scout
      if ([...this.seen.values()].some(o => o.danger && W.t - o.t < 60 && Math.hypot(o.x - near.x, o.y - near.y) < 8)) return;
      const runner = army.filter(u => !busy(u) && u.hp >= u.maxHp * 0.75 && !(u.id === this.explorer && this.scoutGoal && this.scoutGoal[3])).sort((a, b) => (b.type === 'scout') - (a.type === 'scout'))[0];
      if (runner && !(runner.order && runner.order.t === 'move' && !(runner.id === this.explorer && this.scoutGoal))) {
        command(W, { t: 'move', pid: this.pid, ids: [runner.id], x: near.x + 0.5, y: near.y + 0.5 }); if (runner.id === this.explorer) this.scoutGoal = null;
      }
      return;
    }
    const idle = army.filter(u => !u.order);
    const guards = near.guards.filter(id => alive(W, id)).length;      // only with enough soldiers for the guards
    if (idle.length >= 4 + 2 * guards && !this.threat()) command(W, { t: 'move', pid: this.pid, ids: idle.map(u => u.id), x: near.x + 0.5, y: near.y + 0.5, amove: true });
  }
  planFeudal() { return this.P.techs.has('loom') === false && this.m.units.length > 14; }
  threatNear(x, y, r) {
    const W = this.W;
    for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner >= 0 && e.owner !== this.pid && pl(W, e.owner).team !== this.P.team && MILITARY(e.type) && Math.hypot(e.x - x, e.y - y) < r && this.P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) return e;
    return null;
  }
  threat() {
    const W = this.W;
    for (const e of W.dyn.values()) {
      if (e.kind !== 'unit' || e.owner === this.pid || pl(W, e.owner).team === this.P.team) continue;
      if (isAnimal(e) && UNITS[e.type].animal !== 'predator') continue;
      if (Math.hypot(e.x - this.base[0], e.y - this.base[1]) < 16 && this.P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) {
        if (e.owner >= 0 && W.t - this.lastHit > 30) { this.attacked++; this.lastHit = W.t; }
        return e;
      }
    }
    return null;
  }
  // nearest discovered enemy building that matters (no peeking through the fog), else the latest enemy sighting.
  // Farms are skipped (soldiers don't auto-target them and they don't keep a player alive); Town Centers and production
  // first; a target attacked 3 times without falling is left alone for a while.
  enemyTarget() {
    const W = this.W; let best = null, bd = 1e9;
    const [ox, oy] = this.fwd || this.base;
    for (const [id, k] of this.known) {
      if (k.type === 'farm' || (this.tries.get(id) || [0])[0] >= 3 && W.t < this.tries.get(id)[1]) continue;
      const d = Math.hypot(k.x - ox, k.y - oy) - (k.type === 'town_center' ? 12 : BUILDINGS[k.type].trains || BUILDINGS[k.type].attack ? 6 : k.type === 'house' ? -4 : 0);
      if (d < bd) { bd = d; best = [k.x, k.y, id]; }
    }
    if (!best) { let t = -1; for (const f of this.foes.values()) if (!f.nav && f.t > t && Math.hypot(f.x - this.base[0], f.y - this.base[1]) > 12) { t = f.t; best = [f.x, f.y]; } }
    return best;
  }
  // whole map explored and nobody in sight: comb through areas we can't see right now, far from home first
  staleTarget(fx, fy) {
    const W = this.W, S = W.size, vis = this.P.vis, n = Math.ceil(S / CELL), [bx, by] = this.base;
    let best = null, bs = 1e9;
    for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++) {
      const cell = cj * n + ci; if (W.t - (this.tried.get(cell) ?? -1e9) < 120) continue;
      let seen = 0, all = 0;
      for (let j = cj * CELL + 1; j < Math.min(S, cj * CELL + CELL); j += 2) for (let i = ci * CELL + 1; i < Math.min(S, ci * CELL + CELL); i += 2) { all++; if (vis[j * S + i]) seen++; }
      if (!all || seen / all > 0.2) continue;
      const x = Math.min(S - 1, ci * CELL + CELL / 2), y = Math.min(S - 1, cj * CELL + CELL / 2);
      if (this.overSea([x, y])) continue;
      const sc = Math.hypot(x - fx, y - fy) * 0.6 - Math.hypot(x - bx, y - by) * 0.4 + this.rnd() * 10;
      if (sc < bs) { bs = sc; best = [x, y, cell]; }
    }
    if (!best) return null;
    this.tried.set(best[2], W.t);
    const f = nearestFree(W, best[0], best[1], this.pid, 4); return f ? [f[0] + 0.5, f[1] + 0.5] : null;
  }
  // no Town Center, (almost) no villagers and no army to speak of: nothing left to fight for
  hopeless(tc, vils, army) {
    const W = this.W, P = this.P; if (W.t < 300 || tc) return false;
    const canRebuild = vils.length >= 1 && P.res.wood + P.res.gold >= 400 && P.res.stone >= 100;
    const makers = this.m.bld.some(b => b.built && BUILDINGS[b.type].trains);
    return (!vils.length && army.length < 5 && !makers) || (vils.length < 3 && !canRebuild && army.length < 4);
  }
  // Home City card from our deck: villagers and economy first, soldiers when threatened, otherwise the crate we need most
  pickCard() {
    const P = this.P, ok = (id) => cardOk(P, id), threat = this.threat();
    const army = this.m.units.filter(u => MILITARY(u.type)).length;
    const deck = P.deck.filter(ok);
    if (!deck.length) return null;
    const soldiers = deck.filter(id => CARDS[id].units && MILITARY(CARDS[id].units[0][0]));
    if ((threat || (army < 6 && this.W.t > this.D.firstAttack)) && soldiers.length) return soldiers[soldiers.length - 1];
    const firsts = deck.filter(id => CARDS[id].units && CARDS[id].units[0][0] === 'villager').concat(deck.filter(id => CARDS[id].mod || CARDS[id].reveal));
    if (firsts.length) return firsts[0];
    if (this.style === 'serbu' && soldiers.length) return soldiers[(this.rnd() * soldiers.length) | 0];
    const crates = deck.filter(id => CARDS[id].give);
    const need = (c) => Object.entries(CARDS[c].give).reduce((s, [r, n]) => s + n / (200 + P.res[r]), 0);
    return crates.sort((a, b) => need(b) - need(a))[0] || deck[0];
  }
  // market: sell what piles up, buy what's short when rich in gold (one or two lots at a time, prices move each trade)
  trade() {
    const W = this.W, P = this.P, mk = this.m.bld.find(b => b.type === 'market' && b.built); if (!mk) return;
    const goods = Object.keys(MARKET.base);
    for (const r of goods) if (P.res[r] > (r === 'stone' ? 700 : 1100) && sellPrice(W, P, r) >= 40) command(W, { t: 'trade', pid: this.pid, bid: mk.id, res: r, buy: false });
    const short = goods.filter(r => r !== 'stone').sort((a, b) => P.res[a] - P.res[b])[0];
    if (P.res[short] < 150 && P.res.gold > buyPrice(W, P, short) + 250 && buyPrice(W, P, short) < 260) command(W, { t: 'trade', pid: this.pid, bid: mk.id, res: short, buy: true });
    if (this.foodKeep > P.res.food && P.res.gold >= buyPrice(W, P, 'food') + 20) command(W, { t: 'trade', pid: this.pid, bid: mk.id, res: 'food', buy: true });   // the market feeds the town before dawn
    if (P.res.gold < 80) { const rich = goods.sort((a, b) => P.res[b] - P.res[a])[0]; if (P.res[rich] > 500) command(W, { t: 'trade', pid: this.pid, bid: mk.id, res: rich, buy: false }); }
  }
  nearDropRes(kind, res, v) {
    const W = this.W, d = nearestDrop(W, this.pid, res, v.x, v.y);
    const [x, y] = d ? [d.x + d.w / 2, d.y + d.h / 2] : this.base;
    return this.res(kind, x, y, 30);
  }
  farResourceFromDrop(kind, res) {
    const W = this.W; const t = this.res(kind, this.base[0], this.base[1], 30); if (!t) return null;
    const d = nearestDrop(W, this.pid, res, t.x, t.y);
    return d && distTo(d, t.x, t.y) < 5 ? (this.m.bld.filter(b => b.type === 'lumber_camp').length ? this.secondForest(kind) : null) : t;
  }
  secondForest(kind) {
    const W = this.W; let best = null, bd = 1e9;
    for (const e of W.ents.values()) {
      if (e.kind !== 'res' || e.type !== kind || !this.P.exp[idx(W, e.x, e.y)]) continue;
      const d = nearestDrop(W, this.pid, 'wood', e.x, e.y); if (d && distTo(d, e.x, e.y) < 7) continue;
      const dd = Math.hypot(e.x - this.base[0], e.y - this.base[1]); if (dd < bd && dd < 24) { bd = dd; best = e; }
    }
    return best;
  }
  freeFarm() {
    for (const b of this.m.bld) if (b.type === 'farm' && b.built) { const f = b.farmer && alive(this.W, b.farmer); if (!f || !f.order || f.order.id !== b.id) return b; }
    return null;
  }
  // ---------------------------------------------------------------- town planning
  // Candidate spots in rings around `near` are scored instead of taking the first that fits: buildings keep to blocks
  // between planned streets (every 7th row / column through the Town Center), houses line up in rows, military
  // buildings face the enemy, and nothing is put on a road. The result reads as a planned town that grows outward.
  build(type, near, rMin, rMax, anywhere = false) {
    const W = this.W, P = this.P; if (!canBuild(W, this.pid, type) || !canAfford(P, costOf(P, type))) return false;
    const d = BUILDINGS[type], n = d.n;
    // already placing one?
    if (this.m.bld.some(b => b.type === type && !b.built)) return false;
    const [cx, cy] = near, [tx, ty] = this.base;
    const far = !d.water && ['house', 'farm', 'barracks', 'archery_range', 'stable', 'market', 'castle', 'watch_tower', 'town_center', 'blacksmith', 'academy'].includes(type) ? 9 : 0;
    const planned = !anywhere && !d.water && type !== 'farm' && !['lumber_camp', 'mining_camp', 'mill', 'watch_tower'].includes(type);
    const street = (i, j) => Math.abs(i - tx) < 22 && Math.abs(j - ty) < 22 && (((i - Math.round(tx)) % 7 + 7) % 7 === 0 || ((j - Math.round(ty)) % 7 + 7) % 7 === 0);
    const mil = ['barracks', 'archery_range', 'stable', 'castle'].includes(type), [ex, ey] = mil ? this.towardEnemy(20) : [0, 0];
    let best = null, bs = 1e9, tried = 0;
    rings: for (let r = rMin; r <= rMax + far && tried < 260; r++) for (let k = 0; k < (r > rMax ? 24 : 16); k++) {
      const a = (k / (r > rMax ? 24 : 16)) * Math.PI * 2 + (this.pid + r) * 0.7;
      const i = Math.round(cx + Math.cos(a) * r - n / 2), j = Math.round(cy + Math.sin(a) * r - n / 2);
      if (!placementOk(W, this.pid, type, i, j)) continue;
      // keep a 1-tile gap around blocking buildings so villagers never get walled in
      let ok = true;
      if (d.block) for (let a2 = -1; a2 <= n && ok; a2++) for (let c = -1; c <= n && ok; c++) { const ii = i + a2, jj = j + c; if (ii < 0 || jj < 0 || ii >= W.size || jj >= W.size) continue; const o = W.occ[idx(W, ii, jj)]; if (o && W.ents.get(o)?.kind === 'building') ok = false; }
      if (!ok) continue;
      tried++;
      let sc = r * 1.0;
      if (planned) {
        let onStreet = 0, onRoad = 0, nextRoad = 0;
        for (let a2 = 0; a2 < n; a2++) for (let c = 0; c < n; c++) { if (street(i + a2, j + c)) onStreet++; if (W.road[idx(W, i + a2, j + c)]) onRoad++; }
        for (let a2 = -1; a2 <= n; a2++) for (let c = -1; c <= n; c++) if ((a2 < 0 || a2 >= n || c < 0 || c >= n) && i + a2 >= 0 && j + c >= 0 && i + a2 < W.size && j + c < W.size && (W.road[idx(W, i + a2, j + c)] || street(i + a2, j + c))) nextRoad++;
        sc += onStreet * 2.5 + onRoad * 4 - Math.min(4, nextRoad) * 0.8;
        if (type === 'house') for (const b of this.m.bld) if (b.type === 'house' && b.x !== undefined && (b.y === j || b.x === i) && Math.abs(b.x - i) + Math.abs(b.y - j) <= 6) { sc -= 2.5; break; }   // rows of houses
        if (mil) sc += Math.hypot(i - ex, j - ey) * 0.15;
      }
      if (sc < bs) { bs = sc; best = [i, j]; }
      if (!planned) break rings;          // drop sites / farms: the first fit next to the resource is the right one
    }
    if (!best) return false;
    const [i, j] = best;
    const vils = this.m.units.filter(u => u.type === 'villager').sort((a1, b1) => Math.hypot(a1.x - i, a1.y - j) - Math.hypot(b1.x - i, b1.y - j));
    const builders = restNow(W, this.P) ? [] : vils.filter(v => !v.order || v.order.t !== 'build').slice(0, type === 'house' || type === 'farm' ? 1 : type === 'castle' ? 5 : 2).map(v => v.id);
    command(W, { t: 'place', pid: this.pid, type, i, j, ids: builders });
    this.m.bld.push({ type, built: false, placedAt: W.t, x: i, y: j });
    return true;
  }
}
