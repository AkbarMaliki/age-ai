// Deterministic lockstep for online games. Every client runs the same simulation; only commands travel.
//   The host is the clock: at the start of turn n (TPT ticks each) it publishes turn n + LEAD with every command it has
//   received (its own included), so all clients apply the same commands at the same tick. Clients may only simulate
//   ticks of turns they have. Every HASH_EVERY turns the host attaches a state hash; a mismatch means a desync.
//   AIs run on every client (they are deterministic). Meta commands ('_ai' / '_human') hand a dropped player's
//   kingdom to an AI and back. A client that (re)joins late replays every turn from 0 at full speed.
import { step, command, TICK } from './sim.js?v=20261014223400';
import { GAME_SPEED } from './data.js?v=20261014223400';
import { AI } from './ai.js?v=20261014223400';

export const TPT = 2, LEAD = 3, HASH_EVERY = 25;
const MAX_LAG = 40;          // turns the host lets a player fall behind before it waits (~5 s)
const AI_AFTER = 15;         // seconds offline before the AI takes a player's kingdom
const START_WAIT = 25;       // seconds the host waits for everyone to load at the start

export function stateHash(W) {
  let h = 2166136261 >>> 0;
  const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
  mix(W.tick); mix(W.dyn.size);
  for (const e of W.dyn.values()) { mix(e.id); mix(Math.round((e.x || 0) * 1000)); mix(Math.round((e.y || 0) * 1000)); mix(Math.round((e.hp || 0) * 100)); }
  for (const P of W.players) for (const r in P.res) mix(Math.round(P.res[r] * 100));
  return h;
}

export class Lockstep {
  constructor(game, net, spectator) {
    this.g = game; this.net = net; this.spectator = spectator;
    this.turns = new Map(); this.ready = -1; this.next = 0; this.published = -1; this.pending = [];
    this.myHash = new Map(); this.acks = {}; this.offT = {}; this.asked = {}; this.aiSeats = new Set();
    this.wait = 0; this.desync = false; this.catching = false; this.t0 = performance.now(); this.lastAck = -1;
    this.host = false;
    net.listenTurns((n, v) => this.onTurn(n, v));
    net.on('promoted', () => { if (!this.host && !this.spectator) { this.becomeHost(false); this.g.hud.notify('Tuan rumah keluar — kamu sekarang menjadi tuan rumah room.', 'age'); } });
    if (net.isHost() && !spectator) this.becomeHost(true);
  }
  seatOf(pid) { return this.g.seats.findIndex(s => s && s.pid === pid); }

  // ---------------------------------------------------------------- network in
  onTurn(n, v) {
    if (n < this.next || this.turns.has(n)) return;            // already applied / our own echo
    let tr = { c: [] };
    if (v) { try { tr = JSON.parse(v); } catch { } if (!Array.isArray(tr.c)) tr.c = []; }
    this.turns.set(n, tr);
    while (this.turns.has(this.ready + 1)) this.ready++;
  }
  becomeHost(fresh) {
    this.host = true;
    this.net.listenInputs((pid, raw) => {
      let c; try { c = JSON.parse(raw); } catch { return; }
      const seat = this.seatOf(pid); if (seat < 0 || !c || typeof c.t !== 'string' || c.t[0] === '_') return;
      c.pid = seat; this.pending.push(c);              // a player can only ever command their own kingdom
    });
    this.net.listenAcks((a) => { this.acks = a; });
    if (fresh) { for (let n = 0; n < LEAD; n++) this.publishNext(null); }
    else { this.published = Math.max(this.published, this.ready); this.grace = 1.5; }   // let the old host's last turns land first
  }
  publishNext(h) {
    const n = this.published + 1, c = this.pending.splice(0);
    const rec = c.length || h ? JSON.stringify(h ? { c, h } : { c }) : 0;
    this.published = n; this.onTurn(n, rec); this.net.writeTurn(n, rec);
  }
  // a command from this client's player
  send(c) {
    if (this.spectator) return;
    if (this.host) this.pending.push(JSON.parse(JSON.stringify(c))); else this.net.sendCmd(c);
  }

  // ---------------------------------------------------------------- host housekeeping
  humans() { return this.g.seats.map((s, i) => [s, i]).filter(([s]) => s && !s.bot && s.pid !== this.net.pid); }
  // may the host start turn n? (everyone loaded, nobody playing too far behind)
  lagOk(n) {
    const loading = (performance.now() - this.t0) / 1000 < START_WAIT;
    for (const [s] of this.humans()) {
      const p = this.net.players[s.pid]; if (!p || !p.online) continue;
      const a = this.acks[s.pid];
      if (a === undefined || a === null) { if (loading && n > 0) { this.waitFor = s.name; return false; } continue; }
      if (a < 0) continue;                                  // replaying a rejoin: don't hold everyone up
      if (a < n - MAX_LAG) { this.waitFor = s.name; return false; }
    }
    this.waitFor = null; return true;
  }
  watchSeats(dt) {
    if ((this.seatT = (this.seatT || 0) - dt) > 0) return; this.seatT = 1;
    for (const [s, i] of this.humans()) {
      const on = !!this.net.players[s.pid]?.online;
      this.offT[i] = on ? 0 : (this.offT[i] || 0) + 1;
      if (!on && this.offT[i] >= AI_AFTER && !this.aiSeats.has(i) && this.asked[i] !== 'ai') { this.asked[i] = 'ai'; this.pending.push({ t: '_ai', pid: i }); }
      if (on && this.aiSeats.has(i) && this.asked[i] !== 'human') { this.asked[i] = 'human'; this.pending.push({ t: '_human', pid: i }); }
    }
  }

