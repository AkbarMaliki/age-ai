// Online lobby: create a room, share its link, seat players and AIs, pick teams and the map, start.
import { Net, MAX_SEATS, BOT_NAME } from './net.js?v=20261012210204';
import { PLAYER_COLORS, PLAYER_RGB, DECKS } from './data.js?v=20261012210204';
import { Sound } from './audio.js?v=20261012210204';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CFG = {
  map: [['random', 'Acak'], ['padang', 'Padang'], ['rimba', 'Rimba'], ['danau', 'Danau'], ['sungai', 'Sungai'], ['tambang', 'Tambang'], ['pegunungan', 'Gunung'], ['kepulauan', 'Pulau']],
  size: [[112, 'Kecil'], [144, 'Sedang'], [180, 'Besar'], [220, 'Raksasa'], [280, 'Kolosal']],
  season: [['random', 'Acak'], ['semi', 'Semi'], ['kemarau', 'Kemarau'], ['gugur', 'Gugur'], ['salju', 'Salju']],
  night: [['full', 'Penuh'], ['visual', 'Visual'], ['off', 'Mati']],
};
const CFG_NAME = { map: 'Peta', size: 'Ukuran', season: 'Musim', night: 'Siang-malam' };
const DIFFS = [['easy', 'Mudah'], ['normal', 'Normal'], ['hard', 'Sulit']];

