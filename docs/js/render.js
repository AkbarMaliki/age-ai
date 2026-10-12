// Isometric 2D renderer (PixiJS v8): terrain mesh with a blend/fog shader, depth-sorted sprites, particles.
import { Container, Sprite, Texture, Graphics, Mesh, Geometry, Shader, Text } from 'pixi.js';
import { UNITS, BUILDINGS, PLAYER_COLORS, PLAYER_RGB, TREASURES, RES_NAME } from './data.js';
import { idx, TICK } from './sim.js';

export const TW = 96, TH = 48;
export const iso = (x, y) => [(x - y) * TW / 2, (x + y) * TH / 2];
export const unIso = (sx, sy) => { const a = sx / (TW / 2), b = sy / (TH / 2); return [(a + b) / 2, (b - a) / 2]; };
const RENDER_DIRS = [90, 135, 180, 225, 270];
const CARRY_ANIM = { tree: 'carry_wood', gold: 'carry_gold', stone: 'carry_stone', carcass: 'carry_meat', farm: 'carry_food', berry: 'carry_food' };
const WORK = new Set(['chop', 'mine', 'farm', 'forage', 'build', 'hunt']);
// selection ellipse radius / hp bar height per unit type
export const UNIT_BOX = { villager: [15, 62], militia: [15, 66], spearman: [15, 70], archer: [15, 66], bandit: [15, 66], scout: [24, 88], knight: [24, 92],
  sheep: [13, 32], deer: [16, 46], boar: [16, 36], wolf: [15, 36], bear: [20, 56] };
// nearest rendered direction for a screen angle; returns [dir, mirrored]
export function pickDir(a) {
  const d8 = (Math.round(a / 45) * 45 + 360) % 360;
  if (RENDER_DIRS.includes(d8)) return [d8, false];
  return [((180 - d8) % 360 + 360) % 360, true];
}

const VERT = `
in vec2 aPosition; in vec2 aGrid; in vec4 aW; in float aWater;
out vec2 vGrid; out vec4 vW; out float vWater;
uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vGrid = aGrid; vW = aW; vWater = aWater;
}`;
const FRAG = `
in vec2 vGrid; in vec4 vW; in float vWater;
uniform sampler2D uGrass; uniform sampler2D uGrass2; uniform sampler2D uDirt; uniform sampler2D uForest; uniform sampler2D uFog;
uniform float uTime; uniform float uSize;
out vec4 finalColor;
void main() {
  vec2 uv = vGrid / 3.2;
  vec3 g = texture(uGrass, uv).rgb;
  vec3 g2 = texture(uGrass2, uv * 0.85 + 0.37).rgb;
  vec3 d = texture(uDirt, uv * 0.75).rgb;
  vec3 f = texture(uForest, uv * 0.9).rgb;
  float n = texture(uGrass2, vGrid * 0.061).g;
  vec4 w = max(vW + (n - 0.45) * 0.55, 0.0); w = w * w * w; w /= max(dot(w, vec4(1.0)), 1e-4);
  vec3 col = g * w.x + g2 * w.y + d * w.z + f * w.w;
  col *= 0.9 + 0.2 * texture(uGrass, vGrid * 0.021).g;
  if (vWater > 0.02) {
    float r = sin(vGrid.x * 2.3 + uTime * 1.2 + sin(vGrid.y * 1.9 + uTime * 0.8)) * 0.5 + 0.5;
    vec3 wc = mix(vec3(0.12, 0.33, 0.52), vec3(0.2, 0.47, 0.66), r * 0.6 + n * 0.3);
    float sh = smoothstep(0.3, 0.7, vWater + (n - 0.5) * 0.35);
    col = mix(col * 0.82, wc, sh);
    col += vec3(0.25) * smoothstep(0.3, 0.42, vWater + (n - 0.5) * 0.35) * (1.0 - smoothstep(0.42, 0.55, vWater + (n - 0.5) * 0.35)) * 0.5;
  }
  vec4 fog = texture(uFog, vGrid / uSize);
  col = mix(col * vec3(0.48, 0.5, 0.56), col, fog.r);
  col *= smoothstep(0.0, 0.6, fog.g);
  finalColor = vec4(col, 1.0);
}`;

