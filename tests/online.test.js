// Online lockstep check without Firebase: an in-memory "database" with random latency connects a host, a guest and a
// spectator who joins late. The two human kingdoms are played by AI "brains" whose commands go through the network
// (like a real player's clicks). Every client runs its own world; their state hashes must stay identical.
// Also covers a dropped player (AI takes over, then hands back) and a late joiner replaying every turn.
//   node tests/online.test.js [game minutes]
import { generate } from '../js/map.js';
import { AI } from '../js/ai.js';
import { Lockstep, stateHash } from '../js/lockstep.js';
import { DECKS } from '../js/data.js';

const MIN = +(process.argv[2] || 12), MIGRATE = process.argv[3] !== 'nomigrate';   // the host closes its tab at tick 5000
const cfg = { seed: 4242, map: 'padang', size: 112, season: 'semi', night: 'full' };
const seats = [
  { pid: 'host', name: 'Host', color: 'blue', team: 1, bot: false, deck: DECKS.makmur.cards, style: 'makmur' },      // (a brain AI would otherwise pick a deck on its own client only)
  { pid: 'guest', name: 'Tamu', color: 'red', team: 2, bot: false, deck: DECKS.penakluk.cards, style: 'penakluk' },
  { pid: 'b1', name: 'Bot', color: 'green', team: 3, bot: true, diff: 'normal', style: 'penakluk' },
];
let frame = 0, rnd = 1; const handover = { ai: false, human: false };
const R = () => (rnd = (rnd * 16807) % 2147483647) / 2147483647;
// ---- the fake realtime database: messages arrive 1-6 frames (0.1 s each) later, in order per path
const bus = { turns: new Map(), q: [], subsT: [], subsIn: [], subsAck: [], acks: {}, players: { host: { online: true }, guest: { online: true } } };
const later = (fn) => { const at = frame + 1 + Math.floor(R() * 6); const last = bus.q.length ? bus.q[bus.q.length - 1].at : 0; bus.q.push({ at: Math.max(at, last), fn }); };
const pump = () => { while (bus.q.length && bus.q[0].at <= frame) bus.q.shift().fn(); };
class FakeNet {
  constructor(pid, host) { this.pid = pid; this.host = host; this.cb = {}; this.players = bus.players; }
  isHost() { return this.host; }
  on(k, f) { this.cb[k] = f; }
  listenTurns(fn) { for (const [n, v] of [...bus.turns].sort((a, b) => a[0] - b[0])) fn(n, v); bus.subsT.push(fn); }
  writeTurn(n, v) { bus.turns.set(n, v); later(() => bus.subsT.forEach(f => f(n, v))); }
  sendCmd(c) { const s = JSON.stringify(c), pid = this.pid; later(() => bus.subsIn.forEach(f => f(pid, s))); }
  listenInputs(fn) { bus.subsIn.push(fn); }
  ack(n) { const pid = this.pid; later(() => { bus.acks[pid] = n; bus.subsAck.forEach(f => f({ ...bus.acks })); }); }
  listenAcks(fn) { bus.subsAck.push(fn); }
  reportDesync(n) { console.log('desync reported by', this.pid, 'at turn', n); }
}
// ---- one client = its own world + lockstep (+ a brain playing its kingdom)
function client(pid, me, spectator) {
  const W = generate({ size: cfg.size, seed: cfg.seed, type: cfg.map, opts: { season: cfg.season, night: cfg.night }, players: seats.map(s => ({ name: s.name, color: s.color, ai: s.bot, team: s.team, deck: s.deck ? [...s.deck] : null, style: s.style || null })) });
  const G = { W, seats, acc: 0, over: false, ais: seats.map((s, i) => s.bot ? new AI(W, i, s.diff) : null).filter(Boolean), hud: { notify: (t) => { if (/terputus/.test(t)) handover.ai = true; if (/kembali bermain/.test(t)) handover.human = true; if (/terputus|kembali|sinkron/.test(t)) console.log(`  [${pid}] tick ${W.tick}: ${t}`); } }, hist: { tick() { } }, hashes: new Map(),
    onEvent(e) { if (e.k === 'victory') G.over = true; } };
  const net = G.net = new FakeNet(pid, pid === 'host');
  G.lock = new Lockstep(G, net, spectator);
  const brain = me >= 0 && !spectator ? new AI(W, me, 'hard') : null;      // "the player"
  const tick0 = G.lock.tickOnce.bind(G.lock);
  G.lock.tickOnce = () => { tick0(); if (W.tick % 100 === 0) G.hashes.set(W.tick, stateHash(W)); };
  G.frame = (dt) => {
    if (brain && !(pid === 'guest' && bus.players.guest.online === false)) {
      // the player looks at the screen and clicks: its orders are taken out of the sim queue and sent over the network
      const n0 = W.cmds.length; brain.tick(); for (const c of W.cmds.splice(n0)) G.lock.send(c);
    }
    G.lock.update(dt);
  };
  return G;
}
const host = client('host', 0, false), guest = client('guest', 1, false);
let late = null, hostGone = false, lastHostTick = 0;
const lead = () => hostGone ? guest : host;
const total = MIN * 60 * 10, dt = 0.1;
for (; frame < 1e6 && (lead().W.tick < total || guest.W.tick < host.W.tick - 20) && !lead().over; frame++) {
  pump();
  if (!hostGone) host.frame(dt);
  guest.frame(dt);
  if (MIGRATE && !hostGone && host.W.tick >= 5000) {        // the host closes the tab: its seat goes offline, the guest is promoted
    hostGone = true; lastHostTick = host.W.tick; bus.players.host.online = false;
    later(() => guest.net.cb.promoted && guest.net.cb.promoted());
    console.log('host leaves at tick', host.W.tick);
  }
  if (late) late.frame(dt);
  // the guest's connection drops for ~45 s, then comes back
  if (!hostGone) bus.players.guest.online = !(host.W.tick >= 3000 && host.W.tick < 3700);
  if (host.W.tick >= 4000 && !late) { late = client('late', -1, true); console.log('spectator joins at tick', host.W.tick); }
}
// let the stragglers finish
for (let k = 0; k < 4000 && (late && late.W.tick < guest.W.tick || !hostGone && guest.W.tick < host.W.tick); k++, frame++) { pump(); guest.frame(dt); if (late) late.frame(dt); }
let same = 0, diff = 0, first = null;
for (const [t, h] of guest.hashes) for (const o of [host, late]) { if (!o || !o.hashes.has(t)) continue; if (o.hashes.get(t) === h) same++; else { diff++; first = first ?? t; } }
const afterMigration = hostGone ? [...late.hashes.keys()].filter(t => t > lastHostTick && guest.hashes.get(t) === late.hashes.get(t)).length : 0;
if (hostGone) console.log(`after the host left: guest is host ${guest.lock.host}, reached tick ${guest.W.tick}, ${afterMigration} matching hash checks with the spectator, AI for the old host: ${guest.lock.aiSeats.has(0)}`);
const counts = (G) => { const c = {}; for (const e of G.W.dyn.values()) if (e.kind === 'unit' && e.owner >= 0) c[e.owner] = (c[e.owner] || 0) + 1; return JSON.stringify(c); };
console.log(`frames ${frame} | host tick ${host.W.tick} guest ${guest.W.tick} late ${late?.W.tick} | turns ${bus.turns.size} | units host ${counts(host)} guest ${counts(guest)}`);
console.log(`hash checks equal ${same}, different ${diff}${first !== null ? ' (first at tick ' + first + ')' : ''} | in-game desync flags: guest ${guest.lock.desync} late ${late?.lock.desync}`);
console.log(`AI handover: took over ${handover.ai}, handed back ${handover.human}`);
const ok = handover.ai && handover.human && same > 10 && (!hostGone || (guest.lock.host && afterMigration > 5 && guest.lock.aiSeats.has(0))) && diff === 0 && !guest.lock.desync && !(late && late.lock.desync);
console.log(ok ? 'online lockstep OK' : 'ONLINE LOCKSTEP FAILED');
if (!ok) process.exit(1);