export class Lobby {
  // opts: the menu options (name, map, size...); deck(): the player's deck; onStart(game, net, mode)
  constructor(opts, deck, onStart) {
    this.opts = opts; this.deck = deck; this.onStart = onStart; this.net = null;
    $('olCreate').onclick = () => this.create();
    $('olJoin').onclick = () => this.join($('olCode').value);
    $('olCode').onkeydown = (e) => { if (e.key === 'Enter') this.join($('olCode').value); };
    $('olCopy').onclick = () => { const l = $('olLink'); l.select(); (navigator.clipboard ? navigator.clipboard.writeText(l.value) : Promise.reject()).catch(() => document.execCommand('copy')); this.note('Link disalin — kirim ke temanmu.'); Sound.ui(); };
    $('olBack').onclick = () => this.close();
    $('olAddBot').onclick = () => { this.net?.addBot($('olBotDiff').value); Sound.ui(); };
    $('olStartBtn').onclick = () => this.start();
  }
  get name() { return (this.opts.name || '').trim() || 'Pemain'; }
  note(t, bad) { $('olNote').textContent = t || ''; $('olNote').className = bad ? 'warn' : ''; }
  open(code) {
    $('lobby').classList.remove('hidden'); $('olRoom').classList.add('hidden'); $('olStart').classList.remove('hidden');
    $('olName').textContent = this.name;
    if (!Net.available()) { this.note('Mode online tidak tersedia: Firebase gagal dimuat (cek koneksi internet).', true); return; }
    this.note('');
    if (code) this.join(code);
  }
  async close() {
    $('lobby').classList.add('hidden');
    if (this.net) { const n = this.net; this.net = null; await n.leave(); }
    try { history.replaceState(null, '', location.pathname); } catch { }
  }
  bind(net) {
    this.net = net;
    net.on('lobby', () => this.render());
    net.on('game', (g) => {
      if (!g || this.busy || this.started === g.run) return;        // join() starts a game that is already running itself
      if (this.net !== net || $('lobby').classList.contains('hidden')) return;
      this.started = g.run;
      const seated = (g.seats || []).some(s => s && s.pid === net.pid);
      $('lobby').classList.add('hidden');
      this.onStart(g, net, seated ? 'play' : 'watch');
    });
  }
  setUrl(code) { try { history.replaceState(null, '', '?room=' + code); } catch { } }      // a reload rejoins the room
  async create() {
    if (this.busy) return; this.busy = true; Sound.ui(); this.note('Membuat room…');
    try {
      const net = new Net(); this.bind(net);
      const o = this.opts;
      await net.create(this.name, this.deck(), { map: o.map || 'random', size: o.size || 144, season: o.season || 'random', night: o.night || 'full' });
      this.setUrl(net.code);
      this.note('Room dibuat. Bagikan link di atas — teman yang membukanya langsung masuk.');
      this.render();
    } catch (e) { console.error(e); this.note('Gagal membuat room: ' + e.message, true); this.net = null; }
    this.busy = false;
  }
  async join(code) {
    code = String(code || '').trim(); if (code.length < 4) { this.note('Masukkan kode room (5 huruf).', true); return; }
    if (this.busy) return; this.busy = true; Sound.ui(); this.note('Masuk ke room…');
    try {
      const net = new Net(); this.bind(net);
      const mode = await net.join(code, this.name, this.deck());
      this.setUrl(net.code);
      if (mode === 'lobby') { this.note(''); this.render(); }
      else {          // the game is already running: rejoin my kingdom, or watch
        const g = (await net.ref('game').get()).val();
        this.started = g.run; $('lobby').classList.add('hidden');
        this.onStart(g, net, mode);
      }
    } catch (e) { console.error(e); this.note(e.message, true); if (this.net) { await this.net.leave(); this.net = null; } }
    this.busy = false;
  }
  render() {
    const net = this.net; if (!net || !net.meta || $('lobby').classList.contains('hidden')) return;
    if (net.meta.status !== 'lobby' || !net.playersLoaded) return;
    if (!net.players[net.pid]) { if (net.wasSeated) { this.note('Kamu dikeluarkan dari room.', true); this.close(); } return; }
    net.wasSeated = true;
    $('olStart').classList.add('hidden'); $('olRoom').classList.remove('hidden');
    $('olCodeShow').textContent = net.code; $('olLink').value = net.link();
    const host = net.isHost(), seats = net.seated(), used = new Set(seats.map(([, p]) => p.color));
    // seats
    const rows = seats.map(([id, p]) => {
      const mine = id === net.pid, can = mine || (host && p.bot);
      const tag = [id === net.meta.host ? '👑 tuan rumah' : '', mine ? 'kamu' : '', p.bot ? 'AI' : '', !p.bot && !p.online ? 'terputus' : ''].filter(Boolean).join(' · ');
      return `<tr data-id="${esc(id)}" class="${!p.bot && !p.online ? 'off' : ''}">
        <td><button class="sw ${can ? 'can' : ''}" data-act="color" style="background:rgb(${PLAYER_RGB[p.color]})" title="${can ? 'Ganti warna' : ''}"></button></td>
        <td><b>${esc(p.name)}</b><small>${tag}</small></td>
        <td>${p.bot ? (host ? `<select data-act="diff">${DIFFS.map(([v, n]) => `<option value="${v}" ${p.diff === v ? 'selected' : ''}>${n}</option>`).join('')}</select>` : DIFFS.find(d => d[0] === p.diff)?.[1] || '') : ''}</td>
        <td>Tim <select data-act="team" ${can || host ? '' : 'disabled'}>${[1, 2, 3, 4].map(t => `<option ${p.team === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td>${host && p.bot ? '<button data-act="kick" class="x" title="Hapus">✕</button>' : ''}</td></tr>`;
    }).join('');
    $('olSeats').innerHTML = rows + (seats.length < MAX_SEATS ? `<tr class="empty"><td></td><td colspan="4"><i>Kursi kosong — bagikan link atau tambah AI</i></td></tr>` : '');
    $('olSeats').querySelectorAll('[data-act]').forEach(el => {
      const id = el.closest('tr').dataset.id, p = net.players[id], act = el.dataset.act;
      if (act === 'color') el.onclick = () => { if (!(id === net.pid || (host && p.bot))) return; const i = PLAYER_COLORS.indexOf(p.color); const nx = [1, 2, 3, 4].map(k => PLAYER_COLORS[(i + k) % PLAYER_COLORS.length]).find(c => !used.has(c)); if (nx) net.setPlayer(id, p.bot ? { color: nx, name: BOT_NAME[nx] } : { color: nx }); Sound.ui(); };
      if (act === 'team') el.onchange = () => net.setPlayer(id, { team: +el.value });
      if (act === 'diff') el.onchange = () => net.setPlayer(id, { diff: el.value });
      if (act === 'kick') el.onclick = () => net.removePlayer(id);
    });
    // game settings: the host edits, everyone sees
    const cfg = net.meta.cfg || {};
    $('olCfg').innerHTML = Object.entries(CFG).map(([k, list]) => `<label>${CFG_NAME[k]} <select data-k="${k}" ${host ? '' : 'disabled'}>${list.map(([v, n]) => `<option value="${v}" ${String(cfg[k]) === String(v) ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`).join('');
    $('olCfg').querySelectorAll('select').forEach(el => el.onchange = () => { const k = el.dataset.k; net.setCfg({ [k]: k === 'size' ? +el.value : el.value }); });
    $('olHostBar').classList.toggle('hidden', !host || seats.length >= MAX_SEATS);
    const teams = new Set(seats.map(([, p]) => p.team)), offline = seats.some(([, p]) => !p.bot && !p.online);
    const why = seats.length < 2 ? 'Butuh minimal 2 kerajaan (teman atau AI).' : teams.size < 2 ? 'Semua di tim yang sama — pisahkan timnya.' : offline ? 'Ada pemain yang terputus.' : '';
    $('olStartBtn').classList.toggle('hidden', !host);
    $('olStartBtn').disabled = !!why;
    $('olWait').textContent = host ? why : 'Menunggu tuan rumah memulai permainan…';
  }
  async start() {
    const net = this.net; if (!net || !net.isHost() || $('olStartBtn').disabled) return;
    Sound.ui(); $('olStartBtn').disabled = true;
    const deckKeys = Object.keys(DECKS), cfg = net.meta.cfg || {};
    const seats = net.seated().map(([pid, p]) => ({ pid, name: p.name, color: p.color, team: p.team, deck: p.bot ? null : (p.deck || null), bot: !!p.bot, diff: p.diff || 'normal', style: p.bot ? deckKeys[(Math.random() * deckKeys.length) | 0] : null }));
    const game = { cfg: { seed: (Math.random() * 1e9) | 0, map: cfg.map || 'random', size: cfg.size || 144, season: cfg.season || 'random', night: cfg.night || 'full' }, seats, run: Date.now() };
    try { await net.startGame(game); } catch (e) { this.note('Gagal memulai: ' + e.message, true); $('olStartBtn').disabled = false; }
  }
}