function circleTex(r, soft = true) {
  const c = document.createElement('canvas'); c.width = c.height = r * 2; const g = c.getContext('2d');
  const gr = g.createRadialGradient(r, r, 0, r, r, r); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(soft ? 0.5 : 0.9, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return Texture.from(c);
}
function arrowTex() {
  const c = document.createElement('canvas'); c.width = 28; c.height = 5; const g = c.getContext('2d');
  g.fillStyle = '#4a2f18'; g.fillRect(2, 2, 22, 1.4); g.fillStyle = '#ddd'; g.beginPath(); g.moveTo(28, 2.6); g.lineTo(22, 0.5); g.lineTo(22, 4.6); g.fill();
  g.fillStyle = '#e8e2d0'; g.fillRect(0, 1, 4, 3); return Texture.from(c);
}

class Particles {
  constructor(layer, n = 500) {
    this.pool = []; this.soft = circleTex(16);
    for (let i = 0; i < n; i++) { const s = new Sprite(this.soft); s.anchor.set(0.5); s.visible = false; layer.addChild(s); this.pool.push({ s, life: 0 }); }
    this.i = 0;
  }
  emit(o) {
    const p = this.pool[this.i = (this.i + 1) % this.pool.length];
    p.s.visible = true; p.s.x = o.x; p.s.y = o.y; p.vx = o.vx || 0; p.vy = o.vy || 0; p.g = o.g || 0; p.life = p.max = o.life || 1;
    p.s0 = o.size || 0.3; p.s1 = o.grow ?? p.s0 * 2; p.a0 = o.alpha ?? 0.8; p.s.tint = o.color ?? 0xffffff; p.s.blendMode = o.add ? 'add' : 'normal'; p.s.zIndex = o.z || 0;
  }
  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue; p.life -= dt; if (p.life <= 0) { p.s.visible = false; continue; }
      const k = 1 - p.life / p.max; p.vy += p.g * dt; p.s.x += p.vx * dt; p.s.y += p.vy * dt;
      p.s.scale.set(p.s0 + (p.s1 - p.s0) * k); p.s.alpha = p.a0 * (1 - k * k);
    }
  }
}

export class View {
  constructor(app, W, A, me) {
    this.app = app; this.W = W; this.A = A; this.me = me; this.t = 0;
    this.root = new Container(); app.stage.addChild(this.root);
    this.ground = new Container(); this.flat = new Container(); this.objs = new Container(); this.objs.sortableChildren = true;
    this.sky = new Container(); this.sky.sortableChildren = true; this.over = new Container();
    this.root.addChild(this.ground, this.flat, this.objs, this.sky, this.over);
    this.views = new Map();
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.buildTerrain();
    this.parts = new Particles(this.sky);
    this.arrow = arrowTex(); this.white = Texture.WHITE;
    this.selG = new Graphics(); this.flat.addChild(this.selG);
    this.ghost = new Container(); this.ghostG = new Graphics(); this.ghostS = new Sprite(); this.ghostS.alpha = 0.6; this.ghost.addChild(this.ghostG, this.ghostS); this.over.addChild(this.ghost); this.ghost.visible = false;
    this.barG = new Graphics(); this.over.addChild(this.barG);
    this.markers = []; this.markG = new Graphics(); this.flat.addChild(this.markG);
    this.fireT = 0; this.floats = [];
  }
  // rising "+200 Emas" style labels
  floatText(x, y, str, color = 0xffe070) {
    const t = new Text({ text: str, style: { fontFamily: 'Alegreya SC, Georgia, serif', fontSize: 18, fontWeight: '700', fill: color, stroke: { color: 0x1a120a, width: 4 } } });
    t.anchor.set(0.5); const [sx, sy] = iso(x, y); t.x = sx; t.y = sy - 40; this.over.addChild(t); this.floats.push({ t, life: 0 });
  }
  updateFloats(dt) {
    this.floats = this.floats.filter(f => { f.life += dt; f.t.y -= dt * 28; f.t.alpha = Math.min(1, 2.2 - f.life); if (f.life > 2.2) { f.t.destroy(); return false; } return true; });
  }

