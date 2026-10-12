// Computer player: AoE2-style build order -> boom -> age up -> army waves.  Uses only sim commands.
import { UNITS, BUILDINGS, TECHS, GAIA } from './data.js';
import { command, canAfford, placementOk, canBuild, techOk, nearestResource, nearestDrop, alive, distTo, idx, hasBuilt, pl, isAnimal } from './sim.js';

const DIFF = {
  easy:   { think: 2.0, vil: [18, 24, 28], wave: 12, firstAttack: 900, armyCap: 16, mil: 0.6 },
  normal: { think: 1.0, vil: [22, 30, 38], wave: 9, firstAttack: 660, armyCap: 30, mil: 0.85 },
  hard:   { think: 0.6, vil: [24, 34, 45], wave: 7, firstAttack: 480, armyCap: 45, mil: 1.0 },
};

export class AI {
  constructor(W, pid, diff = 'normal') { this.W = W; this.pid = pid; this.D = DIFF[diff] || DIFF.normal; this.next = 1 + pid * 0.37; this.wave = 0; this.lastAttack = 0; }
  tick() {
    const W = this.W; if (W.t < this.next) return; this.next = W.t + this.D.think;
    const P = W.players[this.pid]; if (!P.alive) return;
    const mine = { units: [], bld: [] };
    for (const e of W.dyn.values()) { if (e.owner !== this.pid) continue; if (e.kind === 'unit') mine.units.push(e); else if (e.kind === 'building') mine.bld.push(e); }
    this.m = mine; this.P = P;
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
    if (!count('mill') && vils.length >= 6 && P.res.wood >= 100) { const b = nearestResource(W, 'berry', this.base[0], this.base[1], 16); if (b) this.build('mill', [b.x, b.y], 2, 6); }
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
    if (!count('mining_camp') && vils.length >= 14 && P.res.wood >= 100) { const g = nearestResource(W, 'gold', this.base[0], this.base[1], 22); if (g) this.build('mining_camp', [g.x, g.y], 2, 5); }
    if (!count('barracks') && vils.length >= 12 && P.res.wood >= 175) this.build('barracks', this.base, 6, 12);
    if (P.age >= 2) {
      if (!count('archery_range') && P.res.wood >= 175) this.build('archery_range', this.base, 6, 13);
      if (!count('stable') && P.res.wood >= 200) this.build('stable', this.base, 6, 13);
    }
    if (P.age >= 3 && !count('castle') && P.res.stone >= 650 && vils.length > 25) this.build('castle', this.base, 7, 14);
    // farms when berries run out
    const berriesLeft = nearestResource(W, 'berry', this.base[0], this.base[1], 16);
    const farms = count('farm');
    const wantFood = Math.round(vils.length * 0.45);
    const farmers = vilsOn('farm'), idleFarm = this.freeFarm();
    if (count('mill', false) && (!berriesLeft || vilsOn('berry') >= 6) && !idleFarm && farms < Math.min(16, wantFood) && P.res.wood >= 60 + (this.needCamp ? 100 : 0) && mine.bld.filter(b => b.type === 'farm' && !b.built).length < (P.res.wood >= 180 ? 2 : 1)) this.build('farm', this.base, 4, 10);
    // ---- age up + techs
    if (tc && tc.built && !ageing) {
      for (const t of ['feudal', 'castle']) if (techOk(W, this.pid, t, tc) && canAfford(P, TECHS[t].cost) && vils.length >= target - 2) command(W, { t: 'research', pid: this.pid, bid: tc.id, tech: t });
      if (vils.length > 14 && !P.techs.has('loom') && techOk(W, this.pid, 'loom', tc) && P.res.gold >= 50 && tc.queue.length < 2) command(W, { t: 'research', pid: this.pid, bid: tc.id, tech: 'loom' });
    }
    if (P.age >= 2) for (const [tech, at] of [['double_bit_axe', 'lumber_camp'], ['horse_collar', 'mill'], ['gold_mining', 'mining_camp'], ['wheelbarrow', 'town_center']]) {
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
      if (res === 'food') { tgt = this.meat(vilsOn('carcass')) || nearestResource(W, 'berry', this.base[0], this.base[1], 16) || this.freeFarm(); }
      else if (res === 'wood') tgt = this.nearDropRes('tree', 'wood', v);
      else if (res === 'gold') tgt = this.nearDropRes('gold', 'gold', v);
      else tgt = this.nearDropRes('stone', 'stone', v);
      if (!tgt) tgt = this.nearDropRes('tree', 'wood', v);
      if (tgt) { command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: tgt.id, x: tgt.x, y: tgt.y }); now[res]++; }
    }
    // ---- rebalance: move a few gatherers off a resource that is piling up
    const pile = Object.keys(now).find(k => P.res[k] > 900 && now[k] > 3);
    if (pile && W.t > (this.rbT || 0)) { this.rbT = W.t + 4;
      const kinds = { food: ['berry', 'farm', 'carcass'], wood: ['tree'], gold: ['gold'], stone: ['stone'] }[pile];
      const movers = vils.filter(v => v.order && v.order.t === 'gather' && kinds.includes(v.order.kind)).slice(0, 2);
      const need = ['wood', 'food', 'gold'].filter(k => k !== pile).sort((a, b) => P.res[a] - P.res[b])[0];
      for (const v of movers) {
        const f = need === 'food' ? (this.freeFarm() || nearestResource(W, 'berry', this.base[0], this.base[1], 16)) : this.nearDropRes(need === 'wood' ? 'tree' : 'gold', need, v);
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
    // ---- defend / attack
    const threat = this.threat();
    const idleArmy = army.filter(u => !u.order || u.order.amove);
    if (threat) { const ids = army.filter(u => !u.order || u.order.t !== 'attack').map(u => u.id); if (ids.length) command(W, { t: 'move', pid: this.pid, ids, x: threat.x, y: threat.y, amove: true }); }
    else if (W.t > this.D.firstAttack && idleArmy.length >= this.D.wave + this.wave && W.t - this.lastAttack > 60) {
      const tgt = this.enemyTarget();
      if (tgt) { command(W, { t: 'move', pid: this.pid, ids: idleArmy.map(u => u.id), x: tgt[0], y: tgt[1], amove: true }); this.wave = Math.min(this.wave + 2, 10); this.lastAttack = W.t; }
    }
  }
  meat(hunters) {
    // carcasses first (shared by up to 5), then sheep, then deer close to home
    const W = this.W, [bx, by] = this.base; let best = null, bd = 1e9;
    for (const e of W.dyn.values()) {
      let sc = null;
      if (e.kind === 'res' && e.type === 'carcass' && e.amount > 10) sc = Math.hypot(e.x - bx, e.y - by);
      else if (e.kind === 'unit' && e.type === 'sheep' && (e.owner === this.pid || e.owner === GAIA)) sc = Math.hypot(e.x - bx, e.y - by) + 4;
      else if (e.kind === 'unit' && e.type === 'deer' && this.P.age === 1) sc = Math.hypot(e.x - bx, e.y - by) + 8;
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
    for (const e of W.dyn.values()) if (e.kind === 'treasure') { const d = Math.hypot(e.x - bx, e.y - by); if (d < nd && d < 45) { nd = d; near = e; } }
    if (!near) return;
    const free = !near.guarded;
    if (free) {
      const runner = army.filter(u => !busy(u)).sort((a, b) => (b.type === 'scout') - (a.type === 'scout'))[0];
      if (runner && !(runner.order && runner.order.t === 'move')) command(W, { t: 'move', pid: this.pid, ids: [runner.id], x: near.x + 0.5, y: near.y + 0.5 });
      return;
    }
    const idle = army.filter(u => !u.order);
    if (idle.length >= 5 && !this.threat()) command(W, { t: 'move', pid: this.pid, ids: idle.map(u => u.id), x: near.x + 0.5, y: near.y + 0.5, amove: true });
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
  enemyTarget() {
    const W = this.W; let best = null, bd = 1e9;
    for (const e of W.dyn.values()) {
      if (e.kind !== 'building' || e.owner === this.pid || e.owner === GAIA || W.players[e.owner].team === this.P.team || BUILDINGS[e.type].wall) continue;
      const d = Math.hypot(e.x - this.base[0], e.y - this.base[1]) - (e.type === 'town_center' ? 4 : 0);
      if (d < bd) { bd = d; best = [e.x + e.w / 2, e.y + e.h / 2]; }
    }
    if (!best) { const o = this.W.players.find(p => p.team !== this.P.team && p.alive); if (o && o.start) best = o.start; }
    return best;
  }
  nearDropRes(kind, res, v) {
    const W = this.W, d = nearestDrop(W, this.pid, res, v.x, v.y);
    const [x, y] = d ? [d.x + d.w / 2, d.y + d.h / 2] : this.base;
    return nearestResource(W, kind, x, y, 30);
  }
  farResourceFromDrop(kind, res) {
    const W = this.W; const t = nearestResource(W, kind, this.base[0], this.base[1], 30); if (!t) return null;
    const d = nearestDrop(W, this.pid, res, t.x, t.y);
    return d && distTo(d, t.x, t.y) < 5 ? (this.m.bld.filter(b => b.type === 'lumber_camp').length ? this.secondForest(kind) : null) : t;
  }
  secondForest(kind) {
    const W = this.W; let best = null, bd = 1e9;
    for (const e of W.ents.values()) {
      if (e.kind !== 'res' || e.type !== kind) continue;
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
    for (let r = rMin; r <= rMax; r++) for (let k = 0; k < 16; k++) {
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
