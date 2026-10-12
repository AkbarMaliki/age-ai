// Abad Kerajaan — an AoE2-style RTS for the web.  Boot, menus, game loop and input.
import { Application } from 'pixi.js';
import { UNITS, BUILDINGS, TECHS, AGES, PLAYER_COLORS, PLAYER_NAMES, GAME_SPEED, PLAYER_RGB, RES_NAME, TREASURES } from './data.js';
import { step, command, TICK, placementOk, canBuild, canAfford, distTo, hasBuilt, idx, alive } from './sim.js';
import { generate } from './map.js';
import { AI } from './ai.js';
import { loadAll } from './assets.js';
import { View, iso, UNIT_BOX } from './render.js';
import { HUD } from './ui.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { const v = localStorage.getItem('ak_' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('ak_' + k, JSON.stringify(v)); } catch { } } };

class Game {
  constructor(app, A, opts) {
    this.app = app; this.A = A; this.opts = opts; this.me = 0;
    const colors = [opts.color, ...PLAYER_COLORS.filter(c => c !== opts.color)].slice(0, opts.players);
    this.watch = opts.mode === 'watch';
    const COLOR_NAME = { blue: 'Raja Biru', red: 'Raja Merah', green: 'Adipati Hijau', yellow: 'Baron Kuning' };
    this.W = generate({ size: opts.size, seed: opts.seed, players: colors.map((c, i) => ({ name: this.watch ? COLOR_NAME[c] : i ? PLAYER_NAMES[i] : (opts.name || PLAYER_NAMES[0]), color: c, ai: this.watch || i > 0, team: i })) });
    this.ais = this.W.players.filter(p => this.watch || p.id > 0).map(p => new AI(this.W, p.id, opts.diff));
    this.view = new View(app, this.W, A, this.me);
    this.sel = []; this.groups = {}; this.acc = 0; this.speed = 1; this.paused = false; this.placing = null; this.over = false;
    this.snd = new Sound(); this.lastAttackNote = -99; this.lastHoused = -99;
    if (IS_TOUCH) this.view.cam.zoom = 0.8;            // phones: see a bit more of the map
    const tc = this.W.ents.get(this.W.players[0].tc); this.centerOn(tc.x + 2, tc.y + 3);
    this.hud = new HUD(this);
    this.bindInput();
    if (this.watch) this.setupSpectator();
    this.snd.music('game'); this.snd.ambience(true); this.snd.loadSamples();
    this.hud.notify(`${AGES[1]} dimulai. Kumpulkan sumber daya dan kalahkan musuhmu!`, 'age');
    app.ticker.add(this.frame, this);
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

  // ---------------------------------------------------------------- loop
  frame() {
    const dt = Math.min(0.1, this.app.ticker.deltaMS / 1000);
    if (!this.paused && !this.over) {
      this.acc += dt * GAME_SPEED * this.speed;
      let n = 0;
      while (this.acc >= TICK && n++ < 8) {
        for (const ai of this.ais) ai.tick();
        step(this.W); this.acc -= TICK;
        for (const e of this.W.ev) this.onEvent(e);
        this.W.ev.length = 0;
      }
      if (n >= 8) this.acc = 0;
    }
    if (this.watch) this.spectatorCam(dt);
    this.scroll(dt);
    this.view.applyCam();
    this.sel = this.sel.filter(id => this.W.ents.has(id));
    this.view.sync(Math.min(1, this.acc / TICK), this.paused ? 0 : dt * this.speed, this.sel, this.hover);
    this.hud.update(dt);
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
      case 'deposit': if (vis) this.sfx('drop_' + (e.res || 'food'), e.x, e.y); break;
      case 'die': if (vis) this.sfx(UNITS[e.type].animal ? e.type : e.type === 'villager' ? 'dieVil' : 'die', e.x, e.y); break;
      case 'collapse': if (vis || mine) this.sfx('collapse', e.x, e.y); if (mine) this.hud.notify(`${BUILDINGS[e.type].name} kita hancur!`, 'bad'); break;
      case 'built': if (mine) { this.snd.play('built'); this.hud.notify(`${BUILDINGS[e.type].name} selesai dibangun.`); } break;
      case 'trained': if (mine) this.snd.play(e.type === 'villager' ? 'trainedVil' : 'trained'); break;
      case 'tech': if (mine) { this.snd.play('tech'); this.hud.notify(`Riset selesai: ${TECHS[e.tech].name}.`); } break;
      case 'age': {
        const p = W.players[e.owner];
        if (mine) { this.snd.play('age'); this.hud.notify(`Kita telah maju ke ${AGES[e.age]}!`, 'age'); const tc = W.ents.get(p.tc); if (tc) this.view.fx({ k: 'age', x: tc.x + 2, y: tc.y + 2 }); }
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
      case 'defeated': this.hud.notify(`${W.players[e.owner].name} telah dikalahkan.`, e.owner === this.me ? 'bad' : 'age'); break;
      case 'victory': this.end(e.team === W.players[this.me].team); break;
    }
  }
  // ---------------------------------------------------------------- spectator (bot vs bot)
  setupSpectator() {
    document.body.classList.add('watch'); $('specBar').classList.remove('hidden');
    this.view.reveal = true; this.autoCam = false; this.camT = 0; this.hot = null;   // free camera by default
    const speeds = [...document.querySelectorAll('#specBar .sp')];
    const setSpeed = (v) => { this.speed = v; speeds.forEach(b => b.classList.toggle('on', +b.dataset.sp === v)); };
    speeds.forEach(b => b.onclick = () => { setSpeed(+b.dataset.sp); this.snd.play('click'); });
    setSpeed(2);
    $('spCam').onclick = () => this.toggleAutoCam(); $('spCam').classList.remove('on');
    $('spPov').onclick = () => this.cyclePov(); this.cyclePov(0);
    this.hud.notify('Mode penonton: kamera bebas — tarik dengan klik kiri, WASD/panah, tepi layar atau minimap. Tab = ganti sudut pandang, C = kamera otomatis, 1/2/4/8 = kecepatan.', 'age');
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
      case 'age': {
        const p = W.players[e.owner]; this.snd.play('age'); this.hud.notify(p.name + ' maju ke ' + AGES[e.age] + '!', 'age');
        const tc = W.ents.get(p.tc); if (tc) { this.view.fx({ k: 'age', x: tc.x + 2, y: tc.y + 2 }); this.hot = { x: tc.x + 2, y: tc.y + 2, t: W.t }; }
        break;
      }
      case 'treasure': this.sfx('treasure', e.x, e.y); this.hud.notify(W.players[e.owner].name + ' menemukan harta karun: +' + e.amount + ' ' + RES_NAME[TREASURES[e.type].res]); break;
      case 'defeated': this.snd.play('alert'); this.hud.notify(W.players[e.owner].name + ' telah dikalahkan!', 'bad'); break;
      case 'victory': this.end(true); break;
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
      $('endStats').innerHTML = '<tr><th></th><th>Unit dilatih</th><th>Membunuh</th><th>Kehilangan</th><th>Bangunan</th><th>Sumber daya</th><th>Zaman</th></tr>' +
        this.W.players.map(p => '<tr><td style="color:rgb(' + PLAYER_RGB[p.color] + ')"><b>' + p.name + '</b></td><td>' + p.stats.units + '</td><td>' + p.stats.killed + '</td><td>' + p.stats.lost + '</td><td>' + p.stats.built + '</td><td>' + Math.floor(p.stats.gathered) + '</td><td>' + AGES[p.age] + '</td></tr>').join('');
      $('endScreen').classList.remove('hidden'); return;
    }
    this.over = true; this.snd.play(win ? 'victory' : 'defeat'); this.snd.music(null);
    const P = this.W.players;
    $('endTitle').textContent = win ? 'Kemenangan!' : 'Kekalahan';
    $('endTitle').className = win ? 'win' : 'lose';
    $('endStats').innerHTML = `<tr><th></th><th>Unit dilatih</th><th>Membunuh</th><th>Kehilangan</th><th>Bangunan</th><th>Sumber daya</th><th>Zaman</th></tr>` +
      P.map(p => `<tr><td style="color:rgb(${PLAYER_RGB[p.color]})"><b>${p.name}</b></td><td>${p.stats.units}</td><td>${p.stats.killed}</td><td>${p.stats.lost}</td><td>${p.stats.built}</td><td>${Math.floor(p.stats.gathered)}</td><td>${AGES[p.age]}</td></tr>`).join('');
    $('endScreen').classList.remove('hidden');
  }