  // ------------------------------------------------------------ terrain
  buildTerrain() {
    const W = this.W, S = W.size, V = S + 1;
    const pos = new Float32Array(V * V * 2), grid = new Float32Array(V * V * 2), wts = new Float32Array(V * V * 4), wat = new Float32Array(V * V);
    const T = (i, j) => W.terrain[Math.min(S - 1, Math.max(0, j)) * S + Math.min(S - 1, Math.max(0, i))];
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i; const [x, y] = iso(i, j); pos[k * 2] = x; pos[k * 2 + 1] = y; grid[k * 2] = i; grid[k * 2 + 1] = j;
      const w = [0, 0, 0, 0]; let water = 0;
      for (const [a, b] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const t = T(i + a, j + b);
        if (t === 3) water += 0.25; else w[t === 0 ? 0 : t === 4 ? 1 : t === 1 ? 2 : 3] += 0.25;
      }
      wts.set(w, k * 4); wat[k] = water;
    }
    const ind = []; for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const a = j * V + i; ind.push(a, a + 1, a + V, a + 1, a + V + 1, a + V); }
    const geometry = new Geometry({ attributes: { aPosition: { buffer: pos, format: 'float32x2' }, aGrid: { buffer: grid, format: 'float32x2' }, aW: { buffer: wts, format: 'float32x4' }, aWater: { buffer: wat, format: 'float32' } }, indexBuffer: new Uint32Array(ind) });
    this.fogCanvas = document.createElement('canvas'); this.fogCanvas.width = this.fogCanvas.height = S;
    this.fogCtx = this.fogCanvas.getContext('2d', { willReadFrequently: true }); this.fogImg = this.fogCtx.createImageData(S, S);
    this.fogTex = Texture.from(this.fogCanvas);
    const tx = this.A.terrain;
    for (const t of [...Object.values(tx)]) { t.source.addressMode = 'repeat'; t.source.style && (t.source.style.addressMode = 'repeat'); }
    this.terrainShader = Shader.from({ gl: { vertex: VERT, fragment: FRAG }, resources: {
      uGrass: tx.grass.source, uGrass2: tx.grass2.source, uDirt: tx.dirt.source, uForest: tx.forest.source, uFog: this.fogTex.source,
      tu: { uTime: { value: 0, type: 'f32' }, uSize: { value: S, type: 'f32' } } } });
    this.terrain = new Mesh({ geometry, shader: this.terrainShader });
    this.ground.addChild(this.terrain);
    this.fogDirty = true; this.fogT = 0;
  }
  updateFog() {
    const P = this.W.players[this.me], d = this.fogImg.data, S = this.W.size;
    if (this.reveal) { if (this.revealed) return; for (let k = 0; k < S * S; k++) { d[k * 4] = 255; d[k * 4 + 1] = 255; d[k * 4 + 3] = 255; } this.revealed = true; }   // spectator: whole map
    else for (let k = 0; k < S * S; k++) { d[k * 4] = P.vis[k] ? 255 : 0; d[k * 4 + 1] = P.exp[k] ? 255 : 0; d[k * 4 + 3] = 255; }
    this.fogCtx.putImageData(this.fogImg, 0, 0); this.fogTex.source.update();
  }

  // ------------------------------------------------------------ camera
  setCam(x, y) { this.cam.x = x; this.cam.y = y; }
  applyCam() {
    const s = this.app.screen; this.root.scale.set(this.cam.zoom);
    this.root.x = Math.round(s.width / 2 - this.cam.x * this.cam.zoom); this.root.y = Math.round(s.height / 2 - this.cam.y * this.cam.zoom);
  }
  screenToWorld(px, py) { return unIso((px - this.root.x) / this.cam.zoom, (py - this.root.y) / this.cam.zoom); }
  worldToScreen(x, y) { const [sx, sy] = iso(x, y); return [sx * this.cam.zoom + this.root.x, sy * this.cam.zoom + this.root.y]; }

  // ------------------------------------------------------------ entities
  colorOf(owner) { return this.W.players[owner]?.color || 'none'; }
  // sprite set + animation for a unit (or a corpse / carcass of one)
  unitSet(e) {
    if (e.type === 'villager') return (e.kind === 'corpse' ? e.sk : e.id % 2) ? 'villager_f' : 'villager_m';
    return e.type;
  }
  unitAnim(e) {
    let a = e.anim || 'idle';
    if (e.type === 'villager') {
      if ((a === 'walk' || a === 'carry') && e.carry && e.carry.n >= 1) a = CARRY_ANIM[e.carry.k] || 'carry_food';
      else if (a === 'carry') a = 'walk';
    } else if (UNITS[e.type].animal && a === 'walk' && e.order && e.order.t === 'attack') a = 'run';
    return a;
  }
  atlasFor(set) { return this.A.units.meta.anims[set] ? this.A.units : this.A.fauna; }
  frameFor(e) {
    const A = this.A, col = this.colorOf(e.owner);
    if (e.kind === 'unit' || (e.kind === 'corpse' && e.type !== 'stump') || (e.kind === 'res' && e.type === 'carcass')) {
      const carcass = e.kind === 'res';
      const set = carcass ? e.animal : this.unitSet(e), atlas = this.atlasFor(set), AN = atlas.meta.anims[set];
      if (!AN) return [null, false];
      let anim = e.kind === 'unit' ? this.unitAnim(e) : 'die';
      if (!AN[anim]) anim = anim === 'run' ? 'walk' : anim.startsWith('carry') ? 'walk' : AN.idle ? 'idle' : 'walk';
      const a = AN[anim];
      const [dir, mir] = pickDir(e.dir || 90);
      let f;
      if (carcass) f = a.frames - 1;
      else if (e.kind === 'corpse') f = Math.min(a.frames - 1, Math.floor(e.t * a.fps));
      else if (anim === 'attack') f = Math.min(a.frames - 1, Math.floor((e.aT || 0) * a.fps * 1.2));
      else f = Math.floor((this.t * a.fps + e.id * 0.37) % a.frames);
      return [atlas.get(`${set}/${anim}/${dir}/${f}`, atlas === A.units ? col : 'none'), mir];
    }
    if (e.kind === 'treasure') return [A.nature.get('treasure_' + e.type), false];
    if (e.kind === 'building') {
      const d = BUILDINGS[e.type];
      let key = e.type === 'house' ? ['house', 'house_b', 'house_c'][e.id % 3] : e.type;
      if (key !== e.type && !A.buildings.has(key)) key = e.type;
      if (e.type === 'gate') key = e.axis === 'y' ? 'gate_y' : 'gate_x';
      if (e.type === 'farm') key = e.food > d.food * 0.45 || !e.built ? 'farm' : 'farm_seed';
      if (!e.built && A.buildings.has(key + '_c0')) key = key + '_c' + Math.min(2, Math.floor(e.progress * 3));
      return [A.buildings.get(key, col), false];
    }
    if (e.kind === 'res') {
      const key = e.type === 'tree' ? (e.felled ? 'stump' : ['oak_a', 'oak_b', 'oak_c'][e.variant % 3]) : e.type === 'berry' ? 'berry' : `${e.type}_${'ab'[e.variant % 2]}`;
      return [A.nature.get(key), false];
    }
    if (e.kind === 'corpse') return [A.nature.get('stump'), false];
    if (e.kind === 'rubble') return [A.nature.get('rubble_' + Math.max(1, Math.min(4, e.n))), false];
    return [null, false];
  }
  makeView(e) {
    const v = { spr: new Sprite(), kind: e.kind, extra: null };
    if (e.kind === 'building' && BUILDINGS[e.type].wall) { v.extra = new Container(); v.spr.visible = false; this.objs.addChild(v.extra); }
    if (e.kind === 'building' && e.type === 'farm') this.flat.addChildAt(v.spr, 0); else if (e.kind === 'proj') this.sky.addChild(v.spr); else if (e.kind === 'rubble') this.flat.addChildAt(v.spr, 0); else this.objs.addChild(v.spr);
    this.views.set(e.id, v); return v;
  }
  dropView(id, v) { v.spr.destroy(); if (v.extra) v.extra.destroy({ children: true }); this.views.delete(id); }

  wallSprites(e, v) {
    const W = this.W, col = this.colorOf(e.owner), A = this.A;
    const key = (i, j) => { const o = W.occ[idx(W, i, j)]; const b = o && W.ents.get(o); return b && b.kind === 'building' && (BUILDINGS[b.type].wall || BUILDINGS[b.type].gate) && b.owner === e.owner; };
    const sig = [key(e.x + 1, e.y), key(e.x - 1, e.y), key(e.x, e.y + 1), key(e.x, e.y - 1), e.built ? 1 : 0].join();
    if (v.sig === sig) return; v.sig = sig;
    v.extra.removeChildren().forEach(c => c.destroy());
    const parts = [];
    const [s0, s1, s2, s3] = sig.split(',').map(x => x === 'true');
    if (s3) parts.push('wall_yp'); if (s1) parts.push('wall_xn');
    parts.push('wall_post');
    if (s0) parts.push('wall_xp'); if (s2) parts.push('wall_yn');
    for (const k of parts) { const f = A.buildings.get(k, col); if (!f) continue; const s = new Sprite(f.tex); s.anchor.set(f.ax, f.ay); s.alpha = e.built ? 1 : 0.55; v.extra.addChild(s); }
  }

  sync(alpha, dt, sel, hover) {
    this.t += dt;
    const W = this.W, P = W.players[this.me], A = this.A;
    this.terrainShader.resources.tu.uniforms.uTime = this.t;
    this.fogT -= dt; if (this.fogT <= 0) { this.fogT = 0.25; this.updateFog(); }
    const scr = this.app.screen, z = this.cam.zoom;
    const vx0 = (-this.root.x) / z - 200, vy0 = (-this.root.y) / z - 250, vx1 = vx0 + scr.width / z + 400, vy1 = vy0 + scr.height / z + 500;
    const seen = new Set();
    for (const e of W.ents.values()) {
      if (e.kind === 'timer') continue;
      let x, y;
      if (e.kind === 'unit' || e.kind === 'proj') { x = e.px + (e.x - e.px) * alpha; y = e.py + (e.y - e.py) * alpha; if (e.kind === 'proj' && e.px === undefined) { x = e.x; y = e.y; } }
      else if (e.kind === 'building' || e.kind === 'res' || e.kind === 'treasure') { x = e.x + e.w / 2; y = e.y + e.h / 2; }
      else { x = e.x; y = e.y; }
      const [sx, sy] = iso(x, y);
      if (sx < vx0 || sx > vx1 || sy < vy0 || sy > vy1) { const v = this.views.get(e.id); if (v) { v.spr.visible = false; if (v.extra) v.extra.visible = false; } seen.add(e.id); continue; }
      const ti = Math.min(W.size - 1, Math.max(0, Math.floor(x))), tj = Math.min(W.size - 1, Math.max(0, Math.floor(y)));
      const k = tj * W.size + ti;
      const visible = this.reveal || P.vis[k], explored = this.reveal || P.exp[k];
      const mineE = e.owner === this.me;
      let show = explored;
      if ((e.kind === 'unit' || e.kind === 'proj' || e.kind === 'corpse') && !mineE && !visible) show = false;
      if (!show) { const v = this.views.get(e.id); if (v) { v.spr.visible = false; if (v.extra) v.extra.visible = false; } seen.add(e.id); continue; }
      seen.add(e.id);
      let v = this.views.get(e.id); if (!v) v = this.makeView(e);
      if (e.kind === 'proj') {
        const s = v.spr; s.texture = this.arrow; s.anchor.set(0.5); s.visible = true; if (e.spear) { s.scale.set(1.35, 1.2); s.tint = 0x8a6a48; }
        const z2 = e.z * 30; s.x = sx; s.y = sy - z2;
        const [nx, ny] = iso(e.tx, e.ty); const k2 = Math.min(1, e.t / e.T);
        s.rotation = Math.atan2(ny - (sy) - (1 - 2 * k2) * 20, nx - sx); s.zIndex = sy + 1000;
        continue;
      }
      if (v.extra) { this.wallSprites(e, v); v.extra.visible = true; v.extra.x = sx; v.extra.y = sy; v.extra.zIndex = sy; v.extra.tint = visible || mineE ? 0xffffff : 0x9a9aa6; continue; }
      const [f, mir] = this.frameFor(e);
      if (!f) { v.spr.visible = false; continue; }
      const s = v.spr; s.visible = true;
      if (s.texture !== f.tex) s.texture = f.tex;
      s.anchor.set(f.ax, f.ay); s.scale.x = mir ? -1 : 1;
      s.x = sx; s.y = sy;
      s.zIndex = e.kind === 'building' ? sy - (e.w + e.h) * 6 : sy;
      if (e.kind === 'building' && e.type !== 'farm' && BUILDINGS[e.type].n > 1) s.zIndex = iso(e.x + e.w * 0.75, e.y + e.h * 0.75)[1] - 2;
      s.alpha = e.kind === 'corpse' ? Math.min(1, (15 - e.t) / 3) : e.kind === 'rubble' ? Math.min(1, (40 - e.t) / 5) : (e.kind === 'building' && !e.built && !A.buildings.has(e.type + '_c0') ? 0.6 : 1);
      s.tint = visible || mineE ? (hover === e.id ? 0xfff2c0 : 0xffffff) : 0x9a9aa6;
      // fire on badly damaged buildings
      if (e.kind === 'building' && e.built && e.hp < e.maxHp * 0.5 && visible && Math.random() < dt * 30 * (1 - e.hp / e.maxHp) * Math.min(4, e.w)) {
        const [fx, fy] = iso(e.x + Math.random() * e.w, e.y + Math.random() * e.h);
        const hgt = 20 + Math.random() * 45 * Math.min(2, e.w / 2);
        this.parts.emit({ x: fx, y: fy - hgt, vx: (Math.random() - 0.5) * 8, vy: -30, life: 0.6, size: 0.5, grow: 0.15, color: Math.random() < 0.5 ? 0xff7a1a : 0xffc23a, add: true, alpha: 0.9, z: fy + 50 });
        if (Math.random() < 0.3) this.parts.emit({ x: fx, y: fy - hgt - 10, vx: 6, vy: -22, life: 2.2, size: 0.6, grow: 2.2, color: 0x333333, alpha: 0.45, z: fy + 60 });
      }
    }
    for (const [id, v] of this.views) if (!seen.has(id)) this.dropView(id, v);
    this.parts.update(dt); this.updateFloats(dt);
    this.drawSelection(sel, alpha);
    this.drawMarkers(dt);
  }
  drawSelection(sel, alpha) {
    const g = this.selG, b = this.barG; g.clear(); b.clear();
    for (const id of sel) {
      const e = this.W.ents.get(id); if (!e) continue;
      const col = e.owner === this.me ? 0xffffff : 0xff4040;
      if (e.kind === 'unit') {
        const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha; const [sx, sy] = iso(x, y);
        const [r, hh] = UNIT_BOX[e.type] || [15, 66];
        g.ellipse(sx, sy, r, r * 0.5).stroke({ width: 1.6, color: e.owner < 0 ? 0xffe070 : col, alpha: 0.9 });
        this.hpBar(sx, sy - hh, 30, e.hp / e.maxHp);
      } else if (e.kind === 'building' || e.kind === 'res' || e.kind === 'treasure') {
        const pts = [[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h]].map(([a, c]) => iso(a, c));
        g.poly(pts.flat()).stroke({ width: 1.5, color: e.kind !== 'building' ? 0xffffaa : col, alpha: 0.8 });
        if (e.kind === 'building') {
          const [sx, sy] = iso(e.x + e.w / 2, e.y + e.h / 2), v = this.views.get(id), s = v && v.spr;
          const top = s && s.texture && s.visible ? s.y - s.anchor.y * s.texture.height + 12 : sy - 40 - e.w * 30;   // just above the sprite (AoE2 style)
          this.hpBar(sx, Math.max(top, sy - 40 - e.w * 70), 30 + e.w * 12, e.hp / e.maxHp);
          if (e.rally && e.owner === this.me) {      // gather-point flag (AoE2)
            const [fx, fy] = iso(e.rally.x, e.rally.y), rgb = PLAYER_RGB[this.W.players[this.me].color] || [255, 255, 255], c = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
            g.moveTo(sx, sy).lineTo(fx, fy).stroke({ width: 1, color: 0xffffff, alpha: 0.35 });
            g.moveTo(fx, fy).lineTo(fx, fy - 34).stroke({ width: 2, color: 0x4a3018, alpha: 1 });
            const wv = Math.sin(this.t * 6) * 2; g.poly([fx, fy - 34, fx + 16, fy - 29 + wv, fx, fy - 22]).fill({ color: c, alpha: 0.95 });
          }
        }
      }
    }
  }
  hpBar(x, y, w, f) {
    const b = this.barG; f = Math.max(0, Math.min(1, f));
    b.rect(x - w / 2 - 1, y - 1, w + 2, 6).fill({ color: 0x000000, alpha: 0.7 });
    b.rect(x - w / 2, y, w * f, 4).fill(f > 0.5 ? 0x38d838 : f > 0.25 ? 0xe8c020 : 0xe02020);
  }
  marker(x, y, color = 0x40ff40) { this.markers.push({ x, y, t: 0, color }); }
  drawMarkers(dt) {
    const g = this.markG; g.clear();
    this.markers = this.markers.filter(m => (m.t += dt) < 0.7);
    for (const m of this.markers) { const [sx, sy] = iso(m.x, m.y); const r = 6 + m.t * 26; g.ellipse(sx, sy, r, r * 0.5).stroke({ width: 2, color: m.color, alpha: 1 - m.t / 0.7 }); }
  }
  setGhost(type, i, j, ok, tiles, axis = 'x') {
    if (!type) { this.ghost.visible = false; return; }
    const d = BUILDINGS[type], A = this.A, col = this.colorOf(this.me);
    this.ghost.visible = true;
    const g = this.ghostG; g.clear();
    for (const [ti, tj, good] of tiles) { const p = [[ti, tj], [ti + 1, tj], [ti + 1, tj + 1], [ti, tj + 1]].map(([a, c]) => iso(a, c)); g.poly(p.flat()).fill({ color: good ? 0x30ff30 : 0xff3030, alpha: 0.28 }); }
    let key = type === 'gate' ? (axis === 'y' ? 'gate_y' : 'gate_x') : type === 'stone_wall' ? 'wall_post' : type;
    const f = A.buildings.get(key, col);
    const w = d.len && axis === 'y' ? 1 : (d.len || d.n), h = d.len && axis === 'y' ? d.len : d.n;
    if (f) { this.ghostS.texture = f.tex; this.ghostS.anchor.set(f.ax, f.ay); const [sx, sy] = iso(i + w / 2, j + h / 2); this.ghostS.x = sx; this.ghostS.y = sy; this.ghostS.tint = ok ? 0xffffff : 0xff8080; this.ghostS.visible = tiles.length <= 4 || type !== 'stone_wall'; }
  }

  // ------------------------------------------------------------ events -> effects
  fx(e) {
    const [sx, sy] = iso(e.x ?? 0, e.y ?? 0); const P = this.parts;
    switch (e.k) {
      case 'chop': for (let i = 0; i < 3; i++) P.emit({ x: sx + (Math.random() - 0.5) * 20, y: sy - 30, vx: (Math.random() - 0.5) * 60, vy: -40, g: 160, life: 0.5, size: 0.12, grow: 0.08, color: 0xc89a60, alpha: 1, z: sy + 5 }); break;
      case 'mine': for (let i = 0; i < 3; i++) P.emit({ x: sx + (Math.random() - 0.5) * 16, y: sy - 18, vx: (Math.random() - 0.5) * 70, vy: -50, g: 200, life: 0.4, size: 0.1, grow: 0.06, color: 0xd8d2c0, alpha: 1, z: sy + 5 }); break;
      case 'hammer': P.emit({ x: sx + (Math.random() - 0.5) * 14, y: sy - 8, vx: (Math.random() - 0.5) * 30, vy: -20, life: 0.8, size: 0.35, grow: 1.1, color: 0xb0a080, alpha: 0.5, z: sy + 3 }); break;
      case 'built': case 'collapse': {
        const n = e.k === 'collapse' ? 40 : 18, r = (e.n || 2) * 30;
        for (let i = 0; i < n; i++) P.emit({ x: sx + (Math.random() - 0.5) * r * 2, y: sy + (Math.random() - 0.5) * r - 10, vx: (Math.random() - 0.5) * 40, vy: -15 - Math.random() * 20, life: 1.6 + Math.random(), size: 0.8, grow: 2.6, color: e.k === 'collapse' ? 0x6b6258 : 0xc8b898, alpha: 0.55, z: sy + 80 });
        break;
      }
      case 'die': P.emit({ x: sx, y: sy - 10, vy: -12, life: 0.9, size: 0.4, grow: 1.4, color: 0xa09080, alpha: 0.5, z: sy + 2 }); break;
      case 'treefall': for (let i = 0; i < 10; i++) P.emit({ x: sx + (Math.random() - 0.5) * 40, y: sy - 40 - Math.random() * 40, vx: (Math.random() - 0.5) * 40, vy: 10, g: 40, life: 1.2, size: 0.18, grow: 0.12, color: 0x4f8a2a, alpha: 0.9, z: sy + 20 }); break;
      case 'hit': if (Math.random() < 0.6) for (let i = 0; i < 2; i++) P.emit({ x: sx + (Math.random() - 0.5) * 10, y: sy - 22 - Math.random() * 14, vx: (Math.random() - 0.5) * 50, vy: -20, g: 120, life: 0.35, size: 0.09, grow: 0.05, color: 0x8a1010, alpha: 0.9, z: sy + 4 }); break;
      case 'treasure': this.floatText(e.x, e.y, `+${e.amount} ${RES_NAME[TREASURES[e.type].res]}`); for (let i = 0; i < 24; i++) P.emit({ x: sx + (Math.random() - 0.5) * 40, y: sy - 10 - Math.random() * 30, vx: (Math.random() - 0.5) * 60, vy: -60 - Math.random() * 40, g: 90, life: 1.1, size: 0.12, grow: 0.02, color: 0xffd040, add: true, alpha: 1, z: sy + 50 }); break;
      case 'arrowhit': P.emit({ x: sx, y: sy - 12, life: 0.3, size: 0.2, grow: 0.5, color: 0xffffff, alpha: 0.5, z: sy + 2 }); break;
      case 'age': for (let i = 0; i < 30; i++) P.emit({ x: sx + (Math.random() - 0.5) * 160, y: sy - Math.random() * 120, vy: -40, life: 1.5, size: 0.25, grow: 0.05, color: 0xffd860, add: true, alpha: 0.9, z: sy + 200 }); break;
    }
  }
}
