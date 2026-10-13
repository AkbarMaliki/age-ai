// Online rooms on Firebase Realtime Database: /age/rooms/{CODE}   (same Firebase project as the other games)
//   meta     {host, status:'lobby'|'play', created, cfg:{map, size, season, night}}
//   players  {pid: {name, color, team, deck, bot, diff, online, joined}}      seats in the lobby (bots too)
//   watchers {pid: {name, online}}                                           spectators who joined a running game
//   game     {cfg:{seed, map, size, season, night}, seats:[{pid, name, color, team, deck, bot, diff, style}], run}
//   turns/n  host -> all: JSON string {c:[commands], h:[turn, hash]} or 0 for an empty turn (lockstep, see lockstep.js)
//   in/pid   player -> host (push): JSON string of one command
//   ack/pid  last turn a player has simulated (the host waits for stragglers)
//   chat     (push) {name, color, text, t}
// Commands travel as JSON strings so every client applies byte-identical objects (no RTDB array / undefined quirks).
import { PLAYER_COLORS } from './data.js?v=20261013205428';

const ROOT = 'age/rooms', INDEX = 'age/index';     // index: {code: created} so abandoned rooms can be found cheaply
const sanitize = (o) => JSON.parse(JSON.stringify(o, (k, v) => (v === undefined ? null : v)));
export const MAX_SEATS = 4;
export const BOT_NAME = { blue: 'Raja Biru', red: 'Raja Merah', green: 'Adipati Hijau', yellow: 'Baron Kuning' };      // AIs are named after their colour

export class Net {
  constructor() {
    this.cb = {}; this.meta = null; this.players = {}; this.watchers = {}; this.game = null; this.code = null; this.offs = [];
    let pid = null; try { pid = sessionStorage.getItem('ak.pid'); } catch { }
    if (!pid) { pid = 'p' + Math.random().toString(36).slice(2, 10); try { sessionStorage.setItem('ak.pid', pid); } catch { } }
    this.pid = pid;
  }
  static available() { return !!(window.firebase && window.AK_FIREBASE_CONFIG && window.AK_FIREBASE_CONFIG.databaseURL); }
  db() { if (!firebase.apps.length) firebase.initializeApp(window.AK_FIREBASE_CONFIG); return firebase.database(); }
  ref(p = '') { return this.db().ref(`${ROOT}/${this.code}${p ? '/' + p : ''}`); }
  on(name, f) { this.cb[name] = f; }
  emit(name, ...a) { this.cb[name]?.(...a); }
  link() { return location.origin + location.pathname + '?room=' + this.code; }

