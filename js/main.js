// Abad Kerajaan — an AoE2-style RTS for the web.  Boot, menus, game loop and input.
import { Application } from 'pixi.js';
import { CIVS, RELICS, CIV_KEYS, VICTORY, FORWARD } from './data.js';
import { openTechTree } from './techtree.js';
import { Saves } from './saves.js';
import { UNITS, BUILDINGS, TECHS, AGES, PLAYER_COLORS, PLAYER_NAMES, GAME_SPEED, PLAYER_RGB, RES_NAME, TREASURES, CARDS, XP, DECKS, SEASONS, MILITARY, DAY } from './data.js';
import { townRing } from './sim.js';
import { step, command, TICK, placementOk, canBuild, canAfford, distTo, hasBuilt, idx, alive, costOf, passable, nearestFree, trainType, unitCost } from './sim.js';
import { generate } from './map.js';
import { AI } from './ai.js';
import { loadAll, vq } from './assets.js';
import { View, iso, UNIT_BOX } from './render.js';
import { HUD } from './ui.js';
import { Sound } from './audio.js';
import { History, StatsPanel, score, exploredPct } from './stats.js';
import { CardPanel, DeckBuilder } from './cards.js';
import { Advisor } from './advisor.js';
import { recordGame, achievementsHtml, loadProfile, rankOf } from './achievements.js';
import { Lockstep } from './lockstep.js';
import { Lobby } from './lobby.js';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem('ak_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('ak_' + k, JSON.stringify(v)); } catch { } } };

class Game {
  constructor(app, A, opts) {
    this.app = app; this.A = A; this.opts = opts; this.me = 0;
    const on = this.online = opts.online || null;      // { net, seats, me, spectator }
    // setup = every choice that shapes the world (seed, players, civilizations, AI personalities). Built once with all
    // the randomness resolved, so a saved game / replay rebuilds the identical world and replays the recorded commands.
    const rp = this.replay = opts.replay || null;      // { rec, mode: 'load' | 'watch' }
    const setup = this.setup = rp ? rp.rec.setup : on ? Game.onlineSetup(on) : Game.makeSetup(opts);
    this.me = rp && rp.mode === 'watch' ? setup.me || 0 : on ? (on.spectator ? 0 : on.me) : setup.me;
    this.watch = (rp && rp.mode === 'watch') || (on ? !!on.spectator : setup.watch);
    if (on) this.seats = on.seats;
    this.W = generate({ size: setup.size, seed: setup.seed, type: setup.map, opts: { season: setup.season, night: setup.night, relicWin: setup.relicWin, life: setup.life === undefined ? false : setup.life !== 'off', victory: setup.victory, treaty: setup.treaty, popLimit: setup.popLimit, startRes: setup.startRes }, players: setup.players });
    this.ais = setup.ais.map(a => new AI(this.W, a.pid, a.diff));
    // the command log (save / replay): commands keyed by the tick they were given at
    this.rec = { v: 2, setup, cmds: rp && rp.mode === 'load' ? [] : rp ? rp.rec.cmds : [] };
    if (rp) { this.feedI = 0; this.feedEnd = rp.rec.tick || 0; if (rp.mode === 'load') this.ff = this.feedEnd; }
    this.view = new View(app, this.W, A, this.me);
    this.sel = []; this.groups = {}; this.acc = 0; this.speed = on ? 1 : setup.speed || 1; this.paused = false; this.placing = null; this.over = false;
    this.snd = new Sound(); this.lastAttackNote = -99; this.lastHoused = -99;
    if (IS_TOUCH) this.view.cam.zoom = 0.8;            // phones: see a bit more of the map
    const tc = this.W.ents.get(this.W.players[this.me].tc); this.centerOn(tc.x + 2, tc.y + 3);
    this.hud = new HUD(this);
    this.hist = new History(this.W); this.hist.onFound = (f) => this.onFound(f);
    this.stats = new StatsPanel(this, this.hist);
    this.cards = new CardPanel(this);
    this.advisor = new Advisor(this);
    this.track = { feudalAt: 0, maxVil: 0, spies: 0, lostTC: false };
    this.bindInput();
    if (this.watch) this.setupSpectator();
    this.snd.music('game'); this.snd.ambience(true); this.snd.loadSamples();
    this.hud.notify(`${AGES[1]} dimulai. Kumpulkan sumber daya dan kalahkan musuhmu!`, 'age');
    this.hud.notify(`Peta: ${this.W.map.name} — ${this.W.map.desc}`);
    const se = SEASONS[this.W.opts.season]; this.hud.notify(`${se.name}: ${se.desc}`);
    if (this.watch) this.hud.notify((this.replay ? '🎬 Replay — ' : 'Gaya AI: ') + this.W.players.map(p => p.name + (CIVS[p.civ] ? ' ' + CIVS[p.civ].glyph : '') + ' — ' + (p.style && DECKS[p.style] ? DECKS[p.style].name : 'pemain')).join(', '));
    const myCiv = !this.watch && this.W.players[this.me].civ && CIVS[this.W.players[this.me].civ];
    if (myCiv) this.hud.notify(`${myCiv.glyph} ${myCiv.name}: ${myCiv.desc}`, 'age');
    if (this.W.opts.relicWin) this.hud.notify('📿 Kemenangan Relik aktif: kuasai semua relik selama 5 menit untuk menang.');
    if (this.W.opts.victory !== 'conquest') this.hud.notify(`${this.W.opts.victory === 'regicide' ? '👑' : '⛰'} ${VICTORY[this.W.opts.victory].name}: ${VICTORY[this.W.opts.victory].desc}`, 'age');
    if (this.W.opts.treaty) this.hud.notify(`🕊 Gencatan senjata ${this.W.opts.treaty / 60} menit: belum ada yang bisa menyerang.`, 'age');
    const allies = this.W.players.filter(p => p.id !== this.me && p.team === this.W.players[this.me].team);
    if (!this.watch && allies.length) this.hud.notify(`🤝 Sekutu: ${allies.map(p => p.name).join(', ')} — berbagi pandangan. Upeti & tanda di 🤝 Diplomasi (Alt+klik = tanda).`, 'age');
    $('pSpeed').textContent = `Kecepatan: ${this.speed}x`;
    $('btnDiplo').classList.toggle('hidden', !!this.watch); $('btnDiplo').onclick = () => this.toggleDiplo();
    $('diploClose').onclick = () => this.toggleDiplo(false);
    $('btnTree').onclick = () => openTechTree(this.W.players[this.me], (k, z) => this.hud.iconStyle(k, z));
    if (!this.watch) this.hud.notify('Lokasi musuh belum diketahui. Kirim pengintai untuk menjelajah! (I = statistik)');
    if (on) {
      this.lock = new Lockstep(this, on.net, !!on.spectator);
      this.hud.notify(`🌐 Room ${on.net.code} — ${this.W.players.map(p => p.name + (p.ai ? ' (AI)' : '')).join(', ')}. Tekan Enter untuk chat.`, 'age');
      on.net.on('chat', (c) => this.hud.notify(`💬 ${c.name}: ${c.text}`, 'chat'));
      $('pSpeed').classList.add('hidden'); $('pauseMenu').querySelector('h2').textContent = 'Menu (permainan online tetap berjalan)';
      $('btnChat').classList.remove('hidden'); $('btnChat').onclick = () => this.openChat();
    }
    app.ticker.add(this.frame, this);
  }
  static makeSetup(opts) {
    const COLOR_NAME = { blue: 'Raja Biru', red: 'Raja Merah', green: 'Adipati Hijau', yellow: 'Baron Kuning' };
    const deckKeys = Object.keys(DECKS), rnd = (n) => (Math.random() * n) | 0, watch = opts.mode === 'watch';
    const colors = [opts.color, ...PLAYER_COLORS.filter(c => c !== opts.color)].slice(0, opts.players);
    const civOf = (c) => CIVS[c] ? c : CIV_KEYS[rnd(CIV_KEYS.length)];
    // every AI gets a random ready-made deck (its personality) and civilization; the player brings the deck built in the menu
    // teams: free-for-all, or allies (2 vs 2; 1 vs 2 = the two AIs together; 1 vs 1 unchanged)
    const teamOf = (i) => opts.teams !== 'ally' ? i : opts.players === 4 ? (i < 2 ? 0 : 1) : i === 0 ? 0 : 1;
    const players = colors.map((c, i) => { const ai = watch || i > 0; return { name: watch ? COLOR_NAME[c] : i ? PLAYER_NAMES[i] : (opts.name || PLAYER_NAMES[0]), color: c, ai, team: teamOf(i),
      deck: ai ? null : (opts.deck && opts.deck.length >= 8 ? [...opts.deck] : null), style: ai ? deckKeys[rnd(deckKeys.length)] : null, civ: civOf(ai ? null : opts.civ) }; });
    return { size: opts.size, seed: opts.seed || ((Math.random() * 1e9) | 0), map: opts.map, season: opts.season === 'random' ? null : opts.season, night: opts.night || 'full',
      relicWin: opts.relicWin === 'on', life: opts.life || 'on', victory: opts.victory || 'conquest', treaty: +opts.treaty || 0, popLimit: +opts.popLimit || 200, startRes: opts.startRes || 'standar', speed: +opts.speed || 1,
      players, ais: players.map((p, i) => p.ai ? { pid: i, diff: opts.diff } : null).filter(Boolean), me: 0, watch };
  }
  // online: everything comes from the host's game record, so every client builds the identical world
  static onlineSetup(on) {
    const g = on.game || {}, cfg = g.cfg || {};
    const players = on.seats.map(s => ({ name: s.name, color: s.color, ai: !!s.bot, team: s.team, deck: !s.bot && s.deck && s.deck.length >= 8 ? [...s.deck] : null, style: s.style || null, civ: s.civ || null }));
    return { size: cfg.size, seed: cfg.seed, map: cfg.map, season: cfg.season === 'random' ? null : cfg.season, night: cfg.night || 'full', relicWin: !!cfg.relicWin, players,
      life: cfg.life || 'on', victory: cfg.victory || 'conquest', treaty: +cfg.treaty || 0, popLimit: +cfg.popLimit || 200, startRes: cfg.startRes || 'standar', speed: +cfg.speed || 1,
      ais: on.seats.map((s, i) => s.bot ? { pid: i, diff: s.diff || 'normal' } : null).filter(Boolean), me: on.spectator ? 0 : on.me, watch: !!on.spectator, online: true };
  }
  // meta commands in a command log (online: a dropped player's AI takes over and hands back)
  applyMeta(c) {
    const W = this.W, P = W.players[c.pid]; if (!P) return;
    if (c.t === '_ai' && !this.ais.some(a => a.pid === c.pid)) { P.ai = true; this.ais.push(new AI(W, c.pid, 'normal')); }
    if (c.t === '_human') { P.ai = false; this.ais = this.ais.filter(a => a.pid !== c.pid || this.setup.ais.some(s => s.pid === c.pid)); }
  }
  // replay / load: hand the sim the recorded commands of this tick (before the AIs think, like when they were given)
  feed() {
    const cmds = this.rec.cmds, W = this.W;
    if (!this.replay) return;
    const src = this.replay.mode === 'load' ? this.replay.rec.cmds : cmds;
    while (this.feedI < src.length && src[this.feedI][0] <= W.tick) {
      const c = JSON.parse(JSON.stringify(src[this.feedI][1])); this.feedI++;
      if (c.t[0] === '_') this.applyMeta(c); else command(W, c);
      if (this.replay.mode === 'load') cmds.push([W.tick, c]);
    }
  }
  // one simulation tick (shared by play, fast-forward and replay)
  tickOnce(events = true) {
    this.feed();
    for (const ai of this.ais) ai.tick();
    step(this.W); this.hist.tick();
    for (const e of this.W.ev) if (events || e.k === 'victory' || e.k === 'defeated') this.onEvent(e);
    this.W.ev.length = 0;
  }
  // a snapshot to save: setup + every command so far (+ where we are)
  record() { return { v: 2, setup: this.setup, cmds: this.rec.cmds, tick: this.W.tick }; }
  saveGame(slot, kind = 'save') {
    const P = this.W.players[this.me];
    const meta = { kind, date: Date.now(), map: this.W.map.name, minutes: Math.floor(this.W.t / 60), me: this.watch ? null : P.name, players: this.W.players.map(p => ({ name: p.name, color: p.color, civ: p.civ, ai: p.ai })), online: !!this.online };
    return Saves.put(slot, meta, this.record());
  }
  sfx(k, x, y) {
    let gain = 1, pan = 0;
    if (x !== undefined) {
      const [sx, sy] = this.view.worldToScreen(x, y), s = this.app.screen; if (sx < -80 || sy < -80 || sx > s.width + 80 || sy > s.height + 80) return;
      pan = (sx / s.width - 0.5) * 1.4;                                                   // left/right by screen position
      gain = 1 - 0.45 * Math.min(1, Math.hypot(sx / s.width - 0.5, sy / s.height - 0.5) * 1.6);   // quieter towards the edges
      gain *= Math.min(1, 0.55 + 0.45 * this.view.cam.zoom);
    }
    this.snd.play(k, gain, pan);
  }
  hasBuilt(t) { return hasBuilt(this.W, this.me, t); }
  // a command from the local player: straight into the sim offline, through the lockstep online
  send(c) {
    if (this.lock) { this.lock.send(c); return; }
    if (this.watch || this.ff) return;
    this.rec.cmds.push([this.W.tick, JSON.parse(JSON.stringify(c))]);      // the log (saves, replays)
    command(this.W, c);
  }
  openChat() {
    const box = $('chatBox'), inp = $('chatIn'); box.classList.remove('hidden'); inp.value = ''; inp.focus();
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const t = inp.value.trim(); if (t) { const P = this.W.players[this.me]; this.online.net.chat(this.watch ? (this.online.name || 'Penonton') : P.name, this.watch ? 'gray' : P.color, t); } box.classList.add('hidden'); inp.blur(); }
      if (e.key === 'Escape') { box.classList.add('hidden'); inp.blur(); }
    };
  }
  get seeAll() { return (this.watch || !!this.lost) && !this.fogPov; }      // spectators and beaten players see the whole map (unless they turn the fog on)

  // ---------------------------------------------------------------- loop
  frame() {
    const dt = Math.min(0.1, this.app.ticker.deltaMS / 1000);
    if (this.ff) {                       // loading a save: replay every command at full speed
      const t0 = performance.now();
      while (this.W.tick < this.ff && performance.now() - t0 < 40) this.tickOnce(false);
      const k = this.W.tick / Math.max(1, this.ff);
      $('netStatus').textContent = `Memuat permainan… ${Math.floor(k * 100)}%`; $('netStatus').classList.remove('hidden');
      if (this.W.tick >= this.ff) { this.ff = null; this.feed(); this.replay = null; $('netStatus').classList.add('hidden'); this.hud.notify('Permainan dimuat. Lanjutkan!', 'age'); }
    } else if (this.lock) {
      this.lock.update(dt);
      const st = this.lock.status(); if (st !== this.netSt) { this.netSt = st; $('netStatus').textContent = st; $('netStatus').classList.toggle('hidden', !st); }
    } else if (!this.paused && !this.over) {
      this.acc += dt * GAME_SPEED * this.speed;
      // up to 16 ticks a frame within ~32 ms (20x needs ~5 a frame at 60 fps; a slow late game just runs as fast as it can)
      let n = 0; const t0 = performance.now();
      while (this.acc >= TICK && n++ < 16 && (n <= 2 || performance.now() - t0 < 32)) {
        if (this.replay && this.replay.mode === 'watch' && this.W.tick >= this.feedEnd && this.feedI >= this.rec.cmds.length) {
          if (!this.replayDone) { this.replayDone = true; this.hud.notify('🎬 Replay selesai.', 'age'); } this.acc = 0; break;
        }
        this.tickOnce(); this.acc -= TICK;
      }
      if (!this.watch && !this.online && !this.replay && this.W.t - (this.lastAuto || 0) > 120 && this.W.winner < 0) { this.lastAuto = this.W.t; this.saveGame('auto', 'auto'); }
      if (this.acc >= TICK * 4) this.acc = 0;        // fell behind: don't try to catch up (that would freeze the screen)
    }
    if (this.watch) this.spectatorCam(dt);
    this.scroll(dt);
    this.view.applyCam();
    this.sel = this.sel.filter(id => this.W.ents.has(id));
    this.view.sync(Math.min(1, this.acc / TICK), this.paused && !this.lock ? 0 : dt * this.speed, this.sel, this.hover);
    this.hud.update(dt); this.stats.update(dt); this.cards.update(dt); this.advisor.update(dt);
    if ((this.trackT = (this.trackT || 0) - dt) <= 0) { this.trackT = 2; let v = 0; for (const e of this.W.dyn.values()) if (e.kind === 'unit' && e.owner === this.me && e.type === 'villager') v++; this.track.maxVil = Math.max(this.track.maxVil, v); }
    if (this.placing) this.updateGhost();
  }
  onEvent(e) {
    if (this.watch) return this.onSpectatorEvent(e);
    const mine = e.owner === this.me, W = this.W, P = W.players[this.me];
    const vis = e.x !== undefined ? P.vis[idx(W, Math.min(W.size - 1, Math.max(0, Math.floor(e.x))), Math.min(W.size - 1, Math.max(0, Math.floor(e.y))))] : 0;
    if (vis || mine) this.view.fx(e);
    switch (e.k) {
      case 'chop': case 'hammer': case 'swing': case 'shoot': case 'arrowhit': case 'forage': case 'treefall': case 'farm': if (vis) this.sfx(e.k, e.x, e.y); break;
      case 'mine': if (vis) this.sfx(e.res === 'gold' ? 'mine_gold' : 'mine_stone', e.x, e.y); break;
      case 'deposit': if (vis) this.sfx('drop_' + (e.res === 'iron' ? 'stone' : e.res || 'food'), e.x, e.y); break;
      case 'die': if (vis) this.sfx(UNITS[e.type].animal ? e.type : e.type === 'villager' ? 'dieVil' : UNITS[e.type].naval || UNITS[e.type].cls === 'siege' ? 'collapse' : 'die', e.x, e.y); break;
      case 'fish': if (vis) this.sfx('forage', e.x, e.y); break;
      case 'gunshot': case 'cannon': case 'boom': if (vis) this.sfx(e.k, e.x, e.y); break;
      case 'dusk': if (W.opts.night === 'full' && !P.mods.nightWork && !P.techs.has('torches')) this.hud.notify('🌙 Malam tiba — penduduk desa pulang beristirahat. Riset Obor Kerja agar mereka lembur sampai tengah malam.', 'age'); else if (W.opts.night === 'full') this.hud.notify('🌙 Malam tiba — penduduk lembur dengan obor sampai tengah malam.', 'age'); else this.hud.notify('🌙 Malam tiba — jarak pandang berkurang.', 'age'); break;
      case 'dawn': this.hud.notify(`☀ Fajar hari ke-${e.day}. Rakyat makan dari lumbung.`); break;
      case 'hungry': if (mine) { this.snd.play('alert'); this.hud.notify(`Lumbung kosong! Rakyat kelaparan (butuh ${e.food} makanan) — kerja lebih lambat hari ini.`, 'bad'); } break;
      case 'weather': this.hud.notify(e.snow ? '🌨 Salju turun lebat.' : '🌧 Hujan turun — panah kurang tepat, pandangan memendek.'); break;
      case 'spy': if (mine) { this.track.spies++; this.advisor.onSpy(e.report); this.snd.play('tech'); this.hud.notify('🕵 Mata-mata kembali membawa laporan! Lihat Penasihat (!).', 'age'); } break;
      case 'spec': if (mine) this.hud.notify(`Pasukan khusus: semua ${UNITS[e.from].name} kini menjadi ${UNITS[e.to].name}!`, 'age'); break;
      case 'repairstop': if (mine && W.t - (this.lastRepNote || -99) > 15) { this.lastRepNote = W.t; this.hud.notify('Perbaikan berhenti: sumber daya kurang.', 'bad'); } break;
      case 'board': case 'unload': if (mine) this.sfx('forage', e.x, e.y); break;
      case 'collapse': if (vis || mine) this.sfx('collapse', e.x, e.y); if (!P.alive) break; if (mine && e.type === 'town_center') this.track.lostTC = true; if (mine && (e.hit || e.type !== 'farm')) this.hud.notify(`${BUILDINGS[e.type].name} kita hancur!`, 'bad'); else if (mine) this.hud.notify('Ladang habis — tanam ulang.'); break;
      case 'built': if (mine) { this.snd.play('built'); this.hud.notify(`${BUILDINGS[e.type].name} selesai dibangun.`); } break;
      case 'trained': if (mine) this.snd.play(e.type === 'villager' ? 'trainedVil' : 'trained'); break;
      case 'tech': if (mine) { this.snd.play('tech'); this.hud.notify(`Riset selesai: ${TECHS[e.tech].name}.`); } break;
      case 'age': {
        const p = W.players[e.owner];
        if (mine) { this.snd.play('age'); this.hud.notify(`Kita telah maju ke ${AGES[e.age]}! Kota berubah wujud.`, 'age'); const tc = W.ents.get(p.tc); if (tc) this.view.fx({ k: 'age', x: tc.x + 2, y: tc.y + 2 }); if (e.age === 2 && !this.track.feudalAt) this.track.feudalAt = W.t; }
        else this.hud.notify(`${p.name} telah maju ke ${AGES[e.age]}.`, 'enemy');
        break;
      }
      case 'housed': if (mine && W.t - this.lastHoused > 20) { this.lastHoused = W.t; this.snd.play('alert'); this.hud.notify('Butuh lebih banyak rumah!', 'bad'); } break;
      case 'hit': if (mine && W.t - this.lastAttackNote > 15) { this.lastAttackNote = W.t; this.snd.play('alert'); this.hud.notify('Kita diserang!', 'bad'); this.attackAt = [e.x, e.y]; } break;
      case 'ack': break;   // voiced immediately when the order is given (see rightClickWorld)
      case 'hunt': if (vis) this.sfx('hunt', e.x, e.y); break;
      case 'treasure':
        if (mine) { this.snd.play('treasure'); this.hud.notify(`Harta karun ditemukan! +${e.amount} ${RES_NAME[TREASURES[e.type].res]}`, 'age'); this.view.fx({ k: 'age', x: e.x, y: e.y }); }
        else if (vis) this.hud.notify(`${W.players[e.owner].name} mengambil harta karun.`, 'enemy');
        break;
      case 'sheep': if (mine && vis) this.sfx('sheep', e.x, e.y); break;
      case 'defeated':
        this.hud.notify(`${W.players[e.owner].name} ${e.resign ? 'menyerah' : e.regicide ? 'kalah — Rajanya tewas' : 'telah dikalahkan'}.`, e.owner === this.me ? 'bad' : 'age');
        if (e.owner === this.me && !this.lost && W.winner < 0) this.end(false);      // others may still be fighting (1 vs 2 / 1 vs 3)
        break;
      case 'victory': if (e.relic) { this.relicWin = true; this.hud.notify('📿 Kemenangan Relik!', 'age'); } if (e.wonder) this.hud.notify('🏛 Kemenangan Keajaiban Dunia!', 'age'); if (e.koth) this.hud.notify('⛰ Kemenangan Raja Bukit!', 'age'); if (e.prosper) this.hud.notify('⭐ Kemenangan Kemakmuran!', 'age'); this.end(e.team === W.players[this.me].team); break;
      case 'shipready': if (mine) { this.snd.play('card'); this.hud.notify('Kiriman Kerajaan tersedia! Buka 🃏 Kiriman (K) dan pilih kartu.', 'age'); } break;
      case 'shipsent': if (mine) this.hud.notify(`Kiriman berangkat: ${CARDS[e.card].name} — tiba dalam ${XP.travel} detik.`); break;
      case 'shipment': if (mine) { this.snd.play('ship'); this.hud.notify(`Kiriman tiba di Pusat Kota: ${CARDS[e.card].name}!`, 'age'); this.view.fx({ k: 'age', x: e.x, y: e.y }); } break;
      case 'trade': if (mine) this.snd.play('coin'); break;
      case 'convert':
        if (mine) { this.snd.play('tech'); this.hud.notify(`✝ ${UNITS[e.type].name} musuh berhasil dikonversi!`, 'age'); }
        else if (e.from === this.me) { this.snd.play('alert'); this.hud.notify(`${UNITS[e.type].name} kita dikonversi oleh biarawan ${W.players[e.owner].name}!`, 'bad'); }
        if (vis || mine || e.from === this.me) this.view.fx(e); break;
      case 'chant': if (vis) this.view.fx(e); break;
      case 'relic': if (mine) { this.snd.play('treasure'); this.hud.notify(`📿 Relik disimpan di Biara: +${Math.round(RELICS.gold * 60)} emas per menit.`, 'age'); } else if (vis) this.hud.notify(`${W.players[e.owner].name} menyimpan sebuah relik.`, 'enemy'); break;
      case 'relicpick': if (mine) this.hud.notify('Biarawan membawa relik — antar ke Biara (klik kanan Biara).'); break;
      case 'relichold': { const t = W.players.find(p => p.team === e.team); this.hud.notify(t && t.team === P.team ? `📿 Semua relik kita kuasai! Pertahankan ${Math.round(e.secs / 60)} menit untuk menang.` : `📿 ${t ? t.name : 'Musuh'} menguasai semua relik! Rebut atau hancurkan Biaranya dalam ${Math.round(e.secs / 60)} menit!`, t && t.team === P.team ? 'age' : 'bad'); break; }
      case 'relicbroken': this.hud.notify('Penguasaan relik terputus.'); break;
      case 'bell': if (mine) this.hud.notify(e.on ? '🔔 Lonceng Kota! Penduduk berlindung dan menembakkan panah dari dalam.' : '🔔 Lonceng dibunyikan lagi — penduduk kembali bekerja.', 'age'); else if (e.on && vis) this.hud.notify(`${W.players[e.owner].name} membunyikan lonceng kota.`, 'enemy'); break;
      case 'heal': if (vis && Math.random() < 0.3) this.view.fx({ k: 'heal', x: e.x, y: e.y }); break;
      case 'flare': { const o = W.players[e.owner]; if (o.team !== P.team) break; this.view.flare(e.x, e.y, ((PLAYER_RGB[o.color][0] << 16) | (PLAYER_RGB[o.color][1] << 8) | PLAYER_RGB[o.color][2])); this.hud.flares = [...(this.hud.flares || []), { x: e.x, y: e.y, t: performance.now(), color: `rgb(${PLAYER_RGB[o.color]})` }]; if (!mine) { this.snd.play('alert'); this.hud.notify(`🚩 ${o.name} memberi tanda di peta.`, 'age'); } break; }
      case 'tribute': if (e.to === this.me) { this.snd.play('coin'); this.hud.notify(`🎁 ${W.players[e.owner].name} mengirim upeti: ${e.n} ${RES_NAME[e.res]}.`, 'age'); } else if (mine) this.hud.notify(`Upeti terkirim ke ${W.players[e.to].name}: ${e.n} ${RES_NAME[e.res]} tiba.`); break;
      case 'tradegold': if (mine) this.snd.play('coin'); break;
      case 'fishtrap': if (mine) this.hud.notify('🪤 Perangkap ikan dipasang — kirim Kapal Nelayan.'); break;
      case 'treatyend': this.snd.play('alert'); this.hud.notify('⚔ Gencatan senjata berakhir! Serangan kini dimungkinkan.', 'bad'); break;
      case 'wonderbuilt': { const o = W.players[e.owner]; this.snd.play('age'); this.hud.notify(o.team === P.team ? `🏛 Keajaiban ${o.name} berdiri! Pertahankan ${Math.round(e.secs / 60)} menit untuk menang.` : `🏛 ${o.name} menyelesaikan Keajaiban Dunia! Hancurkan dalam ${Math.round(e.secs / 60)} menit atau kalah!`, o.team === P.team ? 'age' : 'bad'); break; }
      case 'wonderlost': this.hud.notify('🏛 Sebuah Keajaiban Dunia runtuh!', 'age'); break;
      case 'colony': if (mine) this.hud.notify('⛵ Pemukim berlayar untuk mendirikan kota di pulau lain.', 'age'); else if (vis) this.hud.notify(`⛵ ${W.players[e.owner].name} mengirim pemukim ke pulau lain!`, 'enemy'); break;
      case 'shaftdone': if (mine) this.hud.notify('⛏ Urat bijih sebuah Tambang Bawah Tanah habis — tambangnya runtuh. Gali tambang baru di tempat lain.', 'bad'); break;
      case 'colonyland': if (mine) this.hud.notify('🏰 Pemukim mendarat — Pusat Kota baru sedang dibangun.', 'age'); break;
      case 'birth': if (mine) { this.snd.play('trainedVil'); this.hud.notify(`👶 Bayi lahir di keluarga ${e.fam}: ${e.name.split(' ')[0]}!`, 'age'); } break;
      case 'grownup': if (mine) this.hud.notify(`🧑 ${e.name} kini dewasa dan siap bekerja.`); break;
      case 'outbreak': if (mine) { this.snd.play('alert'); this.hud.notify(`🤒 Wabah! ${e.name} jatuh sakit — penyakit menular ke yang berdekatan. Bangun Balai Pengobatan dan Sumur.`, 'bad'); } break;
      case 'contagion': if (mine && W.t - (this.lastContagion || -99) > 60) { this.lastContagion = W.t; this.hud.notify('🤒 Penyakit tertular dari orang asing!', 'bad'); } break;
      case 'lifedeath': if (mine && W.t - (this.lastLifeDeath || -99) > 8) { this.lastLifeDeath = W.t; this.snd.play('alert'); this.hud.notify(`💀 ${e.name} meninggal karena ${e.why}.`, 'bad'); } break;
      case 'desert': if (mine) { this.snd.play('alert'); this.hud.notify(`🚶 ${e.name} meninggalkan kerajaan karena tidak bahagia. Warga butuh hiburan — bangun Kedai!`, 'bad'); } break;
      case 'penned': if (mine && W.t - (this.lastPenned || -99) > 30) { this.lastPenned = W.t; this.hud.notify('🐑 Ternak masuk padang kandang — akan bertambah gemuk dan menghasilkan susu.'); } break;
      case 'prosperhold': { const o = W.players[e.owner]; this.snd.play('alert'); this.hud.notify(o.team === P.team ? `⭐ Kerajaan ${o.name} makmur! Pertahankan 10 menit untuk menang.` : `⭐ ${o.name} mencapai kemakmuran — menang dalam 10 menit kecuali dihentikan!`, o.team === P.team ? 'age' : 'bad'); break; }
      case 'prosperlost': if (mine) this.hud.notify('⭐ Kemakmuran turun di bawah batas — hitungan mundur berhenti.', 'bad'); break;
      case 'war': {        // the war commanders' chronicle: wars on us and our allies in full, elsewhere only fallen towns
        const o = W.players[e.owner], vs = e.foe >= 0 ? W.players[e.foe] : null, onUs = vs && vs.team === P.team, ours = o.team === P.team;
        if (onUs) { if (['declare', 'march', 'siege', 'fall', 'conquer', 'wonder'].includes(e.kind)) this.snd.play('alert'); this.hud.notify('⚔ ' + e.text, e.kind === 'retreat' || e.kind === 'truce' ? 'age' : 'bad'); if (e.kind === 'siege' || e.kind === 'march') this.attackAt = [e.x, e.y]; }
        else if (ours && e.kind !== 'alarm') this.hud.notify('⚔ ' + e.text, 'age');
        else if (e.kind === 'fall' || e.kind === 'conquer') this.hud.notify('⚔ ' + e.text, 'enemy');
        break;
      }
      case 'kothcapture': { const o = W.players[e.owner]; if (!o) break; this.snd.play('alert'); this.hud.notify(o.team === P.team ? `⛰ Monumen dikuasai ${o.name}! Pertahankan ${Math.round(e.secs / 60)} menit.` : `⛰ ${o.name} merebut Monumen! Rebut kembali dalam ${Math.round(e.secs / 60)} menit!`, o.team === P.team ? 'age' : 'bad'); break; }
    }
  }
  // first sighting of an enemy building (stats History). Players only hear about their own discoveries.
  onFound(f) {
    const W = this.W, by = W.players[f.by], of = W.players[f.of];
    if (this.watch) { this.hud.notify(`${by.name} menemukan wilayah ${of.name}!`, 'enemy'); if (!this.hot || W.t - this.hot.t > 3) this.hot = { x: f.x, y: f.y, t: W.t }; }
    else if (f.by === this.me) { this.snd.play('alert'); this.hud.notify(`Pengintai kita menemukan wilayah ${of.name}!`, 'age'); }
  }
  // ---------------------------------------------------------------- spectator (bot vs bot)
  setupSpectator() {
    document.body.classList.add('watch'); $('specBar').classList.remove('hidden');
    this.view.reveal = true; this.autoCam = false; this.camT = 0; this.hot = null;   // free camera by default
    this.fogButton();
    const speeds = [...document.querySelectorAll('#specBar .sp')];
    const setSpeed = (v) => { this.speed = v; speeds.forEach(b => b.classList.toggle('on', +b.dataset.sp === v)); };
    speeds.forEach(b => b.onclick = () => { setSpeed(+b.dataset.sp); this.snd.play('click'); });
    setSpeed(2);
    $('spCam').onclick = () => this.toggleAutoCam(); $('spCam').classList.remove('on');
    $('spPov').onclick = () => this.cyclePov(); this.cyclePov(0);
    this.hud.notify('Mode penonton: kamera bebas — tarik dengan klik kiri, WASD/panah, tepi layar atau minimap. Tab = ganti sudut pandang, C = kamera otomatis, 1/2/4/8/0 = kecepatan (0 = 20x).', 'age');
  }
  // the eye: spectators (and beaten players) see the whole map, or only what the kingdom they follow has explored and knows
  fogButton() { const b = $('fogBtn'); b.classList.remove('hidden'); b.onclick = () => this.toggleFog(); this.toggleFog(false, true); }
  toggleFog(on = !this.fogPov, quiet = false) {
    this.fogPov = on; this.view.reveal = !on; this.view.revealed = false; this.view.fogT = 0;
    const b = $('fogBtn'); b.classList.toggle('off', on); b.title = on ? 'Kabut perang AKTIF (V): hanya wilayah yang dijelajahi dan diketahui kerajaan yang sedang dilihat — klik untuk membuka seluruh peta' : 'Kabut perang MATI (V): seluruh peta terlihat — klik untuk melihat hanya apa yang diketahui kerajaan yang sedang dilihat';
    if (quiet) return;
    this.snd.play('click');
    this.hud.notify(on ? `👁 Kabut perang aktif. ${this.fogNote()} Tab = ganti kerajaan.` : '👁 Kabut perang mati: seluruh peta terlihat.', 'age');
  }
  toggleAutoCam() { this.autoCam = !this.autoCam; $('spCam').classList.toggle('on', this.autoCam); this.camT = 0; this.camGoal = null; this.snd.play('click'); }
  // any hand-made camera move hands control back to the viewer
  userCam() { this.camGoal = null; if (this.watch && this.autoCam) { this.autoCam = false; $('spCam').classList.remove('on'); } }
  cyclePov(step = 1) {
    const live = this.W.players.filter(p => p.alive); if (!live.length) return;
    const i = (live.findIndex(p => p.id === this.me) + step + live.length) % live.length;
    this.me = live[i].id; this.view.me = this.me;
    const p = this.W.players[this.me]; $('spPov').textContent = p.name; $('spPov').style.color = 'rgb(' + PLAYER_RGB[p.color] + ')';
    if (step) { const tc = this.W.ents.get(p.tc); if (tc) this.centerOn(tc.x + 2, tc.y + 2); }
    if (step && this.fogPov) this.hud.notify('👁 ' + this.fogNote(), 'age');
  }
  // how much of the map the followed kingdom knows (the Juru Peta card draws all of it)
  fogNote() {
    const P = this.W.players[this.me], pct = Math.round(exploredPct(this.W, P));
    return `Hanya yang diketahui ${P.name} — ${pct}% peta ${P.cards.includes('survey') ? '(kartu Juru Peta: seluruh medan tergambar, unit musuh tetap tak terlihat)' : 'dijelajahi'}.`;
  }
  onSpectatorEvent(e) {
    const W = this.W;
    this.view.fx(e);
    switch (e.k) {
      case 'chop': case 'hammer': case 'swing': case 'shoot': case 'arrowhit': case 'forage': case 'treefall': case 'farm': case 'hunt': this.sfx(e.k, e.x, e.y); break;
      case 'mine': this.sfx(e.res === 'gold' ? 'mine_gold' : 'mine_stone', e.x, e.y); break;
      case 'deposit': this.sfx('drop_' + (e.res || 'food'), e.x, e.y); break;
      case 'die': this.sfx(UNITS[e.type].animal ? e.type : e.type === 'villager' ? 'dieVil' : 'die', e.x, e.y); break;
      case 'collapse': this.sfx('collapse', e.x, e.y); break;
      case 'hit': if (!this.hot || W.t - this.hot.t > 3) this.hot = { x: e.x, y: e.y, t: W.t }; break;
      case 'war':
        this.hud.notify('⚔ ' + e.text, ['fall', 'conquer', 'declare', 'wonder', 'hold'].includes(e.kind) ? 'age' : 'enemy');
        if (['declare', 'fall', 'conquer', 'wonder'].includes(e.kind)) this.snd.play('alert');
        if (['march', 'siege', 'fall'].includes(e.kind)) this.hot = { x: e.x, y: e.y, t: W.t + 8 };      // the auto camera goes to see the battle
        break;
      case 'age': {
        const p = W.players[e.owner]; this.snd.play('age'); this.hud.notify(p.name + ' maju ke ' + AGES[e.age] + '!', 'age');
        const tc = W.ents.get(p.tc); if (tc) { this.view.fx({ k: 'age', x: tc.x + 2, y: tc.y + 2 }); this.hot = { x: tc.x + 2, y: tc.y + 2, t: W.t }; }
        break;
      }
      case 'treasure': this.sfx('treasure', e.x, e.y); this.hud.notify(W.players[e.owner].name + ' menemukan harta karun: +' + e.amount + ' ' + RES_NAME[TREASURES[e.type].res]); break;
      case 'defeated': this.snd.play('alert'); this.hud.notify(W.players[e.owner].name + (e.resign ? ' menyerah!' : ' telah dikalahkan!'), 'bad'); if (this.me === e.owner) this.cyclePov(1); break;
      case 'victory': this.end(true); break;
      case 'shipment': this.hud.notify(`${W.players[e.owner].name} menerima kiriman: ${CARDS[e.card].name}`); this.sfx('ship', e.x, e.y); this.view.fx({ k: 'age', x: e.x, y: e.y }); break;
      case 'trade': this.sfx('coin', e.x, e.y); break;
      case 'gunshot': case 'cannon': case 'boom': this.sfx(e.k, e.x, e.y); break;
      case 'fish': this.sfx('forage', e.x, e.y); break;
      case 'dusk': this.hud.notify('🌙 Malam tiba.', 'age'); break;
      case 'dawn': this.hud.notify(`☀ Fajar hari ke-${e.day}.`); break;
      case 'weather': this.hud.notify(e.snow ? '🌨 Salju turun lebat.' : '🌧 Hujan turun.'); break;
      case 'spec': this.hud.notify(`${W.players[e.owner].name}: ${UNITS[e.from].name} menjadi ${UNITS[e.to].name}!`, 'age'); break;
      case 'tech': if (TECHS[e.tech].group || e.tech === 'gunpowder') this.hud.notify(`${W.players[e.owner].name} memilih ${TECHS[e.tech].name}.`, 'enemy'); break;
      case 'hungry': this.hud.notify(`${W.players[e.owner].name} kelaparan!`, 'bad'); break;
      case 'wonderbuilt': this.snd.play('age'); this.hud.notify(`🏛 ${W.players[e.owner].name} menyelesaikan Keajaiban Dunia!`, 'age'); break;
      case 'outbreak': this.hud.notify(`🤒 Wabah di kerajaan ${W.players[e.owner].name}!`, 'bad'); break;
      case 'birth': if (Math.random() < 0.3) this.hud.notify(`👶 Kelahiran di ${W.players[e.owner].name}: ${e.name}`); break;
      case 'desert': this.hud.notify(`🚶 Warga ${W.players[e.owner].name} pergi karena tidak bahagia.`); break;
      case 'kothcapture': if (W.players[e.owner]) this.hud.notify(`⛰ ${W.players[e.owner].name} menguasai Monumen!`, 'age'); break;
      case 'treatyend': this.hud.notify('⚔ Gencatan senjata berakhir!', 'bad'); break;
      case 'tribute': this.hud.notify(`🎁 ${W.players[e.owner].name} → ${W.players[e.to].name}: ${e.n} ${RES_NAME[e.res]}`); break;
    }
  }
  spectatorCam(dt) {
    if (!this.autoCam) return;
    this.camT -= dt;
    if (this.camT <= 0) {
      this.camT = 7;
      const W = this.W, h = this.hot;
      if (h && W.t - h.t < 12) this.camGoal = [h.x, h.y];
      else {   // nothing happening: visit a random town
        const live = W.players.filter(p => p.alive), p = live[Math.floor(Math.random() * live.length)], tc = p && W.ents.get(p.tc);
        if (tc) this.camGoal = [tc.x + 2, tc.y + 2];
      }
    }
    if (this.camGoal) { const [gx, gy] = iso(this.camGoal[0], this.camGoal[1]), c = this.view.cam, k = Math.min(1, dt * 1.8); c.x += (gx - c.x) * k; c.y += (gy - c.y) * k; }
  }
  end(win) {
    if (this.watch) {
      this.over = true; this.snd.play('victory'); this.snd.music(null);
      const w = this.W.players.find(p => p.team === this.W.winner);
      $('endTitle').textContent = w ? w.name + ' Menang!' : 'Permainan Selesai'; $('endTitle').className = 'win';
      this.endTable(); return;
    }
    this.over = true; this.snd.play(win ? 'victory' : 'defeat'); this.snd.music(null);
    const P = this.W.players, w = P.find(p => p.team === this.W.winner);
    $('endTitle').textContent = win ? 'Kemenangan!' : this.lost && w ? `Kekalahan — ${w.name} menang` : 'Kekalahan';
    $('endTitle').className = win ? 'win' : 'lose';
    this.endTable(P);
    // beaten while others still fight: keep watching the rest of the match with the whole map revealed
    $('endWatch').classList.toggle('hidden', win || this.W.winner >= 0);
    $('endWatch').onclick = () => {
      this.lost = true; this.over = false; this.view.reveal = true; this.view.revealed = false; $('endScreen').classList.add('hidden'); this.fogButton();
      this.snd.music('game'); this.hud.notify('Kerajaanmu telah jatuh. Menonton sisa pertandingan — seluruh peta terbuka.', 'bad');
    };
  }
  resignMe() {
    const b = $('pResign');
    if (!this.resignAsk) { this.resignAsk = true; b.textContent = '🏳 Yakin menyerah? Klik sekali lagi'; setTimeout(() => { this.resignAsk = false; b.textContent = '🏳 Menyerah'; }, 4000); return; }
    this.resignAsk = false; b.textContent = '🏳 Menyerah';
    this.send({ t: 'resign', pid: this.me }); this.togglePause();
  }
  trade(b, res, buy) { this.send({ t: 'trade', pid: this.me, bid: b.id, res, buy }); }
  setFormation(f) { const ids = this.ownUnits().filter(u => MILITARY(u.type) && !u.nav).map(u => u.id); this.send({ t: 'form', pid: this.me, ids, f }); }
  unloadHere() {
    const ships = this.ownUnits().filter(u => u.cargo && u.cargo.length);
    for (const s of ships) { const f = nearestFree(this.W, s.x, s.y, this.me, 6); if (f) this.send({ t: 'unload', pid: this.me, ids: [s.id], x: f[0] + 0.5, y: f[1] + 0.5 }); }
  }
  startTarget(kind) { this.targeting = kind; this.placing = null; this.view.setGhost(null); this.hud.notify({ patrol: 'Klik titik tujuan patroli (Esc batal).', follow: 'Klik unit yang ingin dikawal (Esc batal).', ground: 'Klik titik yang ingin dibombardir (Esc batal).', flare: 'Klik titik di peta atau minimap untuk memberi tanda ke sekutu (Esc batal).' }[kind]); this.snd.play('click'); }
  townWatch() {
    const ids = this.ownUnits().filter(u => MILITARY(u.type) && !u.nav).map(u => u.id); if (!ids.length) return;
    const pts = townRing(this.W, this.me, this.W.size >= 180 ? 15 : 13, 8);
    if (pts.length < 3) { this.hud.notify('Tidak ada Pusat Kota untuk dijaga.', 'bad'); return; }
    this.send({ t: 'patrol', pid: this.me, ids, pts, guard: true }); this.snd.play('click');
    this.hud.notify(`🏰 ${ids.length} prajurit kini berjaga keliling kota.`);
  }
  sendFlare(x, y) { if (this.watch || this.lost) return; this.send({ t: 'flare', pid: this.me, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }); this.snd.play('click'); }
  // diplomacy: who is with whom, tribute, flares
  toggleDiplo(on = $('diploPanel').classList.contains('hidden')) {
    $('diploPanel').classList.toggle('hidden', !on); if (!on) return;
    const W = this.W, me = W.players[this.me], RN = { food: '🍖', wood: '🪵', gold: '🪙', stone: '🪨' };
    const row = (p) => { const rel = p.id === this.me ? 'Kamu' : p.team === me.team ? '🤝 Sekutu' : '⚔ Musuh';
      return `<tr class="${p.alive ? '' : 'dead'}"><td><i class="dot" style="background:rgb(${PLAYER_RGB[p.color]})"></i> <b>${p.name}</b> ${CIVS[p.civ] ? CIVS[p.civ].glyph : ''}</td><td>${rel}${p.alive ? '' : ' · kalah'}</td><td>${AGES[p.age].split(' ')[1]}</td>
        <td class="trib">${p.id !== this.me && p.alive ? Object.keys(RN).map(r => `<button data-to="${p.id}" data-r="${r}" title="Kirim 100 ${RES_NAME[r]} (80 tiba)">${RN[r]}+100</button>`).join('') : ''}</td></tr>`; };
    $('diploBody').innerHTML = `<table class="diplo"><tr><th>Kerajaan</th><th>Hubungan</th><th>Zaman</th><th>Upeti (komisi 20%)</th></tr>${W.players.map(row).join('')}</table>
      <p class="hint">Tim ditetapkan di awal permainan. Sekutu berbagi pandangan dan tidak bisa saling menyerang. ${W.opts.treaty && W.t < W.opts.treaty ? `🕊 Gencatan senjata berakhir dalam ${Math.ceil((W.opts.treaty - W.t) / 60)} menit.` : ''}</p>
      <div class="row"><button id="diploFlare">🚩 Beri Tanda di Peta (Alt+klik)</button></div>`;
    $('diploBody').querySelectorAll('button[data-to]').forEach(b => b.onclick = () => { this.send({ t: 'tribute', pid: this.me, to: +b.dataset.to, res: b.dataset.r, n: 100 }); this.snd.play('coin'); });
    $('diploFlare').onclick = () => { this.toggleDiplo(false); this.startTarget('flare'); };
  }
  useTarget(px, py) {
    const kind = this.targeting; this.targeting = null; this.app.canvas.style.cursor = '';
    const [x, y] = this.view.screenToWorld(px, py), t = this.pick(px, py), ids = this.ownUnits().map(u => u.id), q = !!(this.keys && this.keys.Shift) || undefined;
    if (kind === 'flare') { this.sendFlare(x, y); return; }
    if (!ids.length) return;
    if (kind === 'patrol') this.send({ t: 'patrol', pid: this.me, ids, x, y, q });
    if (kind === 'ground') this.send({ t: 'ground', pid: this.me, ids, x, y, q });
    if (kind === 'flare') { this.sendFlare(x, y); return; }
    if (kind === 'follow') { if (!t || t.kind !== 'unit') { this.hud.notify('Pilih sebuah unit untuk dikawal.', 'bad'); return; } this.send({ t: 'follow', pid: this.me, ids, target: t.id, q }); }
    this.view.marker(x, y, kind === 'patrol' ? 0x90d0ff : kind === 'ground' ? 0xff5040 : 0xffffff); this.snd.play('click');
  }
  setStance(st) { const ids = this.ownUnits().filter(u => MILITARY(u.type)).map(u => u.id); this.send({ t: 'stance', pid: this.me, ids, s: st }); this.snd.play('click'); }
  ringBell(on) { this.send({ t: 'bell', pid: this.me, on }); this.snd.play(on ? 'alert' : 'click'); }
  useSpy(b) { this.send({ t: 'ability', pid: this.me, bid: b.id }); this.snd.play('click'); }
  // what the achievements look at
  summary(win) {
    const W = this.W, P = W.players[this.me], s = P.stats;
    return { win, diff: this.opts.diff, players: W.players.length, t: W.t, map: W.map.type, season: W.opts.season, night: W.opts.night !== 'off', age: P.age, score: score(W, P).total,
      feudalAt: this.track.feudalAt, maxVil: this.track.maxVil, built: s.built, killed: s.killed, razed: s.razed, treasures: s.treasures, trades: s.trades, cards: P.cards.length,
      techs: [...P.techs], spies: this.track.spies, fished: s.fished, shipsSunk: s.shipsSunk, hungryDays: s.hungryDays, repaired: s.repaired, healed: s.healed || 0, bells: s.bells || 0, converted: s.converted || 0, relicWin: !!this.relicWin, lostTC: this.track.lostTC };
  }
  endTable(P = this.W.players) {
    this.hist.next = 0; this.hist.tick();      // final timeline sample
    $('endStats').innerHTML = `<tr><th></th><th>Skor</th><th>Unit dilatih</th><th>Membunuh</th><th>Kehilangan</th><th>Bangunan dibangun</th><th>Bangunan dihancurkan</th><th>Sumber daya</th><th>Zaman</th></tr>` +
      P.map(p => `<tr><td style="color:rgb(${PLAYER_RGB[p.color]})"><b>${p.name}</b></td><td><b>${score(this.W, p).total}</b></td><td>${p.stats.units}</td><td>${p.stats.killed}</td><td>${p.stats.lost}</td><td>${p.stats.built}</td><td>${p.stats.razed}</td><td>${Math.floor(p.stats.gathered)}</td><td>${AGES[p.age]}</td></tr>`).join('');
    $('endFull').onclick = () => { this.stats.tab = 'time'; this.stats.toggle(true); };
    if (!this.watch && !this.recorded) {
      this.recorded = true;
      const r = recordGame(this.summary(this.W.winner === this.W.players[this.me].team)), rk = rankOf(r.profile.xp);
      $('endAch').innerHTML = `<p>+${r.gained} XP · Gelar: <b>${rk.name}</b>${rk.next ? ` (${r.profile.xp}/${rk.next})` : ''}</p>` + (r.unlocked.length ? '<div class="achs">' + r.unlocked.map(a => `<div class="ach got"><b>🏆 ${a.name}</b><small>${a.desc}</small></div>`).join('') + '</div>' : '');
    } else if (this.watch) $('endAch').innerHTML = '';
    $('endScreen').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- camera
  // zoom keeping the world point under (px, py) fixed; far zoom-out for an overview of big maps
  zoomAt(px, py, f) {
    const v = this.view, c = v.cam, s = this.app.screen, z0 = c.zoom;
    const z = Math.max(this.watch || this.lost ? 0.1 : 0.18, Math.min(1.6, z0 * f)); if (z === z0) return;      // (was 0.22 / 0.3: big empires need a wider view)
    const X = (px - (s.width / 2 - c.x * z0)) / z0, Y = (py - (s.height / 2 - c.y * z0)) / z0;
    c.x = (s.width / 2 - (px - X * z)) / z; c.y = (s.height / 2 - (py - Y * z)) / z; c.zoom = z;
  }
  centerOn(x, y) { const [sx, sy] = iso(x, y); this.view.setCam(sx, sy); this.userCam(); }
  scroll(dt) {
    const k = this.keys || {}; const v = this.view; const sp = 900 * dt / v.cam.zoom;
    let dx = 0, dy = 0;
    if (k.ArrowLeft) dx -= sp; if (k.ArrowRight) dx += sp; if (k.ArrowUp) dy -= sp; if (k.ArrowDown) dy += sp;
    if (this.watch) { if (k.a || k.A) dx -= sp; if (k.d || k.D) dx += sp; if (k.w || k.W) dy -= sp; if (k.s || k.S) dy += sp; }
    const m = this.mouse;
    if (m && m.inside && !this.dragging && document.hasFocus()) { const s = this.app.screen, e = 6; if (m.x < e) dx -= sp; if (m.x > s.width - e) dx += sp; if (m.y < e) dy -= sp; if (m.y > s.height - e) dy += sp; }
    if (dx || dy) this.userCam();
    v.cam.x += dx; v.cam.y += dy;
    // clamp to the map diamond
    const S = this.W.size, [cx, cy] = [v.cam.x, v.cam.y];
    const [wx, wy] = [(cx / 48 + cy / 24) / 2, (cy / 24 - cx / 48) / 2];
    const nx = Math.max(-2, Math.min(S + 2, wx)), ny = Math.max(-2, Math.min(S + 2, wy));
    if (nx !== wx || ny !== wy) { const [a, b] = iso(nx, ny); v.cam.x = a; v.cam.y = b; }
  }

  // ---------------------------------------------------------------- selection + commands
  roleOf(u) { const d = UNITS[u.type]; if (!d || d.animal) return null; if (u.type === 'villager') return u.id % 2 ? 'vf' : 'vm'; return d.cls === 'cavalry' ? 'cav' : 'sol'; }
  select(ids, add = false) {
    this.sel = add ? [...new Set([...this.sel, ...ids])] : ids;
    const e = this.W.ents.get(this.sel[0]); if (!e) return;
    if (e.kind === 'building') { this.snd.play(e.owner === this.me ? 'sel_' + e.type : 'selBld'); return; }
    if (e.kind !== 'unit') { this.snd.play('click'); return; }
    if (UNITS[e.type].animal) { this.snd.play(e.type); return; }
    if (e.owner === this.me) { const r = this.roleOf(e); if (r) this.snd.voice(r, 'sel', e.id); }
  }
  pick(px, py) {
    const W = this.W, P = W.players[this.me]; let best = null, bz = -1e9, bunit = false;
    for (const [id, v] of this.view.views) {
      const e = W.ents.get(id); if (!e || !v.spr.visible || e.kind === 'proj' || e.kind === 'corpse' || e.kind === 'rubble') continue;
      if (e.kind === 'unit') {
        const [sx, sy] = this.view.worldToScreen(e.x, e.y); const z = this.view.cam.zoom; const [rw, hh] = UNIT_BOX[e.type] || [15, 62]; const tall = hh - 8;
        if (px > sx - rw * z && px < sx + rw * z && py > sy - tall * z && py < sy + 6 * z) { if (!bunit || v.spr.zIndex > bz) { best = e; bz = v.spr.zIndex; bunit = true; } }
        continue;
      }
      if (bunit) continue;
      const [x, y] = this.view.screenToWorld(px, py);
      let hit = x >= e.x && x < e.x + e.w && y >= e.y && y < e.y + e.h;
      if (!hit && e.kind === 'building') { const b = v.spr.getBounds(); hit = px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height * 0.85 && Math.abs(x - (e.x + e.w / 2)) < e.w && Math.abs(y - (e.y + e.h / 2)) < e.h; }
      if (!hit && e.kind === 'res' && e.type === 'tree') { const [sx, sy] = this.view.worldToScreen(e.x + 0.5, e.y + 0.5); const z = this.view.cam.zoom; hit = Math.abs(px - sx) < 22 * z && py < sy + 4 * z && py > sy - 110 * z; }
      if (hit && v.spr.zIndex > bz) { best = e; bz = v.spr.zIndex; }
    }
    return best;
  }
  ownUnits() { return this.sel.map(id => this.W.ents.get(id)).filter(e => e && e.kind === 'unit' && e.owner === this.me); }
  rightClickWorld(x, y, tgt = null) {
    if (this.watch) { this.centerOn(x, y); return; }
    const us = this.ownUnits();
    if (us.length) {
      this.send({ t: 'smart', pid: this.me, ids: us.map(u => u.id), target: tgt ? tgt.id : 0, x, y, q: !!(this.keys && this.keys.Shift) || undefined });   // shift: queue after the current order
      const lead = us.find(u => this.roleOf(u)) || us[0], role = this.roleOf(lead);
      if (role) {
        const hostile = tgt && (tgt.kind === 'unit' || tgt.kind === 'building') && tgt.owner !== this.me && !(tgt.kind === 'unit' && UNITS[tgt.type].animal && lead.type === 'villager');
        const work = lead.type === 'villager' && tgt && (tgt.kind === 'res' || (tgt.kind === 'building' && tgt.owner === this.me) || (tgt.kind === 'unit' && UNITS[tgt.type].food));
        this.snd.voice(role, hostile ? 'attack' : work ? 'work' : 'move', lead.id, true);
      }
      this.view.marker(tgt ? (tgt.kind === 'unit' ? tgt.x : tgt.x + tgt.w / 2) : x, tgt ? (tgt.kind === 'unit' ? tgt.y : tgt.y + tgt.h / 2) : y, tgt && tgt.owner !== undefined && tgt.owner !== this.me && tgt.kind !== 'res' ? 0xff4040 : 0x40ff40);
      return;
    }
    const b = this.sel.map(id => this.W.ents.get(id)).find(e => e && e.kind === 'building' && e.owner === this.me && e.built);
    if (b && BUILDINGS[b.type].trains) { this.send({ t: 'rally', pid: this.me, bid: b.id, x, y, target: tgt ? tgt.id : 0 }); this.view.marker(x, y, 0xffd040); this.snd.play('click'); }
  }
  stop() { this.send({ t: 'stop', pid: this.me, ids: this.ownUnits().map(u => u.id) }); }
  deleteSel() { if (this.watch) return; for (const id of this.sel) { const e = this.W.ents.get(id); if (e && e.owner === this.me) this.send({ t: 'delete', pid: this.me, id }); } }
  train(b, u) { const P = this.W.players[this.me], t = trainType(P, u); if (!UNITS[t] || !canAfford(P, unitCost(P, t))) { this.snd.play('nope'); return; } this.send({ t: 'train', pid: this.me, bid: b.id, type: u }); }
  research(b, t) { this.send({ t: 'research', pid: this.me, bid: b.id, tech: t }); }
  cancel(b, i) { this.send({ t: 'cancel', pid: this.me, bid: b.id, i }); this.snd.play('click'); }
  selectIdle() {
    const idle = [...this.W.ents.values()].filter(e => e.kind === 'unit' && e.owner === this.me && e.type === 'villager' && !e.order);
    if (!idle.length) return;
    this.idleI = ((this.idleI || 0) + 1) % idle.length; const u = idle[this.idleI];
    this.select([u.id]); this.centerOn(u.x, u.y);
  }
  startPlace(type) { if (!canBuild(this.W, this.me, type)) return; this.placing = { type, axis: 'x' }; if (BUILDINGS[type].water) this.hud.notify('Dermaga dibangun di atas air, menempel ke pantai.'); }

  updateGhost() {
    const p = this.placing, m = this.mouse; if (!m) return;
    const d = BUILDINGS[p.type];
    const [wx, wy] = this.view.screenToWorld(m.x, m.y);
    const w = d.len && p.axis === 'y' ? 1 : (d.len || d.n), h = d.len && p.axis === 'y' ? d.len : d.n;
    const i = Math.round(wx - w / 2), j = Math.round(wy - h / 2);
    let tiles = [];
    if (d.wall && p.start) tiles = this.wallLine(p.start[0], p.start[1], Math.floor(wx), Math.floor(wy)).map(([a, b]) => [a, b, placementOk(this.W, this.me, p.type, a, b)]);
    else for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) { const ok = placementOk(this.W, this.me, p.type, i + a, j + b) || (a || b) && placementOk(this.W, this.me, 'stone_wall', i + a, j + b); tiles.push([i + a, j + b, ok]); }
    const ok = placementOk(this.W, this.me, p.type, i, j, p.axis) && canAfford(this.W.players[this.me], costOf(this.W.players[this.me], p.type));
    p.i = i; p.j = j; p.ok = ok;
    this.view.setGhost(p.type, d.wall && p.start ? Math.floor(wx) : i, d.wall && p.start ? Math.floor(wy) : j, ok, tiles, p.axis);
  }
  wallLine(i0, j0, i1, j1) {
    const out = []; let i = i0, j = j0; out.push([i, j]);
    while (i !== i1 || j !== j1) { const di = Math.sign(i1 - i), dj = Math.sign(j1 - j); if (Math.abs(i1 - i) >= Math.abs(j1 - j)) i += di; else j += dj; out.push([i, j]); }
    return out;
  }
  place(shift) {
    const p = this.placing; const d = BUILDINGS[p.type];
    const vils = this.ownUnits().filter(u => u.type === 'villager').map(u => u.id);
    if (d.wall) {
      if (!p.start) { p.start = [Math.floor(this.view.screenToWorld(this.mouse.x, this.mouse.y)[0]), Math.floor(this.view.screenToWorld(this.mouse.x, this.mouse.y)[1])]; return; }
      const [wx, wy] = this.view.screenToWorld(this.mouse.x, this.mouse.y);
      const tiles = this.wallLine(p.start[0], p.start[1], Math.floor(wx), Math.floor(wy)).filter(([a, b]) => placementOk(this.W, this.me, p.type, a, b));
      if (tiles.length) { this.send({ t: 'place', pid: this.me, type: p.type, tiles, ids: vils }); this.snd.play('place'); }
      this.placing = shift ? { type: p.type, axis: p.axis } : null; this.view.setGhost(null); return;
    }
    if (!p.ok) {
      this.snd.play('nope');
      const W = this.W, k = W.terr && idx(W, Math.max(0, Math.min(W.size - 1, p.i)), Math.max(0, Math.min(W.size - 1, p.j)));
      if (k !== undefined && W.terr[k] && W.terr[k] - 1 !== this.me && W.players[W.terr[k] - 1].team !== W.players[this.me].team && !FORWARD.has(p.type)) this.hud.notify(`🚩 Wilayah ${W.players[W.terr[k] - 1].name}: di sini hanya boleh bangunan militer (barak, menara, kastil, tembok).`, 'bad');
      return;
    }
    this.send({ t: 'place', pid: this.me, type: p.type, i: p.i, j: p.j, axis: p.axis, ids: vils });
    this.snd.play('place');
    if (!shift || !canAfford(this.W.players[this.me], costOf(this.W.players[this.me], p.type))) { this.placing = null; this.view.setGhost(null); }
  }

  // ---------------------------------------------------------------- selection helpers (mouse + touch)
  boxSelect(ax, ay, bx, by, add = false) {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    const ids = [];
    for (const ent of this.W.dyn.values()) { if (ent.kind !== 'unit' || ent.owner !== this.me || ent.inside) continue; const [sx, sy] = this.view.worldToScreen(ent.x, ent.y); if (sx >= x0 && sx <= x1 && sy - 20 >= y0 - 20 && sy - 20 <= y1) ids.push(ent.id); }
    const people = ids.filter(id => !UNITS[this.W.ents.get(id).type].animal);     // sheep only when nothing else is boxed
    this.select(people.length ? people : ids, add);
  }
  clickSelect(t, add = false) {
    const now = performance.now();
    if (this.lastClick && this.lastClick.id === t.id && now - this.lastClick.t < 380 && t.kind === 'unit' && t.owner === this.me) {   // double click/tap: all of this type on screen
      const ids = [];
      for (const ent of this.W.dyn.values()) if (ent.kind === 'unit' && ent.owner === this.me && ent.type === t.type) { const [sx, sy] = this.view.worldToScreen(ent.x, ent.y); if (sx > 0 && sy > 0 && sx < this.app.screen.width && sy < this.app.screen.height) ids.push(ent.id); }
      this.select(ids);
    } else this.select([t.id], add && t.owner === this.me);
    this.lastClick = { id: t.id, t: now };
  }

  // ---------------------------------------------------------------- touch: tap = select / command, drag = pan,
  // pinch = zoom (two fingers also pan), long-press or the ▢ button = box select, building ghost follows the finger
  touchDown(e) {
    const T = this.touches || (this.touches = new Map());
    T.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    this.mouse = { x: e.offsetX, y: e.offsetY, inside: false };
    if (T.size === 1) {
      this.tap = { x: e.offsetX, y: e.offsetY, t: performance.now(), moved: false };
      if (this.placing) this.updateGhost();
      clearTimeout(this.lpTimer);
      if (!this.watch) this.lpTimer = setTimeout(() => { if (this.tap && !this.tap.moved && !this.placing) { this.boxFrom = [this.tap.x, this.tap.y]; navigator.vibrate?.(15); } }, 420);
      if (this.boxMode) this.boxFrom = [e.offsetX, e.offsetY];
    } else { this.tap = null; this.boxFrom = null; $('selbox').style.display = 'none'; clearTimeout(this.lpTimer); this.pinch = this.pinchState(); }
  }
  pinchState() {
    const p = [...this.touches.values()]; if (p.length < 2) return null;
    return { d: Math.max(20, Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)), cx: (p[0].x + p[1].x) / 2, cy: (p[0].y + p[1].y) / 2 };
  }
  touchMove(e) {
    const T = this.touches, p = T && T.get(e.pointerId); if (!p) return;
    const dx = e.offsetX - p.x, dy = e.offsetY - p.y; p.x = e.offsetX; p.y = e.offsetY;
    const c = this.view.cam;
    if (T.size >= 2) {
      const s = this.pinchState();
      if (this.pinch && s) { this.zoomAt(s.cx, s.cy, s.d / this.pinch.d); c.x -= (s.cx - this.pinch.cx) / c.zoom; c.y -= (s.cy - this.pinch.cy) / c.zoom; this.userCam(); }
      this.pinch = s; return;
    }
    if (this.tap && Math.hypot(e.offsetX - this.tap.x, e.offsetY - this.tap.y) > 12) { this.tap.moved = true; clearTimeout(this.lpTimer); }
    if (this.boxFrom) {
      const box = $('selbox'), [bx, by] = this.boxFrom; box.style.display = 'block';
      box.style.left = Math.min(bx, e.offsetX) + 'px'; box.style.top = Math.min(by, e.offsetY) + 'px'; box.style.width = Math.abs(e.offsetX - bx) + 'px'; box.style.height = Math.abs(e.offsetY - by) + 'px';
      return;
    }
    if (this.placing) { this.mouse.x = e.offsetX; this.mouse.y = e.offsetY; return; }   // drag the building ghost
    if (this.tap && this.tap.moved) { c.x -= dx / c.zoom; c.y -= dy / c.zoom; this.userCam(); }
  }
  touchUp(e, cancel = false) {
    const T = this.touches; if (!T) return; T.delete(e.pointerId); clearTimeout(this.lpTimer);
    if (T.size >= 1) { this.pinch = this.pinchState(); this.tap = null; return; }
    this.pinch = null;
    if (this.boxFrom) {
      $('selbox').style.display = 'none';
      if (this.tap && this.tap.moved && !cancel) this.boxSelect(this.boxFrom[0], this.boxFrom[1], e.offsetX, e.offsetY);
      this.boxFrom = null; this.setBoxMode(false); this.tap = null; return;
    }
    if (this.tap && !this.tap.moved && !cancel) this.handleTap(e.offsetX, e.offsetY);
    this.tap = null;
  }
  handleTap(px, py) {
    if (this.targeting) { this.useTarget(px, py); return; }
    if (this.placing) { this.mouse = { x: px, y: py, inside: false }; this.updateGhost(); this.place(false); return; }
    const t = this.pick(px, py), [x, y] = this.view.screenToWorld(px, py);
    if (this.watch) { if (t) this.select([t.id]); else this.sel = []; return; }
    const own = this.ownUnits(), vil = own.some(u => u.type === 'villager');
    const ownSel = this.sel.map(id => this.W.ents.get(id)).find(e => e && e.owner === this.me);
    if (own.length) {
      // with units selected a tap is an order, except on another of our units (re-select) or a finished building of ours
      const ownUnit = t && t.kind === 'unit' && t.owner === this.me && !(vil && UNITS[t.type].food);
      const ownDoneBld = t && t.kind === 'building' && t.owner === this.me && t.built && t.type !== 'farm' && !(vil && own.some(u => u.carry && u.carry.n >= 1 && (BUILDINGS[t.type].drop || []).includes(u.carry.res)));
      if (ownUnit || ownDoneBld) { this.clickSelect(t); return; }
      this.rightClickWorld(x, y, t); return;
    }
    if (t) { this.clickSelect(t); return; }
    if (ownSel && ownSel.kind === 'building' && BUILDINGS[ownSel.type].trains && ownSel.built) { this.rightClickWorld(x, y, null); return; }   // rally point
    this.sel = [];
  }
  setBoxMode(on) { this.boxMode = on; $('tbBox').classList.toggle('on', on); }
  bindTouchBar() {
    const on = (id, fn) => { const b = $(id); if (b) b.onclick = (ev) => { ev.stopPropagation(); this.snd.play('click'); fn(); }; };
    on('tbCancel', () => { if (this.placing) { this.placing = null; this.view.setGhost(null); } else this.sel = []; this.setBoxMode(false); });
    on('tbBox', () => this.setBoxMode(!this.boxMode));
    on('tbArmy', () => {
      const ids = []; const s = this.app.screen;
      for (const e of this.W.dyn.values()) if (e.kind === 'unit' && e.owner === this.me && e.type !== 'villager' && !UNITS[e.type].animal) { const [sx, sy] = this.view.worldToScreen(e.x, e.y); if (sx > 0 && sy > 0 && sx < s.width && sy < s.height) ids.push(e.id); }
      if (ids.length) this.select(ids);
    });
    on('tbTC', () => { const tc = this.W.ents.get(this.W.players[this.me].tc); if (tc) { this.select([tc.id]); this.centerOn(tc.x + 2, tc.y + 2); } });
    on('tbFull', () => goFullscreen());
  }

  // ---------------------------------------------------------------- input
  bindInput() {
    const cv = this.app.canvas; this.keys = {}; this.mouse = { x: 0, y: 0, inside: false };
    const box = $('selbox');
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    cv.addEventListener('pointercancel', (e) => { if (e.pointerType === 'touch') this.touchUp(e, true); });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') { this.touchMove(e); return; }
      this.mouse.x = e.offsetX; this.mouse.y = e.offsetY; this.mouse.inside = true;
      if (this.down && this.down.btn === 0 && this.watch) {
        const ddx = e.offsetX - this.down.x, ddy = e.offsetY - this.down.y;
        if (this.down.pan || Math.abs(ddx) + Math.abs(ddy) > 6) { const z = this.view.cam.zoom; this.view.cam.x -= ddx / z; this.view.cam.y -= ddy / z; this.down.x = e.offsetX; this.down.y = e.offsetY; this.down.pan = true; this.userCam(); }
      }
      else if (this.down && this.down.btn === 0 && !this.placing) {
        const dx = e.offsetX - this.down.x, dy = e.offsetY - this.down.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) { this.dragging = true; box.style.display = 'block'; box.style.left = Math.min(e.offsetX, this.down.x) + 'px'; box.style.top = Math.min(e.offsetY, this.down.y) + 'px'; box.style.width = Math.abs(dx) + 'px'; box.style.height = Math.abs(dy) + 'px'; }
      }
      if (this.down && this.down.btn === 1) { this.userCam(); const z = this.view.cam.zoom; this.view.cam.x -= (e.offsetX - this.down.x) / z; this.view.cam.y -= (e.offsetY - this.down.y) / z; this.down.x = e.offsetX; this.down.y = e.offsetY; }
      const h = this.pick(e.offsetX, e.offsetY); this.hover = h ? h.id : 0;
      const own = this.ownUnits();
      let cur = 'default';
      if (this.placing || this.targeting) cur = 'crosshair';
      else if (h && own.length) {
        const vil = own.some(u => u.type === 'villager');
        if (h.kind === 'unit' && UNITS[h.type].food && vil) cur = 'url(assets/cur_gather.png) 4 4, pointer';
        else if (h.kind !== 'res' && h.kind !== 'treasure' && h.owner !== this.me && h.owner !== undefined && !(h.kind === 'unit' && UNITS[h.type].animal === 'herd')) cur = 'url(assets/cur_attack.png) 4 4, crosshair';
        else if (h.kind === 'res' && vil) cur = 'url(assets/cur_gather.png) 4 4, pointer';
        else if (h.kind === 'treasure') cur = 'pointer';
        else if (h.kind === 'building' && h.owner === this.me && !h.built && own.some(u => u.type === 'villager')) cur = 'url(assets/cur_build.png) 4 4, pointer';
      }
      cv.style.cursor = cur;
    });
    cv.addEventListener('pointerdown', (e) => {
      this.snd.unlock();
      cv.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') { this.touchDown(e); return; }
      this.down = { x: e.offsetX, y: e.offsetY, btn: e.button, t: performance.now() };
      if (e.button === 2) {
        if (this.placing) { this.placing = null; this.view.setGhost(null); return; }
        const t = this.pick(e.offsetX, e.offsetY); const [x, y] = this.view.screenToWorld(e.offsetX, e.offsetY);
        this.rightClickWorld(x, y, t);
      }
      if (e.button === 0 && this.placing) { this.place(e.shiftKey); this.down = null; }
      else if (e.button === 0 && e.altKey) { const [x, y] = this.view.screenToWorld(e.offsetX, e.offsetY); this.sendFlare(x, y); this.down = null; }
    });
    cv.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') { this.touchUp(e); return; }
      const d = this.down; this.down = null; if (!d || d.btn !== 0 || d.pan) return;
      if (this.dragging) {
        this.dragging = false; box.style.display = 'none';
        this.boxSelect(d.x, d.y, e.offsetX, e.offsetY, e.shiftKey);
        return;
      }
      if (this.targeting) { this.useTarget(e.offsetX, e.offsetY); return; }
      const t = this.pick(e.offsetX, e.offsetY);
      if (!t) { if (!e.shiftKey) this.sel = []; return; }
      this.clickSelect(t, e.shiftKey);
    });
    this.bindTouchBar();
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (this.dead || e.target.tagName === 'INPUT') return;      // listeners of finished games stay attached
      this.keys[e.key] = true;
      if (e.key === 'i' || e.key === 'I' || e.key === 'F4') { e.preventDefault(); this.stats.toggle(); return; }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); this.cards.toggle(); return; }
      if ((e.key === 'j' || e.key === 'J') && !this.watch) { e.preventDefault(); this.advisor.toggle(); return; }
      if (e.key === 'Escape' && this.targeting) { this.targeting = null; this.app.canvas.style.cursor = ''; return; }
      if (e.key === 'Escape' && this.advisor.open) { this.advisor.toggle(false); return; }
      if (e.key === 'Escape' && this.stats.open) { this.stats.toggle(false); return; }
      if (e.key === 'Escape' && this.cards.open) { this.cards.toggle(false); return; }
      if (e.key === 'Escape') { if (this.placing) { this.placing = null; this.view.setGhost(null); } else if (this.sel.length) this.sel = []; else this.togglePause(); return; }
      if (e.key === 'F3' || (e.key === 'p' && !e.ctrlKey)) { e.preventDefault(); this.togglePause(); return; }
      if (e.key === 'Enter' && this.online) { e.preventDefault(); this.openChat(); return; }
      if (this.over || (this.paused && !this.lock)) return;
      if (this.watch) {
        if (e.key === 'Tab') { e.preventDefault(); this.cyclePov(); return; }
        if (e.key === 'c' || e.key === 'C') { this.toggleAutoCam(); return; }
        if (e.key === 'v' || e.key === 'V') { this.toggleFog(); return; }
        if (/^[12480]$/.test(e.key) && !e.ctrlKey) { const b = document.querySelector('#specBar .sp[data-sp="' + (e.key === '0' ? '20' : e.key) + '"]'); if (b) b.click(); return; }
      }
      if (/^[0-9]$/.test(e.key)) {
        if (e.ctrlKey) { e.preventDefault(); this.groups[e.key] = [...this.sel]; this.hud.notify(`Grup ${e.key} disimpan.`); }
        else if (this.groups[e.key]) { const ids = this.groups[e.key].filter(id => this.W.ents.has(id)); this.select(ids); if (this.lastGroup === e.key && performance.now() - this.lastGroupT < 400 && ids[0]) { const u = this.W.ents.get(ids[0]); this.centerOn(u.x, u.y); } this.lastGroup = e.key; this.lastGroupT = performance.now(); }
        return;
      }
      if (e.key === '-' || e.key === '_') { this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, 1 / 1.15); return; }
      if (e.key === '=' || e.key === '+') { this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, 1.15); return; }
      if (e.key === 'Delete') { this.deleteSel(); return; }
      if (e.key === '.') { this.selectIdle(); return; }
      if ((e.key === 'b' || e.key === 'B') && !this.watch && (!this.sel.length || this.sel.some(id => this.W.ents.get(id)?.type === 'town_center'))) { this.ringBell(!this.W.players[this.me].bell); return; }   // B: town bell (with nothing or a TC selected)
      if (e.key === 'h' || e.key === 'H') { const tc = this.W.ents.get(this.W.players[this.me].tc) || [...this.W.ents.values()].find(x => x.kind === 'building' && x.owner === this.me && x.type === 'town_center'); if (tc) { this.select([tc.id]); this.centerOn(tc.x + 2, tc.y + 2); } return; }
      if (e.key === ' ' ) { e.preventDefault(); const u = this.W.ents.get(this.sel[0]) || (this.attackAt && { x: this.attackAt[0], y: this.attackAt[1] }); if (u) this.centerOn(u.x + (u.w || 0) / 2, u.y + (u.h || 0) / 2); return; }
      if (this.placing && (e.key === 'r' || e.key === 'R') && BUILDINGS[this.placing.type].len) { this.placing.axis = this.placing.axis === 'x' ? 'y' : 'x'; return; }
      if (!this.watch) this.hud.hotkey(e.key);
    });
    addEventListener('keyup', (e) => { this.keys[e.key] = false; });
    addEventListener('blur', () => { this.keys = {}; });
  }
  togglePause() {
    if (this.over) return;
    this.paused = !this.paused; $('pauseMenu').classList.toggle('hidden', !this.paused);      // online: only the menu opens
    this.snd.play('click');
  }
  destroy() { this.dead = true; $('netStatus').classList.add('hidden'); $('btnChat').classList.add('hidden'); $('chatBox').classList.add('hidden'); $('pSpeed').classList.remove('hidden'); $('pauseMenu').querySelector('h2').textContent = 'Permainan Dijeda'; $('statsPanel').classList.add('hidden'); $('cardsPanel').classList.add('hidden'); $('advPanel').classList.add('hidden'); this.view.weatherG.destroy(); $('endWatch').classList.add('hidden'); document.body.classList.remove('watch'); $('specBar').classList.add('hidden'); this.app.ticker.remove(this.frame, this); this.app.stage.removeChildren(); this.snd.music(null); this.snd.ambience(false); }
}