  // ---------------------------------------------------------------- camera
  // zoom keeping the world point under (px, py) fixed; far zoom-out for an overview of big maps
  zoomAt(px, py, f) {
    const v = this.view, c = v.cam, s = this.app.screen, z0 = c.zoom;
    const z = Math.max(this.watch ? 0.22 : 0.3, Math.min(1.6, z0 * f)); if (z === z0) return;
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
      command(this.W, { t: 'smart', pid: this.me, ids: us.map(u => u.id), target: tgt ? tgt.id : 0, x, y });
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
    if (b && BUILDINGS[b.type].trains) { command(this.W, { t: 'rally', pid: this.me, bid: b.id, x, y, target: tgt ? tgt.id : 0 }); this.view.marker(x, y, 0xffd040); this.snd.play('click'); }
  }
  stop() { command(this.W, { t: 'stop', pid: this.me, ids: this.ownUnits().map(u => u.id) }); }
  deleteSel() { if (this.watch) return; for (const id of this.sel) { const e = this.W.ents.get(id); if (e && e.owner === this.me) command(this.W, { t: 'delete', pid: this.me, id }); } }
  train(b, u) { if (!canAfford(this.W.players[this.me], UNITS[u].cost)) { this.snd.play('nope'); return; } command(this.W, { t: 'train', pid: this.me, bid: b.id, type: u }); }
  research(b, t) { command(this.W, { t: 'research', pid: this.me, bid: b.id, tech: t }); }
  cancel(b, i) { command(this.W, { t: 'cancel', pid: this.me, bid: b.id, i }); this.snd.play('click'); }
  selectIdle() {
    const idle = [...this.W.ents.values()].filter(e => e.kind === 'unit' && e.owner === this.me && e.type === 'villager' && !e.order);
    if (!idle.length) return;
    this.idleI = ((this.idleI || 0) + 1) % idle.length; const u = idle[this.idleI];
    this.select([u.id]); this.centerOn(u.x, u.y);
  }
  startPlace(type) { if (!canBuild(this.W, this.me, type)) return; this.placing = { type, axis: 'x' }; }

