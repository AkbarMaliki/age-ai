// The living menu background: a small world of three computer kingdoms runs behind the main menu (desktop only). It
// is made off-screen in small steps (the static picture shows meanwhile), fast-forwarded until there are real towns,
// then faded in; a slow director camera glides between towns, forts and battles. Nothing here touches a real game.
import { View, iso } from './render.js?v=20261015092649';
import { generate } from './map.js?v=20261015092649';
import { step, TICK } from './sim.js?v=20261015092649';
import { AI } from './ai.js?v=20261015092649';
import { GAME_SPEED } from './data.js?v=20261015092649';
import { loadAll } from './assets.js?v=20261015092649';

export const MENU_COLORS = ['blue', 'red', 'green', 'yellow'];
const MAPS = ['padang', 'rimba', 'danau', 'sungai'];

export class MenuScene {
  constructor(app, onAssets) { this.app = app; this.onAssets = onAssets; this.dead = false; }
  // assets: the sprite atlases if already loaded with MENU_COLORS (else they are loaded here, in the background)
  async start(assets) {
    try {
      const A = assets || await loadAll(MENU_COLORS, () => { }, 1);
      if (this.dead) return;
      if (!assets && this.onAssets) this.onAssets(A);
      // a world of three kingdoms, grown for 12 game-minutes in small slices (the menu stays responsive)
      const seed = (Math.random() * 1e9) | 0, type = MAPS[(Math.random() * MAPS.length) | 0];
      const W = generate({ size: 144, seed, type, players: MENU_COLORS.slice(0, 3).map((c, i) => ({ name: c, color: c, ai: true, team: i, style: null })), opts: { night: 'full', life: true, season: ['semi', 'gugur', 'kemarau'][(Math.random() * 3) | 0] } });      // (no grey winter behind a menu)
      const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
      for (let n = 0; n < 12 * 60 / TICK && !this.dead; n++) {
        for (const a of ais) a.tick(); step(W); W.ev.length = 0;
        if (n % 150 === 149) await new Promise(r => setTimeout(r, 0));
      }
      if (this.dead) return;
      this.W = W; this.ais = ais; this.acc = 0; this.heat = []; this.camT = 0; this.drift = [0, 0];
      this.view = new View(this.app, W, A, 0); this.view.reveal = true; this.view.terrG.visible = false;     // (no border lines in a menu picture)
      this.view.cam.zoom = 0.8; this.pickShot(true);
      this.fps0 = this.app.ticker.maxFPS; this.app.ticker.maxFPS = 30;          // a background: light on the machine
      this.app.ticker.add(this.frame, this);
      document.body.classList.add('livebg');
    } catch (e) { /* no live background: the picture stays */ }
  }
  destroy() {
    this.dead = true; document.body.classList.remove('livebg');
    if (!this.view) return;
    this.app.ticker.remove(this.frame, this); this.app.ticker.maxFPS = this.fps0 || 0;
    this.view.weatherG.destroy(); this.app.stage.removeChildren(); this.view = null;
  }
  frame() {
    if (this.dead || !this.view) return;
    const dt = Math.min(0.1, this.app.ticker.deltaMS / 1000), W = this.W;
    this.acc += dt * GAME_SPEED;
    let n = 0;
    while (this.acc >= TICK && n++ < 3) {
      for (const a of this.ais) a.tick(); step(W);
      for (const e of W.ev) { this.view.fx(e); if (e.k === 'hit' && !e.fire) this.addHeat(e.x, e.y); }
      W.ev.length = 0; this.acc -= TICK;
    }
    if (W.winner >= 0) { this.acc = 0; return; }
    this.director(dt);
    this.view.applyCam();
    this.view.sync(Math.min(1, this.acc / TICK), dt, [], 0);
  }
  addHeat(x, y) {
    let c = null; for (const h of this.heat) if (Math.hypot(h.x - x, h.y - y) < 14) { c = h; break; }
    if (c) c.w++; else if (this.heat.length < 16) this.heat.push({ x, y, w: 1 });
  }
  // the next shot: a battle if one is raging, else a town or an old fort, never the same place twice in a row
  pickShot(now = false) {
    const W = this.W, hot = this.heat.filter(h => h.w > 5).sort((a, b) => b.w - a.w)[0];
    let x, y;
    if (hot && Math.random() < 0.6) { x = hot.x; y = hot.y; }
    else {
      const towns = [...W.dyn.values()].filter(e => e.kind === 'building' && e.built && ['town_center', 'castle', 'market', 'monastery', 'wonder'].includes(e.type));
      const spots = towns.length && Math.random() < 0.75 ? towns : [...W.dyn.values()].filter(e => e.kind === 'post' || e.kind === 'camp' || (e.kind === 'building' && e.built));     // towns mostly
      const s = spots.length ? spots[(Math.random() * spots.length) | 0] : null;
      x = s ? s.x + (s.w || 1) / 2 : W.size / 2; y = s ? s.y + (s.h || 1) / 2 : W.size / 2;
    }
    for (const h of this.heat) h.w *= 0.4;
    // framed beside the menu (the buttons cover the middle of the screen): left and right in turn
    this.side = -(this.side || 1); this.zoomGoal = 0.7 + Math.random() * 0.35; this.camT = 13;
    const g = iso(x, y), off = this.app.screen.width * 0.27 / this.zoomGoal; this.goal = [g[0] - this.side * off, g[1]];
    const a = Math.random() * 6.283; this.drift = [Math.cos(a) * 14, Math.sin(a) * 7];       // a slow glide while it dwells
    if (now) { this.view.cam.x = this.goal[0]; this.view.cam.y = this.goal[1]; this.view.cam.zoom = this.zoomGoal; }
  }
  director(dt) {
    const c = this.view.cam; this.camT -= dt; if (this.camT <= 0) this.pickShot();
    const k = Math.min(1, dt * 0.35);
    this.goal[0] += this.drift[0] * dt; this.goal[1] += this.drift[1] * dt;
    c.x += (this.goal[0] - c.x) * k; c.y += (this.goal[1] - c.y) * k; c.zoom += (this.zoomGoal - c.zoom) * Math.min(1, dt * 0.2);
  }
}