  // ---------------------------------------------------------------- simulation
  update(dt) {
    const G = this.g, W = G.W; if (G.over) return;
    if (this.host) { this.watchSeats(dt); if (this.grace > 0) this.grace -= dt; }
    const maxTick = (this.ready + 1) * TPT, behind = maxTick - W.tick, normal = (LEAD + 1) * TPT;
    const wasCatching = this.catching;
    this.catching = !this.host && behind > 300;
    if (wasCatching && !this.catching && !this.spectator) { this.net.ack(this.next); this.g.hud.notify('Tersinkron dengan permainan.', 'age'); }
    if (this.catching && !wasCatching && !this.spectator) this.net.ack(-1);
    G.acc += dt * GAME_SPEED * ((G.setup && G.setup.speed) || 1);
    if (!this.host && behind > normal + 2 * TPT) G.acc += (behind - normal) * TICK * Math.min(1, dt * 3);   // drifted behind: ease back
    const t0 = performance.now(); let ran = 0, blocked = false;
    while (G.acc >= TICK || this.catching) {
      if (W.tick >= (this.ready + 1) * TPT) {                                          // out of turns
        // a host (e.g. one just promoted) that has used up every turn publishes the next ones itself
        if (this.host && W.tick % TPT === 0 && !(this.grace > 0) && this.lagOk(W.tick / TPT)) { while (this.published < W.tick / TPT + LEAD) this.publishNext(null); continue; }
        blocked = true; break;                                                          // waiting for the network
      }
      if (W.tick % TPT === 0 && !this.boundary()) { blocked = true; break; }            // host waiting for a slow player
      this.tickOnce(); G.acc = Math.max(0, G.acc - TICK); ran++;
      if (G.over || performance.now() - t0 > (this.catching ? 35 : 14)) break;
    }
    if (blocked) G.acc = Math.min(G.acc, TICK);
    this.wait = blocked && !ran ? this.wait + dt : 0;
    this.progress = this.catching ? W.tick / Math.max(1, maxTick) : 1;
  }
  // start of turn n: hash, (host) publish ahead, apply the turn's commands
  boundary() {
    const G = this.g, W = G.W, n = W.tick / TPT;
    if (this.host && (!this.lagOk(n) || (this.grace > 0 && n + LEAD > this.published))) return false;
    let h = null;
    if (n % HASH_EVERY === 0) { const v = stateHash(W); if (this.host) h = [n, v]; else this.myHash.set(n, v); }
    if (this.host) while (this.published < n + LEAD) this.publishNext(this.published + 1 === n + LEAD ? h : null);
    const tr = this.turns.get(n); if (!tr) return false;
    this.turns.delete(n); this.next = n + 1;
    if (tr.h && !this.host) {
      const mine = this.myHash.get(tr.h[0]); this.myHash.delete(tr.h[0]);
      if (mine !== undefined && mine !== tr.h[1] && !this.desync) {
        this.desync = true; this.net.reportDesync(tr.h[0]);
        console.warn('desync at turn', tr.h[0], mine, tr.h[1]);
        G.hud.notify('⚠ Permainan tidak sinkron dengan tuan rumah (desync). Coba muat ulang halaman untuk menyusul.', 'bad');
      }
    }
    for (const c of tr.c) { if (!c || typeof c.t !== 'string') continue; if (G.rec) G.rec.cmds.push([W.tick, c]); if (c.t[0] === '_') this.meta(c); else command(W, c); }
    if (!this.host && !this.spectator && !this.catching && n % 5 === 0 && n !== this.lastAck) { this.lastAck = n; this.net.ack(n); }
    return true;
  }
  meta(c) {
    const G = this.g, W = G.W, P = W.players[c.pid]; if (!P) return;
    if (c.t === '_ai' && !this.aiSeats.has(c.pid)) {
      this.aiSeats.add(c.pid); P.ai = true; G.ais.push(new AI(W, c.pid, 'normal'));
      if (!this.catching) G.hud.notify(`${P.name} terputus — kerajaannya dikendalikan AI.`, 'enemy');
    }
    if (c.t === '_human' && this.aiSeats.has(c.pid)) {
      this.aiSeats.delete(c.pid); P.ai = false; G.ais = G.ais.filter(a => a.pid !== c.pid);
      if (!this.catching) G.hud.notify(`${P.name} kembali bermain.`, 'age');
    }
    if (this.host) delete this.asked[c.pid];
  }
  tickOnce() {
    const G = this.g, W = G.W;
    for (const ai of G.ais) ai.tick();
    step(W); G.hist.tick();
    for (const e of W.ev) if (!this.catching || e.k === 'victory' || e.k === 'defeated') G.onEvent(e);
    W.ev.length = 0;
  }
  status() {
    if (this.catching) return `Menyusul permainan… ${Math.floor(this.progress * 100)}%`;
    if (this.host && this.waitFor) return `Menunggu ${this.waitFor}…`;
    if (this.wait > 1.5) return this.host ? 'Menunggu pemain…' : 'Menunggu tuan rumah (koneksi)…';
    return '';
  }
}
