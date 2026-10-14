// Computer player: AoE2-style build order -> boom -> age up -> army waves.  Uses only sim commands.
// It plays under the fog of war like a human: it only knows enemy buildings, animals, treasures and resources it has
// actually seen (explored tiles / its own vision), so it must scout the map before it can find and attack anyone.
// Its personality comes from its card deck (economy, rush, fortress, scholar, navy); its army, doctrines and specialists
// are picked to counter what its scouts and spies have actually seen of the enemy.
import { UNITS, BUILDINGS, TECHS, GAIA, CARDS, MARKET, MILITARY, DECKS } from './data.js?v=20261014142033';
import { DAY, RELICS } from './data.js?v=20261014142033';
import { timeOfDay, unreachable, restNow, targetable } from './sim.js?v=20261014142033';
import { command, canAfford, placementOk, canBuild, canTrain, techOk, nearestResource, nearestDrop, nearestFree, alive, distTo, idx, hasBuilt, pl, isAnimal, rng, cardOk, buyPrice, sellPrice, stat, trainType, techCost, costOf, spyReport, regionAt, passable, center, unitCost, isEnemy, townRing } from './sim.js?v=20261014142033';

const CELL = 8;   // exploration grid (tiles per cell side)
const TOWNS = ['Sukamaju', 'Karangsari', 'Tanjungpura', 'Wanasari', 'Giriwangi', 'Sumberjaya', 'Mekarsari', 'Banyuasri', 'Purwasari', 'Rejosari', 'Kalisari', 'Gunungsari', 'Tirtamaya', 'Candirejo', 'Batursari', 'Lembahhijau'];     // town names in the war chronicle
const segDist = (px, py, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0; return Math.hypot(px - ax - t * dx, py - ay - t * dy); };