  updateGhost() {
    const p = this.placing, m = this.mouse; if (!m) return;
    const d = BUILDINGS[p.type];
    const [wx, wy] = this.view.screenToWorld(m.x, m.y);
    const w = d.len && p.axis === 'y' ? 1 : (d.len || d.n), h = d.len && p.axis === 'y' ? d.len : d.n;
    const i = Math.round(wx - w / 2), j = Math.round(wy - h / 2);
    let tiles = [];
    if (d.wall && p.start) tiles = this.wallLine(p.start[0], p.start[1], Math.floor(wx), Math.floor(wy)).map(([a, b]) => [a, b, placementOk(this.W, this.me, p.type, a, b)]);
    else for (let a = 0; a < w; a++) for (let b = 0; b < h; b++) { const ok = placementOk(this.W, this.me, p.type, i + a, j + b) || (a || b) && placementOk(this.W, this.me, 'stone_wall', i + a, j + b); tiles.push([i + a, j + b, ok]); }
    const ok = placementOk(this.W, this.me, p.type, i, j, p.axis) && canAfford(this.W.players[this.me], d.cost);
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
      if (tiles.length) { command(this.W, { t: 'place', pid: this.me, type: p.type, tiles, ids: vils }); this.snd.play('place'); }
      this.placing = shift ? { type: p.type, axis: p.axis } : null; this.view.setGhost(null); return;
    }
    if (!p.ok) { this.snd.play('nope'); return; }
    command(this.W, { t: 'place', pid: this.me, type: p.type, i: p.i, j: p.j, axis: p.axis, ids: vils });
    this.snd.play('place');
    if (!shift || !canAfford(this.W.players[this.me], d.cost)) { this.placing = null; this.view.setGhost(null); }
  }

  // ---------------------------------------------------------------- selection helpers (mouse + touch)
  boxSelect(ax, ay, bx, by, add = false) {
    const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = Math.min(ay, by), y1 = Math.max(ay, by);
    const ids = [];
    for (const ent of this.W.dyn.values()) { if (ent.kind !== 'unit' || ent.owner !== this.me) continue; const [sx, sy] = this.view.worldToScreen(ent.x, ent.y); if (sx >= x0 && sx <= x1 && sy - 20 >= y0 - 20 && sy - 20 <= y1) ids.push(ent.id); }
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
      if (this.placing) cur = 'crosshair';
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
    });
    cv.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') { this.touchUp(e); return; }
      const d = this.down; this.down = null; if (!d || d.btn !== 0 || d.pan) return;
      if (this.dragging) {
        this.dragging = false; box.style.display = 'none';
        this.boxSelect(d.x, d.y, e.offsetX, e.offsetY, e.shiftKey);
        return;
      }
      const t = this.pick(e.offsetX, e.offsetY);
      if (!t) { if (!e.shiftKey) this.sel = []; return; }
      this.clickSelect(t, e.shiftKey);
    });
    this.bindTouchBar();
    cv.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      this.keys[e.key] = true;
      if (e.key === 'Escape') { if (this.placing) { this.placing = null; this.view.setGhost(null); } else if (this.sel.length) this.sel = []; else this.togglePause(); return; }
      if (e.key === 'F3' || (e.key === 'p' && !e.ctrlKey)) { e.preventDefault(); this.togglePause(); return; }
      if (this.over || this.paused) return;
      if (this.watch) {
        if (e.key === 'Tab') { e.preventDefault(); this.cyclePov(); return; }
        if (e.key === 'c' || e.key === 'C') { this.toggleAutoCam(); return; }
        if (/^[1248]$/.test(e.key) && !e.ctrlKey) { const b = document.querySelector('#specBar .sp[data-sp="' + e.key + '"]'); if (b) b.click(); return; }
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
    this.paused = !this.paused; $('pauseMenu').classList.toggle('hidden', !this.paused);
    this.snd.play('click');
  }
  destroy() { document.body.classList.remove('watch'); $('specBar').classList.add('hidden'); this.app.ticker.remove(this.frame, this); this.app.stage.removeChildren(); this.snd.music(null); this.snd.ambience(false); }
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
  if (![112, 144, 180, 220].includes(opts.size)) opts.size = 144;
  const segs = document.querySelectorAll('.seg');
  segs.forEach(s => { const k = s.dataset.k; s.querySelectorAll('button').forEach(b => { b.classList.toggle('on', String(opts[k]) === b.dataset.v); b.onclick = () => { opts[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; s.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); store.set('opts', opts); Sound.ui(); }; }); });
  $('nameIn').value = opts.name || ''; $('nameIn').oninput = () => { opts.name = $('nameIn').value.slice(0, 16); store.set('opts', opts); };
  $('btnPlay').onclick = () => start(opts);
  $('btnHow').onclick = () => $('howto').classList.remove('hidden');
  $('howClose').onclick = () => $('howto').classList.add('hidden');
  $('pResume').onclick = () => game && game.togglePause();
  $('pQuit').onclick = $('endMenu').onclick = () => toMenu();
  $('pSpeed').onclick = () => { if (!game) return; game.speed = game.speed === 1 ? 1.5 : game.speed === 1.5 ? 2 : 1; $('pSpeed').textContent = `Kecepatan: ${game.speed}x`; };
  $('volMusic').value = store.get('volMusic', 0.5); $('volSfx').value = store.get('volSfx', 0.8);
  const vol = () => { Sound.setVolume(+$('volMusic').value, +$('volSfx').value); store.set('volMusic', +$('volMusic').value); store.set('volSfx', +$('volSfx').value); };
  $('volMusic').oninput = $('volSfx').oninput = vol; vol();
  $('loading').classList.add('hidden');
  addEventListener('pointerdown', () => { Sound.unlockStatic(); Sound.menuMusic(); }, { once: true });
  window.__ak = { get game() { return game; }, start, app };
}
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window && navigator.maxTouchPoints > 0);
if (IS_TOUCH) document.body.classList.add('touch');
function goFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (!document.fullscreenElement && req) Promise.resolve(req.call(el)).then(() => screen.orientation?.lock?.('landscape').catch(() => { })).catch(() => { });
}
let assetsCache = null;
async function start(opts) {
  Sound.ui();
  if (IS_TOUCH) goFullscreen();
  $('menu').classList.add('hidden'); $('loading').classList.remove('hidden'); $('loadBar').style.width = '0%';
  const colors = [opts.color, ...PLAYER_COLORS.filter(c => c !== opts.color)].slice(0, opts.players);
  try {
    if (!assetsCache || assetsCache.colors !== colors.join()) {
      // phones: keep the sprite atlases at 75% (50% on low-memory devices) to stay within mobile GPU memory
      const atlasScale = IS_TOUCH ? ((navigator.deviceMemory || 4) <= 3 ? 0.5 : 0.75) : 1;
      assetsCache = await loadAll(colors, (f) => { $('loadBar').style.width = Math.round(f * 100) + '%'; }, atlasScale);
      assetsCache.colors = colors.join();
    }
  } catch (err) { $('loadText').textContent = 'Gagal memuat aset: ' + err.message; return; }
  const seed = opts.seed || ((Math.random() * 1e9) | 0);
  game = new Game(app, assetsCache, { ...opts, seed });
  $('loading').classList.add('hidden'); $('hud').classList.remove('hidden');
}
function toMenu() {
  if (game) { game.destroy(); game = null; }
  ['pauseMenu', 'endScreen', 'hud'].forEach(id => $(id).classList.add('hidden'));
  $('menu').classList.remove('hidden'); Sound.menuMusic();
}
boot();