  async create(name, deck, cfg) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let k = 0; k < 8; k++) {
      this.code = Array.from({ length: 5 }, () => chars[(Math.random() * chars.length) | 0]).join('');
      const s = await this.ref('meta').get();
      if (!s.exists() || Date.now() - (s.val().created || 0) > 12 * 3600e3) break;      // free, or an abandoned old room
    }
    await this.ref().set(sanitize({
      meta: { host: this.pid, status: 'lobby', created: Date.now(), cfg },
      players: { [this.pid]: { name, color: PLAYER_COLORS[0], team: 1, deck, bot: false, online: true, joined: Date.now() } },
    }));
    this.db().ref(`${INDEX}/${this.code}`).set(Date.now());
    this.sweep();
    this.role = 'player'; this.attach();
    return this.code;
  }
  // rooms nobody closed properly (tab closed mid-game) are removed after a day
  async sweep() {
    try {
      const idx = (await this.db().ref(INDEX).get()).val() || {}, old = Date.now() - 24 * 3600e3;
      for (const [code, t] of Object.entries(idx).filter(([c, t]) => t < old && c !== this.code).slice(0, 10)) { await this.db().ref(`${ROOT}/${code}`).remove(); await this.db().ref(`${INDEX}/${code}`).remove(); }
    } catch { }
  }
  // -> 'lobby' (seated), 'play' (rejoining my own running game) or 'watch' (a running game I'm not part of)
  async join(code, name, deck) {
    this.code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const s = await this.ref().get();
    if (!s.exists() || !s.val().meta) throw new Error('Room tidak ditemukan');
    const v = s.val(), ps = v.players || {};
    let mode = 'lobby';
    if (v.meta.status === 'play') {
      const seated = v.game && (v.game.seats || []).some(x => x && x.pid === this.pid);
      mode = seated ? 'play' : 'watch';
      if (mode === 'watch') await this.ref(`watchers/${this.pid}`).set({ name, online: true });
    } else if (!ps[this.pid]) {
      if (Object.keys(ps).length >= MAX_SEATS) throw new Error('Room penuh (maks 4 kerajaan)');
      const used = new Set(Object.values(ps).map(p => p.color)), teams = new Set(Object.values(ps).map(p => p.team));
      await this.ref(`players/${this.pid}`).set(sanitize({ name, color: PLAYER_COLORS.find(c => !used.has(c)), team: [1, 2, 3, 4].find(t => !teams.has(t)) || 2, deck, bot: false, online: true, joined: Date.now() }));
    }
    this.role = mode === 'watch' ? 'watcher' : 'player'; this.attach();
    return mode;
  }
  attach() {
    const conn = this.db().ref('.info/connected');
    const f0 = conn.on('value', (s) => {
      if (!s.val()) return;
      const me = this.meRef = this.ref(`${this.role === 'watcher' ? 'watchers' : 'players'}/${this.pid}/online`);
      me.onDisconnect().set(false); me.set(true).catch(() => { });
    });
    this.offs.push(() => conn.off('value', f0));
    const sub = (path, ev, fn) => { const r = this.ref(path); const h = r.on(ev, fn); this.offs.push(() => r.off(ev, h)); };
    sub('meta', 'value', (s) => { this.meta = s.val(); this.emit('lobby'); this.checkHost(); });
    sub('players', 'value', (s) => { this.players = s.val() || {}; this.playersLoaded = true; this.emit('lobby'); this.checkHost(); });
    sub('watchers', 'value', (s) => { this.watchers = s.val() || {}; });
    sub('game', 'value', (s) => { const g = s.val(); const fresh = g && (!this.game || this.game.run !== g.run); this.game = g; if (fresh) this.emit('game', g); });
    const since = Date.now() - 5000;
    sub('chat', 'child_added', (s) => { const c = s.val(); if (c && c.t > since) this.emit('chat', c); });
  }
  // the host left: the first online human (by join time) takes over the room
  checkHost() {
    const m = this.meta, ps = this.players; if (!m || !ps || !this.code) return;
    if (ps[m.host]?.online) return;
    const humans = Object.entries(ps).filter(([, p]) => !p.bot && p.online).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0));
    if (humans.length && humans[0][0] === this.pid) {
      const old = m.host;
      this.ref('meta/host').transaction(cur => (cur === old ? this.pid : undefined)).then(r => { if (r.committed) this.emit('promoted', old); });
    }
  }
  isHost() { return this.meta?.host === this.pid; }
  seated() { return Object.entries(this.players).sort((a, b) => (a[1].joined || 0) - (b[1].joined || 0)); }

  // ----- lobby (host) -----
  async addBot(diff = 'normal') {
    const ps = Object.values(this.players); if (ps.length >= MAX_SEATS) return;
    const used = new Set(ps.map(p => p.color)), teams = new Set(ps.map(p => p.team));
    const color = PLAYER_COLORS.find(c => !used.has(c));
    await this.ref(`players/b${Math.random().toString(36).slice(2, 8)}`).set(sanitize({ name: BOT_NAME[color], color, team: [1, 2, 3, 4].find(t => !teams.has(t)) || 2, bot: true, diff, online: true, joined: Date.now() }));
  }
  removePlayer(id) { return this.ref(`players/${id}`).remove(); }
  setPlayer(id, patch) { return this.ref(`players/${id}`).update(sanitize(patch)); }
  setCfg(patch) { return this.ref('meta/cfg').update(sanitize(patch)); }
  async startGame(game) {
    await this.ref().update(sanitize({ game, turns: null, in: null, ack: null, desync: null }));
    await this.ref('meta').update({ status: 'play' });
  }
  backToLobby() { return this.ref().update({ 'meta/status': 'lobby', game: null, turns: null, in: null, ack: null, watchers: null }); }

  // ----- lockstep traffic -----
  listenTurns(fn) {
    const r = this.ref('turns'), h = r.on('child_added', (s) => fn(+s.key, s.val()));
    this.offs.push(() => r.off('child_added', h)); return () => r.off('child_added', h);
  }
  writeTurn(n, data) { return this.ref(`turns/${n}`).set(data); }
  sendCmd(c) { this.ref(`in/${this.pid}`).push(JSON.stringify(c)); }
  // host: every command a player pushes, once; the queue is cleared as it is read
  listenInputs(fn) {
    const rin = this.ref('in');
    const h = rin.on('child_added', (s) => {
      const pid = s.key, r = s.ref;
      const h2 = r.on('child_added', (e) => { fn(pid, e.val()); e.ref.remove(); });
      this.offs.push(() => r.off('child_added', h2));
    });
    this.offs.push(() => rin.off('child_added', h));
  }
  ack(n) { this.ref(`ack/${this.pid}`).set(n); }
  listenAcks(fn) { const r = this.ref('ack'), h = r.on('value', (s) => fn(s.val() || {})); this.offs.push(() => r.off('value', h)); }
  reportDesync(n) { this.ref(`desync/${this.pid}`).set(n); }
  chat(name, color, text) { this.ref('chat').push(sanitize({ name, color, text: String(text).slice(0, 140), t: firebase.database.ServerValue.TIMESTAMP })); }

  async leave() {
    try {
      for (const f of this.offs) f(); this.offs = [];
      if (this.meRef) await this.meRef.onDisconnect().cancel();     // or closing the tab later would write into a removed room
      const drop = async () => { await this.ref().remove(); await this.db().ref(`${INDEX}/${this.code}`).remove(); };
      if (this.code) {
        const playing = this.meta?.status === 'play';
        if (this.role === 'watcher') await this.ref(`watchers/${this.pid}`).remove();
        else if (playing) {
          const others = Object.entries(this.players).filter(([id, p]) => id !== this.pid && !p.bot && p.online);
          if (!others.length) await drop();                                             // last one out: the room goes
          else await this.ref(`players/${this.pid}/online`).set(false);                // my kingdom stays (the AI takes it over)
        }
        else {
          const others = Object.entries(this.players).filter(([id, p]) => id !== this.pid && !p.bot && p.online);
          if (!others.length) await drop(); else await this.ref(`players/${this.pid}`).remove();
        }
      }
    } catch { }
    this.code = null; this.meta = null; this.players = {}; this.game = null;
  }
}