const DIFF = {
  easy:   { think: 2.0, vil: [18, 24, 28, 32], wave: 12, firstAttack: 900, armyCap: 16, mil: 0.6, fill: 0.5 },
  normal: { think: 1.0, vil: [20, 28, 36, 42], wave: 9, firstAttack: 660, armyCap: 32, mil: 0.85, fill: 0.8 },
  hard:   { think: 0.6, vil: [22, 32, 44, 52], wave: 7, firstAttack: 480, armyCap: 50, mil: 1.0, fill: 1.0 },
};
// personality: tweaks on top of the difficulty
const STYLE = {
  eko:     { vil: 4, attack: 1.2, wave: 1, towers: 1, mix: { inf: 1, arch: 1, cav: 1.2 }, doc1: 'doc_cavalry', doc2: 'doc_formation', iron: 0.08, ages: ['feudal', 'castle_trade', 'imperial'] },
  serbu:   { vil: -2, attack: 0.72, wave: -2, towers: 0, mix: { inf: 1.2, arch: 0.8, cav: 1.3 }, doc1: 'doc_cavalry', doc2: 'doc_blitz', iron: 0.06, early: true, ages: ['feudal_war', 'castle_war', 'imperial_war'], horseArchers: true },
  benteng: { vil: 0, attack: 1.2, wave: 1, towers: 3, walls: true, mix: { inf: 1.2, arch: 1.4, cav: 0.6 }, doc1: 'doc_legion', doc2: 'doc_fortress', iron: 0.08, ages: ['feudal_wall', 'castle_war', 'imperial_war'], healers: true },
  ilmu:    { vil: 2, attack: 1.1, wave: 0, towers: 1, mix: { inf: 0.9, arch: 1.5, cav: 0.8 }, doc1: 'doc_archers', doc2: 'doc_formation', iron: 0.14, scholar: true, ages: ['feudal', 'castle', 'imperial_lore'], healers: true },
  laut:    { vil: 2, attack: 1.05, wave: 0, towers: 1, mix: { inf: 1, arch: 1.4, cav: 0.8 }, doc1: 'doc_archers', doc2: 'doc_blitz', iron: 0.06, navy: true, ages: ['feudal', 'castle_trade', 'imperial'] },
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
    // age paths: the personality's choice, sometimes an improvised one (games play out differently)
    const alt = { 2: ['feudal', 'feudal_war', 'feudal_wall'], 3: ['castle', 'castle_war', 'castle_trade'], 4: ['imperial', 'imperial_war', 'imperial_lore'] };
    this.agePath = { 2: this.rnd() < 0.25 ? alt[2][(this.rnd() * 3) | 0] : this.S.ages[0], 3: this.rnd() < 0.25 ? alt[3][(this.rnd() * 3) | 0] : this.S.ages[1], 4: this.rnd() < 0.25 ? alt[4][(this.rnd() * 3) | 0] : this.S.ages[2] };
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
    const army = mine.units.filter(u => MILITARY(u.type) && !u.nav && !UNITS[u.type].hero && !UNITS[u.type].trade);         // land army (not the king)
    const fleet = mine.units.filter(u => u.nav && MILITARY(u.type) && !UNITS[u.type].trade && u.type !== 'transport');
    const tc = mine.bld.find(b => b.type === 'town_center' && b.built) || mine.bld.find(b => b.type === 'town_center');
    this.base = tc ? [tc.x + 2, tc.y + 2] : (P.start || [W.size / 2, W.size / 2]);
    this.tc = tc;
    const count = (t, any = true) => mine.bld.filter(b => b.type === t && (any || b.built)).length;
    const building = (t) => mine.bld.some(b => b.type === t && !b.built);
    this.count = count;
    const firstAttack = this.D.firstAttack * S.attack;

    // ---- villagers
    const tcs = mine.bld.filter(b => b.type === 'town_center' && b.built);
    // an empire fills its land: once it has a second town, the villager and army targets grow with the kingdom's
    // population limit (which every town raises) right up to it (an easy AI fills half of the extra room)
    const extra = Math.max(0, tcs.length - 1), baseVil = Math.max(12, this.D.vil[Math.min(P.age, this.D.vil.length) - 1] + S.vil);     // (Imperial has its own entry: a missing one made every target NaN)
    const foePop = Math.max(1, ...W.players.filter(q => q.alive && q.team !== P.team).map(q => q.pop));
    this.ahead = P.pop / foePop >= 2 && P.pop >= 40;          // far stronger: the watches thin out and the army goes to finish it
    const grow = extra ? Math.max(0, (P.popLim || 0) - baseVil - this.D.armyCap - 8) * this.D.fill : 0;
    const target = baseVil + Math.max(extra * 12, Math.round(grow * 0.55));
    this.armyCap = this.D.armyCap + Math.round(grow * 0.45);
    this.tcs = tcs;
    const ageing = tc && tc.queue.some(q => q.tech && TECHS[q.tech].toAge);
    // dawn brings the food upkeep: keep enough in the granary as night approaches
    this.foodKeep = W.opts.night !== 'off' && (timeOfDay(W) > 0.4 || timeOfDay(W) < 0.03) ? Math.ceil(P.pop * DAY.upkeep * (P.techs.has('granary') ? 0.6 : 1) * Math.max(0, 1 + P.mods.upkeep) * 1.15) + 30 : 0;     // tomorrow's bread is not spent
    if (tc && tc.built && !ageing && vils.length < target && tc.queue.length < 2 && canAfford(P, UNITS.villager.cost) && P.res.food - 50 >= this.foodKeep) command(W, { t: 'train', pid: this.pid, bid: tc.id, type: 'villager' });
    // ---- houses
    const pendingPop = mine.bld.filter(b => !b.built && BUILDINGS[b.type].pop).length * 5;
    if (P.popCap + pendingPop < P.popLim && P.pop + 4 > P.popCap + pendingPop && P.res.wood >= 25 && vils.length) {
      const ht = this.houseTown(tcs, mine);            // the town with the fewest houses gets the next one
      if (ht && ht !== tc) this.withTown(ht, () => this.build('house', this.base, 4, 10)); else this.build('house', this.base, 4, 10);
    }
    // ---- drop sites and economy buildings
    const gk = (o) => o.kind === 'shaft' ? (W.ents.get(o.id) || {}).ore : o.kind;          // a miner underground counts for the ore its mine digs
    const vilsOn = (k) => vils.filter(v => v.order && ((v.order.t === 'gather' && gk(v.order) === k) || (v.order.t === 'drop' && v.order.then && gk(v.order.then) === k) || (k === 'carcass' && v.order.t === 'attack' && v.order.hunt))).length;
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
    if (P.age >= 3 && !count('siege_workshop') && count('blacksmith', false) && vils.length >= 26 && P.res.wood >= 260) this.build('siege_workshop', this.base, 7, 14);
    if (P.age >= 4 && !count('wonder') && (S.scholar || this.style === 'eko' || P.res.gold > 3000) && P.res.wood >= 1000 && P.res.stone >= 1000 && P.res.gold >= 1000 && vils.length >= 35) this.build('wonder', this.base, 8, 18);
    this.economy2(P, mine);
    this.lifeCare(P, mine, vils);
    this.expand(P, mine, vils, tcs, ageing, target);
    this.towns(P, mine, vils, tcs);
    this.mines(P, mine, vils, tcs);
    this.diplomacy(P);
    if (!tc && vils.length && canAfford(P, BUILDINGS.town_center.cost)) this.build('town_center', this.base, 0, 10);     // rebuild a lost Town Center
    if (P.age >= 2 && !count('market') && vils.length >= 24 && P.res.wood >= 260) this.build('market', this.base, 8, 15);
    if (P.age >= 2 && !count('monastery') && count('barracks', false) && vils.length >= 22 && P.res.wood >= 200 && (this.relicsSeen() || S.healers || P.age >= 3)) this.build('monastery', this.base, 7, 14);
    // floating resources: more production so the army can actually be rebuilt
    if (P.age >= 2 && P.res.wood > 900 && P.res.food + P.res.gold > 1500) for (const t of P.age >= 3 ? ['stable', 'archery_range', 'barracks'] : ['archery_range', 'barracks', 'stable']) if (count(t) < 3 && !building(t)) { this.build(t, this.base, 7, 15); break; }
    this.water(vils, fleet);
    this.townBell(army);
    this.monks();
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
    // ---- age up + techs. After a few minutes in an age the AI saves for the next one: armies, research and
    // monks may only spend what is above the age-up cost (unless the town is under attack right now)
    if (P.age !== this.ageSeen) { this.ageSeen = P.age; this.ageSince = W.t; }
    const nextAge = this.agePath[P.age + 1];
    this.reserve = nextAge && !ageing && tc && tc.built && W.t - this.ageSince > (P.age === 1 ? 1e9 : P.age === 2 ? 300 : 420) && vils.length >= target - 4 && techOk(W, this.pid, nextAge, tc) && !(this.attacked >= 2 && W.t - this.lastHit < 45) ? TECHS[nextAge].cost : null;
    if (tc && tc.built && !ageing) {
      const ageT = this.agePath[P.age + 1];
      if (ageT) for (const t of [ageT]) if (techOk(W, this.pid, t, tc) && canAfford(P, TECHS[t].cost) && P.res.food - (TECHS[t].cost.food || 0) >= this.foodKeep && (vils.length >= target - 2 || P.res.food > 3000 && P.res.gold > 1500)) command(W, { t: 'research', pid: this.pid, bid: tc.id, tech: t });
      if (vils.length > 14 && !P.techs.has('loom') && techOk(W, this.pid, 'loom', tc) && P.res.gold >= 50 && tc.queue.length < 2) command(W, { t: 'research', pid: this.pid, bid: tc.id, tech: 'loom' });
    }
    this.research();
    // ---- assign idle villagers
    const want = P.age === 1 ? { food: 0.56, wood: 0.44, gold: 0, stone: 0, iron: 0 } : P.age === 2 ? { food: 0.42, wood: 0.33, gold: 0.2, stone: 0.04, iron: S.iron * 0.6 } : { food: 0.4, wood: 0.29, gold: 0.2, stone: 0.06, iron: S.iron };      // towns need timber: wells, taverns, barns
    if (P.age === 1 && this.planFeudal()) want.gold = 0.04;
    if (S.walls || S.towers > 2) want.stone += 0.04;
    if (this.lifeNeed && this.lifeNeed.wood && P.res.wood < this.lifeNeed.wood) want.wood *= 1.35;      // timber for the tavern / hospital
    if (P.age >= 2 && P.res.stone < 120 && canBuild(W, this.pid, 'town_center') && vils.length >= 20) want.stone = Math.max(want.stone, 0.1);      // stone for a new town
    if (this.expandNeed && P.res.wood < 300) want.wood *= 1.25;
    if (P.age >= 3 && !count('castle') && vils.length >= 25 && P.res.stone < 650) want.stone = Math.max(want.stone, 0.12);      // a castle: unique units, trebuchets
    if (P.age >= 3 && count('academy', false) && !Object.keys(TECHS).some(t => TECHS[t].spec && t.startsWith('spec_') && P.techs.has(t)) && P.res.iron < 150) want.iron = Math.max(want.iron, 0.08);   // iron for a specialist line
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
      if (res === 'food') { const [hx, hy] = this.homeOf(v); tgt = this.meat(vilsOn('carcass')) || this.res('berry', hx, hy, 16) || (vilsOn('fish') < 8 && this.shoreFish(v)) || this.freeFarm(v) || this.shoreFish(v); }
      else if (res === 'wood') tgt = this.nearDropRes('tree', 'wood', v);
      else tgt = this.nearDropRes(res, res, v) || this.shaftFor(res, v);
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
      const needs = ['wood', 'food', 'gold', 'iron', 'stone'].filter(k => k !== pile && (k !== 'iron' || P.age >= 2) && (k !== 'stone' || (P.age >= 2 && P.res.stone < 400))).sort((a, b) => P.res[a] - P.res[b]);     // stone too: new towns, towers, a castle
      const find = (need, v) => need === 'food' ? (this.freeFarm(v) || this.res('berry', ...this.homeOf(v), 16)) : this.nearDropRes(need === 'wood' ? 'tree' : need, need, v) || this.shaftFor(need, v);
      for (const v of movers) {
        let f = null; for (const need of needs) if ((f = find(need, v))) break;          // the scarcest resource we can actually reach (no gold left: food, ...)
        if (f) command(W, { t: 'smart', pid: this.pid, ids: [v.id], target: f.id, x: f.x, y: f.y });
      }
    }
    this.repair(vils);
    // ---- military
    if (army.length < this.armyCap && (P.age >= 2 || this.threat() || (S.early && vils.length >= 14)) && vils.length >= this.D.vil[0] * 0.7) this.trainArmy(army, ageing, target, vils);
    // ---- treasures: the scout grabs free ones, an idle army clears guarded ones nearby (AoE3)
    if (W.t > (this.thT || 0)) { this.thT = W.t + 3; this.treasureHunt(army.filter(u => !this.inWar(u.id))); }
    // ---- scouting: one fast unit explores (home ring first, then out towards where enemies may live)
    this.scoutTick(army, fleet);
    // ---- defend / attack (only targets it has discovered)
    if (this.inv && this.invasion(army)) return;
    const threat = this.threat();
    const guard = this.homeGuard(army, threat);                   // the town watch stays home; the rest is the field army
    const field = army.filter(u => !guard.has(u.id) && !this.onWatch(u.id));        // (the new towns' watches stay too)
    const idleArmy = field.filter(u => (!u.order || u.order.amove) && u.id !== this.explorer);
    if (threat) this.defend(army, guard, threat);
    const war = this.commander(field, threat, firstAttack);       // the war commander leads the field army in a campaign
    if (threat || war) { /* defending, or the campaign has the army */ }
    else {
      if (this.known.size) this.everKnown = true;
      const core = [...this.known.values()].filter(k => !['farm', 'house'].includes(k.type)).length;
      const tgt = this.enemyTarget(), weak = this.everKnown && core <= 3;     // enemy nearly wiped out: finish it with what we have
      const foePop = Math.max(1, ...W.players.filter(q => q.alive && q.team !== P.team).map(q => q.pop)), ahead = P.pop / foePop >= 2 && army.length >= 10;   // far stronger: finish it
      const need = Math.max(4, weak ? Math.min(5, this.D.wave + this.wave) : ahead ? 6 : this.D.wave + this.wave + S.wave);
      const peace = W.opts.treaty && W.t < W.opts.treaty;
      if (!peace && this.koth(idleArmy)) { /* army sent to the monument */ }
      else if (tgt && !peace && W.t > firstAttack && idleArmy.length >= need && W.t - this.lastAttack > (weak || ahead ? 25 : this.beachT && W.t - this.beachT < 300 ? 40 : 60)) {
        if (this.overSea(tgt)) { this.startInvasion(idleArmy, tgt); }
        else {
          const ids = idleArmy.map(u => u.id), form = this.formationFor(idleArmy);
          command(W, { t: 'form', pid: this.pid, ids, f: form });
          command(W, { t: 'move', pid: this.pid, ids, x: tgt[0], y: tgt[1], amove: true, form });
          const treb = idleArmy.filter(u => UNITS[u.type].packs).map(u => u.id);          // trebuchets bombard the target building
          if (treb.length && tgt[2]) command(W, { t: 'smart', pid: this.pid, ids: treb, target: tgt[2] });
          if (!weak) this.wave = Math.min(this.wave + 2, 10); this.lastAttack = W.t;
          if (tgt[2]) { const tr = this.tries.get(tgt[2]) || [0, 0]; tr[0] = tr[0] >= 3 ? 1 : tr[0] + 1; tr[1] = W.t + 240; this.tries.set(tgt[2], tr); }
        }
      } else if (!this.known.size && this.homeDone && idleArmy.length >= 8 && W.t > 900 && !this.inv && W.t - this.lastAttack > 120 && this.m.units.some(u => u.type === 'transport_ship' && !u.order)) {
        const land = this.otherLand(); if (land) this.startInvasion(idleArmy, land);           // islands: sail an army over to find the enemy
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
  // can we pay for this and still keep the age-up savings?
  afford(c) {
    const R = this.reserve, Q = this.lifeNeed, X = this.expandNeed; if (!R && !Q && !X) return canAfford(this.P, c);
    for (const k in c) if (this.P.res[k] < c[k] + (R && R[k] || 0) + (Q && Q[k] || 0) + (X && X[k] || 0)) return false;
    return true;
  }
  res(kind, x, y, r) { return nearestResource(this.W, kind, x, y, r, this.pid, null, this.P.exp); }
  remember() {
    const W = this.W, vis = this.P.vis, at = (x, y) => idx(W, Math.min(W.size - 1, Math.max(0, Math.floor(x))), Math.min(W.size - 1, Math.max(0, Math.floor(y))));
    for (const e of W.dyn.values()) {
      if (e.kind === 'building') {
        if (e.owner === this.pid || W.players[e.owner].team === this.P.team || BUILDINGS[e.type].wall) continue;
        const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
        if (vis[at(cx, cy)]) this.known.set(e.id, { x: cx, y: cy, owner: e.owner, type: e.type });
      } else if (e.kind === 'unit' && e.owner === GAIA && vis[at(e.x, e.y)]) this.seen.set(e.id, { t: W.t, x: e.x, y: e.y, danger: !isAnimal(e) || ['predator', 'guard'].includes(UNITS[e.type].animal) });
      else if (e.kind === 'unit' && e.owner !== GAIA && e.owner !== this.pid && !isAnimal(e) && W.players[e.owner].team !== this.P.team && vis[at(e.x, e.y)]) this.foes.set(e.id, { t: W.t, x: e.x, y: e.y, type: e.type, nav: !!e.nav, owner: e.owner });
    }
    for (const [id] of W.wonders || []) { const b = alive(W, id); if (b && b.owner !== this.pid && W.players[b.owner].team !== this.P.team) this.known.set(id, { x: b.x + b.w / 2, y: b.y + b.h / 2, owner: b.owner, type: b.type }); }    // a wonder is known to all
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
    if (e.n >= 4) { w.inf += 3 * e.cav / e.n; w.cav += 3 * e.arch / e.n; w.arch += 3 * e.inf / e.n + 1.5 * e.arch / e.n; }
    if (P.techs.has('doc_legion')) w.inf += 1.2; if (P.techs.has('doc_cavalry')) w.cav += 1.2; if (P.techs.has('doc_archers')) w.arch += 1.2;
    return w;
  }

  // ---------------------------------------------------------------- research: blacksmith, doctrines, academy, specialists
  research() {
    const W = this.W, P = this.P, S = this.S, mine = this.m;
    const go = (tech, at, spare = 120) => {
      const b = mine.bld.find(x => x.type === at && x.built && x.queue.length < 1); if (!b || !techOk(W, this.pid, tech, b)) return false;
      const c = techCost(P, tech); if (!this.afford(c) || P.res.food < (c.food || 0) + Math.max(spare, this.foodKeep)) return false;
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
      go('spy_network', 'academy', 150); go('stone_mining', 'mining_camp', 200);
      if (S.walls || S.towers > 2) go('masonry', 'academy', 150);
      if (main === 'inf' || P.techs.has('doc_legion')) go('drill', 'barracks', 200);
      if (main === 'cav' || S.horseArchers) go('husbandry', 'stable', 200);
      if (S.walls || this.attacked >= 2) go('civic_defense', 'town_center', 200);
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
      if (e.n >= 4 && e.cav / e.n > 0.3) go('pikes', 'barracks', 250);                       // heavy horse seen: long spears
      const myArch = this.m.units.filter(u => CLS(u.type) === 'arch').length, myCav = this.m.units.filter(u => CLS(u.type) === 'cav').length;
      if (myArch >= 6) { go('thumb_ring', 'archery_range', 250); go('parthian', 'archery_range', 300); }
      if (myCav >= 6) go('flank_tactics', 'stable', 300);
      // unit lines: upgrade what we field
      const has = (t) => this.m.units.filter(u => u.type === t).length;
      if (has('militia') >= 4) { go('man_at_arms', 'barracks', 200); go('long_sword', 'barracks', 250); go('champion', 'barracks', 400); }
      if (has('pikeman') + has('spearman') >= 5) go('halberdier', 'barracks', 400);
      if (has('archer') + has('crossbow') + has('fire_archer') >= 5) go('arbalest', 'archery_range', 400);
      if (has('skirmisher') >= 4) go('elite_skirm', 'archery_range', 250);
      if (has('horse_archer') >= 4) go('heavy_ha', 'archery_range', 400);
      if (has('scout') >= 3) { go('light_cav', 'stable', 200); go('hussar', 'stable', 400); }
      if (has('knight') + has('cataphract') + has('lancer') >= 4) { go('cavalier', 'stable', 400); go('paladin', 'stable', 600); }
      if (has('ram') >= 1) go('capped_ram', 'siege_workshop', 250); if (has('mangonel') >= 2) go('onager', 'siege_workshop', 400); if (has('scorpion') >= 2) go('heavy_scorpion', 'siege_workshop', 400);
      for (const [t, at] of [['bow_saw', 'lumber_camp'], ['heavy_plow', 'mill'], ['gold_shaft', 'mining_camp'], ['hand_cart', 'town_center'], ['two_man_saw', 'lumber_camp'], ['crop_rotation', 'mill']]) if (go(t, at, 250)) break;
      if (this.m.bld.filter(b => b.type === 'watch_tower').length >= 2) { go('guard_tower', 'watch_tower', 300); go('keep', 'watch_tower', 500); }
      if (this.m.units.filter(u => u.type === 'war_ship').length >= 2) go('galleon', 'dock', 300);
      if (this.m.units.some(u => u.type === 'healer')) go('medicine', 'academy', 300);
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
      } else if (b.type === 'archery_range') {
        // skirmishers when the enemy leans on archers, horse archers for raiders, gunners once gunpowder is in
        const skirm = e.n >= 4 && e.arch / e.n > 0.35 && this.rnd() < 0.6;
        const ha = P.age >= 3 && (this.S.horseArchers || (e.n >= 4 && e.inf / e.n > 0.5)) && this.rnd() < 0.45;
        options.push([b, skirm ? 'skirmisher' : ha ? 'horse_archer' : P.techs.has('gunpowder') && (P.res.iron >= 25 && this.rnd() < 0.4) ? 'gunner' : 'archer', deficit('arch')]);
      }
      else if (b.type === 'stable') options.push([b, P.age >= 3 ? 'knight' : 'scout', deficit('cav')]);
      else if (b.type === 'academy' && P.techs.has('gunpowder') && this.siegeWanted(army)) options.push([b, 'cannon', 0.25]);
      if (b.type === 'siege_workshop') {           // rams for walls, mangonels against blobs, scorpions against infantry
        if (this.siegeWanted(army)) options.push([b, 'ram', 0.3]);
        if (e.n >= 6 && (e.inf + e.arch) / e.n > 0.6 && army.filter(u => u.type === 'mangonel').length < 3) options.push([b, 'mangonel', 0.3]);
        else if (e.n >= 6 && e.inf / e.n > 0.4 && army.filter(u => u.type === 'scorpion').length < 3) options.push([b, 'scorpion', 0.2]);
      }
      if (b.type === 'castle' && [...this.known.values()].some(k => k.type === 'castle' || k.type === 'watch_tower' || k.type === 'wonder') && army.filter(u => UNITS[u.type].packs).length < 2) options.push([b, 'trebuchet_p', 0.35]);
      if (b.type === 'castle' && P.spec.unique) options.push([b, 'unique', 0.15 + Math.max(0, deficit(CLS(P.spec.unique)) || 0)]);     // our civilization's unique unit
      if (b.type === 'academy' && army.length >= 10 && army.filter(u => u.type === 'healer').length < Math.floor(army.length / (this.S.healers ? 8 : 14))) options.push([b, 'healer', 0.2]);
    }
    options.sort((a, b) => b[2] - a[2]);
    const reserve = ageing ? 0 : (P.age < 3 && vils.length >= target - 3 ? 500 : 0);    // saving up for the next age
    for (const [b, type0] of options.slice(0, 3)) {
      const type = trainType(P, type0), d = UNITS[type];
      const cost = unitCost(P, type);
      if (!canTrain(W, this.pid, type) || !this.afford(cost)) continue;
      if (P.res.food - (cost.food || 0) < this.foodKeep) continue;                          // tomorrow's upkeep comes first
      if (reserve && P.res.food - (cost.food || 0) < reserve * (1 - this.D.mil)) continue;
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
    const towers = this.count('watch_tower'), wantT = S.towers + (pressed ? 2 : 0) + (this.D.think < 1 ? 1 : 0) + (this.stance === 'bertahan' ? 2 : 0);
    if (towers < wantT && P.res.stone >= 125 + (S.walls ? 60 : 0) && P.res.wood >= 25) {
      // towers watch over the gold / lumber camps first, then the side facing the enemy
      const camps = this.m.bld.filter(b => b.built && ['mining_camp', 'lumber_camp', 'mill'].includes(b.type));
      const c = camps[towers % Math.max(1, camps.length)];
      const at = c && towers < camps.length ? [c.x + 1, c.y + 1] : this.towardEnemy(12);
      this.build('watch_tower', at, 2, 6);
    }
    if ((S.walls || (pressed && this.D.think < 1.5)) && P.res.stone >= 160 && vils.length >= 20) this.wallRing('stone_wall');
    else if (S.walls && P.age === 1 && P.res.wood >= 250 && vils.length >= 14 && !this.palDone) this.wallRing('palisade');
  }
  // a ring of stone wall around the town at radius R, with four gates; built a stretch at a time
  wallRing(type = 'stone_wall') {
    const W = this.W, P = this.P, [bx, by] = this.base, R0 = W.size >= 180 ? 20 : 18;
    if (this.m.bld.some(b => (b.type === 'stone_wall' || b.type === 'palisade' || b.type === 'gate') && !b.built)) return;       // finish the current stretch first
    if (!this.ring) {
      const pts = [], seen = new Set();
      // the radius bulges out round a field block that is close to town, so the first fields sit inside the wall
      const blocks = (this.fds || []).slice(0, 1).map(F => [F.mx - 7, F.my - 7, F.mx + 10, F.my + 10]);
      const Rof = (a) => { let R = R0; for (let r = R0; r < R0 + 22; r++) { const x = bx + Math.cos(a) * r, y = by + Math.sin(a) * r; if (blocks.some(([x0, y0, x1, y1]) => x >= x0 && x < x1 && y >= y0 && y < y1)) R = r + 1.5; } return R; };
      for (let k = 0; k < 720; k++) { const a = k / 720 * Math.PI * 2, R = Rof(a), i = Math.round(bx + Math.cos(a) * R), j = Math.round(by + Math.sin(a) * R), key = i + ',' + j; if (!seen.has(key)) { seen.add(key); pts.push([i, j, a]); } }
      this.ring = pts; this.ringI = 0; this.gates = [0, 1, 2, 3].map(q => q * Math.PI / 2 + this.rnd() * 0.5);
    }
    const nearGate = (a) => this.gates.some(g => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.13);
    const tiles = [];
    while (this.ringI < this.ring.length && tiles.length < 10) {
      const [i, j, a] = this.ring[this.ringI++];
      if (nearGate(a)) { if (!this.gateDone) this.gateDone = new Set(); const gk = this.gates.findIndex(g => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < 0.13); if (!this.gateDone.has(gk) && P.res.stone >= 30) { this.gateDone.add(gk); const ax = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? 'y' : 'x'; if (placementOk(W, this.pid, 'gate', i, j, ax)) command(W, { t: 'place', pid: this.pid, type: 'gate', i, j, axis: ax, ids: this.builders(2, i, j) }); } continue; }
      if (placementOk(W, this.pid, type, i, j) && !W.road[idx(W, i, j)] && this.walkableBeside(i, j)) tiles.push([i, j]);
    }
    if (tiles.length && canAfford(P, type === 'palisade' ? { wood: 3 * tiles.length } : { stone: 5 * tiles.length })) command(W, { t: 'place', pid: this.pid, type, tiles, ids: this.builders(2, tiles[0][0], tiles[0][1]) });
    if (this.ringI >= this.ring.length) { this.ringI = 0; if (type === 'palisade') this.palDone = true; }       // go round again later (fill gaps left by trees, rebuild)
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
    const W = this.W, P = this.P, S = this.S; if (W.t < (this.watT || 0) || W.frozen) return; this.watT = W.t + 6;     // frozen winter: no docks, no boats
    const island = W.map && W.map.water === 'islands';
    const fish = this.res('fish', this.base[0], this.base[1], island ? 80 : 46);
    if (!this.count('dock') && (fish || island) && vils.length >= (S.navy || island ? 8 : 11) && P.res.wood >= 150) {
      // by the fish if possible, else the nearest shore of our own landmass (on big islands the sea can be 40+ tiles away)
      if (!(fish && this.build('dock', [fish.x, fish.y], 1, 8))) { const sp = this.dockSpot(); if (sp) this.build('dock', sp, 0, 3); }
    }
    const dock = this.m.bld.find(b => b.type === 'dock' && b.built); if (!dock) return;
    // the shoals by our docks are fished out: a new dock by the nearest known fish further out
    if (W.t > (this.dock2T || 0) && this.count('dock') < 3 && P.res.wood >= 180) {
      this.dock2T = W.t + 30;
      const docks = this.m.bld.filter(b => b.type === 'dock');
      if (!docks.some(b => this.res('fish', b.x, b.y, 18))) { const far = this.res('fish', this.base[0], this.base[1], island ? 90 : 60); if (far && docks.every(b => Math.hypot(b.x - far.x, b.y - far.y) > 18)) this.build('dock', [far.x, far.y], 1, 8); }
    }
    const boats = this.m.units.filter(u => u.type === 'fishing_boat').length;
    const shoals = fish ? [...W.dyn.values(), ...W.ents.values()].filter(e => e.kind === 'res' && e.type === 'fish' && Math.hypot(e.x - dock.x, e.y - dock.y) < 30).length : 0;
    if (fish && boats < Math.min(S.navy ? 10 : 8, 2 + shoals * 2) && dock.queue.length < 2 && this.afford(UNITS.fishing_boat.cost)) command(W, { t: 'train', pid: this.pid, bid: dock.id, type: 'fishing_boat' });
    const enemyShips = [...this.foes.values()].filter(f => f.nav && MILITARY(f.type) && !UNITS[f.type].trade && f.type !== 'transport' && W.t - f.t < 120).length;
    const wantFleet = P.age >= 2 ? (S.navy ? 5 : 0) + enemyShips + (island ? 3 : 0) : 0;
    if (P.age >= 3 && enemyShips >= 2 && fleet.length < wantFleet + 2 && dock.queue.length < 2 && this.afford(unitCost(P, 'fire_ship'))) command(W, { t: 'train', pid: this.pid, bid: dock.id, type: this.rnd() < 0.7 ? 'fire_ship' : 'demo_ship' });
    if (P.age >= 4 && P.techs.has('gunpowder') && this.S.navy && fleet.filter(f => f.type === 'cannon_galleon').length < 3 && dock.queue.length < 2 && this.afford(unitCost(P, 'cannon_galleon'))) command(W, { t: 'train', pid: this.pid, bid: dock.id, type: 'cannon_galleon' });
    if (fleet.length < Math.min(10, wantFleet) && dock.queue.length < 2 && this.afford(UNITS.war_ship.cost)) command(W, { t: 'train', pid: this.pid, bid: dock.id, type: 'war_ship' });
    const trans = this.m.units.filter(u => u.type === 'transport_ship').length;
    if (island && P.age >= 2 && trans < (this.m.units.filter(u => MILITARY(u.type) && !u.nav).length >= 20 ? 4 : 2) && dock.queue.length < 2 && this.afford(UNITS.transport_ship.cost)) command(W, { t: 'train', pid: this.pid, bid: dock.id, type: 'transport_ship' });
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
    // the war fleet sails ahead to clear the landing
    const fleet = this.m.units.filter(u => u.nav && MILITARY(u.type) && !UNITS[u.type].trade && u.type !== 'transport_ship' && !(u.order && u.order.t === 'attack'));
    if (fleet.length) { const c = nearestFree(this.W, tgt[0], tgt[1], this.pid, 10, true); if (c) command(this.W, { t: 'move', pid: this.pid, ids: fleet.map(u => u.id), x: c[0] + 0.5, y: c[1] + 0.5, amove: true }); }
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
      this.beachT = W.t;                 // a beachhead: the next waves follow sooner
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
      const db = Math.hypot(x - bx, y - by), df = Math.hypot(x - fx, y - fy);
      let sc;
      if (!far) { if (db > 28) continue; sc = df * 0.8 + Math.abs(db - 16) * 1.5; }
      else sc = df * 0.5 + Math.abs(Math.hypot(x - C, y - C) - homeR) * 0.7 - db * 0.35;
      if (dangers.some(k => Math.hypot(k.x - x, k.y - y) < 11)) sc += 60;      // keep the scout out of arrow range
      if (beasts.some(o => Math.hypot(o.x - x, o.y - y) < 7)) sc += 30;        // ... and away from wolves, bears and bandits,
      else if (beasts.some(o => segDist(o.x, o.y, fx, fy, x, y) < 6)) sc += 40;  // also on the way there
      sc += this.rnd() * 8 - (un / all) * 6;
      if (sc >= bs) continue;                     // cheap score first; the walkable-spot search only for a better candidate
      const f = nearestFree(W, x, y, this.pid, 4, nav); if (!f || (home && regionAt(W, f[0] + 0.5, f[1] + 0.5, nav) !== home)) continue;   // stay on our landmass / sea
      bs = sc; best = [f[0] + 0.5, f[1] + 0.5, cell];
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
      if (!u && !this.known.size && this.homeDone) u = fleet.find(s => !s.order) || this.m.units.find(s => s.type === 'war_ship' || s.type === 'fishing_boat' || (s.type === 'transport_ship' && !s.cargo.length && !(this.inv && this.inv.ships.includes(s.id)) && !(this.colony && this.colony.ship === s.id))) || null;
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
      const ship = fleet.find(s => !s.order) || this.m.units.find(s => s.type === 'war_ship' || s.type === 'fishing_boat' || (s.type === 'transport_ship' && !s.cargo.length && !(this.inv && this.inv.ships.includes(s.id))));
      if (!ship) { const dk = this.m.bld.find(b => b.type === 'dock' && b.built && !b.queue.length); if (dk && canAfford(this.P, UNITS.fishing_boat.cost)) command(W, { t: 'train', pid: this.pid, bid: dk.id, type: 'fishing_boat' }); }
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
    if (b && canAfford(P, unitCost(P, type)) && P.res.food - (unitCost(P, type).food || 0) >= (this.foodKeep || 0)) { command(W, { t: 'train', pid: this.pid, bid: b.id, type }); this.rsT = W.t + (type === 'scout' ? 90 : 10); }
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
      else if (e.kind === 'unit' && (e.type === 'sheep' || e.type === 'cow') && (e.owner === this.pid || (e.owner === GAIA && this.recent(e.id, 60)))) {
        if (e.pen && (e.meat || 0) < UNITS[e.type].fat * 0.95 && this.P.res.food > 120) continue;      // livestock fattens in the barn until it is worth it
        sc = Math.hypot(e.x - bx, e.y - by) + (e.pen ? 0 : 4);
      }
      else if (e.kind === 'unit' && e.type === 'deer' && this.recent(e.id, 90)) sc = Math.max(0, Math.hypot(e.x - bx, e.y - by) - 10) + 8;      // hunting parties go further out
      if (sc === null || sc > 20 || unreachable(W, e.id, this.pid)) continue;
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
  // economy II: keep a few farms queued at the mill, lay fish traps when the shoals run out, trade with allies
  economy2(P, mine) {
    const W = this.W; if (W.t < (this.eco2T || 0)) return; this.eco2T = W.t + 5;
    const farms = mine.bld.filter(b => b.type === 'farm').length, q = W.reseed[this.pid] || 0;
    if (farms >= 6 && q < 4 && P.res.wood >= 300 + 60 * q + (this.lifeNeed ? this.lifeNeed.wood || 0 : 0)) command(W, { t: 'reseed', pid: this.pid, bid: 0, n: 1 });
    const dock = mine.bld.find(b => b.type === 'dock' && b.built);
    if (dock && P.age >= 2 && P.res.wood >= 400 && !this.res('fish', dock.x, dock.y, 14) && this.m.units.some(u => u.type === 'fishing_boat')) command(W, { t: 'fishtrap', pid: this.pid, bid: dock.id });
    const mk = mine.bld.find(b => b.type === 'market' && b.built);
    const ally = mk && [...W.dyn.values()].find(e => e.kind === 'building' && e.type === 'market' && e.built && e.owner !== this.pid && e.owner >= 0 && W.players[e.owner].team === P.team);
    if (ally) {
      const carts = this.m.units.filter(u => u.type === 'trade_cart');
      if (carts.length < 6 && !mk.queue.length && this.afford(unitCost(P, 'trade_cart')) && P.res.food >= 300) command(W, { t: 'train', pid: this.pid, bid: mk.id, type: 'trade_cart' });
      for (const c of carts) if (!c.order) command(W, { t: 'smart', pid: this.pid, ids: [c.id], target: ally.id });
    }
    // regicide: the king stays inside the Town Center (or castle)
    if (P.king) { const k = W.ents.get(P.king), home = mine.bld.find(b => b.type === 'castle' && b.built) || mine.bld.find(b => b.type === 'town_center' && b.built); if (k && home && !k.inside && (!k.order || k.order.t !== 'garrison')) command(W, { t: 'garrison', pid: this.pid, ids: [k.id], target: home.id }); }
  }
  // the people's needs: a tavern, wells where they work and live, a hospital, a barn with livestock
  lifeCare(P, mine, vils) {
    const W = this.W; if (W.t < (this.lifeT || 0)) return; this.lifeT = W.t + 4;
    const count = (t, any = true) => mine.bld.filter(b => b.type === t && (any || b.built)).length, L = P.life || { fun: 80, sick: 0 };
    if (!W.opts.life) { this.lifeNeed = null; if (!count('barn') && vils.length >= 22 && count('mill', false)) this.build('barn', this.base, 8, 16); }
    else {
    // a bored, unhappy people comes first: armies and research leave the wood / gold for the tavern
    const needTav = !count('tavern') && P.pop >= 14 && (L.fun < 70 || P.pop >= 22);
    this.lifeNeed = needTav ? BUILDINGS.tavern.cost : P.age >= 2 && !count('hospital') && L.sick >= 3 ? BUILDINGS.hospital.cost : null;
    if (needTav) this.build('tavern', this.base, 3, 12);
    else if (count('tavern') < 2 && P.pop >= 55 && L.fun < 55) this.build('tavern', this.base, 3, 14);
    if (P.age >= 2 && !count('hospital') && (P.pop >= 35 || L.sick >= 2)) this.build('hospital', this.base, 3, 12);
    if (!count('barn') && P.pop >= 20 && count('mill', false) && (count('tavern') || P.pop >= 30)) this.build('barn', this.base, 8, 16);
    }
    // a well wherever people work or live far from water (camps, field mills, house blocks)
    if (W.opts.life && W.t > (this.wellT || 0)) {
      this.wellT = W.t + 15;
      const water = mine.bld.filter(b => b.built && (b.type === 'well' || b.type === 'town_center'));
      const wet = (x, y) => water.some(b => Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y) <= 10) || this.nearWater(x, y);
      const sites = mine.bld.filter(b => b.built && ['lumber_camp', 'mining_camp', 'mill', 'house', 'barn', 'barracks'].includes(b.type)).sort((a, b) => Math.hypot(a.x - this.base[0], a.y - this.base[1]) - Math.hypot(b.x - this.base[0], b.y - this.base[1]));
      const dry = sites.find(b => !wet(b.x + b.w / 2, b.y + b.h / 2));
      if (dry && !mine.bld.some(b => b.type === 'well' && !b.built)) this.build('well', [dry.x + dry.w / 2, dry.y + dry.h / 2], 1, 5, true);
    }
    // livestock: buy a few head, bring captured sheep in, and let them fatten
    const barn = mine.bld.find(b => b.type === 'barn' && b.built);
    if (barn) {
      const herd = this.m.units.filter(u => u.type === 'sheep' || u.type === 'cow');
      if (herd.length < 6 && !barn.queue.length && P.res.food >= 250 && P.res.gold >= 120) command(W, { t: 'train', pid: this.pid, bid: barn.id, type: P.res.gold >= 260 ? 'cow' : 'sheep' });
      const stray = herd.filter(u => !u.pen && !u.order && Math.hypot(u.x - barn.x, u.y - barn.y) < 45 && !this.m.units.some(v => v.order && v.order.id === u.id)).map(u => u.id);
      if (stray.length) command(W, { t: 'smart', pid: this.pid, ids: stray, target: barn.id });
    }
    const go = (tech, at, spare = 150) => { const b = mine.bld.find(x => x.type === at && x.built && !x.queue.length); if (b && techOk(W, this.pid, tech, b) && this.afford(techCost(P, tech)) && P.res.food >= (techCost(P, tech).food || 0) + spare) command(W, { t: 'research', pid: this.pid, bid: b.id, tech }); };
    go('brewery', 'tavern'); if (P.age >= 2) { go('minstrels', 'tavern'); go('herbalism', 'hospital'); if (L.sick >= 2) go('quarantine', 'hospital'); }
    if (P.age >= 3) go('sanitation', 'hospital');
    if (barn && (barn.herd || 0) >= 3) go('fodder', 'barn');
  }
  nearWater(x, y) {
    const W = this.W, S = W.size;
    for (let j = Math.floor(y) - 4; j <= y + 4; j++) for (let i = Math.floor(x) - 4; i <= x + 4; i++) if (i >= 0 && j >= 0 && i < S && j < S && W.terrain[j * S + i] === 3) return true;
    return false;
  }
  // ---------------------------------------------------------------- expansion
  // Border posts claim the land where we work (camps out of our territory), then a second / third Town Center goes up
  // by rich resources further out — on our own landmass, or by ship on another island (a colony with its own dock).
  expand(P, mine, vils, tcs, ageing, target) {
    const W = this.W;
    // the new towns train villagers too
    for (const t of tcs) if (t !== this.tc && !t.queue.length && vils.length < target && this.afford(UNITS.villager.cost) && P.res.food - 50 >= this.foodKeep) command(W, { t: 'train', pid: this.pid, bid: t.id, type: 'villager' });
    if (this.colony) this.colonyTick();
    if (W.t < (this.expT || 0)) return; this.expT = W.t + 20;
    const T = W.terr, mineT = (x, y) => T && T[idx(W, Math.floor(x), Math.floor(y))] === this.pid + 1;
    // border posts by camps outside our land, then out towards the middle of the map
    const posts = mine.bld.filter(b => b.type === 'outpost').length;
    if (W.t > 420 && posts < Math.min(5, P.age + 1) && !mine.bld.some(b => b.type === 'outpost' && !b.built)) {
      const camp = mine.bld.find(b => b.built && ['lumber_camp', 'mining_camp', 'mill', 'dock'].includes(b.type) && !mineT(b.x + b.w / 2, b.y + b.h / 2));
      if (camp) this.build('outpost', [camp.x + camp.w / 2, camp.y + camp.h / 2], 2, 5, true);
      else if (posts < P.age) { const C = W.size / 2, [bx, by] = this.base, d = Math.hypot(C - bx, C - by) || 1, x = bx + (C - bx) / d * 21, y = by + (C - by) / d * 21; if (!mineT(x, y)) this.build('outpost', [x, y], 0, 5, true); }
    }
    // a new town by rich resources: once a site is known, armies and research leave its cost aside
    const due = P.age >= 2 && vils.length >= 24 && canBuild(W, this.pid, 'town_center') && !mine.bld.some(b => b.type === 'town_center' && !b.built) && !this.colony;
    if (due && W.t > (this.siteT || 0)) { this.siteT = W.t + 60; this.site = this.expansionSite(false) || (W.map && W.map.water === 'islands' ? this.expansionSite(true) : null); }
    this.expandNeed = due && this.site ? costOf(P, 'town_center') : null;
    if (due && !ageing && W.t > (this.tcT || 0) && P.res.wood >= 300 && P.res.stone >= 110) {
      this.tcT = W.t + 120;
      const site = this.expansionSite(false);
      if (site) { this.build('town_center', site, 0, 3, true); this.tcT = W.t + 300; }
      else if (W.map && W.map.water === 'islands') { const s2 = this.expansionSite(true); if (s2) this.startColony(s2, vils); }
    }
  }
  // ---------------------------------------------------------------- underground mines
  // When the gold, stone or iron round our towns runs out, a mine is dug by the town: it is set to the ore we need,
  // switched when another ore runs short, and a new one is dug when it caves in.
  shaftFor(res, v) {
    if (!['gold', 'stone', 'iron'].includes(res)) return null;
    let best = null, bd = 1e9;
    for (const b of this.m.bld) {
      if (!b.id || !b.built || !BUILDINGS[b.type].shaft || b.ore !== res || !(b.left > 0)) continue;
      const crew = this.m.units.filter(u => u.order && u.order.t === 'gather' && u.order.id === b.id).length; if (crew >= BUILDINGS[b.type].crew) continue;
      const d = Math.hypot(b.x - v.x, b.y - v.y); if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  mines(P, mine, vils, tcs) {
    const W = this.W; if (P.age < 2 || W.t < (this.mineT || 0)) return; this.mineT = W.t + 12;
    const shafts = mine.bld.filter(b => b.id && BUILDINGS[b.type].shaft);
    const want = (k) => k === 'gold' ? P.res.gold < 3000 : k === 'stone' ? P.res.stone < 500 : P.res.iron < 400 && (this.S.iron > 0 || P.age >= 3);
    const surface = (k) => (tcs.length ? tcs : [{ x: this.base[0] - 2, y: this.base[1] - 2 }]).some(t => this.res(k, t.x + 2, t.y + 2, 32));
    const need = (k) => P.res[k] / { gold: 1, stone: 0.6, iron: 0.5 }[k];          // gold matters most
    const lack = ['gold', 'stone', 'iron'].filter(k => want(k) && !surface(k)).sort((a, b) => need(a) - need(b));
    // the ore each mine digs: what we lack most and no other mine digs; switched only when another ore is far scarcer
    this.oreSet = this.oreSet || new Set();
    for (const s of shafts) {
      const best = lack.find(k => !shafts.some(o => o !== s && o.ore === k && o.left > 0)) || lack[0];
      if (!best || s.ore === best) { this.oreSet.add(s.id); continue; }
      if (!this.oreSet.has(s.id) || !want(s.ore) || need(s.ore) > need(best) * 2 + 100) { this.oreSet.add(s.id); command(W, { t: 'ore', pid: this.pid, bid: s.id, ore: best }); }
    }
    // a new mine for an ore no mine digs yet (three, then two per town)
    const missing = lack.find(k => !shafts.some(s => s.ore === k && (s.left > 0 || !s.built)));
    if (missing && shafts.length < Math.max(3, 2 * tcs.length) && vils.length >= 15 && P.res.wood >= 320 && !mine.bld.some(b => b.type === 'mine_shaft' && !b.built)) this.build('mine_shaft', this.base, 6, 14);
    // crews: woodcutters go down a mine that is short of hands while its ore is needed
    if (restNow(W, P)) return;
    for (const s of shafts) {
      if (!s.built || !(s.left > 0) || !lack.includes(s.ore)) continue;
      const crew = vils.filter(v => v.order && v.order.id === s.id).length; if (crew >= 5) continue;
      const go = vils.filter(v => v.order && v.order.t === 'gather' && v.order.kind === 'tree' && !(v.carry && v.carry.n > 3)).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y)).slice(0, Math.min(2, 5 - crew));
      if (go.length && (P.res.wood > 250 || vils.length > 30)) command(W, { t: 'smart', pid: this.pid, ids: go.map(v => v.id), target: s.id, x: s.x + 1, y: s.y + 1 });
    }
  }
  // ---------------------------------------------------------------- the other towns
  // Every Town Center after the first grows into a town of its own: houses round its plaza, camps by the nearby wood
  // and ore, its own field district and mill, a well and a tavern, then a market, a barracks and a tower to hold it.
  // The planner is pointed at that town for the call (base / tc / town), so its quarters are laid out like the capital's.
  withTown(t, fn) {
    const keep = [this.base, this.tc, this.town];
    this.base = [t.x + 2, t.y + 2]; this.tc = t; this.town = t;
    try { return fn(); } finally { [this.base, this.tc, this.town] = keep; }
  }
  // each new town keeps a few soldiers of its own who walk its rounds (the field army never takes them)
  onWatch(id) { if (this.tw) for (const s of this.tw.values()) if (s.has(id)) return true; return false; }
  townWatch(t) {
    const W = this.W, tw = this.tw || (this.tw = new Map()), cx = t.x + 2, cy = t.y + 2;
    for (const [id, s] of tw) { if (!W.ents.has(id)) tw.delete(id); else for (const u of s) if (!W.ents.has(u)) s.delete(u); }
    const set = tw.get(t.id) || new Set(); tw.set(t.id, set);
    const army = this.m.units.filter(u => MILITARY(u.type) && !u.nav && !UNITS[u.type].hero && !UNITS[u.type].trade && !UNITS[u.type].packs && UNITS[u.type].cls !== 'siege' && u.id !== this.explorer && !stat(W, u.owner, u.type).heal && !stat(W, u.owner, u.type).convert);
    // a share of the army split between the new towns (6 a town used to keep half of a ten-town empire's army home)
    const towns = Math.max(1, (this.tcs || []).length - 1), pool0 = Math.round(army.length * (this.ahead || (this.war && this.war.phase === 'kepung') ? 0.1 : 0.18));
    const want = army.length < 10 ? 0 : Math.max(1, Math.min(this.ahead ? 2 : 4, Math.floor(pool0 / towns)));
    if (set.size > want) { const out = [...set].slice(want); for (const id of out) set.delete(id); command(W, { t: 'stop', pid: this.pid, ids: out }); }     // released to the field army
    if (set.size < want) {
      const pool = army.filter(u => !set.has(u.id) && !(this.guard && this.guard.has(u.id)) && !this.onWatch(u.id) && !this.inWar(u.id) && (!u.order || u.order.t === 'patrol' || (u.order.amove && u.order.t !== 'attack')))
        .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
      for (const u of pool.slice(0, want - set.size)) { set.add(u.id); if (u.order) command(W, { t: 'stop', pid: this.pid, ids: [u.id] }); }
    }
    const idle = [...set].map(id => W.ents.get(id)).filter(u => u && (!u.order || (u.order.t !== 'patrol' && u.order.t !== 'attack')));
    if (idle.length) { const pts = townRing(W, this.pid, 10, 6, t); if (pts.length >= 3) command(W, { t: 'patrol', pid: this.pid, ids: idle.map(u => u.id), pts, guard: true }); }
  }
  houseTown(tcs, mine) {
    let best = null, bn = 1e9;
    for (const t of tcs) { const n = mine.bld.filter(b => b.type === 'house' && b.x !== undefined && Math.hypot(b.x - t.x - 2, b.y - t.y - 2) < 16).length; if (t !== this.tc && n >= 10) continue; if (n < bn) { bn = n; best = t; } }
    return best;
  }
  towns(P, mine, vils, tcs) {
    const W = this.W, others = tcs.filter(t => t !== this.tc);
    if (!others.length || W.t < (this.townT || 0)) return; this.townT = W.t + 4;
    const t = others[this.townI = ((this.townI || 0) + 1) % others.length];
    const cx = t.x + 2, cy = t.y + 2, inTown = (e, r) => Math.hypot(e.x - cx, e.y - cy) < r;
    const here = (type, r = 18) => mine.bld.filter(b => b.type === type && b.x !== undefined && inTown(b, r)).length;
    const folk = vils.filter(v => inTown(v, 22));
    // settlers: a few villagers walk over from the capital until the new town has hands of its own
    if (folk.length < 8 && vils.length >= 18 && !restNow(W, P)) {
      const r = this.res('tree', cx, cy, 14) || this.res('berry', cx, cy, 14) || this.res('gold', cx, cy, 16);
      const go = vils.filter(v => !inTown(v, 30) && v.order && v.order.t === 'gather' && ['tree', 'gold', 'stone', 'berry'].includes(v.order.kind)).slice(0, 2);
      if (r && go.length) command(W, { t: 'smart', pid: this.pid, ids: go.map(v => v.id), target: r.id, x: r.x, y: r.y });
    }
    this.townWatch(t);
    if (!folk.length) return;
    this.withTown(t, () => {
      // drop sites by the wood and ore round the town (the Town Center itself takes what lies next to it)
      if (!here('lumber_camp', 16) && P.res.wood >= 100) { const r = this.res('tree', cx, cy, 14); if (r && distTo(t, r.x, r.y) > 5) this.build('lumber_camp', [r.x, r.y], 2, 5); }
      for (const k of ['gold', 'stone', 'iron']) {
        const r = this.res(k, cx, cy, 16); if (!r || distTo(t, r.x, r.y) <= 5 || P.res.wood < 100) continue;
        if (!mine.bld.some(b => b.type === 'mining_camp' && b.x !== undefined && Math.hypot(b.x - r.x, b.y - r.y) < 6)) { this.build('mining_camp', [r.x, r.y], 2, 5); break; }
      }
      // homes: a town looks lived in (and every house is room for more people)
      if (here('house', 16) < Math.min(10, 2 + Math.floor(folk.length / 2)) && P.res.wood >= 80) this.build('house', this.base, 4, 10);
      // its own fields and mill, outside the houses
      const fields = here('farm', 24);
      if (folk.length >= 5 && fields < Math.min(12, Math.ceil(folk.length * 0.45)) && P.res.wood >= 60 + (here('mill', 24) ? 0 : 100)) this.build('farm', this.base, 4, 10);
      // life: water, a tavern; then the town grows a market, a barracks and a watch tower
      if (W.opts.life && !here('well', 12) && P.res.wood >= 60 && P.res.stone >= 15) this.build('well', this.base, 3, 8);
      if (W.opts.life && folk.length >= 8 && !here('tavern', 18) && P.res.wood >= 250) this.build('tavern', this.base, 3, 12);
      if (P.age >= 2 && folk.length >= 10 && !here('market', 20) && P.res.wood >= 450) this.build('market', this.base, 8, 15);
      if (P.age >= 2 && folk.length >= 8 && !here('barracks', 20) && P.res.wood >= 400) this.build('barracks', this.base, 6, 13);
      if (P.age >= 2 && !here('watch_tower', 12) && P.res.stone >= 250 && P.res.wood >= 100) this.build('watch_tower', this.base, 4, 8);
      if (P.age >= 3 && folk.length >= 14 && !here('blacksmith', 20) && P.res.wood >= 500) this.build('blacksmith', this.base, 6, 13);
    });
  }
  // the best spot for a new town: free land 24-50 tiles out, nobody's territory, away from known enemies, rich around
  expansionSite(otherIsland) {
    const W = this.W, S = W.size, [bx, by] = this.base, home = regionAt(W, bx, by + 3), T = W.terr;
    const foes = [...this.known.values()], VAL = { gold: 3, stone: 2, iron: 1.5, berry: 1.5, fish: 1, tree: 0.25 };
    // resources on a coarse grid once (not every entity for every candidate spot)
    const G = 8, gn = Math.ceil(S / G), cellV = new Float32Array(gn * gn);
    for (const e of W.ents.values()) if (e.kind === 'res' && VAL[e.type] && this.P.exp[idx(W, Math.floor(e.x), Math.floor(e.y))]) cellV[Math.floor(e.y / G) * gn + Math.floor(e.x / G)] += VAL[e.type];
    let best = null, bs = -1e9;
    for (let j = 4; j < S - 8; j += 4) for (let i = 4; i < S - 8; i += 4) {
      const dd = Math.hypot(i - bx, j - by); if (otherIsland ? dd > 90 : (dd < 24 || dd > 50 + 16 * Math.max(0, (this.tcs || []).length - 1))) continue;
      if ((this.tcs || []).some(t => Math.hypot(t.x + 2 - i, t.y + 2 - j) < 22)) continue;
      const k = idx(W, i, j); if (!this.P.exp[k] || (T && T[k])) continue;
      const rg = regionAt(W, i + 2, j + 5); if (otherIsland ? (rg === home || !rg) : rg !== home) continue;
      if (foes.some(f => Math.hypot(f.x - i, f.y - j) < 30)) continue;
      if (!placementOk(W, this.pid, 'town_center', i, j)) continue;
      let sc = 0; const ci = Math.floor((i + 2) / G), cj = Math.floor((j + 2) / G);
      for (let b2 = cj - 1; b2 <= cj + 1; b2++) for (let a2 = ci - 1; a2 <= ci + 1; a2++) if (a2 >= 0 && b2 >= 0 && a2 < gn && b2 < gn) sc += cellV[b2 * gn + a2];
      if (otherIsland) { let shore = false; for (let a = 0; a < 16 && !shore; a++) { const x = Math.round(i + 2 + Math.cos(a / 16 * 6.28) * 7), y = Math.round(j + 2 + Math.sin(a / 16 * 6.28) * 7); if (x >= 0 && y >= 0 && x < S && y < S && W.terrain[y * S + x] === 3) shore = true; } if (!shore) continue; }
      sc -= dd * (otherIsland ? 0.15 : 0.3);
      if (sc > bs) { bs = sc; best = [i + 2, j + 2]; }
    }
    return best && bs > (otherIsland ? 2 : 6) ? best : null;
  }
  // islands: a transport takes settlers (and a small escort) to another island and they raise a Town Center there
  startColony(site, vils) {
    const W = this.W, ship = this.m.units.find(u => u.type === 'transport_ship' && !u.order && !u.cargo.length && !(this.inv && this.inv.ships.includes(u.id)));
    if (!ship) { const dk = this.m.bld.find(b => b.type === 'dock' && b.built && !b.queue.length); if (dk && this.afford(UNITS.transport_ship.cost)) command(W, { t: 'train', pid: this.pid, bid: dk.id, type: 'transport_ship' }); return; }
    const settlers = vils.filter(v => !v.inside && (!v.order || !['build', 'repair', 'board'].includes(v.order.t))).slice(0, 5);
    const escort = this.m.units.filter(u => MILITARY(u.type) && !u.nav && !(this.guard && this.guard.has(u.id)) && !this.onWatch(u.id) && (!u.order || u.order.amove)).slice(0, 3);
    if (settlers.length < 4) return;
    this.colony = { ship: ship.id, settlers: settlers.map(u => u.id), escort: escort.map(u => u.id), site, state: 'board', t: W.t };
    W.ev.push({ k: 'colony', owner: this.pid, x: site[0], y: site[1] });
  }
  colonyTick() {
    const W = this.W, c = this.colony, ship = alive(W, c.ship);
    if (!ship || W.t - c.t > 300) { this.colony = null; return; }
    const ids = [...c.settlers, ...c.escort];
    if (c.state === 'board') {
      if (!c.parked) { c.parked = true; const p = this.coast(this.base); if (p) command(W, { t: 'move', pid: this.pid, ids: [ship.id], x: p[0], y: p[1] }); }
      const ashore = ids.map(id => W.ents.get(id)).filter(u => u && u.kind === 'unit');
      for (const u of ashore) if (!u.order || u.order.t !== 'board') command(W, { t: 'smart', pid: this.pid, ids: [u.id], target: ship.id, x: ship.x, y: ship.y });
      if (!ashore.length || W.t - c.t > 80) { c.state = 'sail'; if (ship.cargo.length) command(W, { t: 'unload', pid: this.pid, ids: [ship.id], x: c.site[0], y: c.site[1] }); else { this.colony = null; } }
      return;
    }
    if (c.state === 'sail') { if (!ship.cargo.length) { c.state = 'build'; c.t2 = W.t; } return; }
    if (c.state === 'build') {
      const vs = c.settlers.map(id => W.ents.get(id)).filter(u => u && u.kind === 'unit');
      if (!vs.length) { this.colony = null; return; }
      // a spot by the landing for the Town Center, then a dock
      let spot = null; const [sx, sy] = c.site;
      for (let r = 0; r < 10 && !spot; r++) for (let a = 0; a < Math.max(1, r * 8) && !spot; a++) { const i = Math.round(sx - 2 + Math.cos(a / Math.max(1, r * 8) * 6.28) * r), j = Math.round(sy - 2 + Math.sin(a / Math.max(1, r * 8) * 6.28) * r); if (placementOk(W, this.pid, 'town_center', i, j) && regionAt(W, i + 2, j + 5) === regionAt(W, vs[0].x, vs[0].y)) spot = [i, j]; }
      if (spot && canAfford(this.P, costOf(this.P, 'town_center'))) { command(W, { t: 'place', pid: this.pid, type: 'town_center', i: spot[0], j: spot[1], ids: vs.map(u => u.id) }); W.ev.push({ k: 'colonyland', owner: this.pid, x: spot[0] + 2, y: spot[1] + 2 }); }
      const esc = c.escort.map(id => W.ents.get(id)).filter(u => u && u.kind === 'unit');
      if (esc.length) command(W, { t: 'move', pid: this.pid, ids: esc.map(u => u.id), x: sx, y: sy, amove: true });
      this.colony = null; this.tcT = W.t + 300;
    }
  }
  // the nearest land on another landmass (an unexplored part preferred) — where an army goes looking for the enemy
  otherLand() {
    const W = this.W, S = W.size, [bx, by] = this.base, home = regionAt(W, bx, by + 3);
    let best = null, bs = 1e9;
    for (let j = 3; j < S - 3; j += 5) for (let i = 3; i < S - 3; i += 5) {
      if (W.terrain[j * S + i] === 3 || !passable(W, i, j, this.pid)) continue;
      const rg = regionAt(W, i + 0.5, j + 0.5); if (!rg || rg === home) continue;
      if (W.t - (this.landTried?.get(rg) ?? -1e9) < 600) continue;
      const sc = Math.hypot(i - bx, j - by) - (this.P.exp[j * S + i] ? 0 : 25);
      if (sc < bs) { bs = sc; best = [i + 0.5, j + 0.5, rg]; }
    }
    if (best) (this.landTried ||= new Map()).set(best[2], W.t);
    return best && [best[0], best[1]];
  }
  // allies help each other: spare resources to a starving ally every few minutes
  diplomacy(P) {
    const W = this.W; if (W.t < (this.dipT || 120)) return; this.dipT = W.t + 150;
    for (const Q of W.players) if (Q !== P && Q.alive && Q.team === P.team) for (const r of ['food', 'wood', 'gold', 'stone']) if (Q.res[r] < 100 && P.res[r] > 1000) { command(W, { t: 'tribute', pid: this.pid, to: Q.id, res: r, n: 300 }); return; }
  }
  // king of the hill: take and hold the monument
  koth(idle) {
    const W = this.W, m = W.monument; if (!m || W.opts.victory !== 'koth' || this.P.age < 2 || idle.length < 4) return false;
    if (m.team === this.P.team && W.t - (this.kothT || 0) < 40) return false;
    this.kothT = W.t; command(W, { t: 'move', pid: this.pid, ids: idle.map(u => u.id), x: m.x, y: m.y + 3, amove: true }); return true;
  }
  relicsSeen() { const W = this.W; for (const e of W.dyn.values()) if (e.kind === 'relic' && !e.inBld && this.P.exp[idx(W, Math.floor(e.x), Math.floor(e.y))]) return true; return false; }
  // monks: fetch the relics we have seen, bring carried ones home, convert valuable enemies near them
  monks() {
    const W = this.W, P = this.P; if (W.t < (this.monkT || 0)) return; this.monkT = W.t + 2;
    const mon = this.m.bld.find(b => b.type === 'monastery' && b.built); if (!mon) return;
    const monks = this.m.units.filter(u => u.type === 'monk');
    const free = [...W.dyn.values()].filter(e => e.kind === 'relic' && !e.carrier && !e.inBld && P.exp[idx(W, Math.floor(e.x), Math.floor(e.y))]);
    const want = Math.min(6, Math.min(3, free.length) + (P.age >= 3 ? 2 : 1));
    if (monks.length < want && !mon.queue.length && this.afford(unitCost(P, 'monk')) && P.res.gold >= 160) command(W, { t: 'train', pid: this.pid, bid: mon.id, type: 'monk' });
    const taken = new Set(monks.filter(m => m.order && m.order.t === 'relic').map(m => m.order.id));
    for (const m of monks) {
      if (m.relic) { if (!m.order || m.order.t !== 'relic') command(W, { t: 'smart', pid: this.pid, ids: [m.id], target: mon.id }); continue; }
      if (m.order && m.order.t !== 'heal') continue;
      const r = free.filter(e => !taken.has(e.id) && !this.threatNear(e.x, e.y, 8)).sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))[0];
      if (r) { taken.add(r.id); command(W, { t: 'smart', pid: this.pid, ids: [m.id], target: r.id }); continue; }
      if (m.faith >= 1) {      // conversion: the priciest enemy soldier in sight close to the monk
        let best = null, bv = 99;
        for (const e of W.dyn.values()) {
          if (e.kind !== 'unit' || e.owner < 0 || pl(W, e.owner).team === P.team || !MILITARY(e.type) || e.type === 'monk' || UNITS[e.type].naval || UNITS[e.type].cls === 'siege') continue;
          if (Math.hypot(e.x - m.x, e.y - m.y) > 12 || !P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) continue;
          const v = Object.values(UNITS[e.type].cost).reduce((a, b) => a + b, 0); if (v > bv) { bv = v; best = e; }
        }
        if (best) command(W, { t: 'smart', pid: this.pid, ids: [m.id], target: best.id });
      }
    }
  }
  // town bell: an enemy army at the gates and too few defenders -> villagers into the shelters (they shoot from there)
  townBell(army) {
    const W = this.W, P = this.P; if (W.t < (this.bellT || 0)) return; this.bellT = W.t + 2;
    const [bx, by] = this.base; let foes = 0;
    for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner >= 0 && pl(W, e.owner).team !== P.team && MILITARY(e.type) && !UNITS[e.type].naval && Math.hypot(e.x - bx, e.y - by) < 14 && P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) foes++;
    const def = army.filter(u => Math.hypot(u.x - bx, u.y - by) < 18).length;
    if (!P.bell && foes >= 5 && foes > def * 1.5 && W.t - (this.bellOff ?? -999) > 120) { command(W, { t: 'bell', pid: this.pid, on: true }); this.bellOn = W.t; }
    else if (P.bell && ((foes === 0 && W.t - this.bellOn > 10) || W.t - this.bellOn > 60)) { command(W, { t: 'bell', pid: this.pid, on: false }); this.bellOff = W.t; }   // short: the economy must go on
  }
  planFeudal() { return this.P.techs.has('loom') === false && this.m.units.length > 14; }
  threatNear(x, y, r) {
    const W = this.W;
    for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner >= 0 && e.owner !== this.pid && pl(W, e.owner).team !== this.P.team && MILITARY(e.type) && Math.hypot(e.x - x, e.y - y) < r && this.P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) return e;
    return null;
  }
  // ---------------------------------------------------------------- the war commander (Komandan Perang)
  // From the Castle Age (or once the field army is big) the army stops raiding whichever border building is nearest and
  // fights a campaign: the commander picks one enemy kingdom (the weakest it knows, near ones first), musters at a
  // staging point, marches on one of that kingdom's towns, razes it building by building (towers and the Town Center
  // first) and moves straight on to the next town until the kingdom falls. New soldiers reinforce the army where it
  // stands; it falls back only when it is broken. Every turn of the war is told as a 'war' event (W.chron, the chronicle).
  inWar(id) { return !!(this.war && this.war.units.has(id)); }
  tell(kind, text, x, y, foe = this.war ? this.war.foe : -1) {
    const W = this.W;
    W.ev.push({ k: 'war', kind, owner: this.pid, foe, text, x, y });
    (W.chron || (W.chron = [])).push({ t: W.t, kind, owner: this.pid, foe, text });
  }
  // the enemy's land army as far as we know: what we have seen lately, at least a share of its population
  foeArmy(q) {
    const W = this.W; let n = 0;
    for (const f of this.foes.values()) if (f.owner === q && !f.nav && MILITARY(f.type) && W.t - f.t < 150) n++;
    return Math.max(n, Math.round(W.players[q].pop * 0.3));
  }
  // the towns of one kingdom we know of: its Town Centres with the known buildings round them (outlying buildings make
  // settlements of their own). Only towns our army can walk to.
  takeable(id, k) {
    const W = this.W;
    if (k.type === 'farm' || BUILDINGS[k.type].water || this.overSea([k.x, k.y])) return false;
    if (this.P.vis[idx(W, Math.floor(k.x), Math.floor(k.y))]) { const e = W.ents.get(id); if (!e || !targetable(e)) return false; }     // in sight we know better
    return true;
  }
  cities(foe) {
    const W = this.W, ks = [...this.known.entries()].filter(([id, k]) => k.owner === foe && this.takeable(id, k));
    const out = ks.filter(([, k]) => k.type === 'town_center').map(([id, k]) => ({ id, x: k.x, y: k.y, n: 0, tc: true }));
    for (const [id, k] of ks) {
      let c = null, cd = 22; for (const o of out) { const d = Math.hypot(o.x - k.x, o.y - k.y); if (d < cd) { cd = d; c = o; } }
      if (!c) { c = { id, x: k.x, y: k.y, n: 0, tc: false }; out.push(c); }
      c.n++;
    }
    const Q = W.players[foe];
    for (const c of out) { c.cap = c.tc && Q.tc === c.id; c.name = c.cap ? `Ibu Kota ${Q.name}` : `${c.tc ? 'Kota' : 'Desa'} ${TOWNS[c.id % TOWNS.length]}`; }
    return out;
  }
  // where our army comes from: the forward camp, else the town nearest to the target
  origin(c) {
    if (this.fwd) return this.fwd;
    let best = this.base, bd = 1e9;
    for (const t of this.tcs || []) { const d = Math.hypot(t.x + 2 - c.x, t.y + 2 - c.y); if (d < bd) { bd = d; best = [t.x + 2, t.y + 2]; } }
    return best;
  }
  // the next town to take: near ones first; Town Centres and the capital weigh more than outlying camps
  pickCity(foe) {
    let best = null, bs = 1e9;
    for (const c of this.cities(foe)) {
      const [ox, oy] = this.origin(c);
      const sc = Math.hypot(c.x - ox, c.y - oy) - Math.min(20, c.n * 1.5) - (c.tc ? 10 : 0) - (c.cap ? 14 : 0);
      if (sc < bs) { bs = sc; best = c; }
    }
    return best;
  }
  // the kingdom to fight: weak and near first
  pickFoe() {
    const W = this.W; let best = null, bs = 1e9;
    for (const Q of W.players) {
      if (!Q.alive || Q.team === this.P.team) continue;
      const c = this.pickCity(Q.id); if (!c) continue;
      const [ox, oy] = this.origin(c), sc = this.foeArmy(Q.id) * 1.2 + Math.hypot(c.x - ox, c.y - oy) * 0.3 + Q.pop * 0.1 - Math.min(40, ((this.grudge || {})[Q.id] || 0) * 2);      // (revenge first)
      if (sc < bs) { bs = sc; best = { foe: Q.id, city: c }; }
    }
    return best;
  }
  stagePoint(c) {
    const [ox, oy] = this.origin(c), d = Math.hypot(c.x - ox, c.y - oy) || 1, k = Math.min(14, d * 0.3);
    const f = nearestFree(this.W, ox + (c.x - ox) / d * k, oy + (c.y - oy) / d * k, this.pid, 6);
    return f ? [f[0] + 0.5, f[1] + 0.5] : [ox, oy];
  }
  warNeed(foe) {
    const minN = Math.min(this.D.wave + 3, Math.max(6, Math.round(this.armyCap * 0.5)));
    return this.ahead ? minN : Math.max(minN, Math.min(Math.round(this.foeArmy(foe) * 1.1), Math.round(this.armyCap * 0.6)));
  }
  // A wonder decides the game in ten minutes. An enemy wonder becomes the target of the whole campaign at once (a short
  // muster, then straight at it); our own wonder is guarded by the field army until it wins.
  wonders(field, war) {
    const W = this.W, P = this.P; if (!W.wonders || !W.wonders.size || (W.opts.treaty && W.t < W.opts.treaty)) return false;
    let mine = null, foe = null, ft = 1e9;
    for (const [id, t0] of W.wonders) {
      const b = alive(W, id); if (!b) continue;
      if (b.owner === this.pid) mine = b;
      else if (W.players[b.owner].team !== P.team && t0 < ft && !this.overSea([b.x + b.w / 2, b.y + b.h / 2])) { ft = t0; foe = b; }
    }
    if (foe) {
      if (war && war.city.wonder === foe.id) return false;           // already on it: the campaign runs as usual
      const Q = W.players[foe.owner], c = { id: foe.id, x: foe.x + foe.w / 2, y: foe.y + foe.h / 2, n: 1, tc: false, wonder: foe.id, name: `Keajaiban Dunia ${Q.name}` };
      if (!war) { war = this.war = { foe: Q.id, city: c, phase: 'kumpul', t: W.t, units: new Set(), razed: 0, peak: 0, fails: 0, reT: 0 }; war.stage = this.stagePoint(c); }
      else {
        if (war.foe !== Q.id) war.razed = 0;
        war.foe = Q.id; war.city = c; war.fails = 0; war.stage = this.stagePoint(c);
        if (war.phase !== 'pulang' && war.phase !== 'kumpul') { war.phase = 'maju'; war.t = W.t; const mem = [...war.units].map(id => W.ents.get(id)).filter(u => u && !u.inside); if (mem.length) command(W, { t: 'move', pid: this.pid, ids: mem.map(u => u.id), x: c.x, y: c.y, amove: true }); }
      }
      this.tell('wonder', `Keajaiban Dunia ${Q.name} harus runtuh sebelum waktunya habis! Panglima ${P.name} mengerahkan seluruh pasukan ke sana.`, c.x, c.y, Q.id);
      return false;
    }
    if (!mine) { this.holdT = 0; return false; }
    // our wonder stands: no new campaigns; the field army (and an army still mustering) guards it
    if (war && war.phase === 'kumpul') { war.units.clear(); this.war = null; }
    if (this.war) return false;
    const cx = mine.x + mine.w / 2, cy = mine.y + mine.h / 2;
    if (!this.holdT) { this.holdT = W.t; this.tell('hold', `Keajaiban Dunia ${P.name} berdiri! Panglima memerintahkan seluruh pasukan berjaga di sekelilingnya sampai kemenangan tiba.`, cx, cy, -1); }
    const idle = field.filter(u => u.id !== this.explorer && !u.order && Math.hypot(u.x - cx, u.y - cy) > 10);
    if (idle.length) { const pts = townRing(W, this.pid, 11, 8, mine); if (pts.length >= 3) command(W, { t: 'patrol', pid: this.pid, ids: idle.map(u => u.id), pts, guard: true }); else command(W, { t: 'move', pid: this.pid, ids: idle.map(u => u.id), x: cx, y: cy + 6, amove: true }); }
    return true;
  }
  breach(u) {
    const W = this.W, r = 14, ci = Math.floor(u.x), cj = Math.floor(u.y); let best = null, bd = 1e9;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (i < 0 || j < 0 || i >= W.size || j >= W.size) continue;
      const o = W.occ[idx(W, i, j)]; if (!o) continue; const e = W.ents.get(o);
      if (!e || e.kind !== 'building' || e.owner !== this.war.foe || !(BUILDINGS[e.type].wall || BUILDINGS[e.type].gate) || !targetable(e) || unreachable(W, e.id, this.pid) || !this.P.vis[idx(W, i, j)]) continue;
      const d = Math.hypot(i + 0.5 - u.x, j + 0.5 - u.y); if (d < bd) { bd = d; best = e.id; }
    }
    return best;
  }
  endWar(rest = 30) { this.war = null; this.peaceT = this.W.t + rest; }
  warStatus() {
    const w = this.war, W = this.W;
    if (!w) return this.stance === 'bertahan' ? `Bertahan — pasukan berjaga di perbatasan menghadapi ${this.stanceFoe >= 0 ? W.players[this.stanceFoe].name : 'musuh'}` : W.t < (this.peaceT || 0) ? 'Memulihkan pasukan setelah perang' : 'Membangun kekuatan';
    const Q = W.players[w.foe].name, n = w.units.size, c = w.city.name;
    return { kumpul: `Perang melawan ${Q} — mengumpulkan ${n} prajurit, sasaran ${c}`, maju: `Perang melawan ${Q} — ${n} prajurit berbaris menuju ${c}`, kepung: `Perang melawan ${Q} — ${n} prajurit mengepung ${c}`,
      buru: `Perang melawan ${Q} — ${n} prajurit memburu sisa kerajaannya`, bela: `Perang melawan ${Q} — ${n} prajurit pulang membela kota yang diserang`, mundur: `Perang melawan ${Q} — pasukan mundur dan berkumpul lagi`, pulang: `Perang melawan ${Q} — pasukan pulang mempertahankan kota` }[w.phase]
      + (w.razed ? ` · ${w.razed} kota direbut` : '');
  }
  commander(field, threat, firstAttack) {
    const W = this.W, P = this.P;
    if (W.t < (this.cmdT || 0)) return !!this.war;
    this.cmdT = W.t + 2;
    let war = this.war;
    if (war) {
      for (const id of war.units) if (!W.ents.has(id)) war.units.delete(id);
      const Q = W.players[war.foe];
      if (!Q.alive) {
        if (war.razed) this.tell('conquer', `Kerajaan ${Q.name} runtuh di bawah pasukan ${P.name}! ${war.razed} kota direbut dalam perang ini.`, war.city.x, war.city.y);      // the ones who took its towns get the credit
        this.endWar(); return false;
      }
    }
    this.guardTowns(field); this.posture();
    if (this.wonders(field, war)) return true;
    this.counterTick(field);
    war = this.war;
    if (war && this.stance === 'bertahan' && war.phase === 'kumpul' && !war.counter && !war.city.wonder) { war.units.clear(); this.war = war = null; }     // no new campaigns while holding
    if (!war && this.stance === 'bertahan') { this.holdFront(field); return true; }
    if (!war) {
      const peace = W.opts.treaty && W.t < W.opts.treaty;
      if (peace || threat || this.inv || W.t < firstAttack || W.t < (this.peaceT || 0) || !(P.age >= 3 || field.length >= 18 || this.ahead)) return false;
      const pick = this.pickFoe(); if (!pick) return false;
      war = this.war = { foe: pick.foe, city: pick.city, phase: 'kumpul', t: W.t, units: new Set(), razed: 0, peak: 0, fails: 0, reT: 0 };
      war.stage = this.stagePoint(pick.city);
      this.tell('declare', `${P.name} menyatakan perang terhadap ${W.players[pick.foe].name}! Panglima mengumpulkan pasukan untuk menyerbu ${pick.city.name}.`, war.stage[0], war.stage[1]);
    }
    const Q = W.players[war.foe], ids = (us) => us.map(u => u.id);
    const go = (us, x, y, amove = true) => { if (us.length) command(W, { t: 'move', pid: this.pid, ids: ids(us), x, y, amove }); };
    // soldiers of the field army who are free join the campaign (monks keep their own work)
    const fresh = field.filter(u => !war.units.has(u.id) && u.id !== this.explorer && !stat(W, u.owner, u.type).convert && (!u.order || u.order.amove || u.order.t === 'patrol'));
    let mem = [...war.units].map(id => W.ents.get(id)).filter(u => u && !u.inside);
    const cx = mem.length ? mem.reduce((a, u) => a + u.x, 0) / mem.length : war.stage[0], cy = mem.length ? mem.reduce((a, u) => a + u.y, 0) / mem.length : war.stage[1];
    // the town still standing: the known buildings of the target round its centre
    const targets = [...this.known.entries()].filter(([id, k]) => k.owner === war.foe && Math.hypot(k.x - war.city.x, k.y - war.city.y) < 22 && this.takeable(id, k));
    if (war.phase === 'bela') {          // back home defending a town; when it is safe: muster again (a counter-attack may follow)
      const d = war.def, h = this.hitTowns && this.hitTowns.get(d.id);
      if (!h || W.t - h.t > 12 || !W.ents.has(d.id)) { war.phase = 'kumpul'; war.t = W.t; war.stage = this.stagePoint(war.city); return true; }
      go(mem.filter(u => !u.order && Math.hypot(u.x - d.x, u.y - d.y) > 10), d.x, d.y + 3);
      return true;
    }
    if (war.phase === 'pulang') {
      if (!threat && W.t - war.t > 15) { war.phase = 'kumpul'; war.t = W.t; }
      return true;
    }
    if (!targets.length && war.phase !== 'buru' && war.phase !== 'mundur') {       // the town is gone: on to the next one
      if (war.phase === 'kepung') { war.razed++; this.tell('fall', `${war.city.name}${war.city.cap ? '' : ` milik ${Q.name}`} jatuh! Pasukan ${P.name} membumihanguskannya.`, war.city.x, war.city.y); }
      const next = this.pickCity(war.foe), was = war.phase;
      if (!next) { war.phase = 'buru'; war.t = W.t; war.huntT = 0; this.tell('hunt', `Tak ada lagi kota ${Q.name} yang diketahui — pasukan ${P.name} menyisir wilayahnya mencari sisa-sisanya.`, cx, cy); return true; }
      war.city = next;
      if (was === 'kepung' && mem.length >= 5) { war.phase = 'maju'; war.t = W.t; go(mem, next.x, next.y); this.tell('next', `Tanpa berhenti, ${mem.length} prajurit ${P.name} bergerak ke ${next.name}.`, cx, cy); }
      else if (was === 'kumpul') war.stage = this.stagePoint(next);
      else if (was === 'maju') go(mem, next.x, next.y);
      return true;
    }
    if (war.phase === 'kumpul') {
      for (const u of fresh) war.units.add(u.id);
      mem = [...war.units].map(id => W.ents.get(id)).filter(u => u && !u.inside);
      const [sx, sy] = war.stage, near = mem.filter(u => Math.hypot(u.x - sx, u.y - sy) < 12);
      go(mem.filter(u => (!u.order || fresh.includes(u)) && Math.hypot(u.x - sx, u.y - sy) >= 7), sx, sy);
      const need = war.city.wonder ? Math.min(8, this.warNeed(war.foe)) : this.warNeed(war.foe), wait = W.t - war.t;
      if (near.length >= need || (war.city.wonder && wait > 40 && near.length >= 4) || (war.counter && wait > 30 && near.length >= 6) || (mem.length >= this.armyCap * 0.75 && near.length >= mem.length * 0.7) || (wait > 150 && near.length >= Math.min(need, 10)) || (wait > 300 && near.length >= 5)) {
        war.phase = 'maju'; war.t = W.t; war.peak = mem.length;
        const form = this.formationFor(mem); command(W, { t: 'form', pid: this.pid, ids: ids(mem), f: form });
        command(W, { t: 'move', pid: this.pid, ids: ids(mem), x: war.city.x, y: war.city.y, amove: true, form });
        const treb = mem.filter(u => UNITS[u.type].packs); if (treb.length && targets[0]) command(W, { t: 'smart', pid: this.pid, ids: ids(treb), target: targets[0][0] });
        this.tell('march', `${mem.length} prajurit ${P.name} berangkat menyerbu ${war.city.name}!`, sx, sy);
      } else if (wait > 300 && mem.length < 5) { war.units.clear(); this.endWar(60); }
      return true;
    }
    // new soldiers march out to the army where it stands (in small groups)
    if (fresh.length >= 3 || (fresh.length && W.t - war.reT > 20)) {
      war.reT = W.t; for (const u of fresh) war.units.add(u.id);
      if (mem.length) go(fresh, cx, cy); else go(fresh, war.city.x, war.city.y);
      war.peak = Math.max(war.peak, war.units.size);
    }
    // broken: too few left against the enemy round them -> fall back to the staging point and muster again
    if ((war.phase === 'maju' || war.phase === 'kepung') && mem.length < Math.max(4, war.peak * 0.3)) {
      let foes = 0; for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner === war.foe && MILITARY(e.type) && !e.nav && Math.hypot(e.x - cx, e.y - cy) < 16 && P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) foes++;
      if (foes > mem.length) {
        war.fails++; war.phase = 'mundur'; war.t = W.t; war.stage = this.stagePoint(war.city); go(mem, war.stage[0], war.stage[1], false);
        if (war.fails >= 3) { this.tell('truce', `Setelah tiga kali dipukul mundur, ${P.name} menghentikan perang melawan ${Q.name} untuk sementara.`, cx, cy); war.units.clear(); this.endWar(240); }
        else this.tell('retreat', `Pasukan ${P.name} dipukul mundur dari ${war.city.name}! Sisa ${mem.length} prajurit kembali untuk berkumpul lagi.`, cx, cy);
        return true;
      }
    }
    if (war.phase === 'mundur') { if (W.t - war.t > 25) { war.phase = 'kumpul'; war.t = W.t; } return true; }
    if (war.phase === 'buru') {       // no town known: comb the enemy's land, follow the latest sightings
      const c = this.pickCity(war.foe);
      if (c) { war.city = c; war.phase = 'maju'; war.t = W.t; go(mem, c.x, c.y); this.tell('found', `Pengintai menemukan ${c.name} — pasukan ${P.name} segera menyerbu.`, c.x, c.y); return true; }
      if (W.t - war.t > 360) { this.tell('truce', `Sisa-sisa ${Q.name} bersembunyi; pasukan ${P.name} pulang.`, cx, cy); war.units.clear(); this.endWar(60); return true; }
      if (W.t > war.huntT) {
        war.huntT = W.t + 25;
        let g = null, lt = -1; for (const f of this.foes.values()) if (f.owner === war.foe && !f.nav && f.t > lt && !this.overSea([f.x, f.y])) { lt = f.t; g = [f.x, f.y]; }
        g = g || this.exploreTarget(cx, cy, true) || this.staleTarget(cx, cy);
        if (g) go(mem.filter(u => !u.order || u.order.amove), g[0], g[1]);
      }
      return true;
    }
    const tx = war.city.x, ty = war.city.y;
    if (war.phase === 'maju') {
      go(mem.filter(u => !u.order && Math.hypot(u.x - tx, u.y - ty) > 12), tx, ty);       // stragglers catch up
      if (Math.hypot(cx - tx, cy - ty) < 16 || mem.filter(u => Math.hypot(u.x - tx, u.y - ty) < 18).length >= mem.length * 0.4) {
        war.phase = 'kepung'; war.t = W.t;
        this.tell('siege', `Pasukan ${P.name} tiba di gerbang ${war.city.name}. Pengepungan dimulai!`, tx, ty);
      }
      return true;
    }
    // siege: towers and castles first, then the Town Center, the barracks and the rest; the idle pick the best target
    const prio = (k) => k.type === 'wonder' ? -1 : BUILDINGS[k.type].attack ? 0 : k.type === 'town_center' ? 1 : BUILDINGS[k.type].trains ? 2 : 3;
    const orders = new Map();
    for (const u of mem) {
      if (u.order) continue;
      if (Math.hypot(u.x - tx, u.y - ty) > 30) { go([u], tx, ty); continue; }
      const st = stat(W, u.owner, u.type);
      if (st.heal || !st.atk) { go([u], cx, cy, false); continue; }
      const siege = UNITS[u.type].packs || st.cls === 'siege';
      let best = null, bs = 1e9;
      for (const [id, k] of targets) { const sc = prio(k) * (siege ? 30 : 12) + Math.hypot(k.x - u.x, k.y - u.y); if (sc < bs) { bs = sc; best = id; } }
      // walled in (our soldiers can't find a way to it): break through the nearest stretch of wall or gate first
      if (best && unreachable(W, best, this.pid)) best = this.breach(u) || best;
      if (best) { if (!orders.has(best)) orders.set(best, []); orders.get(best).push(u.id); }
    }
    for (const [id, us] of orders) { const k = this.known.get(id) || W.ents.get(id); if (k) command(W, { t: 'smart', pid: this.pid, ids: us, target: id, x: k.x, y: k.y }); }     // (a wall being breached is not in `known`)
    return true;
  }
  // ---------------------------------------------------------------- the commander's defence
  // Every town is watched (not only the capital): free soldiers ride to a town under attack, and the campaign army comes
  // back to it ('bela') when the attack is too big for the town. A big attack beaten off makes the attacker the next
  // target (counter-attack), and kingdoms that attack us are remembered (grudge). A kingdom clearly weaker than its
  // strongest enemy goes on the defensive: no new campaigns, more towers, the army standing by on the border.
  townName(t) { return t.id === this.P.tc ? `Ibu Kota ${this.P.name}` : `Kota ${TOWNS[t.id % TOWNS.length]}`; }
  townThreats() {
    const W = this.W, P = this.P, towns = (this.tcs || []).map(t => ({ t, x: t.x + 2, y: t.y + 2, p: 0, by: {}, own: 0 }));
    if (!towns.length) return towns;
    const near = (e) => { let best = null, bd = 20; for (const c of towns) { const d = Math.hypot(e.x - c.x, e.y - c.y); if (d < bd) { bd = d; best = c; } } return best; };
    for (const e of W.dyn.values()) {
      if (e.kind !== 'unit' || e.owner < 0 || e.nav || e.inside || !MILITARY(e.type)) continue;
      if (e.owner === this.pid) { const c = near(e); if (c) c.own++; continue; }
      if (W.players[e.owner].team === P.team || !P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) continue;
      const c = near(e); if (!c) continue;
      const d = UNITS[e.type]; c.p += d.cls === 'siege' ? 2.5 : d.cls === 'cavalry' ? 1.5 : 1; c.by[e.owner] = (c.by[e.owner] || 0) + 1;
    }
    for (const b of this.m.bld) if (b.built && (BUILDINGS[b.type].attack || b.type === 'town_center')) { const c = near({ x: b.x + b.w / 2, y: b.y + b.h / 2 }); if (c) c.own += 1.5; }
    return towns;
  }
  guardTowns(field) {
    const W = this.W, P = this.P, towns = this.townThreats(), war = this.war;
    const G = this.grudge || (this.grudge = {}), hit = this.hitTowns || (this.hitTowns = new Map());
    for (const k in G) G[k] *= 0.995;
    let worst = null;
    for (const c of towns) {
      if (c.p < 3) continue;
      c.foe = +Object.keys(c.by).sort((a, b) => c.by[b] - c.by[a])[0];
      G[c.foe] = (G[c.foe] || 0) + c.p * 0.05;
      const h = hit.get(c.t.id) || { peak: 0 }; h.peak = Math.max(h.peak, c.p); h.by = c.foe; h.t = W.t; hit.set(c.t.id, h);
      if (c.t !== this.tc && (!worst || c.p > worst.p)) worst = c;        // (the capital has its own defence: defend())
    }
    // attacks beaten off: a big one makes the attacker the next target
    for (const [id, h] of hit) if (W.t - h.t > 12) {
      hit.delete(id);
      const t = W.ents.get(id);
      const told = this.repelT || (this.repelT = {});
      if (t && h.peak >= 6 && W.players[h.by].alive && W.t - (told[id] || -999) > 150) { told[id] = W.t; this.counter = { foe: h.by, t: W.t }; this.tell('repel', `Serangan ${W.players[h.by].name} di ${this.townName(t)} berhasil dipatahkan!`, t.x + 2, t.y + 2, h.by); }
    }
    if (!worst) return;
    const Q = W.players[worst.foe], name = this.townName(worst.t), go = (us) => { if (us.length) command(W, { t: 'move', pid: this.pid, ids: us.map(u => u.id), x: worst.x, y: worst.y + 3, amove: true }); };
    const free = field.filter(u => !this.inWar(u.id) && u.id !== this.explorer && (!u.order || u.order.amove || u.order.t === 'patrol') && Math.hypot(u.x - worst.x, u.y - worst.y) > 8 && Math.hypot(u.x - worst.x, u.y - worst.y) < 90)
      .sort((a, b) => Math.hypot(a.x - worst.x, a.y - worst.y) - Math.hypot(b.x - worst.x, b.y - worst.y)).slice(0, Math.ceil(worst.p * 1.5) + 2);
    go(free);
    if (war && !['bela', 'pulang'].includes(war.phase) && !war.city.wonder && worst.p >= 6 && worst.p > (worst.own + free.length) * 1.1) {
      const mem = [...war.units].map(id => W.ents.get(id)).filter(u => u && !u.inside);
      war.phase = 'bela'; war.t = W.t; war.def = { id: worst.t.id, x: worst.x, y: worst.y }; go(mem); (this.alarmT || (this.alarmT = {}))[worst.t.id] = W.t;
      this.tell('defend', `${name} diserang ${Q.name}! Panglima ${P.name} membawa ${mem.length} prajurit pulang untuk membelanya.`, worst.x, worst.y, Q.id);
    } else if (worst.p >= 5 && free.length && W.t - ((this.alarmT || {})[worst.t.id] || -999) > 150) {
      (this.alarmT || (this.alarmT = {}))[worst.t.id] = W.t;
      this.tell('alarm', `${name} diserang ${Q.name}! ${free.length} prajurit dikirim membantu penjaga kota.`, worst.x, worst.y, Q.id);
    }
  }
  // attack or hold: weighed against the strongest enemy we know of
  posture() {
    const W = this.W, P = this.P; if (W.t < (this.postT || 0)) return; this.postT = W.t + 10;
    const mine = this.m.units.filter(u => MILITARY(u.type) && !u.nav && !UNITS[u.type].hero && !UNITS[u.type].trade).length;
    let top = 0, foe = -1;
    for (const Q of W.players) if (Q.alive && Q.team !== P.team && (this.cities(Q.id).length || [...this.foes.values()].some(f => f.owner === Q.id))) { const a = this.foeArmy(Q.id); if (a > top) { top = a; foe = Q.id; } }
    this.stanceFoe = foe;
    const r = mine / Math.max(1, top);
    if (this.stance !== 'bertahan' && top >= 12 && r < 0.6 && P.age >= 2) {
      this.stance = 'bertahan';
      this.tell('posture', `Panglima ${P.name} memilih bertahan: pasukan ${W.players[foe].name} (±${top}) jauh lebih besar dari ${mine} prajurit kita. Menara didirikan dan pasukan berjaga di perbatasan.`, this.base[0], this.base[1], foe);
    } else if (this.stance === 'bertahan' && (r >= 0.95 || top < 8)) {
      this.stance = 'serang';
      this.tell('posture', `Pasukan ${P.name} kembali kuat (${mine} prajurit) — Panglima bersiap menyerang lagi.`, this.base[0], this.base[1], foe);
    }
  }
  // on the defensive: the field army stands by on the border facing the strongest enemy
  holdFront(field) {
    const W = this.W; if (W.t < (this.frontT || 0)) return; this.frontT = W.t + 15;
    const c = this.stanceFoe >= 0 ? this.pickCity(this.stanceFoe) : null; if (!c) return;
    const [fx, fy] = this.stagePoint(c);
    const idle = field.filter(u => u.id !== this.explorer && !this.inWar(u.id) && !u.order && Math.hypot(u.x - fx, u.y - fy) > 8);
    if (idle.length) command(W, { t: 'move', pid: this.pid, ids: idle.map(u => u.id), x: fx, y: fy, amove: true });
  }
  // a beaten-off attack: strike back at once at the attacker's nearest town, with what is at hand
  counterTick(field) {
    const W = this.W, P = this.P, c0 = this.counter; if (!c0) return;
    this.counter = null;
    if (W.t - c0.t > 90 || !W.players[c0.foe].alive || (W.opts.treaty && W.t < W.opts.treaty) || field.length < 6) return;
    let war = this.war;
    if (war && (war.phase !== 'kumpul' || war.foe === c0.foe || war.city.wonder)) return;
    const c = this.pickCity(c0.foe); if (!c) return;
    if (!war) war = this.war = { foe: c0.foe, city: c, phase: 'kumpul', t: W.t, units: new Set(), razed: 0, peak: 0, fails: 0, reT: 0 };
    else { war.foe = c0.foe; war.city = c; war.razed = 0; war.fails = 0; war.t = W.t; }
    war.counter = true; war.stage = this.stagePoint(c);
    this.tell('counter', `Selagi pasukan ${W.players[c0.foe].name} lemah, ${P.name} melancarkan serangan balik ke ${c.name}!`, war.stage[0], war.stage[1], c0.foe);
  }
  // ---------------------------------------------------------------- the town watch
  // A share of the army (more for defensive personalities, more after being raided) is kept at home. It walks the
  // rounds between guard posts round the Town Center and meets raiders first. The field army only turns back when the
  // attackers are clearly stronger than the watch and the towers; otherwise it carries on with its own campaign.
  homeGuard(army, threat) {
    const W = this.W, [bx, by] = this.base;
    const G = this.guard = this.guard || new Set();
    for (const id of G) if (!W.ents.has(id)) G.delete(id);
    const fit = (u) => u.id !== this.explorer && !UNITS[u.type].packs && UNITS[u.type].cls !== 'siege' && !UNITS[u.type].hero && !stat(W, u.owner, u.type).heal && !stat(W, u.owner, u.type).convert;
    const cand = army.filter(fit);
    const share = (({ eko: 0.28, serbu: 0.15, benteng: 0.4, ilmu: 0.3, laut: 0.25 }[this.style] ?? 0.25) + (this.attacked >= 2 && W.t - this.lastHit < 300 ? 0.12 : 0)) * (this.ahead ? 0.5 : 1);
    const want = cand.length < 5 ? 0 : Math.min(16, Math.max(2, Math.round(cand.length * share)));
    if (G.size < want) {             // recruit from the soldiers at home: archers and spearmen first, then the rest
      const sc = (u) => (stat(W, u.owner, u.type).range ? -3 : 0) + (['spearman', 'pikeman'].includes(u.type) ? -2 : 0) + Math.hypot(u.x - bx, u.y - by) / 10;
      const pool = cand.filter(u => !G.has(u.id) && !this.onWatch(u.id) && !this.inWar(u.id) && Math.hypot(u.x - bx, u.y - by) < 28 && (!u.order || u.order.t === 'patrol' || (!u.order.amove && u.order.t !== 'attack'))).sort((a, b) => sc(a) - sc(b));
      for (const u of pool.slice(0, want - G.size)) G.add(u.id);
    } else if (G.size > want + 2) {    // too many at home: the furthest go back to the field army
      const ex = [...G].map(id => W.ents.get(id)).filter(Boolean).sort((a, b) => Math.hypot(b.x - bx, b.y - by) - Math.hypot(a.x - bx, a.y - by));
      for (const u of ex.slice(0, G.size - want)) { G.delete(u.id); if (u.order && u.order.t === 'patrol') command(W, { t: 'stop', pid: this.pid, ids: [u.id] }); }
    }
    // the rounds: idle watchmen walk the ring of guard posts
    if (!threat && G.size && W.t > (this.roundT || 0)) {
      this.roundT = W.t + 8;
      const idle = [...G].map(id => W.ents.get(id)).filter(u => u && (!u.order || (u.order.t !== 'patrol' && u.order.t !== 'attack')));
      if (idle.length) {
        if (!this.ringPts || W.t > (this.ringPtsT || 0)) { this.ringPts = townRing(W, this.pid, W.size >= 180 ? 15 : 13, 8); this.ringPtsT = W.t + 120; }
        if (this.ringPts.length >= 3) command(W, { t: 'patrol', pid: this.pid, ids: idle.map(u => u.id), pts: this.ringPts, guard: true });
      }
    }
    return G;
  }
  // how dangerous the raiders in town are (cavalry and siege count more)
  threatPower() {
    const W = this.W, [bx, by] = this.base; let p = 0;
    for (const e of W.dyn.values()) {
      if (e.kind !== 'unit' || e.owner < 0 || pl(W, e.owner).team === this.P.team || isAnimal(e) || e.nav) continue;
      if (Math.hypot(e.x - bx, e.y - by) > 24 || !this.P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) continue;
      const d = UNITS[e.type]; p += e.type === 'villager' ? 0.3 : d.cls === 'siege' ? 2.5 : d.cls === 'cavalry' ? 1.5 : 1;
    }
    return p;
  }
  defend(army, guard, threat) {
    const W = this.W, [bx, by] = this.base;
    const atHome = army.filter(u => u.id !== this.explorer && (guard.has(u.id) || Math.hypot(u.x - bx, u.y - by) < 28));
    const respond = atHome.filter(u => !u.order || u.order.t !== 'attack').map(u => u.id);
    if (respond.length) command(W, { t: 'move', pid: this.pid, ids: respond, x: threat.x, y: threat.y, amove: true });
    // the field army comes home only when the town cannot hold on its own
    const forts = this.m.bld.filter(b => b.built && (b.type === 'watch_tower' || b.type === 'castle' || b.type === 'town_center')).length * 1.5;
    const away = army.filter(u => u.id !== this.explorer && !atHome.includes(u) && (!u.order || u.order.t !== 'attack'));
    if (away.length && this.threatPower() > (atHome.length + forts) * 1.25 && W.t > (this.recallT || 0)) {
      this.recallT = W.t + 20;
      command(W, { t: 'move', pid: this.pid, ids: away.map(u => u.id), x: threat.x, y: threat.y, amove: true });
      if (this.war && this.war.phase !== 'pulang' && away.some(u => this.war.units.has(u.id))) { this.war.phase = 'pulang'; this.war.t = W.t; if (W.t - (this.recallTold || -999) > 180) this.recallTold = W.t, this.tell('recall', `Panglima ${this.P.name} menarik pasukan pulang — kota sendiri diserang!`, bx, by); }
    }
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
      const relicRush = (W.relicHold && W.relicHold.team !== this.P.team && k.type === 'monastery') || k.type === 'wonder' ? 40 : 0;
      const d = Math.hypot(k.x - ox, k.y - oy) - relicRush - (k.type === 'town_center' ? 12 : BUILDINGS[k.type].trains || BUILDINGS[k.type].attack ? 6 : k.type === 'house' ? -4 : 0);
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
    const W = this.W, P = this.P; if (W.t < 300) return false;
    // crushed: a handful of people left against an enemy many times stronger, for two minutes running
    const top = Math.max(...W.players.filter(q => q.alive && q.team !== P.team).map(q => q.pop), 0);
    if (W.t > 1200 && P.pop < 15 && top > Math.max(40, P.pop * 5) && army.length < 6) { this.crushT ||= W.t; if (W.t - this.crushT > 120) return true; } else this.crushT = 0;
    if (tc) return false;
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
    // stone for the next town or castle: a rich treasury buys it rather than waiting for the quarries
    if (P.res.stone < 150 && P.age >= 2 && P.res.gold > buyPrice(W, P, 'stone') + 400 && buyPrice(W, P, 'stone') < 300) command(W, { t: 'trade', pid: this.pid, bid: mk.id, res: 'stone', buy: true });
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
  freeFarm(v = null) {          // with a villager: the nearest free field
    let best = null, bd = 1e9;
    for (const b of this.m.bld) if (b.type === 'farm' && b.built) { const f = b.farmer && alive(this.W, b.farmer); if (!f || !f.order || f.order.id !== b.id) { if (!v) return b; const d = Math.hypot(b.x - v.x, b.y - v.y); if (d < bd) { bd = d; best = b; } } }
    return best;
  }
  homeOf(v) {                    // the centre of the villager's nearest town
    let best = this.base, bd = 1e9;
    for (const t of this.tcs || []) { const d = Math.hypot(t.x + 2 - v.x, t.y + 2 - v.y); if (d < bd) { bd = d; best = [t.x + 2, t.y + 2]; } }
    return best;
  }
  // ---------------------------------------------------------------- town plan: districts
  // The town grows in quarters around the Town Center (d = Chebyshev distance from its footprint):
  //   centre      plaza (sim, d 1) ringed by the civic buildings (market, smithy, academy, monastery, d 2-8)
  //   residential tidy blocks of houses on a 3-tile lattice with lanes between them (d 2-13, not on the front)
  //   military    barracks, ranges, stables, workshop and castle on the side that faces the enemy (d 6-20)
  //   fields      outside the town (d >= 12) on the sheltered side: a grid of 3x3 fields round their own mill
  tcRect() { if (this.town) return this.town; const W = this.W, tc = W.ents.get(W.players[this.pid].tc); return tc && tc.kind === 'building' && tc.type === 'town_center' ? tc : this.m.bld.find(b => b.type === 'town_center' && b.built && b.id); }
  ringD(T, i, j, n) { const dx = Math.max(T.x - (i + n - 1), i - (T.x + T.w - 1), 0), dy = Math.max(T.y - (j + n - 1), j - (T.y + T.h - 1), 0); return Math.max(dx, dy); }
  frontOff(T, x, y) {            // 0 = straight towards the enemy, PI = straight away from it
    if (!this.toE || this.toE.id !== T.id || this.toE.t < this.W.t - 30) { const [ex, ey] = this.towardEnemy(30); this.toE = { a: Math.atan2(ey - (T.y + T.h / 2), ex - (T.x + T.w / 2)), t: this.W.t, id: T.id }; }
    const a = Math.atan2(y - (T.y + T.h / 2), x - (T.x + T.w / 2)); return Math.abs(Math.atan2(Math.sin(a - this.toE.a), Math.cos(a - this.toE.a)));
  }
  // field districts: blocks of 3x3 fields round their own mill, outside the town on the sheltered side. A new block is
  // opened when the others are full (up to 3); a failed search (unexplored land) is retried later.
  newFieldDistrict(T) {
    const W = this.W, cx = T.x + T.w / 2, cy = T.y + T.h / 2; this.frontOff(T, cx, cy); const back = this.toE.a + Math.PI;
    const taken = (i, j) => (this.fds || []).some(F => i + 3 > F.mx - 6 && i < F.mx + 9 && j + 3 > F.my - 6 && j < F.my + 9);
    let best = null;
    for (const da of [0, 0.45, -0.45, 0.9, -0.9, 1.35, -1.35, 1.8, -1.8, 2.25, -2.25]) for (const R of [14, 17, 20, 24]) {
      const a = back + da, ox = Math.round(cx + Math.cos(a) * R) - 1, oy = Math.round(cy + Math.sin(a) * R) - 1;     // mill cell origin
      if (taken(ox - 1, oy - 1)) continue;
      const cells = [];
      for (let gy = -2; gy <= 2; gy++) for (let gx = -2; gx <= 2; gx++) {
        if (!gx && !gy) continue; const i = ox + gx * 3, j = oy + gy * 3;
        if (this.ringD(T, i, j, 3) < 10 || taken(i, j)) continue;
        let free = true; for (let b = 0; b < 3 && free; b++) for (let c = 0; c < 3 && free; c++) { const ii = i + b, jj = j + c; if (!passable(W, ii, jj, this.pid) || W.terrain[idx(W, ii, jj)] === 3 || !this.P.exp[idx(W, ii, jj)]) free = false; }
        if (free) cells.push({ i, j, k: Math.max(Math.abs(gx), Math.abs(gy)) * 10 + Math.hypot(gx, gy) });
      }
      const sc = cells.length * 10 - Math.abs(da) * 5 - R * 1.2;
      if (cells.length >= 8 && placementOk(W, this.pid, 'mill', ox, oy) && (!best || sc > best.sc)) best = { sc, mx: ox, my: oy, cells };
    }
    if (!best) return null;
    best.cells.sort((p, q) => p.k - q.k);
    (this.fds = this.fds || []).push(best); return best;
  }
  fieldDistrict(T) {
    if (this.fdTc !== T.id) {          // every town keeps its own field districts
      const by = this.fdBy || (this.fdBy = new Map()); if (this.fdTc !== undefined) by.set(this.fdTc, { fds: this.fds, retry: this.fdRetry });
      const st = by.get(T.id); this.fdTc = T.id; this.fds = st ? st.fds : []; this.fdRetry = st ? st.retry : 0;
    }
    if (!this.fds.length && this.W.t >= (this.fdRetry || 0)) { if (!this.newFieldDistrict(T)) this.fdRetry = this.W.t + 45; }
    return this.fds;
  }
  inFields(i, j, n) { return (this.fds || []).some(F => i + n > F.mx - 6 && i < F.mx + 9 && j + n > F.my - 6 && j < F.my + 9); }
  placeFarm(T) {
    const W = this.W, list = this.fieldDistrict(T); if (!list.length) return false;
    for (let pass = 0; pass < 2; pass++) {
      for (const F of this.fds) {
        // each block has its own mill (food is carried there, not to the Town Center)
        const mill = this.m.bld.find(b => b.type === 'mill' && Math.abs(b.x - F.mx) <= 1 && Math.abs(b.y - F.my) <= 1);
        const cell = F.cells.find(c => placementOk(W, this.pid, 'farm', c.i, c.j)); if (!cell) continue;
        if (!mill && !this.m.bld.some(b => b.type === 'mill' && !b.built) && canAfford(this.P, costOf(this.P, 'mill')) && placementOk(W, this.pid, 'mill', F.mx, F.my)) this.order('mill', F.mx, F.my);
        if (canAfford(this.P, costOf(this.P, 'farm'))) this.order('farm', cell.i, cell.j);          // fields go in while their mill is still being raised
        return true;
      }
      if (pass || this.fds.length >= 3 || W.t < (this.fdRetry || 0) || !this.newFieldDistrict(T)) { this.fdRetry = W.t + 45; break; }
    }
    return false;
  }
  order(type, i, j) {
    const W = this.W;
    const vils = this.m.units.filter(u => u.type === 'villager').sort((a1, b1) => Math.hypot(a1.x - i, a1.y - j) - Math.hypot(b1.x - i, b1.y - j));
    const builders = restNow(W, this.P) ? [] : vils.filter(v => !v.order || v.order.t !== 'build').slice(0, type === 'house' || type === 'farm' ? 1 : type === 'castle' || type === 'town_center' ? 4 : 2).map(v => v.id);
    command(W, { t: 'place', pid: this.pid, type, i, j, ids: builders });
    this.m.bld.push({ type, built: false, placedAt: W.t, x: i, y: j });
  }
  // a spot in the right quarter, on the 3-tile lattice anchored at the Town Center (null: no plan / nothing fits)
  planSpot(type) {
    const W = this.W, T = this.tcRect(); if (!T) return null;
    this.fieldDistrict(T);
    const d = BUILDINGS[type], n = d.n;
    const mil = ['barracks', 'archery_range', 'stable', 'castle', 'siege_workshop'].includes(type);
    const civic = ['market', 'blacksmith', 'academy', 'monastery', 'tavern', 'hospital'].includes(type), house = type === 'house', rural = type === 'barn' || type === 'mine_shaft';
    const [r0, r1] = mil ? [6, 15] : civic ? [2, 10] : house ? [2, 15] : rural ? [8, 16] : [3, 15];
    let best = null, bs = 1e9;
    for (let j = T.y - 3 - 3 * 8; j <= T.y + T.h + 24; j += 3) for (let i = T.x - 3 - 3 * 8; i <= T.x + T.w + 24; i += 3) {
      const r = this.ringD(T, i, j, n); if (r < r0 || r > r1) continue;
      if (this.inFields(i, j, n) || !placementOk(W, this.pid, type, i, j)) continue;
      const off = this.frontOff(T, i + n / 2, j + n / 2);
      if (house && off < 0.75) continue;                               // nobody lives in the barracks quarter
      if (mil && off > 1.5) continue;
      let ok = true;               // a free lane all round, so nobody is ever walled in
      if (d.block) for (let a = -1; a <= n && ok; a++) for (let c = -1; c <= n && ok; c++) { const ii = i + a, jj = j + c; if (ii < 0 || jj < 0 || ii >= W.size || jj >= W.size) continue; const o = W.occ[idx(W, ii, jj)]; if (o && W.ents.get(o)?.kind === 'building') ok = false; }
      if (!ok) continue;
      let sc = r;
      if (mil) sc = r * 0.5 + off * 5;
      else if (rural) sc = r * 0.3 + (Math.PI - off) * 2.5;
      else if (civic) sc = r * 1.6;
      else if (house) {
        sc = r * 0.8 + (Math.PI - off) * 0.4;
        for (const b of this.m.bld) if (b.type === 'house' && b.x !== undefined) { const md = Math.abs(b.x - i) + Math.abs(b.y - j); if (md === 3) sc -= 2.4; else if (md === 6 && (b.x === i || b.y === j)) sc -= 0.7; }   // blocks and rows
      }
      if (sc < bs) { bs = sc; best = [i, j]; }
    }
    return best;
  }
  build(type, near, rMin, rMax, anywhere = false) {
    const W = this.W, P = this.P; if (!canBuild(W, this.pid, type) || !canAfford(P, costOf(P, type))) return false;
    const Q = this.lifeNeed, X = this.expandNeed, c0 = costOf(P, type);          // the tavern the people need and the next town come before other buildings
    if ((Q || X) && !['house', 'farm', 'tavern', 'hospital', 'mill', 'town_center', 'dock', 'barn', 'well'].includes(type) && Object.keys(c0).some(k => P.res[k] < c0[k] + (Q && Q[k] || 0) + (X && X[k] || 0))) return false;
    const d = BUILDINGS[type], n = d.n;
    // already placing one?
    if (this.m.bld.some(b => b.type === type && !b.built)) return false;
    const T = !anywhere && this.tcRect();
    if (T && type === 'farm') { if (this.placeFarm(T)) return true; }      // the field districts outside the town (when they are all full: anywhere near)
    else if (T && !d.water && !['lumber_camp', 'mining_camp', 'mill', 'watch_tower', 'town_center', 'dock'].includes(type)) { const sp = this.planSpot(type); if (sp) { this.order(type, sp[0], sp[1]); return true; } }
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
    this.order(type, best[0], best[1]);
    return true;
  }
}
