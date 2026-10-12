// Computer player: AoE2-style build order -> boom -> age up -> army waves.  Uses only sim commands.
// It plays under the fog of war like a human: it only knows enemy buildings, animals, treasures and resources it has
// actually seen (explored tiles / its own vision), so it must scout the map before it can find and attack anyone.
import { UNITS, BUILDINGS, TECHS, GAIA, CARDS, MARKET } from './data.js';
import { command, canAfford, placementOk, canBuild, techOk, nearestResource, nearestDrop, nearestFree, alive, distTo, idx, hasBuilt, pl, isAnimal, rng, cardOk, buyPrice, sellPrice } from './sim.js';

const CELL = 8;   // exploration grid (tiles per cell side)
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };

const DIFF = {
  easy:   { think: 2.0, vil: [18, 24, 28], wave: 12, firstAttack: 900, armyCap: 16, mil: 0.6 },
  normal: { think: 1.0, vil: [22, 30, 38], wave: 9, firstAttack: 660, armyCap: 30, mil: 0.85 },
  hard:   { think: 0.6, vil: [24, 34, 45], wave: 7, firstAttack: 480, armyCap: 45, mil: 1.0 },
};

export class AI {
  constructor(W, pid, diff = 'normal') {
    this.W = W; this.pid = pid; this.D = DIFF[diff] || DIFF.normal; this.next = 1 + pid * 0.37; this.wave = 0; this.lastAttack = 0;
    this.rnd = rng(((W.seed || 1) * 31 + pid * 977) >>> 0);     // own stream: AI choices never disturb the sim's rng
    this.known = new Map();      // enemy buildings seen: id -> { x, y, owner, type }
    this.seen = new Map();       // gaia units seen: id -> { t, x, y, danger } (last sighting)
    this.tries = new Map();      // enemy building id -> [attacks sent, retry after]
    this.foes = new Map();       // enemy units seen: id -> { t, x, y } (last sighting; used to hunt down survivors)
    this.tried = new Map();      // exploration cells already targeted: cell -> time
    this.scoutGoal = null; this.lastSweep = -99;
  }
  tick() {
    const W = this.W; if (W.t < this.next) return; this.next = W.t + this.D.think;
    const P = W.players[this.pid]; if (!P.alive) return;
    const mine = { units: [], bld: [] };
    for (const e of W.dyn.values()) { if (e.owner !== this.pid) continue; if (e.kind === 'unit') mine.units.push(e); else if (e.kind === 'building') mine.bld.push(e); }
    this.m = mine; this.P = P;
    this.remember();
    const vils = mine.units.filter(u => u.type === 'villager');
    const army = mine.units.filter(u => u.type !== 'villager' && !UNITS[u.type].animal);
    const tc = mine.bld.find(b => b.type === 'town_center' && b.built) || mine.bld.find(b => b.type === 'town_center');
    this.base = tc ? [tc.x + 2, tc.y + 2] : (P.start || [W.size / 2, W.size / 2]);
    const count = (t, any = true) => mine.bld.filter(b => b.type === t && (any || b.built)).length;
    const building = (t) => mine.bld.some(b => b.type === t && !b.built);

    // ---- villagers
    const target = this.D.vil[P.age - 1];
    const ageing = tc && tc.queue.some(q => q.tech && TECHS[q.tech].toAge);
    if (tc && tc.built && !ageing && vils.length < target && tc.queue.length < 2 && canAfford(P, UNITS.villager.cost)) command(W, { t: 'train', pid: this.pid, bid: tc.id, type: 'villager' });
    // ---- houses
    const pendingPop = mine.bld.filter(b => !b.built && BUILDINGS[b.type].pop).length * 5;
    if (P.popCap + pendingPop < 100 && P.pop + 4 > P.popCap + pendingPop && P.res.wood >= 25 && vils.length) this.build('house', this.base, 4, 9);
    // ---- drop sites and economy buildings
    const vilsOn = (k) => vils.filter(v => v.order && ((v.order.t === 'gather' && v.order.kind === k) || (v.order.t === 'drop' && v.order.then && v.order.then.kind === k) || (k === 'carcass' && v.order.t === 'attack' && v.order.hunt))).length;
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
    if (!count('barracks') && vils.length >= 12 && P.res.wood >= 175) this.build('barracks', this.base, 6, 12);
    if (P.age >= 2) {
      if (!count('archery_range') && P.res.wood >= 175) this.build('archery_range', this.base, 6, 13);
      if (!count('stable') && P.res.wood >= 200) this.build('stable', this.base, 6, 13);
    }
    if (P.age >= 3 && !count('castle') && P.res.stone >= 650 && vils.length > 25) this.build('castle', this.base, 7, 14);
    if (!tc && vils.length && canAfford(P, BUILDINGS.town_center.cost)) this.build('town_center', this.base, 0, 10);     // rebuild a lost Town Center
    if (P.age >= 2 && !count('market') && vils.length >= 24 && P.res.wood >= 260) this.build('market', this.base, 8, 15);
    // floating resources: more production so the army can actually be rebuilt
    if (P.age >= 2 && P.res.wood > 900 && P.res.food + P.res.gold > 1500) for (const t of P.age >= 3 ? ['stable', 'archery_range', 'barracks'] : ['archery_range', 'barracks', 'stable']) if (count(t) < 3 && !building(t)) { this.build(t, this.base, 7, 15); break; }
    // ---- give up when the kingdom can't come back (AoE2 AIs resign too)
    if (this.hopeless(tc, vils, army)) { if (!this.hopeT) this.hopeT = W.t; else if (W.t - this.hopeT > 20) { command(W, { t: 'resign', pid: this.pid }); return; } } else this.hopeT = 0;
    // ---- Home City shipment + market trades
    if (P.ships > 0 && !P.shipment) { const c = this.pickCard(); if (c) command(W, { t: 'card', pid: this.pid, card: c }); }
    if (W.t > (this.mkT || 0)) { this.mkT = W.t + 5; this.trade(); }
    // farms when berries run out
    const berriesLeft = this.res('berry', this.base[0], this.base[1], 16);
    const farms = count('farm');
    const wantFood = Math.round(vils.length * 0.45);
    const farmers = vilsOn('farm'), idleFarm = this.freeFarm();
    if (count('mill', false) && (!berriesLeft || vilsOn('berry') >= 6) && !idleFarm && farms < Math.min(16, wantFood) && P.res.wood >= 60 + (this.needCamp ? 100 : 0) && mine.bld.filter(b => b.type === 'farm' && !b.built).length < (P.res.wood >= 180 ? 2 : 1)) this.build('farm', this.base, 4, 10);
    // ---- age up + techs
    if (tc && tc.built && !ageing) {
      for (const t of ['feudal', 'castle']) if (techOk(W, this.pid, t, tc) && canAfford(P, TECHS[t].cost) && vils.length >= target - 2) command(W, { t: 'research', pid: this.pid, bid: tc.id, tech: t });
      if (vils.length > 14 && !P.techs.has('loom') && techOk(W, this.pid, 'loom', tc) && P.res.gold >= 50 && tc.queue.length < 2) command(W, { t: 'research', pid: this.pid, bid: tc.id, tech: 'loom' });
    }
    if (P.age >= 2) for (const [tech, at] of [['double_bit_axe', 'lumber_camp'], ['horse_collar', 'mill'], ['gold_mining', 'mining_camp'], ['wheelbarrow', 'town_center'], ['guilds', 'market'], ['trade_route', 'market']]) {
      const b = mine.bld.find(x => x.type === at && x.built && !x.queue.length);
      if (b && techOk(W, this.pid, tech, b) && canAfford(P, TECHS[tech].cost) && P.res.food > TECHS[tech].cost.food + 150) command(W, { t: 'research', pid: this.pid, bid: b.id, tech });
    }
    // ---- assign idle villagers
    const want = P.age === 1 ? { food: 0.6, wood: 0.4, gold: 0, stone: 0 } : P.age === 2 ? { food: 0.48, wood: 0.32, gold: 0.17, stone: 0.03 } : { food: 0.42, wood: 0.28, gold: 0.22, stone: 0.08 };
    if (P.age === 1 && this.planFeudal()) want.gold = 0.04;
    for (const k in want) if (want[k] > 0) want[k] *= Math.max(0.15, Math.min(1.6, 1.4 - P.res[k] / 900));
    const now = { food: vilsOn('berry') + vilsOn('farm') + vilsOn('carcass'), wood: vilsOn('tree'), gold: vilsOn('gold'), stone: vilsOn('stone') };
    const unfinished = mine.bld.filter(b => !b.built && b.id && !b.nb);
    for (const v of vils) {
      if (v.order) continue;
      if (unfinished.length) { const b = unfinished.shift(); command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: b.id, x: b.x, y: b.y }); continue; }
      const res = Object.keys(want).filter(k => want[k] > 0).sort((a, b) => (now[a] - vils.length * want[a]) - (now[b] - vils.length * want[b]))[0];
      let tgt = null;
      if (res === 'food') { tgt = this.meat(vilsOn('carcass')) || this.res('berry', this.base[0], this.base[1], 16) || this.freeFarm(); }
      else if (res === 'wood') tgt = this.nearDropRes('tree', 'wood', v);
      else if (res === 'gold') tgt = this.nearDropRes('gold', 'gold', v);
      else tgt = this.nearDropRes('stone', 'stone', v);
      if (!tgt) tgt = this.nearDropRes('tree', 'wood', v);
      if (tgt) { command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: tgt.id, x: tgt.x, y: tgt.y }); now[res]++; }
    }
    // ---- starving (e.g. wolves ate the sheep, everyone ended up on wood): put half the villagers on food
    if (P.res.food < 60 && now.food < Math.ceil(vils.length * 0.3) && W.t > (this.stT || 0)) {
      this.stT = W.t + 6;
      const movers = vils.filter(v => v.order && v.order.t === 'gather' && v.order.kind !== 'farm' && !['berry', 'carcass'].includes(v.order.kind)).slice(0, Math.ceil(vils.length * 0.5) - now.food);
      for (const v of movers) { const f = this.meat(vilsOn('carcass')) || this.res('berry', this.base[0], this.base[1], 16) || this.freeFarm(); if (!f) break; command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: f.id, x: f.x, y: f.y }); now.food++; }
      if (!movers.length || now.food < 1) { if (count('mill', false) && !mine.bld.some(b => b.type === 'farm' && !b.built)) this.build('farm', this.base, 4, 10); }
    }
    // ---- rebalance: move a few gatherers off a resource that is piling up
    const pile = Object.keys(now).find(k => P.res[k] > 900 && now[k] > 3);
    if (pile && W.t > (this.rbT || 0)) { this.rbT = W.t + 4;
      const kinds = { food: ['berry', 'farm', 'carcass'], wood: ['tree'], gold: ['gold'], stone: ['stone'] }[pile];
      const movers = vils.filter(v => v.order && v.order.t === 'gather' && kinds.includes(v.order.kind)).slice(0, 2);
      const need = ['wood', 'food', 'gold'].filter(k => k !== pile).sort((a, b) => P.res[a] - P.res[b])[0];
      for (const v of movers) {
        const f = need === 'food' ? (this.freeFarm() || this.res('berry', this.base[0], this.base[1], 16)) : this.nearDropRes(need === 'wood' ? 'tree' : 'gold', need, v);
        if (f) command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: f.id, x: f.x, y: f.y });
      }
    }
    // ---- military
    const mil = { 1: [['barracks', 'militia']], 2: [['archery_range', 'archer'], ['barracks', 'spearman'], ['stable', 'scout']], 3: [['stable', 'knight'], ['archery_range', 'archer'], ['barracks', 'spearman']] }[P.age];
    if (army.length < this.D.armyCap && (P.age >= 2 || this.threat()) && vils.length >= this.D.vil[0] * 0.7)
      for (const [bt, ut] of mil) {
        const b = mine.bld.find(x => x.type === bt && x.built && x.queue.length < 2);
        const reserve = ageing ? 0 : (P.age < 3 && vils.length >= target - 3 ? { food: 500, gold: 0 } : null);
        if (b && canAfford(P, UNITS[ut].cost) && (!reserve || P.res.food - (UNITS[ut].cost.food || 0) > reserve.food * (1 - this.D.mil))) command(W, { t: 'train', pid: this.pid, bid: b.id, type: ut });
      }
    // ---- treasures: the scout grabs free ones, an idle army clears guarded ones nearby (AoE3)
    if (W.t > (this.thT || 0)) { this.thT = W.t + 3; this.treasureHunt(army); }
    // ---- scouting: one fast unit explores (home ring first, then out towards where enemies may live)
    this.scoutTick(army);
    // ---- defend / attack (only targets it has discovered)
    const threat = this.threat();
    const idleArmy = army.filter(u => (!u.order || u.order.amove) && u.id !== this.explorer);
    if (threat) { const ids = army.filter(u => (!u.order || u.order.t !== 'attack') && u.id !== this.explorer).map(u => u.id); if (ids.length) command(W, { t: 'move', pid: this.pid, ids, x: threat.x, y: threat.y, amove: true }); }
    else {
      if (this.known.size) this.everKnown = true;
      const core = [...this.known.values()].filter(k => !['farm', 'house'].includes(k.type)).length;
      const tgt = this.enemyTarget(), weak = this.everKnown && core <= 3;     // enemy nearly wiped out: finish it with what we have
      const need = weak ? Math.min(5, this.D.wave + this.wave) : this.D.wave + this.wave;
      if (tgt && W.t > this.D.firstAttack && idleArmy.length >= need && W.t - this.lastAttack > (weak ? 25 : 60)) {
        command(W, { t: 'move', pid: this.pid, ids: idleArmy.map(u => u.id), x: tgt[0], y: tgt[1], amove: true }); if (!weak) this.wave = Math.min(this.wave + 2, 10); this.lastAttack = W.t;
        if (tgt[2]) { const tr = this.tries.get(tgt[2]) || [0, 0]; tr[0] = tr[0] >= 3 ? 1 : tr[0] + 1; tr[1] = W.t + 240; this.tries.set(tgt[2], tr); }
      } else if (!this.known.size && idleArmy.length >= 3 && W.t - this.lastSweep > 25) {     // nobody (left) found: soldiers search together
        const ax = idleArmy.reduce((a, u) => a + u.x, 0) / idleArmy.length, ay = idleArmy.reduce((a, u) => a + u.y, 0) / idleArmy.length;
        const g = this.exploreTarget(ax, ay, true) || this.staleTarget(ax, ay);
        if (g) { command(W, { t: 'move', pid: this.pid, ids: idleArmy.map(u => u.id), x: g[0], y: g[1], amove: true }); this.lastSweep = W.t; }
      }
    }
  }
  // ---- what this player knows (fog of war)
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
      else if (e.kind === 'unit' && e.owner !== GAIA && e.owner !== this.pid && !isAnimal(e) && W.players[e.owner].team !== this.P.team && vis[at(e.x, e.y)]) this.foes.set(e.id, { t: W.t, x: e.x, y: e.y });
    }
    for (const [id, f] of this.foes) if (W.t - f.t > 150 || (W.t > f.t && vis[at(f.x, f.y)] && !W.ents.has(id))) this.foes.delete(id);
    // forget what turned out to be gone (seen destroyed, or its owner is out of the game)
    for (const [id, k] of this.known) if ((vis[at(k.x, k.y)] && !alive(W, id)) || !W.players[k.owner].alive) this.known.delete(id);
    if (this.seen.size > 300) for (const [id, o] of this.seen) if (o.long ? W.t - o.t > 400 : W.t - o.t > 120 || !W.ents.has(id)) this.seen.delete(id);
  }
  // unexplored area worth a look. home = early ring around the base; far = out towards the enemy side of the map
  exploreTarget(fx, fy, far) {
    const W = this.W, S = W.size, exp = this.P.exp, n = Math.ceil(S / CELL), [bx, by] = this.base, C = S / 2;
    const homeR = Math.hypot(bx - C, by - C), dangers = [...this.known.values()].filter(k => k.type === 'town_center' || BUILDINGS[k.type].attack);
    const beasts = [...this.seen.values()].filter(o => o.danger && W.t - o.t < (o.long ? 400 : 120));
    for (const e of W.dyn.values()) if (e.kind === 'treasure' && exp[idx(W, e.x, e.y)] && e.guards.some(id => alive(W, id))) beasts.push({ x: e.x + 0.5, y: e.y + 0.5 });   // guards stay by their chest
    let best = null, bs = 1e9;
    for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++) {
      const cell = cj * n + ci; if (W.t - (this.tried.get(cell) ?? -1e9) < (far ? 90 : 45)) continue;
      const x = Math.min(S - 1, ci * CELL + CELL / 2), y = Math.min(S - 1, cj * CELL + CELL / 2);
      let un = 0, all = 0;
      for (let j = cj * CELL + 1; j < Math.min(S, cj * CELL + CELL); j += 2) for (let i = ci * CELL + 1; i < Math.min(S, ci * CELL + CELL); i += 2) { all++; if (!exp[j * S + i]) un++; }
      if (!all || un / all < 0.45) continue;
      const db = Math.hypot(x - bx, y - by), df = Math.hypot(x - fx, y - fy);
      let sc;
      if (!far) { if (db > 28) continue; sc = df * 0.8 + Math.abs(db - 16) * 1.5; }
      else sc = df * 0.5 + Math.abs(Math.hypot(x - C, y - C) - homeR) * 0.7 - db * 0.35;
      if (dangers.some(k => Math.hypot(k.x - x, k.y - y) < 11)) sc += 60;      // keep the scout out of arrow range
      if (beasts.some(o => Math.hypot(o.x - x, o.y - y) < 7)) sc += 30;        // ... and away from wolves, bears and bandits,
      else if (beasts.some(o => segDist(o.x, o.y, fx, fy, x, y) < 6)) sc += 40;  // also on the way there
      sc += this.rnd() * 8 - (un / all) * 6;
      if (sc < bs) { bs = sc; best = [x, y, cell]; }
    }
    if (!best) return null;
    this.tried.set(best[2], W.t);
    const f = nearestFree(W, best[0], best[1], this.pid, 4);
    return f ? [f[0] + 0.5, f[1] + 0.5] : null;
  }
  scoutTick(army) {
    const W = this.W;
    let u = alive(W, this.explorer);
    if (!u || u.owner !== this.pid) {
      // the scout died out there: remember the spot as dangerous for a good while
      if (this.explorer && this.scoutPos) this.seen.set('lost' + Math.round(W.t), { t: W.t, x: this.scoutPos[0], y: this.scoutPos[1], danger: true, long: true });
      // only the fast scout cavalry explores alone (slow soldiers get run down by wolves); they search in groups instead
      u = army.find(a => a.type === 'scout' && a.hp >= a.maxHp * 0.5 && (!a.order || a.order.t === 'move')) || null;
      this.explorer = u ? u.id : 0; this.scoutGoal = null; this.scoutPos = null;
      if (!u) { this.replaceScout(); return; }
    }
    this.scoutPos = [u.x, u.y];
    if (this.evade(u)) return;
    // taking hits while already wounded (wolves, a guard, enemy soldiers): break off and ride home
    const hurt = u.hp < (this.scoutHp ?? u.hp) - 0.1 && u.hp < u.maxHp * 0.75; this.scoutHp = u.hp;
    if (hurt && !(this.scoutGoal && this.scoutGoal[3])) { this.scoutGoal = [this.base[0], this.base[1] + 3, W.t + 30, true]; command(W, { t: 'move', pid: this.pid, ids: [u.id], x: this.base[0], y: this.base[1] + 3 }); return; }
    if (u.order && u.order.t === 'attack') return;
    if (u.hp < u.maxHp * 0.4) {             // too wounded to scout on: send it home to guard and get a fresh scout
      command(W, { t: 'move', pid: this.pid, ids: [u.id], x: this.base[0] + 2, y: this.base[1] + 4 }); this.explorer = 0; this.scoutPos = null; this.scoutGoal = null; return;
    }
    const g = this.scoutGoal, arrived = g && Math.hypot(u.x - g[0], u.y - g[1]) < 2.5;
    if (u.order && g && !arrived && W.t < g[2]) return;
    if (u.order && !g) return;                                             // running to a treasure (treasureHunt)
    const far = W.t > 200 || this.homeExplored();
    let t = this.exploreTarget(u.x, u.y, far) || (!far ? this.exploreTarget(u.x, u.y, true) : null);
    if (!t) {          // whole map seen: patrol past known enemy buildings to keep the picture fresh
      const ks = [...this.known.values()]; const k = ks.length ? ks[(this.rnd() * ks.length) | 0] : null;
      t = k ? [k.x + (this.rnd() - 0.5) * 24, k.y + (this.rnd() - 0.5) * 24] : [this.rnd() * W.size, this.rnd() * W.size];
      const f = nearestFree(W, t[0], t[1], this.pid, 5); if (!f) return; t = [f[0] + 0.5, f[1] + 0.5];
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
    if (b && canAfford(P, UNITS[type].cost)) { command(W, { t: 'train', pid: this.pid, bid: b.id, type }); this.rsT = W.t + (type === 'scout' ? 90 : 10); }
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
      if (sc === null || sc > 18) continue;
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
  threat() {
    const W = this.W;
    for (const e of W.dyn.values()) {
      if (e.kind !== 'unit' || e.owner === this.pid || pl(W, e.owner).team === this.P.team) continue;
      if (isAnimal(e) && UNITS[e.type].animal !== 'predator') continue;
      if (Math.hypot(e.x - this.base[0], e.y - this.base[1]) < 16 && this.P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) return e;
    }
    return null;
  }
  // nearest discovered enemy building that matters (no peeking through the fog), else the latest enemy sighting.
  // Farms are skipped (soldiers don't auto-target them and they don't keep a player alive); Town Centers and production
  // first; a target attacked 3 times without falling is left alone for a while.
  enemyTarget() {
    const W = this.W; let best = null, bd = 1e9;
    for (const [id, k] of this.known) {
      if (k.type === 'farm' || (this.tries.get(id) || [0])[0] >= 3 && W.t < this.tries.get(id)[1]) continue;
      const d = Math.hypot(k.x - this.base[0], k.y - this.base[1]) - (k.type === 'town_center' ? 12 : BUILDINGS[k.type].trains || BUILDINGS[k.type].attack ? 6 : k.type === 'house' ? -4 : 0);
      if (d < bd) { bd = d; best = [k.x, k.y, id]; }
    }
    if (!best) { let t = -1; for (const f of this.foes.values()) if (f.t > t && Math.hypot(f.x - this.base[0], f.y - this.base[1]) > 12) { t = f.t; best = [f.x, f.y]; } }
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
  // Home City card: villagers and economy bonuses first, soldiers when threatened, otherwise the crate we need most
  pickCard() {
    const P = this.P, ok = (id) => cardOk(P, id), threat = this.threat();
    const army = this.m.units.filter(u => u.type !== 'villager' && !UNITS[u.type].animal).length;
    const order = threat || (army < 6 && this.W.t > this.D.firstAttack) ? ['knight3', 'archer4', 'spear5', 'armor'] : [];
    order.push('vil5', 'vil3', 'axe', 'baskets', 'miners', 'plough', 'sheep6', 'boots', 'armor');
    if (this.m.bld.some(b => b.type === 'market' && b.built)) order.push('merchants');
    const pick = order.find(ok); if (pick) return pick;
    const crates = Object.values(CARDS).filter(c => c.give && ok(c.id));
    const need = (c) => Object.entries(c.give).reduce((s, [r, n]) => s + n / (200 + P.res[r]), 0);
    return crates.sort((a, b) => need(b) - need(a))[0]?.id || Object.keys(CARDS).find(ok) || null;
  }
  // market: sell what piles up, buy what's short when rich in gold (one or two lots at a time, prices move each trade)
  trade() {
    const W = this.W, P = this.P, mk = this.m.bld.find(b => b.type === 'market' && b.built); if (!mk) return;
    const goods = Object.keys(MARKET.base);
    for (const r of goods) if (P.res[r] > (r === 'stone' ? 700 : 1100) && sellPrice(W, P, r) >= 40) command(W, { t: 'trade', pid: this.pid, bid: mk.id, res: r, buy: false });
    const short = goods.filter(r => r !== 'stone').sort((a, b) => P.res[a] - P.res[b])[0];
    if (P.res[short] < 150 && P.res.gold > buyPrice(W, P, short) + 250 && buyPrice(W, P, short) < 260) command(W, { t: 'trade', pid: this.pid, bid: mk.id, res: short, buy: true });
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
  build(type, near, rMin, rMax) {
    const W = this.W, P = this.P; if (!canBuild(W, this.pid, type) || !canAfford(P, BUILDINGS[type].cost)) return false;
    const d = BUILDINGS[type], n = d.n;
    // already placing one?
    if (this.m.bld.some(b => b.type === type && !b.built)) return false;
    const [cx, cy] = near;
    // crowded base: houses, farms and military buildings may go further out (drop sites stay by their resource)
    const far = ['house', 'farm', 'barracks', 'archery_range', 'stable', 'market', 'castle', 'watch_tower', 'town_center'].includes(type) ? 9 : 0;
    for (let r = rMin; r <= rMax + far; r++) for (let k = 0; k < (r > rMax ? 24 : 16); k++) {
      const a = (k / 16) * Math.PI * 2 + (this.pid + r) * 0.7;
      const i = Math.round(cx + Math.cos(a) * r - n / 2), j = Math.round(cy + Math.sin(a) * r - n / 2);
      if (!placementOk(W, this.pid, type, i, j)) continue;
      // keep a 1-tile gap around blocking buildings so villagers never get walled in
      let ok = true;
      if (d.block) for (let a2 = -1; a2 <= n && ok; a2++) for (let c = -1; c <= n && ok; c++) { const ii = i + a2, jj = j + c; if (ii < 0 || jj < 0 || ii >= W.size || jj >= W.size) continue; const o = W.occ[idx(W, ii, jj)]; if (o && W.ents.get(o)?.kind === 'building') ok = false; }
      if (!ok) continue;
      const vils = this.m.units.filter(u => u.type === 'villager').sort((a1, b1) => Math.hypot(a1.x - i, a1.y - j) - Math.hypot(b1.x - i, b1.y - j));
      const builders = vils.filter(v => !v.order || v.order.t !== 'build').slice(0, type === 'house' || type === 'farm' ? 1 : type === 'castle' ? 5 : 2).map(v => v.id);
      command(W, { t: 'place', pid: this.pid, type, i, j, ids: builders });
      this.m.bld.push({ type, built: false, placedAt: W.t });
      return true;
    }
    return false;
  }
}
