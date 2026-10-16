// AI Assist (Main + Bantuan AI): the player plays, and a computer player looks after whatever the player leaves alone.
// A unit or building is the player's while it is selected and for `delay` seconds after the player last selected it or
// gave it an order; after that the helper may use it. The helper is an ordinary AI whose commands pass through gate():
// orders for units the player holds are dropped, and so is anything that is the player's call (diplomacy, resigning,
// shipments, deleting, the town bell). Scope 'eco' only runs the economy (villagers, fishing boats, houses, drop sites,
// farms, economy research, more villagers); 'full' also trains, researches, ages up and leads the idle army.
// Everything it depends on comes from the sim and the command log (player orders, '_sel' and '_assist' meta commands),
// so a saved game or a replay rebuilds the same helper decisions.
import { UNITS, GAME_SPEED } from './data.js?v=20261016141208';
import { TICK } from './sim.js?v=20261016141208';
import { AI } from './ai.js?v=20261016141208';

export const ASSIST_DELAYS = [10, 20, 40];
const ECO_BLD = new Set(['house', 'mill', 'lumber_camp', 'mining_camp', 'mine_shaft', 'farm', 'dock', 'well', 'tavern', 'hospital', 'barn']);
const ECO_UNIT = new Set(['villager', 'fishing_boat', 'sheep', 'cow']);
const ECO_TECH = new Set(['loom', 'wheelbarrow', 'hand_cart', 'double_bit_axe', 'bow_saw', 'two_man_saw', 'gold_mining', 'iron_smelting', 'stone_mining', 'gold_shaft', 'stone_shaft',
  'horse_collar', 'granary', 'heavy_plow', 'crop_rotation', 'gillnets', 'mine_rails', 'deep_veins', 'brewery', 'minstrels', 'herbalism', 'quarantine', 'sanitation', 'fodder']);
// never the helper's call
const PLAYER_ONLY = new Set(['resign', 'tribute', 'pact', 'card', 'delete', 'bell', 'hire', 'mercaccept', 'mercdecline', 'flare', 'cancel', 'lock']);
// unit orders: only the units the player has left alone
const UNIT_CMDS = new Set(['move', 'smart', 'form', 'stop', 'patrol', 'unload', 'garrison', 'levy', 'unlevy', 'follow', 'ground', 'stance', 'pack']);

export class Assist {
  constructor(W, pid, o = {}) {
    this.W = W; this.pid = pid;
    this.on = o.on !== false;
    this.delay = ASSIST_DELAYS.includes(+o.delay) ? +o.delay : 20;      // real seconds at 1x
    this.scope = o.scope === 'full' ? 'full' : 'eco';
    this.touched = new Map();      // id -> tick the player last selected / ordered it
    this.held = new Set();         // selected right now
    const P = W.players[pid], style = P.style, deck = P.deck;
    this.ai = new AI(W, pid, 'normal');
    P.style = style; P.deck = deck;          // the helper's personality is its own: the player keeps their deck and name
    this.ai.mayUse = (e) => this.free(e);
    this.ai.mayPlace = (type) => this.scope === 'full' || ECO_BLD.has(type);
  }
  get wait() { return Math.round(this.delay * GAME_SPEED / TICK); }
  touch(id) { if (id) this.touched.set(id, this.W.tick); }
  // a command the player gave (live or from the log)
  note(c) {
    if (c.pid !== this.pid) return;
    if (Array.isArray(c.ids)) for (const id of c.ids) this.touch(id);
    this.touch(c.bid);
  }
  // the player's selection changed: what was let go starts its countdown now
  select(ids) {
    for (const id of this.held) this.touch(id);
    this.held = new Set(ids); for (const id of ids) this.touch(id);
  }
  free(e) {
    if (!e || e.owner !== this.pid || this.held.has(e.id)) return false;
    const t = this.touched.get(e.id); if (t !== undefined && this.W.tick - t < this.wait) return false;
    if (e.kind === 'unit' && this.scope === 'eco' && !ECO_UNIT.has(e.type)) return false;
    if (e.kind === 'unit' && UNITS[e.type] && UNITS[e.type].hero) return false;       // the king is always the player's
    return true;
  }
  // a helper command: the command to run (perhaps with fewer units), or null
  gate(c) {
    const W = this.W, eco = this.scope === 'eco';
    if (c.pid !== this.pid || PLAYER_ONLY.has(c.t)) return null;
    if (UNIT_CMDS.has(c.t)) {
      if (eco && (c.t === 'levy' || c.t === 'unlevy' || c.t === 'patrol' || c.t === 'garrison' || c.t === 'stance' || c.t === 'pack' || c.t === 'ground')) return null;
      const ids = (c.ids || []).filter(id => this.free(W.ents.get(id)));
      return ids.length ? { ...c, ids } : null;
    }
    if (c.t === 'place') {
      if (eco && !ECO_BLD.has(c.type)) return null;
      const ids = (c.ids || []).filter(id => this.free(W.ents.get(id)));
      return ids.length ? { ...c, ids } : null;          // never a foundation nobody is free to build
    }
    if (c.bid !== undefined) {      // train, research, rally, ore, reseed, fishtrap, ungarrison, ability
      const b = W.ents.get(c.bid); if (!this.free(b)) return null;
      if (c.t === 'train') return !eco || ECO_UNIT.has(c.type) ? c : null;
      if (c.t === 'research') return !eco || ECO_TECH.has(c.tech) ? c : null;
      if (c.t === 'rally' || c.t === 'ungarrison') return null;      // the player's rally points and garrisons stay as they are
      if (c.t === 'ability') return eco ? null : c;
      return c;
    }
    if (c.t === 'trade') return eco ? null : c;      // market deals: only a full helper
    return null;
  }
  // one sim tick (before step): the helper thinks, then its commands and stories are checked
  tick() {
    const W = this.W, P = W.players[this.pid];
    if (!this.on || !P || !P.alive) return;
    const n0 = W.cmds.length, e0 = W.ev.length, c0 = W.chron ? W.chron.length : 0;
    this.ai.tick();
    const mine = W.cmds.splice(n0);
    for (const c of mine) { const g = this.gate(c); if (g) W.cmds.push(g); }
    // the helper's war stories: a full helper reports what it does with the army, an economy helper keeps quiet
    for (let i = W.ev.length - 1; i >= e0; i--) { const e = W.ev[i]; if (e.k !== 'war' || e.owner !== this.pid) continue; if (this.scope === 'eco') W.ev.splice(i, 1); else e.text = '🤖 ' + e.text; }
    if (W.chron) for (let i = W.chron.length - 1; i >= c0; i--) { const e = W.chron[i]; if (e.owner !== this.pid) continue; if (this.scope === 'eco') W.chron.splice(i, 1); else if (!e.text.startsWith('🤖')) e.text = '🤖 ' + e.text; }
  }
  // how many of the player's units the helper may use now (HUD)
  count() { let n = 0; for (const e of this.W.dyn.values()) if (e.kind === 'unit' && e.owner === this.pid && this.free(e) && !UNITS[e.type].animal) n++; return n; }
}
export const ASSIST_SCOPE = { eco: 'Ekonomi', full: 'Penuh' };