// ---------------------------------------------------------------- boot / menus
let app, game = null;
async function boot() {
  app = new Application();
  await app.init({ resizeTo: window, background: '#000000', antialias: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, IS_TOUCH ? 1.5 : 2), preference: 'webgl' });
  $('game').appendChild(app.canvas);
  // menu state
  const opts = store.get('opts', { diff: 'normal', color: 'blue', size: 144, seed: 0, players: 2, name: '', mode: 'play' });
  if (!opts.mode) opts.mode = 'play';
  if (!opts.map) opts.map = 'random';
  if (!opts.season) opts.season = 'random';
  if (!opts.night) opts.night = 'full';
  if (!opts.civ) opts.civ = 'random';
  if (!opts.relicWin) opts.relicWin = 'off';
  for (const [k, v] of Object.entries({ life: 'on', victory: 'conquest', teams: 'ffa', treaty: 0, popLimit: 200, startRes: 'standar', speed: 1 })) if (opts[k] === undefined) opts[k] = v;
  if (![112, 144, 180, 220, 280].includes(opts.size)) opts.size = 144;
  const segs = document.querySelectorAll('.seg');
  segs.forEach(s => { const k = s.dataset.k; s.querySelectorAll('button').forEach(b => { b.classList.toggle('on', String(opts[k]) === b.dataset.v); b.onclick = () => { opts[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); store.set('opts', opts); Sound.ui(); }; }); });
  $('nameIn').value = opts.name || ''; $('nameIn').oninput = () => { opts.name = $('nameIn').value.slice(0, 16); store.set('opts', opts); };
  // ---- home: few big choices; every detail lives in "Permainan Baru"
  const MAPN = { random: 'Peta acak', padang: 'Padang', rimba: 'Rimba', danau: 'Danau', sungai: 'Sungai', tambang: 'Tambang', pegunungan: 'Gunung', kepulauan: 'Pulau' };
  const refresh = () => {
    const civ = CIVS[opts.civ];
    $('quickInfo').textContent = opts.mode === 'watch' ? `Tonton ${opts.players} AI · ${MAPN[opts.map] || opts.map}` : `${civ ? civ.glyph + ' ' + civ.name : '🎲 Peradaban acak'} · ${MAPN[opts.map] || opts.map} · 1 vs ${opts.players - 1} · ${{ easy: 'Mudah', normal: 'Normal', hard: 'Sulit' }[opts.diff]}`;
    $('civDesc').textContent = civ ? civ.desc : 'Peradaban dipilih acak di awal permainan.';
    const auto = Saves.list().find(x => x.id === 'auto');
    $('btnContinue').classList.toggle('hidden', !auto);
    if (auto) $('contInfo').textContent = `${auto.map} · menit ${auto.minutes} · ${new Date(auto.date).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}`;
  };
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.seg')) setTimeout(refresh, 0); });
  $('btnPlay').onclick = () => start(opts);
  $('btnNew').onclick = () => { Sound.ui(); $('setup').classList.remove('hidden'); refresh(); };
  $('setupBack').onclick = () => { Sound.ui(); $('setup').classList.add('hidden'); refresh(); };
  $('btnStart').onclick = () => { $('setup').classList.add('hidden'); start(opts); };
  $('btnContinue').onclick = () => { const rec = Saves.get('auto'); if (rec) startSaved(rec, 'load'); };
  $('btnSettings').onclick = () => { Sound.ui(); $('settingsModal').classList.remove('hidden'); };
  $('settingsClose').onclick = () => $('settingsModal').classList.add('hidden');
  $('btnCivs').onclick = () => { Sound.ui(); $('civList').innerHTML = Object.entries(CIVS).map(([k, c]) => `<div class="civ"><b>${c.glyph} ${c.name}</b><p>${c.desc}</p></div>`).join(''); $('civModal').classList.remove('hidden'); };
  $('civClose').onclick = () => $('civModal').classList.add('hidden');
  // saves & replays
  const KIND = { auto: '⏱ Simpanan otomatis', save: '💾 Simpanan', replay: '🎬 Replay' };
  const renderSaves = () => {
    const l = Saves.list();
    $('saveList').innerHTML = l.length ? l.map(m => `<div class="sv" data-id="${m.id}"><div><b>${KIND[m.kind] || '💾'} — ${m.map || '?'}${m.online ? ' (online)' : ''}</b>
      <small>${new Date(m.date).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })} · menit ${m.minutes ?? '?'} · ${(m.players || []).map(p => (CIVS[p.civ] ? CIVS[p.civ].glyph + ' ' : '') + p.name + (p.ai ? ' (AI)' : '')).join(', ')}</small></div>
      <div class="acts">${m.kind !== 'replay' && !m.online ? '<button data-a="load">▶ Lanjutkan</button>' : ''}<button data-a="watch">🎬 Tonton</button><button data-a="dl" title="Unduh file">⬇</button><button data-a="del" title="Hapus">🗑</button></div></div>`).join('')
      : '<div class="empty">Belum ada permainan tersimpan.</div>';
    $('saveList').querySelectorAll('button[data-a]').forEach(b => b.onclick = () => {
      const id = b.closest('.sv').dataset.id, a = b.dataset.a;
      if (a === 'del') { Saves.del(id); renderSaves(); refresh(); return; }
      if (a === 'dl') { Saves.download(id); return; }
      const rec = Saves.get(id); if (!rec) return;
      $('loadModal').classList.add('hidden'); startSaved(rec, a === 'load' ? 'load' : 'watch');
    });
  };
  $('btnLoad').onclick = () => { Sound.ui(); renderSaves(); $('loadModal').classList.remove('hidden'); };
  $('loadClose').onclick = () => $('loadModal').classList.add('hidden');
  $('saveFile').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { await Saves.upload(f); renderSaves(); } catch (err) { alert(err.message); } e.target.value = ''; };
  $('pSave').onclick = () => { if (!game) return; const id = game.online || game.watch ? null : game.saveGame(null, 'save'); game.hud.notify(id ? '💾 Permainan disimpan.' : game.online || game.watch ? 'Permainan online / tontonan tidak bisa disimpan untuk dilanjutkan — simpan replay di akhir pertandingan.' : 'Penyimpanan penuh.', id ? 'age' : 'bad'); game.togglePause(); };
  $('endReplay').onclick = () => { if (!game) return; const id = game.saveGame(null, 'replay'); $('endReplay').textContent = id ? '🎬 Replay tersimpan ✓' : 'Penyimpanan penuh'; };
  window.__akRefresh = refresh; refresh();
  $('btnHow').onclick = () => $('howto').classList.remove('hidden');
  $('btnTreeHome').onclick = () => { Sound.ui(); openTechTree(null, (k, z = 1) => { const p = iconsMeta && iconsMeta.icons[k]; return p ? `background-image:url(assets/icons.png);background-position:-${p[0] * z}px -${p[1] * z}px;background-size:${1024 * z}px auto` : ''; }); };
  // deck builder + achievements
  const iconCss = (key) => { const p = iconsMeta && iconsMeta.icons[key]; return p ? `background-image:url(assets/icons.png);background-position:-${p[0]}px -${p[1]}px` : ''; };
  let iconsMeta = null; fetch(vq('assets/icons.json')).then(r => r.json()).then(j => { iconsMeta = j; }).catch(() => { });
  const deckB = new DeckBuilder(store, iconCss);
  opts.deck = deckB.deck;
  $('btnDeck').onclick = () => { Sound.ui(); deckB.open(); };
  $('deckClose').addEventListener('click', () => { opts.deck = deckB.deck; });
  const prof = () => { const p = loadProfile(), r = rankOf(p.xp); $('profLine').textContent = `${r.name} · ${p.wins} menang / ${p.games} main · XP ${p.xp}`; };
  prof();
  $('btnAch').onclick = () => { Sound.ui(); $('achBody').innerHTML = achievementsHtml(); $('achModal').classList.remove('hidden'); };
  $('achClose').onclick = () => $('achModal').classList.add('hidden');
  window.__akProf = prof;
  // online: create / join a room; a ?room=CODE link opens the lobby and joins straight away
  const lobby = new Lobby(opts, () => deckB.deck, (g, net, mode) => startOnline(g, net, mode, opts));
  $('btnOnline').onclick = () => { Sound.ui(); lobby.open(); };
  const urlRoom = new URLSearchParams(location.search).get('room');
  if (urlRoom) lobby.open(urlRoom);
  $('howClose').onclick = () => $('howto').classList.add('hidden');
  $('pResume').onclick = () => game && game.togglePause();
  $('pQuit').onclick = $('endMenu').onclick = () => toMenu();
  $('pResign').onclick = () => game && !game.watch && game.resignMe();
  $('pSpeed').onclick = () => { if (!game) return; game.speed = game.speed === 1 ? 1.5 : game.speed === 1.5 ? 2 : 1; $('pSpeed').textContent = `Kecepatan: ${game.speed}x`; };
  $('volMusic').value = store.get('volMusic', 0.5); $('volSfx').value = store.get('volSfx', 0.8);
  const vol = () => { Sound.setVolume(+$('volMusic').value, +$('volSfx').value); store.set('volMusic', +$('volMusic').value); store.set('volSfx', +$('volSfx').value); };
  $('volMusic').oninput = $('volSfx').oninput = vol; vol();
  $('loading').classList.add('hidden');
  addEventListener('pointerdown', () => { Sound.unlockStatic(); Sound.menuMusic(); }, { once: true });
  window.__ak = { get game() { return game; }, start, startSaved, app, lobby, Saves };
}
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
if (IS_TOUCH) document.body.classList.add('touch');
function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!document.fullscreenElement && req) Promise.resolve(req.call(el)).then(() => screen.orientation?.lock?.('landscape').catch(() => { })).catch(() => { });
}
let assetsCache = null;
async function loadAssets(colors) {
  if (IS_TOUCH) goFullscreen();
  $('menu').classList.add('hidden'); $('loading').classList.remove('hidden'); $('loadBar').style.width = '0%';
  try {
    if (!assetsCache || assetsCache.colors !== colors.join()) {
      // phones: keep the sprite atlases at 75% (50% on low-memory devices) to stay within mobile GPU memory
      const atlasScale = IS_TOUCH ? ((navigator.deviceMemory || 4) <= 3 ? 0.5 : 0.75) : 1;
      assetsCache = await loadAll(colors, (f) => { $('loadBar').style.width = Math.round(f * 100) + '%'; }, atlasScale);
      assetsCache.colors = colors.join();
    }
    return true;
  } catch (err) { $('loadText').textContent = 'Gagal memuat aset: ' + err.message; return false; }
}
async function start(opts) {
  Sound.ui();
  const colors = [opts.color, ...PLAYER_COLORS.filter(c => c !== opts.color)].slice(0, opts.players);
  if (!await loadAssets(colors)) return;
  const seed = opts.seed || ((Math.random() * 1e9) | 0);
  game = new Game(app, assetsCache, { ...opts, seed, deck: store.get('deck', null) });
  $('loading').classList.add('hidden'); $('hud').classList.remove('hidden');
}
// a saved game (load: fast-forward to where it was, then play on) or a replay (watch: spectator view, 1x-8x)
async function startSaved(rec, mode) {
  if (game) { game.destroy(); game = null; }
  Sound.ui();
  if (!await loadAssets(rec.setup.players.map(p => p.color))) return;
  game = new Game(app, assetsCache, { replay: { rec, mode } });
  $('loading').classList.add('hidden'); $('hud').classList.remove('hidden');
}
// an online game (fresh start, rejoin after a reload, or watching): world, seats and seed all come from the host
async function startOnline(g, net, mode, opts) {
  if (game) { game.destroy(); game = null; }
  const seats = g.seats || [], me = seats.findIndex(s => s && s.pid === net.pid);
  if (!await loadAssets(seats.map(s => s.color))) return;
  game = new Game(app, assetsCache, { online: { net, seats, me, spectator: mode === 'watch' || me < 0, name: opts.name, game: g } });
  $('loading').classList.add('hidden'); $('hud').classList.remove('hidden');
}
function toMenu() {
  if (game && game.online) { game.online.net.leave(); try { history.replaceState(null, '', location.pathname); } catch { } }
  if (game) { game.destroy(); game = null; }
  window.__akProf && window.__akProf(); window.__akRefresh && window.__akRefresh();
  $('endReplay').textContent = '🎬 Simpan Replay';
  ['pauseMenu', 'endScreen', 'hud'].forEach(id => $(id).classList.add('hidden'));
  $('menu').classList.remove('hidden'); Sound.menuMusic();
}
boot();
