// Isometric 2D renderer (PixiJS v8): terrain mesh with a blend / relief / road / season / fog shader, depth-sorted
// sprites, particles, day-night lighting with torches and lit windows, weather, birds, chimney smoke, windmills.
import { Container, Sprite, Texture, Graphics, Mesh, Geometry, Shader, Text, RenderTexture } from 'pixi.js';
import { UNITS, BUILDINGS, PLAYER_COLORS, PLAYER_RGB, TREASURES, RES_NAME, TER, DAY, MERCS } from './data.js';
import { idx, TICK, timeOfDay, raining, hiddenFrom, stat } from './sim.js';

export const TW = 96, TH = 48;
export const iso = (x, y) => [(x - y) * TW / 2, (x + y) * TH / 2];
export const unIso = (sx, sy) => { const a = sx / (TW / 2), b = sy / (TH / 2); return [(a + b) / 2, (b - a) / 2]; };
const RENDER_DIRS = [90, 135, 180, 225, 270];
const CARRY_ANIM = { tree: 'carry_wood', gold: 'carry_gold', stone: 'carry_stone', iron: 'carry_stone', carcass: 'carry_meat', farm: 'carry_food', berry: 'carry_food', fish: 'carry_food' };
// selection ellipse radius / hp bar height per unit type
export const UNIT_BOX = { villager: [15, 62], militia: [15, 66], spearman: [15, 70], archer: [15, 66], bandit: [15, 66], scout: [24, 88], knight: [24, 92],
  sheep: [13, 32], deer: [16, 46], boar: [16, 36], wolf: [15, 36], bear: [20, 56],
  gunner: [15, 66], samurai: [16, 72], ninja: [15, 66], fire_archer: [15, 66], crossbow: [15, 66], cataphract: [24, 94], lancer: [24, 92],
  ram: [30, 62], cannon: [26, 48], fishing_boat: [30, 52], transport_ship: [44, 96], war_ship: [48, 96],
  child: [11, 44], cow: [20, 46], mangonel: [28, 60], scorpion: [24, 48], trebuchet: [34, 110], trebuchet_p: [32, 56], trade_cart: [26, 56], king: [16, 74],
  fire_ship: [46, 96], demo_ship: [40, 80], galleon: [52, 110], cannon_galleon: [52, 110], trade_cog: [48, 100] };
// stand-ins while a sprite set is missing from the atlases
const SPRITE_FALLBACK = { cow: 'sheep', mangonel: 'cannon', scorpion: 'cannon', trebuchet: 'ram', trebuchet_p: 'ram', fire_ship: 'war_ship', demo_ship: 'fishing_boat', galleon: 'war_ship', cannon_galleon: 'war_ship', trade_cart: 'ram', trade_cog: 'transport_ship', king: 'knight' };
const BLD_FALLBACK = { siege_workshop: 'barracks', wonder: 'castle' };
// nearest rendered direction for a screen angle; returns [dir, mirrored]
export function pickDir(a) {
  const d8 = (Math.round(a / 45) * 45 + 360) % 360;
  if (RENDER_DIRS.includes(d8)) return [d8, false];
  return [((180 - d8) % 360 + 360) % 360, true];
}

const VERT = `
in vec2 aPosition; in vec2 aGrid; in vec4 aW; in float aWater; in vec2 aEx; in float aShade;
out vec2 vGrid; out vec4 vW; out float vWater; out vec2 vEx; out float vShade;
uniform mat3 uProjectionMatrix; uniform mat3 uWorldTransformMatrix; uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vGrid = aGrid; vW = aW; vWater = aWater; vEx = aEx; vShade = aShade;
}`;
// vEx.x = hill, vEx.y = rock (mountain); vShade = relief lighting; uRoad = road mask; season / light / ice uniforms
const FRAG = `
in vec2 vGrid; in vec4 vW; in float vWater; in vec2 vEx; in float vShade;
uniform sampler2D uGrass; uniform sampler2D uGrass2; uniform sampler2D uDirt; uniform sampler2D uForest; uniform sampler2D uFog; uniform sampler2D uRoad;
uniform float uTime; uniform float uSize; uniform vec3 uLight; uniform float uSnow; uniform float uAutumn; uniform float uIce; uniform float uWet;
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
  // autumn turns the grass and forest floor golden
  col = mix(col, col * vec3(1.28, 0.98, 0.55), uAutumn * (w.x + w.y + w.w) * 0.75);
  // hills: drier grass; mountains: grey rock with streaks
  col = mix(col, col * vec3(1.02, 0.98, 0.82), vEx.x * 0.6);
  float rk = smoothstep(0.25, 0.65, vEx.y + (n - 0.5) * 0.35);
  vec3 rock = mix(d * vec3(0.72, 0.72, 0.74), vec3(0.47, 0.46, 0.45), 0.5) * (0.8 + 0.35 * texture(uGrass, vGrid * 0.37).g);
  col = mix(col, rock, rk);
  // roads grow with their kingdom: packed earth (Dark Age) -> gravel (Feudal) -> cobbles (Castle) -> paved slabs with kerbs (Imperial)
  vec4 rm = texture(uRoad, vGrid / uSize); float rd = rm.r, lv = clamp(rm.g / max(rd, 0.05), 0.0, 1.0) * 3.0;
  float road = smoothstep(0.22, 0.55, rd + (n - 0.5) * 0.25) * (1.0 - vWater);
  float cob = step(0.55, fract(vGrid.x * 2.1 + sin(vGrid.y * 4.0) * 0.2)) * step(0.55, fract(vGrid.y * 2.1 + sin(vGrid.x * 4.0) * 0.2));
  vec3 earth = d * vec3(1.08, 0.97, 0.84) * (0.9 + 0.12 * cob);
  float sp = texture(uGrass, vGrid * 1.9).g, sp2 = texture(uDirt, vGrid * 2.7).r;
  vec3 gravel = mix(d * vec3(1.02, 0.96, 0.86), vec3(0.62, 0.57, 0.5), 0.6) * (0.78 + 0.32 * sp) * (0.92 + 0.16 * step(0.6, sp2));
  vec2 cg = vGrid * 4.4; cg.x += 0.5 * mod(floor(cg.y), 2.0); vec2 cf = fract(cg) - 0.5, ci = floor(cg);
  float hsh = fract(sin(dot(ci, vec2(12.9898, 78.233))) * 43758.5453);
  float stone = 1.0 - smoothstep(0.32, 0.48, max(abs(cf.x), abs(cf.y)) + 0.08 * length(cf));
  vec3 cobble = mix(vec3(0.27, 0.24, 0.21), vec3(0.56, 0.5, 0.42) * (0.78 + 0.34 * hsh) * (0.9 + 0.2 * sp), stone);
  vec2 pg = vGrid * vec2(1.6, 2.4); pg.x += 0.5 * mod(floor(pg.y), 2.0); vec2 pf = fract(pg), pi2 = floor(pg);
  float ph = fract(sin(dot(pi2, vec2(39.3468, 11.135))) * 24634.6345);
  float slab = step(0.04, pf.x) * step(0.05, pf.y);
  vec3 paved = mix(vec3(0.36, 0.33, 0.29), vec3(0.72, 0.66, 0.56) * (0.86 + 0.18 * ph) * (0.92 + 0.12 * sp), slab);
  float kerb = smoothstep(0.3, 0.42, rd) * (1.0 - smoothstep(0.5, 0.62, rd));
  paved = mix(paved, vec3(0.4, 0.37, 0.33), kerb * 0.85);
  vec3 rc = lv < 1.0 ? mix(earth, gravel, lv) : lv < 2.0 ? mix(gravel, cobble, lv - 1.0) : mix(cobble, paved, lv - 2.0);
  col = mix(col, rc, road * mix(0.92, 1.0, clamp(lv - 1.0, 0.0, 1.0)));
  col *= vShade;
  // snow lies everywhere except on busy roads and steep rock faces
  float sn = uSnow * smoothstep(0.2, 0.75, 0.62 + (n - 0.5) * 1.1 - road * 0.45 - rk * 0.3);
  col = mix(col, vec3(0.9, 0.93, 0.98) * (0.86 + 0.16 * n) * vShade, sn);
  col *= 1.0 - uWet * 0.12;
  if (vWater > 0.02) {
    float r = sin(vGrid.x * 2.3 + uTime * 1.2 + sin(vGrid.y * 1.9 + uTime * 0.8)) * 0.5 + 0.5;
    vec3 wc = mix(vec3(0.12, 0.33, 0.52), vec3(0.2, 0.47, 0.66), r * 0.6 + n * 0.3);
    vec3 ice = mix(vec3(0.74, 0.84, 0.92), vec3(0.88, 0.94, 0.99), n) - 0.08 * step(0.92, fract(vGrid.x * 0.7 + vGrid.y * 1.3 + n));
    wc = mix(wc, ice, uIce);
    float sh = smoothstep(0.3, 0.7, vWater + (n - 0.5) * 0.35);
    col = mix(col * 0.82, wc, sh);
    col += vec3(0.25) * smoothstep(0.3, 0.42, vWater + (n - 0.5) * 0.35) * (1.0 - smoothstep(0.42, 0.55, vWater + (n - 0.5) * 0.35)) * 0.5 * (1.0 - uIce);
  }
  col *= uLight;
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
// smooth light pool: full at the centre, fading out to nothing
function lightTex(r = 64) {
  const c = document.createElement('canvas'); c.width = c.height = r * 2; const g = c.getContext('2d');
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  for (let i = 0; i <= 8; i++) { const k = i / 8; gr.addColorStop(k, `rgba(255,255,255,${((1 - k) ** 1.6).toFixed(3)})`); }
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return Texture.from(c);
}
function arrowTex() {
  const c = document.createElement('canvas'); c.width = 28; c.height = 5; const g = c.getContext('2d');
  g.fillStyle = '#4a2f18'; g.fillRect(2, 2, 22, 1.4); g.fillStyle = '#ddd'; g.beginPath(); g.moveTo(28, 2.6); g.lineTo(22, 0.5); g.lineTo(22, 4.6); g.fill();
  g.fillStyle = '#e8e2d0'; g.fillRect(0, 1, 4, 3); return Texture.from(c);
}
function bulletTex() { const c = document.createElement('canvas'); c.width = 18; c.height = 3; const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 18, 0); gr.addColorStop(0, 'rgba(255,220,140,0)'); gr.addColorStop(1, 'rgba(255,240,200,1)'); g.fillStyle = gr; g.fillRect(0, 0, 18, 3); return Texture.from(c); }
function ballTex() { const c = document.createElement('canvas'); c.width = c.height = 10; const g = c.getContext('2d'); g.fillStyle = '#1d1b1a'; g.beginPath(); g.arc(5, 5, 4, 0, 6.29); g.fill(); g.fillStyle = '#6b6560'; g.beginPath(); g.arc(3.8, 3.8, 1.3, 0, 6.29); g.fill(); return Texture.from(c); }
// birds: two wing frames, drawn small and dark
function birdTex(up) {
  const c = document.createElement('canvas'); c.width = 22; c.height = 12; const g = c.getContext('2d');
  g.strokeStyle = '#262019'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath();
  if (up) { g.moveTo(1, 2); g.quadraticCurveTo(6, 3, 11, 8); g.quadraticCurveTo(16, 3, 21, 2); }
  else { g.moveTo(1, 9); g.quadraticCurveTo(6, 6, 11, 7); g.quadraticCurveTo(16, 6, 21, 9); }
  g.stroke(); return Texture.from(c);
}
// fish shoal: rings on the water with a few dark fish
function fishTex(k) {
  const c = document.createElement('canvas'); c.width = 96; c.height = 48; const g = c.getContext('2d');
  g.strokeStyle = 'rgba(220,240,255,0.55)'; g.lineWidth = 1.5;
  for (const [x, y, rx] of [[40, 22, 14], [58, 28, 10], [30, 30, 8]]) { g.beginPath(); g.ellipse(x + k * 3, y, rx, rx * 0.45, 0, 0, 6.29); g.stroke(); }
  g.fillStyle = 'rgba(25,40,55,0.7)';
  for (const [x, y, a] of [[38, 22, 0.3], [50, 26, -0.4], [44, 30, 2.6], [56, 21, 3.1]]) { g.save(); g.translate(x + k * 2, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, 5, 1.8, 0, 0, 6.29); g.fill(); g.beginPath(); g.moveTo(-5, 0); g.lineTo(-8, -2); g.lineTo(-8, 2); g.fill(); g.restore(); }
  return Texture.from(c);
}
// war effects: puffy smoke, flame tongues, blood splats (drawn white / baked once, coloured by tint)
function smokeTex(v) {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  let r = v * 9301 + 49297; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * 6.283, d = rnd() * 13, x = S / 2 + Math.cos(a) * d, y = S / 2 + 2 + Math.sin(a) * d * 0.8, rr = 9 + rnd() * 13;
    const gr = g.createRadialGradient(x - rr * 0.25, y - rr * 0.3, 0, x, y, rr); gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(235,235,235,0.3)'); gr.addColorStop(1, 'rgba(220,220,220,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, 6.283); g.fill();
  }
  return Texture.from(c);
}
function flameTex(v) {
  const c = document.createElement('canvas'); c.width = 32; c.height = 64; const g = c.getContext('2d'), w = v ? 3 : -3;
  g.beginPath(); g.moveTo(16 + w, 2); g.bezierCurveTo(24 + w, 20, 31, 36, 16, 62); g.bezierCurveTo(1, 36, 8 + w, 20, 16 + w, 2);
  const gr = g.createRadialGradient(16, 48, 1, 16, 42, 34); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,250,225,0.95)'); gr.addColorStop(0.65, 'rgba(255,215,150,0.55)'); gr.addColorStop(1, 'rgba(255,170,90,0)');
  g.fillStyle = gr; g.fill(); return Texture.from(c);
}
function bloodTex(v) {
  const c = document.createElement('canvas'); c.width = 48; c.height = 24; const g = c.getContext('2d');
  let r = v * 7919 + 13; const rnd = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  g.fillStyle = 'rgb(112,10,8)';
  for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(24 + (rnd() - 0.5) * 14, 12 + (rnd() - 0.5) * 6, 5 + rnd() * 7, 2.5 + rnd() * 3.5, 0, 0, 6.283); g.fill(); }
  for (let i = 0; i < 10; i++) { const a = rnd() * 6.283, d = 12 + rnd() * 10; g.beginPath(); g.ellipse(24 + Math.cos(a) * d, 12 + Math.sin(a) * d * 0.45, 0.8 + rnd() * 1.6, 0.5 + rnd() * 0.9, 0, 0, 6.283); g.fill(); }
  g.fillStyle = 'rgba(55,0,0,0.55)'; g.beginPath(); g.ellipse(24, 12, 6, 3, 0, 0, 6.283); g.fill();
  return Texture.from(c);
}
const lerpC = (a, b, k) => ((((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * k)) << 16) | ((((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * k)) << 8) | ((a & 255) + (((b & 255) - (a & 255)) * k));
// effect settings (Pengaturan): blood on/off, full or light war effects; phones default to light
const LOW = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
export const FX = { blood: true, rich: !LOW };
const mulTint = (t, L) => (Math.min(255, ((t >> 16) & 255) * L[0]) << 16) | (Math.min(255, ((t >> 8) & 255) * L[1]) << 8) | Math.min(255, (t & 255) * L[2]);

// Fixed pools of sprites (nothing is allocated while playing; when a pool is full the oldest particle is reused).
// Optional per particle: own texture, colour fading c0 -> c1, wind (ax) and drag, spin, squash (sy), fade-in, anchor.
class Particles {
  constructor(layer, n = 700, texs = null) {
    this.pool = []; this.soft = circleTex(16); this.texs = texs;
    for (let i = 0; i < n; i++) { const s = new Sprite(texs ? texs[i % texs.length] : this.soft); s.anchor.set(0.5); s.visible = false; layer.addChild(s); this.pool.push({ s, life: 0 }); }
    this.i = 0;
  }
  emit(o) {
    const p = this.pool[this.i = (this.i + 1) % this.pool.length], s = p.s;
    s.visible = true; s.x = o.x; s.y = o.y; p.vx = o.vx || 0; p.vy = o.vy || 0; p.g = o.g || 0; p.life = p.max = o.life || 1;
    p.s0 = o.size || 0.3; p.s1 = o.grow ?? p.s0 * 2; p.a0 = o.alpha ?? 0.8; p.c0 = o.color ?? 0xffffff; p.c1 = o.c1 ?? -1; s.tint = p.c0;
    s.blendMode = o.add ? 'add' : 'normal'; s.zIndex = o.z || 0;
    s.texture = o.tex || (this.texs ? this.texs[(Math.random() * this.texs.length) | 0] : this.soft);
    s.anchor.set(0.5, o.ay ?? 0.5); s.rotation = o.rot || 0; p.spin = o.spin || 0; p.sy = o.sy || 1; p.dr = o.drag || 0; p.ax = o.ax || 0; p.fin = o.fadeIn || 0;
  }
  update(dt) {
    for (const p of this.pool) {
      if (p.life <= 0) continue; p.life -= dt; const s = p.s; if (p.life <= 0) { s.visible = false; continue; }
      const k = 1 - p.life / p.max; p.vy += p.g * dt; p.vx += p.ax * dt;
      if (p.dr) { const f = Math.max(0, 1 - p.dr * dt); p.vx *= f; p.vy *= f; }
      s.x += p.vx * dt; s.y += p.vy * dt; if (p.spin) s.rotation += p.spin * dt;
      const sc = p.s0 + (p.s1 - p.s0) * k; s.scale.set(sc, sc * p.sy);
      s.alpha = p.a0 * (1 - k * k) * (p.fin && k < p.fin ? k / p.fin : 1);
      if (p.c1 >= 0) s.tint = lerpC(p.c0, p.c1, k);
    }
  }
  live() { let n = 0; for (const p of this.pool) if (p.life > 0) n++; return n; }
}
// blood on the ground: splats that spread a little, darken with the light and fade after a while (oldest reused)
class Decals {
  constructor(layer, n) {
    this.c = new Container(); layer.addChildAt(this.c, Math.min(1, layer.children.length)); this.texs = [bloodTex(1), bloodTex(2), bloodTex(3)];
    this.pool = []; for (let i = 0; i < n; i++) { const s = new Sprite(this.texs[i % 3]); s.anchor.set(0.5); s.visible = false; this.c.addChild(s); this.pool.push({ s, t: 0, life: 0 }); }
    this.i = 0;
  }
  put(x, y, size, life = 28, grow = 0) {
    const d = this.pool[this.i = (this.i + 1) % this.pool.length], s = d.s;
    s.texture = this.texs[(Math.random() * 3) | 0]; s.x = x; s.y = y; s.visible = true; d.size = size; d.flip = Math.random() < 0.5 ? -1 : 1; d.grow = grow; d.t = 0; d.life = life;
  }
  update(dt, L) {
    const tint = mulTint(0xffffff, L);
    for (const d of this.pool) {
      if (!d.s.visible) continue; d.t += dt; if (d.t >= d.life) { d.s.visible = false; continue; }
      const g = d.grow ? Math.min(1, 0.3 + 0.7 * d.t / d.grow) : 1; d.s.scale.set(d.size * g * d.flip, d.size * g);
      d.s.alpha = 0.85 * Math.min(1, (d.life - d.t) / 6); d.s.tint = tint;
    }
  }
}
// pooled additive glow sprites (torches, lit windows, campfires), re-laid out every frame
class Glows {
  constructor(layer, n = 260) { this.tex = circleTex(32); this.pool = []; for (let i = 0; i < n; i++) { const s = new Sprite(this.tex); s.anchor.set(0.5); s.blendMode = 'add'; s.visible = false; layer.addChild(s); this.pool.push(s); } this.n = 0; }
  begin() { this.n = 0; }
  put(x, y, size, color, alpha, z) { if (this.n >= this.pool.length) return; const s = this.pool[this.n++]; s.visible = true; s.x = x; s.y = y; s.scale.set(size); s.tint = color; s.alpha = alpha; s.zIndex = z; }
  end() { for (let i = this.n; i < this.pool.length; i++) this.pool[i].visible = false; }
}

export class View {
  constructor(app, W, A, me) {
    this.app = app; this.W = W; this.A = A; this.me = me; this.t = 0;
    this.root = new Container(); app.stage.addChild(this.root);
    this.ground = new Container(); this.flat = new Container(); this.objs = new Container(); this.objs.sortableChildren = true;
    this.sky = new Container(); this.sky.sortableChildren = true; this.over = new Container();
    // night lighting: the scene is drawn at full brightness, then multiplied by a light map = ambient darkness + light
    // pools around torches, windows and fires (so they really light the ground, walls and people around them)
    this.lightRT = RenderTexture.create({ width: 64, height: 64 }); this.lightS = new Sprite(this.lightRT); this.lightS.blendMode = 'multiply'; this.lightS.visible = false;
    this.lightC = new Container(); this.lightBg = new Sprite(Texture.WHITE); this.lightC.addChild(this.lightBg); this.lightT = lightTex(64); this.lightPool = []; this.lights = [];
    this.smokeL = new Container();         // smoke and dust above everything that stands (unsorted: cheap)
    this.root.addChild(this.ground, this.flat, this.objs, this.sky, this.smokeL, this.lightS, this.over);
    this.weatherG = new Graphics(); app.stage.addChild(this.weatherG);       // rain / snow in screen space
    this.views = new Map();
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.buildTerrain();
    this.parts = new Particles(this.sky);
    this.smoke = new Particles(this.smokeL, LOW ? 130 : 340, [smokeTex(1), smokeTex(2), smokeTex(3)]);    // smoke columns, dust
    this.flame = new Particles(this.sky, LOW ? 160 : 360, [flameTex(0), flameTex(1)]);                   // flames, embers, sparks
    this.decals = new Decals(this.flat, LOW ? 70 : 160);
    this.emberT = circleTex(8); this.burnN = 0; this.fxN = 0; this.wind = 4;
    this.glows = new Glows(this.sky);
    this.arrow = arrowTex(); this.bullet = bulletTex(); this.ball = ballTex(); this.white = Texture.WHITE;
    this.birdT = [birdTex(true), birdTex(false)]; this.fishT = [fishTex(0), fishTex(1)];
    this.selG = new Graphics(); this.flat.addChild(this.selG);
    this.ghost = new Container(); this.ghostG = new Graphics(); this.ghostS = new Sprite(); this.ghostS.alpha = 0.6; this.ghost.addChild(this.ghostG, this.ghostS); this.over.addChild(this.ghost); this.ghost.visible = false;
    this.barG = new Graphics(); this.over.addChild(this.barG);
    this.markers = []; this.markG = new Graphics(); this.flat.addChild(this.markG);
    this.terrG = new Graphics(); this.flat.addChildAt(this.terrG, 0); this.terrKey = '';
    this.fireT = 0; this.floats = []; this.birds = []; this.birdT0 = 6; this.flakes = []; this.light = [1, 1, 1];
    this.rocks = this.makeRocks();
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
    const pos = new Float32Array(V * V * 2), grid = new Float32Array(V * V * 2), wts = new Float32Array(V * V * 4), wat = new Float32Array(V * V), ex = new Float32Array(V * V * 2), shade = new Float32Array(V * V);
    const T = (i, j) => W.terrain[Math.min(S - 1, Math.max(0, j)) * S + Math.min(S - 1, Math.max(0, i))];
    // a height field from hills and rock, softened, gives the relief shading
    const H = new Float32Array(V * V);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i; const [x, y] = iso(i, j); pos[k * 2] = x; pos[k * 2 + 1] = y; grid[k * 2] = i; grid[k * 2 + 1] = j;
      const w = [0, 0, 0, 0]; let water = 0, hill = 0, rock = 0;
      for (const [a, b] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
        const t = T(i + a, j + b);
        if (t === TER.WATER) water += 0.25; else if (t === TER.HILL) { hill += 0.25; w[0] += 0.25; } else if (t === TER.ROCK) { rock += 0.25; w[2] += 0.25; }
        else w[t === TER.GRASS ? 0 : t === TER.GRASS2 ? 1 : t === TER.DIRT ? 2 : 3] += 0.25;
      }
      wts.set(w, k * 4); wat[k] = water; ex[k * 2] = hill; ex[k * 2 + 1] = rock; H[k] = hill * 1.0 + rock * 2.4;
    }
    const Hs = new Float32Array(V * V);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) { let s = 0, n = 0; for (let b = -2; b <= 2; b++) for (let a = -2; a <= 2; a++) { const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= V || jj >= V) continue; s += H[jj * V + ii]; n++; } Hs[j * V + i] = s / n; }
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const h = (a, b) => Hs[Math.min(V - 1, Math.max(0, b)) * V + Math.min(V - 1, Math.max(0, a))];
      shade[j * V + i] = Math.max(0.68, Math.min(1.32, 1 + (h(i - 1, j) - h(i + 1, j)) * 0.55 + (h(i, j - 1) - h(i, j + 1)) * 0.55 + Hs[j * V + i] * 0.06));
    }
    const ind = []; for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const a = j * V + i; ind.push(a, a + 1, a + V, a + 1, a + V + 1, a + V); }
    const geometry = new Geometry({ attributes: { aPosition: { buffer: pos, format: 'float32x2' }, aGrid: { buffer: grid, format: 'float32x2' }, aW: { buffer: wts, format: 'float32x4' }, aWater: { buffer: wat, format: 'float32' }, aEx: { buffer: ex, format: 'float32x2' }, aShade: { buffer: shade, format: 'float32' } }, indexBuffer: new Uint32Array(ind) });
    this.fogCanvas = document.createElement('canvas'); this.fogCanvas.width = this.fogCanvas.height = S;
    this.fogCtx = this.fogCanvas.getContext('2d', { willReadFrequently: true }); this.fogImg = this.fogCtx.createImageData(S, S);
    this.fogTex = Texture.from(this.fogCanvas);
    this.roadCanvas = document.createElement('canvas'); this.roadCanvas.width = this.roadCanvas.height = S;
    this.roadCtx = this.roadCanvas.getContext('2d'); this.roadImg = this.roadCtx.createImageData(S, S);
    this.roadTex = Texture.from(this.roadCanvas); this.roadTex.source.scaleMode = 'linear'; this.roadVer = -1;
    const tx = this.A.terrain;
    for (const t of [...Object.values(tx)]) { t.source.addressMode = 'repeat'; t.source.style && (t.source.style.addressMode = 'repeat'); }
    const se = W.season || {};
    this.terrainShader = Shader.from({ gl: { vertex: VERT, fragment: FRAG }, resources: {
      uGrass: tx.grass.source, uGrass2: tx.grass2.source, uDirt: tx.dirt.source, uForest: tx.forest.source, uFog: this.fogTex.source, uRoad: this.roadTex.source,
      tu: { uTime: { value: 0, type: 'f32' }, uSize: { value: S, type: 'f32' }, uLight: { value: new Float32Array([1, 1, 1]), type: 'vec3<f32>' }, uSnow: { value: se.snow ? 0.85 : 0, type: 'f32' },
        uAutumn: { value: W.opts && W.opts.season === 'gugur' ? 0.8 : W.opts && W.opts.season === 'kemarau' ? 0.25 : 0, type: 'f32' }, uIce: { value: W.frozen ? 1 : 0, type: 'f32' }, uWet: { value: 0, type: 'f32' } } } });
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
  updateRoads() {
    const W = this.W, sig = W.roadVer + ':' + W.players.map(p => p.age).join();
    if (this.roadSig === sig) return; this.roadSig = sig;
    const d = this.roadImg.data, R = W.road;
    // road value = owner + 1 (older saves: 1 = whoever is nearest is not known, so player 0's age)
    for (let k = 0; k < R.length; k++) { const v = R[k] ? 255 : 0, P = R[k] ? W.players[R[k] - 1] : null; d[k * 4] = v; d[k * 4 + 1] = P ? Math.round(v * (P.age - 1) / 3) : 0; d[k * 4 + 3] = 255; }
    this.roadCtx.putImageData(this.roadImg, 0, 0); this.roadTex.source.update();
    this.buildProps();
  }
  // borders of the kingdoms: a coloured line along the edge of each one's land (only where we have explored)
  drawTerritory() {
    const W = this.W, T = W.terr, g = this.terrG; if (!T) return;
    const P = W.players[this.me], S = W.size, exp = this.reveal ? null : P.exp;
    let ex = 0; if (exp) for (let k = 0; k < S * S; k += 97) ex += exp[k];
    const key = W.terrVer + ':' + ex + ':' + this.me + ':' + !!this.reveal; if (key === this.terrKey) return; this.terrKey = key;
    g.clear();
    const col = (o) => { const c = PLAYER_RGB[W.players[o - 1].color] || [200, 200, 200]; return (c[0] << 16) | (c[1] << 8) | c[2]; };
    const seg = new Map();
    const add = (o, a, b) => { if (!seg.has(o)) seg.set(o, []); seg.get(o).push(a, b); };
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const k = j * S + i, o = T[k]; if (!o || (exp && !exp[k])) continue;
      if (i + 1 >= S || T[k + 1] !== o) add(o, [i + 1, j], [i + 1, j + 1]);
      if (i === 0 || T[k - 1] !== o) add(o, [i, j], [i, j + 1]);
      if (j + 1 >= S || T[k + S] !== o) add(o, [i, j + 1], [i + 1, j + 1]);
      if (j === 0 || T[k - S] !== o) add(o, [i, j], [i + 1, j]);
    }
    for (const [o, pts] of seg) {
      const draw = () => { for (let n = 0; n < pts.length; n += 2) { const [ax, ay] = iso(pts[n][0], pts[n][1]), [bx, by] = iso(pts[n + 1][0], pts[n + 1][1]); g.moveTo(ax, ay).lineTo(bx, by); } };
      draw(); g.stroke({ width: 10, color: col(o), alpha: 0.22 });          // a soft band
      draw(); g.stroke({ width: 3, color: col(o), alpha: 0.9 });            // and a crisp line
    }
  }
  // street furniture that comes with the ages: lanterns along Castle Age roads, gilt lamps and banners in the Imperial Age
  // (visual only, placed by a fixed hash so every client sees the same street)
  buildProps() {
    const W = this.W, S = W.size, A = this.A, R = W.road;
    for (const pr of this.props || []) pr.s.destroy(); this.props = [];
    if (!A.buildings.has('lamp_a3')) return;
    for (let j = 1; j < S - 1; j++) for (let i = 1; i < S - 1; i++) {
      const k = j * S + i, o = R[k]; if (!o) continue; const P = W.players[o - 1]; if (!P || P.age < 3) continue;
      const h = ((i * 73856093) ^ (j * 19349663)) >>> 0; if (h % 9) continue;
      // stand on the verge: a free, non-road neighbour
      const side = [[1, 0], [0, 1], [-1, 0], [0, -1]].find(([di, dj]) => { const kk = (j + dj) * S + i + di; return !R[kk] && !W.occ[kk] && W.terrain[kk] !== TER.WATER && W.terrain[kk] !== TER.ROCK; });
      if (!side) continue;
      const key = P.age >= 4 ? ((h >> 5) % 3 === 0 ? 'banner_a4' : 'lamp_a4') : 'lamp_a3', f = A.buildings.get(key, P.color); if (!f) continue;
      const x = i + 0.5 + side[0] * 0.55, y = j + 0.5 + side[1] * 0.55, [sx, sy] = iso(x, y);
      const sp = new Sprite(f.tex); sp.anchor.set(f.ax, f.ay); sp.x = sx; sp.y = sy; sp.zIndex = sy; sp.visible = false; this.objs.addChild(sp);
      this.props.push({ s: sp, k: (Math.floor(y)) * S + Math.floor(x), x: sx, y: sy, lamp: key !== 'banner_a4' });
    }
  }
  // mountain tiles get boulders on top so the ridges read as raised ground
  makeRocks() {
    const W = this.W, S = W.size, out = [], A = this.A;
    if (!A.nature.has('stone_a')) return out;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      if (W.terrain[j * S + i] !== TER.ROCK) continue;
      const h = ((i * 73856093) ^ (j * 19349663)) >>> 0; if (h % 100 > 55) continue;
      const f = A.nature.get(h % 2 ? 'stone_a' : 'stone_b'); if (!f) continue;
      const s = new Sprite(f.tex); s.anchor.set(f.ax, f.ay); const [sx, sy] = iso(i + 0.5 + ((h >> 8) % 10 - 5) / 20, j + 0.5 + ((h >> 12) % 10 - 5) / 20);
      s.x = sx; s.y = sy; s.zIndex = sy; const k = 1.25 + (h % 7) / 10; s.scale.set((h & 1 ? -k : k), k); s.visible = false; this.objs.addChild(s);
      out.push({ s, k: j * S + i, base: W.season && W.season.snow ? 0xdfe6ef : 0x9a948c });
    }
    return out;
  }

  // ------------------------------------------------------------ camera
  setCam(x, y) { this.cam.x = x; this.cam.y = y; }
  applyCam() {
    const s = this.app.screen; this.root.scale.set(this.cam.zoom);
    this.root.x = Math.round(s.width / 2 - this.cam.x * this.cam.zoom); this.root.y = Math.round(s.height / 2 - this.cam.y * this.cam.zoom);
  }
  screenToWorld(px, py) { return unIso((px - this.root.x) / this.cam.zoom, (py - this.root.y) / this.cam.zoom); }
  worldToScreen(x, y) { const [sx, sy] = iso(x, y); return [sx * this.cam.zoom + this.root.x, sy * this.cam.zoom + this.root.y]; }

  light2(x, y, r, color, k) { if (this.useMap && this.nightK > 0.05) this.lights.push(x, y, r, color, k * Math.min(1, this.nightK * 1.4)); }
  // the light map at half the screen resolution: ambient colour + additive light pools, multiplied over the world layers
  renderLights() {
    const S = this.lightS; S.visible = this.useMap; if (!this.useMap) return;
    const scr = this.app.screen, q = 0.5, w = Math.max(8, Math.ceil(scr.width * q)), h = Math.max(8, Math.ceil(scr.height * q)), z = this.cam.zoom;
    if (this.lightRT.width !== w || this.lightRT.height !== h) this.lightRT.resize(w, h);
    const a = this.ambientL; this.lightBg.width = w; this.lightBg.height = h;
    this.lightBg.tint = (Math.round(Math.min(1, a[0]) * 255) << 16) | (Math.round(Math.min(1, a[1]) * 255) << 8) | Math.round(Math.min(1, a[2]) * 255);
    const Lt = this.lights, n = Lt.length / 5;
    for (let i = 0; i < n; i++) {
      let s = this.lightPool[i];
      if (!s) { s = new Sprite(this.lightT); s.anchor.set(0.5); s.blendMode = 'add'; this.lightC.addChild(s); this.lightPool.push(s); }
      const x = (Lt[i * 5] * z + this.root.x) * q, y = (Lt[i * 5 + 1] * z + this.root.y) * q, r = Lt[i * 5 + 2] * z * q;
      s.visible = x > -r && y > -r && x < w + r && y < h + r; if (!s.visible) continue;
      s.x = x; s.y = y; s.scale.set(r / 64, r * 0.62 / 64); s.tint = Lt[i * 5 + 3]; s.alpha = Math.min(1, Lt[i * 5 + 4]);   // flattened: pools on iso ground
    }
    for (let i = n; i < this.lightPool.length; i++) this.lightPool[i].visible = false;
    this.app.renderer.render({ container: this.lightC, target: this.lightRT, clear: true });
    S.x = -this.root.x / z; S.y = -this.root.y / z; S.scale.set(1 / (z * q));
  }
  // ------------------------------------------------------------ light: day, dusk, night, dawn; weather and season
  // returns [r, g, b] multipliers and `night` (0..1, how dark it is)
  lightNow() {
    const W = this.W;
    let L = [1, 1, 1], night = 0;
    if (W.opts && W.opts.night !== 'off') {
      const t = timeOfDay(W), n0 = 1 - DAY.night, tw = 0.05;
      const NIGHT = [0.4, 0.47, 0.72], DUSK = [1.0, 0.72, 0.55];
      const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
      if (t >= n0 - tw && t < n0) L = mix([1, 1, 1], DUSK, (t - (n0 - tw)) / tw);
      else if (t >= n0 && t < n0 + tw * 0.6) { const k = (t - n0) / (tw * 0.6); L = mix(DUSK, NIGHT, k); night = k; }
      else if (t >= n0 + tw * 0.6 && t < 1 - tw * 0.6) { L = NIGHT; night = 1; }
      else if (t >= 1 - tw * 0.6) { const k = (t - (1 - tw * 0.6)) / (tw * 0.6); L = mix(NIGHT, DUSK, k); night = 1 - k; }
      else if (t < tw) L = mix(DUSK, [1, 1, 1], t / tw);
    }
    const s = W.opts && W.opts.season;
    if (s === 'salju') L = [L[0] * 0.95, L[1] * 0.98, L[2] * 1.05]; else if (s === 'gugur') L = [L[0] * 1.03, L[1] * 0.98, L[2] * 0.9]; else if (s === 'kemarau') L = [L[0] * 1.05, L[1] * 1.02, L[2] * 0.94];
    if (raining(W)) L = L.map(v => v * 0.82);
    return { L, night };
  }

  // ------------------------------------------------------------ entities
  colorOf(owner) { return this.W.players[owner]?.color || 'none'; }
  // sprite set + animation for a unit (or a corpse / carcass of one)
  unitSet(e) {
    if (e.type === 'villager' || e.type === 'child') return (e.kind === 'corpse' ? e.sk : e.id % 2) ? 'villager_f' : 'villager_m';
    const base = UNITS[e.type] ? UNITS[e.type].sprite : e.type;
    const up = e.owner >= 0 && UNITS[e.type] && !UNITS[e.type].animal ? stat(this.W, e.owner, e.type).sprite : null;      // upgraded line: its new look
    const set = up && this.A.units.meta.anims[up] ? up : base;
    return this.A.units.meta.anims[set] || this.A.fauna.meta.anims[set] || !SPRITE_FALLBACK[set] ? set : SPRITE_FALLBACK[set];     // art not packed yet: a stand-in
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
  buildingKey(e) {
    const A = this.A, d = BUILDINGS[e.type], P = this.W.players[e.owner], age = P ? P.age : 1;
    let key = e.type;
    if (e.type === 'house') key = A.buildings.has('house_a1') ? ['house', 'house_b', 'house_c'][e.id % 3] : (() => { const a = e.age || 1, v = e.id % 3; return a === 1 ? (v === 0 ? 'house' : 'house_c') : a === 2 ? ['house', 'house_b', 'house_c'][v] : (v === 0 ? 'house' : 'house_b'); })();
    if (e.type === 'town_center' && e.built) key = age === 1 ? 'town_center_dark' : age >= 3 ? 'town_center_castle' : 'town_center';      // the town grows with the ages
    if (e.type === 'mill' && e.built && A.buildings.has('mill_body')) key = 'mill_body';
    if (e.type === 'watch_tower' && e.built && P) key = P.techs.has('keep') ? 'keep' : P.techs.has('guard_tower') ? 'guard_tower' : key;
    if (key !== e.type && !A.buildings.has(key)) key = e.type;
    if (e.type === 'gate') key = e.axis === 'y' ? 'gate_y' : 'gate_x';
    if (e.type === 'farm') key = e.food > d.food * 0.45 || !e.built ? 'farm' : 'farm_seed';
    if (!e.built) { const base = e.type === 'house' ? key : e.type; key = A.buildings.has(base + '_c0') ? base + '_c' + Math.min(2, Math.floor(e.progress * 3)) : base; }
    if (!A.buildings.has(key) && BLD_FALLBACK[e.type]) key = BLD_FALLBACK[e.type];
    if (e.built && age !== 2 && A.buildings.has(key + '_a' + age)) key += '_a' + age;           // the kingdom's age restyles it
    return key;
  }
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
    if (e.kind === 'relic') return [A.nature.get('relic'), false];
    if (e.kind === 'monument') return [A.buildings.get('monument', col) || A.buildings.get('wonder', col), false];
    if (e.kind === 'camp') return [A.buildings.get(MERCS[e.faction].camp, 'none') || A.buildings.get('house', 'none'), false];
    if (e.kind === 'post') return [A.buildings.get('watch_tower_keep', col) || A.buildings.get('watch_tower', col), false];
    if (e.kind === 'building') return [A.buildings.get(this.buildingKey(e), col), false];
    if (e.kind === 'res') {
      if (e.type === 'fish' && e.trap && A.buildings.has('fish_trap')) return [A.buildings.get('fish_trap', col), false];
      if (e.type === 'fish') return [{ tex: this.fishT[Math.floor(this.t * 0.8 + e.id) % 2], ax: 0.5, ay: 0.5 }, false];
      const key = e.type === 'tree' ? (e.felled ? 'stump' : ['oak_a', 'oak_b', 'oak_c'][e.variant % 3]) : e.type === 'berry' ? 'berry' : `${e.type}_${'ab'[e.variant % 2]}`;
      return [A.nature.get(key) || (e.type === 'iron' ? A.nature.get('stone_' + 'ab'[e.variant % 2]) : null), false];
    }
    if (e.kind === 'corpse') return [A.nature.get('stump'), false];
    if (e.kind === 'rubble') return [A.nature.get('rubble_' + Math.max(1, Math.min(4, e.n))), false];
    return [null, false];
  }
  makeView(e) {
    const v = { spr: new Sprite(), kind: e.kind, extra: null };
    if (e.kind === 'building' && BUILDINGS[e.type].wall) { v.extra = new Container(); v.spr.visible = false; this.objs.addChild(v.extra); }
    if ((e.kind === 'building' && e.type === 'farm') || (e.kind === 'res' && e.type === 'fish')) this.flat.addChildAt(v.spr, 0); else if (e.kind === 'proj') this.sky.addChild(v.spr); else if (e.kind === 'rubble') this.flat.addChildAt(v.spr, 0); else this.objs.addChild(v.spr);
    this.views.set(e.id, v); return v;
  }
  moodTex(k) {
    this.moods = this.moods || {};
    if (!this.moods[k]) { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d'); g.fillStyle = 'rgba(20,14,8,0.55)'; g.beginPath(); g.arc(16, 16, 14, 0, 6.283); g.fill(); g.font = '20px "Segoe UI Emoji","Apple Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText({ sick: '🤢', thirst: '💧', hunger: '🍞', tired: '💤', sad: '☁', rout: '🏳', general: '⭐' }[k], 16, 17); this.moods[k] = Texture.from(c); }
    return this.moods[k];
  }
  campBadge(f) {
    this.cBadges = this.cBadges || {};
    if (!this.cBadges[f]) { const c = document.createElement('canvas'); c.width = c.height = 48; const g = c.getContext('2d'), col = MERCS[f].tint;
      g.fillStyle = 'rgba(20,14,8,0.8)'; g.beginPath(); g.arc(24, 24, 21, 0, 6.283); g.fill(); g.lineWidth = 3; g.strokeStyle = `rgb(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255})`; g.stroke();
      g.font = '24px "Segoe UI Emoji","Apple Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(MERCS[f].glyph, 24, 26); this.cBadges[f] = Texture.from(c); }
    return this.cBadges[f];
  }
  dropView(id, v) { if (v.badge) v.badge.destroy(); v.spr.destroy(); if (v.extra) v.extra.destroy({ children: true }); if (v.sail) v.sail.destroy(); this.views.delete(id); }

  wallSprites(e, v) {
    const W = this.W, col = this.colorOf(e.owner), A = this.A;
    const key = (i, j) => { const o = W.occ[idx(W, i, j)]; const b = o && W.ents.get(o); return b && b.kind === 'building' && (BUILDINGS[b.type].wall || BUILDINGS[b.type].gate) && b.owner === e.owner; };
    const sig = [key(e.x + 1, e.y), key(e.x - 1, e.y), key(e.x, e.y + 1), key(e.x, e.y - 1), e.built ? 1 : 0].join();
    if (v.sig === sig) return; v.sig = sig;
    v.extra.removeChildren().forEach(c => c.destroy());
    const parts = [], pre = e.type === 'palisade' && A.buildings.has('pal_post') ? 'pal_' : 'wall_';
    const [s0, s1, s2, s3] = sig.split(',').map(x => x === 'true');
    if (s3) parts.push(pre + 'yp'); if (s1) parts.push(pre + 'xn');
    parts.push(pre + 'post');
    if (s0) parts.push(pre + 'xp'); if (s2) parts.push(pre + 'yn');
    for (const k of parts) { const f = A.buildings.get(k, col); if (!f) continue; const s = new Sprite(f.tex); s.anchor.set(f.ax, f.ay); s.alpha = e.built ? 1 : 0.55; v.extra.addChild(s); }
  }

  sync(alpha, dt, sel, hover) {
    this.t += dt;
    const W = this.W, P = W.players[this.me], A = this.A;
    const { L: amb, night } = this.lightNow(); this.nightK = night;
    // dark enough for lights to matter: everything is drawn unlit and the light map darkens it afterwards
    this.useMap = amb[0] + amb[1] + amb[2] < 2.9;
    const L = this.useMap ? [1, 1, 1] : amb; this.light = L; this.ambientL = amb; this.lights.length = 0;
    const U = this.terrainShader.resources.tu.uniforms;
    U.uTime = this.t; U.uLight[0] = L[0]; U.uLight[1] = L[1]; U.uLight[2] = L[2]; U.uWet += ((raining(W) ? 1 : 0) - U.uWet) * Math.min(1, dt * 0.5);
    this.fogT -= dt; if (this.fogT <= 0) { this.fogT = 0.25; this.updateFog(); this.updateRoads(); }
    if ((this.terrT = (this.terrT || 0) - dt) <= 0) { this.terrT = 1.5; this.drawTerritory(); }
    const scr = this.app.screen, z = this.cam.zoom;
    const vx0 = (-this.root.x) / z - 200, vy0 = (-this.root.y) / z - 250, vx1 = vx0 + scr.width / z + 400, vy1 = vy0 + scr.height / z + 500;
    const lit = (t) => mulTint(t, L);
    const seen = new Set();
    this.glows.begin();
    const smoke = Math.random() < dt * 6, fires = night > 0.15;
    // war effects budget: fewer, bigger puffs zoomed out; the busier the screen, the thinner each fire (a fixed cost)
    this.lod = Math.min(2.5, Math.max(1, 0.55 / this.cam.zoom)); this.wind = 4 + 2.5 * Math.sin(this.t * 0.07);
    this.burnK = Math.min(1, (FX.rich ? 9 : 4) / Math.max(1, this.burnN)) * (FX.rich ? 1 : 0.6); this.burnN = 0; this.fxN = 0;
    for (const e of W.ents.values()) {
      if (e.kind === 'timer') continue;
      let x, y;
      if (e.kind === 'unit' || e.kind === 'proj') { x = e.px + (e.x - e.px) * alpha; y = e.py + (e.y - e.py) * alpha; if (e.kind === 'proj' && e.px === undefined) { x = e.x; y = e.y; } }
      else if (e.kind === 'building' || e.kind === 'res' || e.kind === 'treasure' || e.kind === 'camp') { x = e.x + e.w / 2; y = e.y + e.h / 2; }
      else if (e.kind === 'relic') {
        const m = e.carrier && W.ents.get(e.carrier);
        if (e.inBld || (e.carrier && !m)) { const v = this.views.get(e.id); if (v) v.spr.visible = false; seen.add(e.id); continue; }
        if (m) { x = m.px + (m.x - m.px) * alpha + 0.15; y = m.py + (m.y - m.py) * alpha + 0.15; } else { x = e.x + 0.5; y = e.y + 0.5; }
      }
      else { x = e.x; y = e.y; }
      const [sx, sy] = iso(x, y);
      if (sx < vx0 || sx > vx1 || sy < vy0 || sy > vy1) { const v = this.views.get(e.id); if (v) { v.spr.visible = false; if (v.extra) v.extra.visible = false; if (v.sail) v.sail.visible = false; if (v.badge) v.badge.visible = false; } seen.add(e.id); continue; }
      const ti = Math.min(W.size - 1, Math.max(0, Math.floor(x))), tj = Math.min(W.size - 1, Math.max(0, Math.floor(y)));
      const k = tj * W.size + ti;
      const visible = this.reveal || P.vis[k], explored = this.reveal || P.exp[k];
      const mineE = e.owner === this.me;
      let show = explored;
      if ((e.kind === 'unit' || e.kind === 'proj' || e.kind === 'corpse') && !mineE && !visible) show = false;
      if (e.kind === 'unit' && !mineE && !this.reveal && e.owner >= 0 && hiddenFrom(W, e, this.me)) show = false;       // a hidden ninja
      if (e.inside) show = false;                                                                                  // asleep indoors
      if (!show) { const v = this.views.get(e.id); if (v) { v.spr.visible = false; if (v.extra) v.extra.visible = false; if (v.sail) v.sail.visible = false; if (v.badge) v.badge.visible = false; } seen.add(e.id); continue; }
      seen.add(e.id);
      let v = this.views.get(e.id); if (!v) v = this.makeView(e);
      if (e.kind === 'proj') {
        const s = v.spr; s.anchor.set(0.5); s.visible = true;
        const pt = e.ptype || 'arrow';
        s.texture = pt === 'bullet' ? this.bullet : pt === 'ball' || pt === 'rock' ? this.ball : this.arrow;
        if (pt === 'rock') { s.scale.set(1.7); s.tint = 0x8f8a80; } else if (pt === 'bolt') { s.scale.set(1.5, 1.25); s.tint = 0x4a3020; }
        if (pt === 'javelin') { s.scale.set(1.35, 1.1); s.tint = 0xb89a6a; }
        if (e.spear) { s.scale.set(1.35, 1.2); s.tint = 0x8a6a48; } else if (pt === 'fire') { s.tint = 0xffc890; this.fireArrow(sx, sy - e.z * 30, sy); }
        const z2 = e.z * 30; s.x = sx; s.y = sy - z2;
        const [nx, ny] = iso(e.tx, e.ty); const k2 = Math.min(1, e.t / e.T);
        s.rotation = pt === 'ball' || pt === 'rock' ? 0 : Math.atan2(ny - (sy) - (1 - 2 * k2) * 20, nx - sx); s.zIndex = sy + 1000;
        continue;
      }
      if (v.extra) { this.wallSprites(e, v); v.extra.visible = true; v.extra.x = sx; v.extra.y = sy; v.extra.zIndex = sy; for (const c of v.extra.children) c.tint = lit(visible || mineE ? 0xffffff : 0x9a9aa6); continue; }
      const [f, mir] = this.frameFor(e);
      if (!f) { v.spr.visible = false; continue; }
      const s = v.spr; s.visible = true;
      if (s.texture !== f.tex) s.texture = f.tex;
      s.anchor.set(f.ax, f.ay);
      const us = e.kind === 'unit' && UNITS[e.type] ? UNITS[e.type] : null, sc = us && us.scale || 1;
      s.scale.set((mir ? -1 : 1) * sc, sc);
      s.x = sx; s.y = sy;
      if (e.kind === 'unit' && (e.nm !== undefined || e.routUntil || (us && us.general))) {
        const mood = e.routUntil > W.t ? 'rout' : e.sick ? 'sick' : e.th < 15 ? 'thirst' : e.hu < 12 ? 'hunger' : e.en < 8 ? 'tired' : e.fu < 10 ? 'sad' : us && us.general ? 'general' : null;
        if (mood && (visible || mineE)) { if (!v.badge) { v.badge = new Sprite(); v.badge.anchor.set(0.5); this.sky.addChild(v.badge); } v.badge.texture = this.moodTex(mood); v.badge.visible = true; v.badge.scale.set(0.55); v.badge.x = sx; v.badge.y = sy - (UNIT_BOX[e.type] || [15, 62])[1] * sc - 10 + Math.sin(this.t * 3 + e.id) * 2; v.badge.zIndex = sy + 999; }
        else if (v.badge) v.badge.visible = false;
      }
      if (e.kind === 'relic' && e.carrier) { s.scale.set(0.45); s.y = sy - 46; }        // carried high by its monk
      s.zIndex = e.kind === 'building' ? sy - (e.w + e.h) * 6 : sy;
      if ((e.kind === 'building' && e.type !== 'farm' && BUILDINGS[e.type].n > 1) || e.kind === 'camp') s.zIndex = iso(e.x + e.w * 0.75, e.y + e.h * 0.75)[1] - 2;
      if (e.kind === 'unit') {        // standing in a barn's yard: drawn over the barn sprite (its yard floor and fence), still sorted among themselves
        const fb = W.focc[k], bb = fb && W.ents.get(fb);
        if (bb && BUILDINGS[bb.type] && BUILDINGS[bb.type].pen) s.zIndex = iso(bb.x + bb.w * 0.75, bb.y + bb.h * 0.75)[1] - 1 + sy / 1e5;
      }
      s.alpha = e.kind === 'corpse' ? Math.min(1, (15 - e.t) / 3) : e.kind === 'rubble' ? Math.min(1, (40 - e.t) / 5) : e.kind === 'res' && e.type === 'fish' ? 0.75 + 0.2 * Math.sin(this.t * 2 + e.id) : (e.kind === 'building' && !e.built && !A.buildings.has(e.type + '_c0') ? 0.6 : 1);
      if (e.kind === 'unit' && mineE && us && us.stealth && W.t - (e.lastAtk || -99) > 3) s.alpha = 0.5;                 // our ninjas, sneaking
      let tint = visible || mineE ? (hover === e.id ? 0xfff2c0 : 0xffffff) : 0x9a9aa6;
      if (us && us.tint) tint = mulTint(tint, [((us.tint >> 16) & 255) / 255, ((us.tint >> 8) & 255) / 255, (us.tint & 255) / 255]);
      if (W.season && W.season.snow && e.kind === 'res' && e.type === 'tree') tint = mulTint(tint, [0.93, 0.97, 1.08]);
      if (e.kind === 'camp') { const c = MERCS[e.faction].tint; tint = mulTint(tint, [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]); }
      s.tint = lit(tint);
      // windmill sails turn while the mill is in use
      if (e.kind === 'building' && e.type === 'mill' && e.built && A.buildings.has('mill_sail_0')) {
        if (!v.sail) { v.sail = new Sprite(); this.objs.addChild(v.sail); }
        const fr = A.buildings.get('mill_sail_' + (Math.floor(this.t * 5 + e.id) % 6), this.colorOf(e.owner));
        v.sail.texture = fr.tex; v.sail.anchor.set(fr.ax, fr.ay); v.sail.x = sx; v.sail.y = sy; v.sail.zIndex = s.zIndex + 0.5; v.sail.visible = true; v.sail.tint = s.tint;
      } else if (v.sail) v.sail.visible = false;
      if (e.kind === 'building' && e.built && visible) {
        const top = s.y - s.anchor.y * s.texture.height;
        // chimney smoke from homes, the town hall and the forge
        if (smoke && ['house', 'town_center', 'blacksmith', 'academy'].includes(e.type) && Math.random() < (e.type === 'blacksmith' ? 0.9 : 0.25)) {
          const cx = sx + (e.type === 'blacksmith' ? 18 : (e.id % 5 - 2) * 6), cy = top + s.texture.height * (e.type === 'house' ? 0.18 : 0.12);
          this.parts.emit({ x: cx, y: cy, vx: 6 + Math.random() * 5, vy: -14 - Math.random() * 6, life: 3.5, size: 0.35, grow: 1.8, color: mulTint(e.type === 'blacksmith' ? 0x555050 : 0x9a948c, L), alpha: 0.32, z: sy + 400 });
        }
        // night: lit windows, and a campfire at camps and barracks
        if (fires) {
          const flick = 0.85 + 0.15 * Math.sin(this.t * 9 + e.id) * Math.sin(this.t * 13.7 + e.id * 2);
          if (e.type !== 'farm' && !BUILDINGS[e.type].wall) { this.glows.put(sx, s.y - s.anchor.y * s.texture.height * 0.35, 0.9 + e.w * 0.45, 0xffa040, 0.28 * night * flick, sy + 500); this.light2(sx, sy - 10, 60 + e.w * 28, 0xffb46a, 0.42 * flick); }
          if (['lumber_camp', 'mining_camp', 'mine_shaft', 'barracks', 'town_center', 'castle'].includes(e.type)) {
            const [fx, fy] = iso(e.x + e.w + 0.6, e.y + e.h * 0.5);
            this.glows.put(fx, fy - 8, 1.6, 0xff8a28, 0.45 * night * flick, fy + 500); this.light2(fx, fy - 6, 230, 0xff9a48, 0.95 * flick);
            if (Math.random() < dt * 20) this.parts.emit({ x: fx + (Math.random() - 0.5) * 8, y: fy - 4, vx: (Math.random() - 0.5) * 6, vy: -26, life: 0.55, size: 0.28, grow: 0.08, color: Math.random() < 0.5 ? 0xff7a1a : 0xffc23a, add: true, alpha: 0.9, z: fy + 2 });
          }
        }
      }
      // torches carried at night
      if (fires && e.kind === 'unit' && us && !us.animal && (visible || mineE) && e.owner >= 0 && !e.inside) {
        const fl = 0.85 + 0.15 * Math.sin(this.t * 11 + e.id);
        if (!us.naval) this.glows.put(sx + 6, sy - 34, 0.7, 0xffb050, 0.32 * night * fl, sy + 2);
        this.light2(sx + 4, sy - 12, us.naval ? 150 : 125, 0xffc27a, 0.85 * fl);            // the torch lights the path around its bearer
      }
      // a mercenary camp: its campfire (day and night) with a wisp of smoke; the poisoned breathe green
      if (e.kind === 'camp') {           // the company's emblem floats over its camp (found from afar on the map)
        if (!v.badge) { v.badge = new Sprite(this.campBadge(e.faction)); v.badge.anchor.set(0.5); this.sky.addChild(v.badge); }
        v.badge.visible = true; v.badge.scale.set(0.75); v.badge.x = sx; v.badge.y = s.y - s.anchor.y * s.texture.height - 14 + Math.sin(this.t * 2 + e.id) * 3; v.badge.zIndex = sy + 999; v.badge.tint = lit(0xffffff);
      }
      if (e.kind === 'camp' && visible) {
        const [fx, fy] = iso(e.x - 0.3, e.y + 1.2), fl = 0.85 + 0.15 * Math.sin(this.t * 11 + e.id);
        if (Math.random() < dt * 9) this.flame.emit({ x: fx + (Math.random() - 0.5) * 6, y: fy - 2, vx: this.wind * 0.5, vy: -22, life: 0.45, size: 0.22, grow: 0.06, sy: 1.1, color: 0xffa020, c1: 0x9a1a04, alpha: 0.9, ay: 0.85, z: fy + 3 });
        if (Math.random() < dt * 0.8) this.smoke.emit({ x: fx, y: fy - 14, vy: -26, ax: this.wind, drag: 0.25, life: 4, size: 0.15, grow: 0.9, color: mulTint(0x5a544c, L), c1: mulTint(0x9a948c, L), alpha: 0.35, rot: Math.random() * 6.28 });
        this.glows.put(fx, fy - 6, 0.8, 0xff8a28, 0.25 + 0.3 * night, fy + 4); if (night > 0.15) this.light2(fx, fy - 4, 150, 0xff9a48, 0.9 * fl);
      }
      if (e.kind === 'unit' && e.poisonUntil > W.t && visible && Math.random() < dt * 5) this.parts.emit({ x: sx + (Math.random() - 0.5) * 10, y: sy - 26 - Math.random() * 10, vx: (Math.random() - 0.5) * 8, vy: -16, life: 0.7, size: 0.09, grow: 0.05, color: 0x8ce060, add: true, alpha: 0.9, z: sy + 5 });
      // fire on badly damaged (or burning) buildings; ruins smoulder
      if (e.kind === 'building' && e.built && visible && !BUILDINGS[e.type].wall && e.type !== 'farm' && (e.hp < e.maxHp * 0.5 || (e.burn && e.burn > W.t))) this.burnFx(e, s, sx, sy, dt, night);
      if (e.kind === 'rubble' && visible && e.t < 30 && e.n >= 2) this.rubbleFx(e, sx, sy, dt);
      // fish now and then leap from the shoal
      if (e.kind === 'res' && e.type === 'fish' && visible && Math.random() < dt * 0.15) for (let i = 0; i < 4; i++) this.parts.emit({ x: sx + (Math.random() - 0.5) * 20, y: sy - 4, vx: (Math.random() - 0.5) * 20, vy: -30, g: 120, life: 0.5, size: 0.08, grow: 0.02, color: 0xdfefff, alpha: 0.9, z: sy + 1 });
    }
    for (const [id, v] of this.views) if (!seen.has(id)) this.dropView(id, v);
    // boulders on the mountain ridges
    for (const r of this.props || []) { const on = r.x > vx0 && r.x < vx1 && r.y > vy0 && r.y < vy1 && (this.reveal || P.exp[r.k]); r.s.visible = on; if (on) { r.s.tint = lit(this.reveal || P.vis[r.k] ? 0xffffff : 0x9a9aa6); if (r.lamp && night > 0.1) this.light2(r.x, r.y - 40, 70, 0xffc070, 0.75); } }
    for (const r of this.rocks) { const [rx, ry] = [r.s.x, r.s.y]; const on = rx > vx0 && rx < vx1 && ry > vy0 && ry < vy1 && (this.reveal || P.exp[r.k]); r.s.visible = on; if (on) r.s.tint = mulTint(this.reveal || P.vis[r.k] ? r.base : mulTint(r.base, [0.7, 0.7, 0.75]), L); }
    this.glows.end();
    this.renderLights();
    this.ambient(dt, night);
    this.weather(dt);
    this.parts.update(dt); this.smoke.update(dt); this.flame.update(dt); this.decals.update(dt, this.light); this.updateFloats(dt);
    this.drawSelection(sel, alpha);
    this.drawMarkers(dt);
  }
  // birds fly over now and then (not at night), with their shadows on the ground
  ambient(dt, night) {
    if (night < 0.5 && (this.birdT0 -= dt) <= 0 && this.birds.length < 3) {
      this.birdT0 = 8 + Math.random() * 14;
      const scr = this.app.screen, z = this.cam.zoom, [wx, wy] = this.screenToWorld(-60, scr.height * (0.2 + Math.random() * 0.5));
      const n = 3 + Math.floor(Math.random() * 5), flock = { birds: [] };
      for (let i = 0; i < n; i++) {
        const s = new Sprite(this.birdT[0]); s.anchor.set(0.5); s.zIndex = 1e6; this.sky.addChild(s);
        const sh = new Sprite(this.birdT[1]); sh.anchor.set(0.5); sh.tint = 0x000000; sh.alpha = 0.18; this.flat.addChild(sh);
        flock.birds.push({ s, sh, ox: -i * 14 + Math.random() * 6, oy: (i % 2 ? 1 : -1) * i * 7, ph: Math.random() * 6 });
      }
      const [sx, sy] = iso(wx, wy); flock.x = sx; flock.y = sy; flock.vx = 70 + Math.random() * 40; flock.vy = (Math.random() - 0.5) * 20; flock.t = 0;
      this.birds.push(flock);
    }
    this.birds = this.birds.filter(f => {
      f.t += dt; f.x += f.vx * dt; f.y += f.vy * dt;
      for (const b of f.birds) { const up = Math.sin(this.t * 10 + b.ph) > 0; b.s.texture = this.birdT[up ? 0 : 1]; b.s.x = f.x + b.ox; b.s.y = f.y + b.oy - 140; b.sh.x = f.x + b.ox + 30; b.sh.y = f.y + b.oy; b.s.tint = mulTint(0xffffff, this.light); }
      if (f.t > 40) { for (const b of f.birds) { b.s.destroy(); b.sh.destroy(); } return false; }
      return true;
    });
  }
  // rain streaks / snowflakes over the screen
  weather(dt) {
    const g = this.weatherG, W = this.W, scr = this.app.screen; g.clear();
    const rain = raining(W), snow = W.season && W.season.snow;
    if (!rain && !snow) { this.flakes.length = 0; return; }
    const want = rain ? (snow ? 160 : 220) : 70;
    while (this.flakes.length < want) this.flakes.push({ x: Math.random() * scr.width, y: Math.random() * scr.height, v: 0.6 + Math.random() * 0.6 });
    if (this.flakes.length > want) this.flakes.length = want;
    for (const f of this.flakes) {
      if (snow) { f.y += 40 * f.v * dt; f.x += Math.sin(this.t + f.v * 9) * 12 * dt; g.circle(f.x, f.y, 1.2 + f.v).fill({ color: 0xffffff, alpha: 0.75 }); }
      else { f.y += 700 * f.v * dt; f.x -= 120 * f.v * dt; g.moveTo(f.x, f.y).lineTo(f.x + 4, f.y - 16).stroke({ width: 1, color: 0xc8d8f0, alpha: 0.45 }); }
      if (f.y > scr.height + 20) { f.y = -20; f.x = Math.random() * (scr.width + 200); }
      if (f.x < -20) f.x += scr.width + 40;
    }
  }
  drawSelection(sel, alpha) {
    const g = this.selG, b = this.barG; g.clear(); b.clear();
    const P = this.W.players[this.me];
    for (const id of sel) {
      const e = this.W.ents.get(id); if (!e) continue;
      const col = e.owner === this.me ? 0xffffff : 0xff4040;
      if (e.kind === 'unit') {
        const x = e.px + (e.x - e.px) * alpha, y = e.py + (e.y - e.py) * alpha; const [sx, sy] = iso(x, y);
        const [r, hh] = UNIT_BOX[e.type] || [15, 66];
        g.ellipse(sx, sy, r, r * 0.5).stroke({ width: 1.6, color: e.owner < 0 ? 0xffe070 : col, alpha: 0.9 });
        if (e.owner === this.me && ((e.oq && e.oq.length) || (e.order && e.order.t === 'patrol'))) {
          const W = this.W, pt = (o) => o.t === 'patrol' ? [o.bx, o.by] : o.x !== undefined ? [o.x, o.y] : (o.id && W.ents.get(o.id)) ? [W.ents.get(o.id).x + (W.ents.get(o.id).w || 0) / 2, W.ents.get(o.id).y + (W.ents.get(o.id).h || 0) / 2] : null;
          let [lx, ly] = [sx, sy];
          for (const o of [e.order, ...(e.oq || [])]) {
            const q = o && pt(o); if (!q) continue; const [qx, qy] = iso(q[0], q[1]);
            g.moveTo(lx, ly).lineTo(qx, qy).stroke({ width: 1.2, color: o.t === 'patrol' ? 0x90d0ff : 0xffffff, alpha: 0.45 }); g.circle(qx, qy, 3).fill({ color: 0xffffff, alpha: 0.6 });
            if (o.t === 'patrol') { const [ax, ay] = iso(o.ax, o.ay); g.moveTo(qx, qy).lineTo(ax, ay).stroke({ width: 1.2, color: 0x90d0ff, alpha: 0.3 }); }
            [lx, ly] = [qx, qy];
          }
        }
        if (e.faith !== undefined && e.owner === this.me) { g.rect(sx - 15, sy - hh + 5, 30, 3).fill({ color: 0x202040, alpha: 0.8 }); g.rect(sx - 15, sy - hh + 5, 30 * e.faith, 3).fill({ color: 0x8fb0ff, alpha: 0.95 }); }   // monk's faith
        this.hpBar(sx, sy - hh, 30, e.hp / e.maxHp);
        // gold pips: blacksmith upgrades this soldier carries
        const owner = this.W.players[e.owner];
        if (owner && !UNITS[e.type].animal && e.type !== 'villager') {
          const c = UNITS[e.type].cls, T = owner.techs;
          const n = (c === 'infantry' || c === 'cavalry' ? ['forging', 'iron_casting'] : c === 'archer' ? ['fletching', 'bodkin'] : []).filter(t => T.has(t)).length
            + (c === 'infantry' ? ['scale_mail', 'chain_mail'] : c === 'cavalry' ? ['scale_barding', 'chain_barding'] : c === 'archer' ? ['padded_archer'] : []).filter(t => T.has(t)).length;
          for (let i = 0; i < Math.min(4, n); i++) b.poly([sx - 14 + i * 7, sy - hh - 4, sx - 11 + i * 7, sy - hh - 9, sx - 8 + i * 7, sy - hh - 4]).fill({ color: 0xffd040, alpha: 0.95 });
          if (e.form && e.form !== 'garis') b.circle(sx + 19, sy - hh + 2, 3).fill({ color: e.form === 'tempur' ? 0x60b0ff : e.form === 'kotak' ? 0xffffff : 0x90ff90 });
        }
        if (e.cargo && e.cargo.length) for (let i = 0; i < e.cargo.length; i++) b.rect(sx - 15 + (i % 8) * 4, sy - hh - 10 - Math.floor(i / 8) * 4, 3, 3).fill(0xffffff);
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
  flare(x, y, color) { this.markers.push({ x, y, t: 0, color, life: 6, flare: true }); }
  drawMarkers(dt) {
    const g = this.markG; g.clear();
    this.markers = this.markers.filter(m => (m.t += dt) < (m.life || 0.7));
    for (const m of this.markers) {
      const [sx, sy] = iso(m.x, m.y);
      if (m.flare) {        // a signal flare: a beam of light and rings pulsing out
        const k = m.t % 1, fade = Math.min(1, (m.life - m.t) / 1.5);
        for (const d of [0, 0.5]) { const q = (k + d) % 1, r = 8 + q * 46; g.ellipse(sx, sy, r, r * 0.5).stroke({ width: 3, color: m.color, alpha: (1 - q) * fade }); }
        g.rect(sx - 2, sy - 90, 4, 90).fill({ color: m.color, alpha: 0.55 * fade }); g.circle(sx, sy - 92, 6 + Math.sin(m.t * 8) * 2).fill({ color: 0xffffff, alpha: 0.9 * fade });
        continue;
      }
      const r = 6 + m.t * 26; g.ellipse(sx, sy, r, r * 0.5).stroke({ width: 2, color: m.color, alpha: 1 - m.t / 0.7 });
    }
  }
  setGhost(type, i, j, ok, tiles, axis = 'x') {
    if (!type) { this.ghost.visible = false; return; }
    const d = BUILDINGS[type], A = this.A, col = this.colorOf(this.me);
    this.ghost.visible = true;
    const g = this.ghostG; g.clear();
    for (const [ti, tj, good] of tiles) { const p = [[ti, tj], [ti + 1, tj], [ti + 1, tj + 1], [ti, tj + 1]].map(([a, c]) => iso(a, c)); g.poly(p.flat()).fill({ color: good ? 0x30ff30 : 0xff3030, alpha: 0.28 }); }
    let key = type === 'gate' ? (axis === 'y' ? 'gate_y' : 'gate_x') : type === 'stone_wall' ? 'wall_post' : type === 'palisade' ? (A.buildings.has('pal_post') ? 'pal_post' : 'wall_post') : type;
    if (type === 'town_center') key = this.W.players[this.me].age === 1 && A.buildings.has('town_center_dark') ? 'town_center_dark' : key;
    const f = A.buildings.get(key, col);
    const w = d.len && axis === 'y' ? 1 : (d.len || d.n), h = d.len && axis === 'y' ? d.len : d.n;
    if (f) { this.ghostS.texture = f.tex; this.ghostS.anchor.set(f.ax, f.ay); const [sx, sy] = iso(i + w / 2, j + h / 2); this.ghostS.x = sx; this.ghostS.y = sy; this.ghostS.tint = ok ? 0xffffff : 0xff8080; this.ghostS.visible = tiles.length <= 4 || !d.wall; }
  }

  // ------------------------------------------------------------ war effects
  // a fire: flame tongues over the footprint, embers, a glow, and a column of dark smoke rising high and drifting with
  // the wind, so a burning town is seen from far away. Rates scale with the damage, the size, the zoom and the budget.
  burnFx(e, s, sx, sy, dt, night) {
    const W = this.W, rnd = Math.random, dmg = 1 - e.hp / e.maxHp, burning = e.burn && e.burn > W.t;
    this.burnN++;
    const I = Math.min(1, Math.max(burning ? 0.6 : 0.15, (dmg - 0.5) * 2)), wf = Math.min(4, Math.max(e.w, e.h)) / 2, K = this.burnK, lod = this.lod;
    const h = s.texture.height * Math.abs(s.scale.y), top = s.y - s.anchor.y * h, L = this.light;
    const spawn = (rate, fn) => { let a = rate * dt; while (a > 0) { if (a < 1 && rnd() > a) break; a -= 1; fn(); } };
    spawn((5 + 20 * I) * wf * K / lod, () => {
      const [fx, fy] = iso(e.x + 0.2 + rnd() * (e.w - 0.4), e.y + 0.2 + rnd() * (e.h - 0.4)), up = h * (0.15 + rnd() * 0.4), sz = (0.6 + rnd() * 0.5) * Math.sqrt(wf * lod) * (0.7 + 0.5 * I);
      // the body of the flame in solid orange (additive alone washes out to white on bright roofs), a hot core on top
      this.flame.emit({ x: fx, y: fy - up, vx: (rnd() - 0.5) * 10 + this.wind, vy: -30 - rnd() * 24, life: 0.5 + rnd() * 0.45, size: sz, grow: sz * 0.25, sy: 1.15, color: 0xff9a1c, c1: 0x8a1404, alpha: 0.85, ay: 0.85, rot: (rnd() - 0.5) * 0.5, z: fy + 40 });
      if (rnd() < 0.6) this.flame.emit({ x: fx, y: fy - up + 2, vx: this.wind, vy: -34 - rnd() * 20, life: 0.35 + rnd() * 0.25, size: sz * 0.55, grow: sz * 0.1, sy: 1.2, color: 0xffd860, c1: 0xff5a10, add: true, alpha: 0.9, ay: 0.85, rot: (rnd() - 0.5) * 0.4, z: fy + 41 });
      if (rnd() < 0.35) this.flame.emit({ tex: this.emberT, x: fx, y: fy - up + 6, vx: this.wind, vy: -10, life: 0.6, size: sz * 3.2, grow: sz * 2.4, color: 0xff8a20, c1: 0x801000, add: true, alpha: 0.5, z: fy + 39 });
    });
    spawn((2 + 6 * I) * wf * K, () => this.flame.emit({ tex: this.emberT, x: sx + (rnd() - 0.5) * e.w * 30, y: top + h * (0.2 + rnd() * 0.5), vx: (rnd() - 0.5) * 34 + this.wind * 2, vy: -55 - rnd() * 45, drag: 0.5, life: 1.3 + rnd(), size: 0.13, grow: 0.04, color: 0xffe080, c1: 0xff3a00, add: true, alpha: 1, z: sy + 1600 }));
    spawn((1 + 2.6 * I) * Math.sqrt(wf) * K / lod, () => this.smoke.emit({
      x: sx + (rnd() - 0.5) * e.w * 24, y: top + h * 0.25, vx: (rnd() - 0.5) * 8, vy: -(75 + rnd() * 25), ax: this.wind, drag: 0.12, life: 10 + rnd() * 3,
      size: (0.55 + rnd() * 0.25) * Math.sqrt(wf) * lod, grow: (3.4 + rnd() * 1.2) * Math.sqrt(wf) * lod, color: mulTint(I > 0.45 ? 0x141210 : 0x2c2925, L), c1: mulTint(0x6a655e, L),
      alpha: 0.7 + 0.2 * I, fadeIn: 0.04, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.25, z: sy + 1500 }));
    const fl = 0.8 + 0.2 * Math.sin(this.t * 17 + e.id) * Math.sin(this.t * 7.3 + e.id);
    this.glows.put(sx, sy - h * 0.22, 0.9 + e.w * 0.45, 0xff6a1a, (0.16 + 0.22 * I) * fl, sy + 45);
    if (night > 0.15) this.light2(sx, sy - 10, 170 + e.w * 34, 0xff7a28, 0.95 * fl);
  }
  // ruins smoulder: a thinning grey column, a few last flames at first
  rubbleFx(e, sx, sy, dt) {
    const rnd = Math.random, k = 1 - e.t / 30, n = e.n || 2, L = this.light;
    if (rnd() < dt * (0.5 + 1.4 * k) * Math.sqrt(n) * this.burnK / this.lod) this.smoke.emit({ x: sx + (rnd() - 0.5) * n * 22, y: sy - 8, vx: (rnd() - 0.5) * 6, vy: -(34 + rnd() * 12), ax: this.wind, drag: 0.2, life: 5 + rnd() * 2, size: 0.3 * this.lod, grow: (1.3 + n * 0.3) * this.lod, color: mulTint(0x3c3732, L), c1: mulTint(0x8a847c, L), alpha: 0.3 + 0.3 * k, fadeIn: 0.1, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.3, z: sy + 1400 });
    if (e.t < 8 && rnd() < dt * 5 * n * this.burnK / this.lod) { const [fx, fy] = iso(e.x + (rnd() - 0.5) * n, e.y + (rnd() - 0.5) * n); this.flame.emit({ x: fx, y: fy, vx: this.wind, vy: -20, life: 0.4 + rnd() * 0.3, size: 0.3, grow: 0.08, sy: 1.1, color: 0xffe0a0, c1: 0xb02008, add: true, alpha: 0.9 * (1 - e.t / 8), ay: 0.85, z: fy + 30 }); }
  }
  fireArrow(x, y, sy) {
    const rnd = Math.random;
    this.flame.emit({ x, y, vx: (rnd() - 0.5) * 8, vy: -14, life: 0.22, size: 0.3, grow: 0.08, sy: 1.1, color: 0xffa020, c1: 0xa01806, alpha: 0.9, ay: 0.75, z: sy + 1002 });
    this.flame.emit({ x, y, vx: (rnd() - 0.5) * 6, vy: -12, life: 0.16, size: 0.18, grow: 0.05, sy: 1.1, color: 0xffe080, c1: 0xff6010, add: true, alpha: 1, ay: 0.75, z: sy + 1003 });
    if (rnd() < 0.55) this.flame.emit({ tex: this.emberT, x, y, vx: (rnd() - 0.5) * 34, vy: -6 + rnd() * 18, g: 50, life: 0.5, size: 0.09, grow: 0.03, color: 0xffd060, c1: 0xff3000, add: true, alpha: 1, z: sy + 1001 });
    if (rnd() < 0.35) this.smoke.emit({ x, y, vy: -6, ax: this.wind, life: 0.9, size: 0.07, grow: 0.32, color: mulTint(0x4a4440, this.light), c1: mulTint(0x8a847c, this.light), alpha: 0.35, rot: rnd() * 6.28, z: sy + 1000 });
    this.glows.put(x, y, 0.5, 0xff8a28, 0.6, sy + 1003);
    if (this.nightK > 0.15) this.light2(x, y + 20, 80, 0xff9a48, 0.8);
  }
  // a hit: a spray of blood and a splat on the ground (living things only; budgeted per frame)
  bleed(sx, sy, big) {
    if (!FX.blood || this.fxN > (FX.rich ? 70 : 25)) return; this.fxN++;
    const rnd = Math.random, P = this.parts, n = big ? 9 : 3 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) P.emit({ x: sx + (rnd() - 0.5) * 8, y: sy - 16 - rnd() * 14, vx: (rnd() - 0.5) * (big ? 120 : 90), vy: -30 - rnd() * 60, g: 320, life: 0.35 + rnd() * 0.2, size: 0.07 + rnd() * 0.07, grow: 0.04, color: 0xb81212, c1: 0x4a0404, alpha: 1, z: sy + 4 });
    P.emit({ x: sx, y: sy - 20, vx: (rnd() - 0.5) * 20, vy: -10, life: 0.35, size: 0.16, grow: 0.5, color: 0x9a1010, alpha: 0.4, z: sy + 5 });
    if (big) this.decals.put(sx + (rnd() - 0.5) * 6, sy + 3, 0.55 + rnd() * 0.25, 35, 2.5);
    else if (rnd() < 0.4) this.decals.put(sx + (rnd() - 0.5) * 22, sy + 2 + (rnd() - 0.5) * 8, 0.22 + rnd() * 0.2, 24);
  }
  // a fire arrow strikes: a burst of sparks, a flash and a puff of smoke
  fireBurst(sx, sy) {
    if (this.fxN > (FX.rich ? 70 : 25)) return; this.fxN++;
    const rnd = Math.random;
    this.flame.emit({ x: sx, y: sy - 8, life: 0.25, size: 0.45, grow: 0.15, color: 0xfff0b0, c1: 0xff5010, add: true, alpha: 1, ay: 0.8, z: sy + 50 });
    for (let i = 0; i < (FX.rich ? 9 : 4); i++) this.flame.emit({ tex: this.emberT, x: sx, y: sy - 10, vx: (rnd() - 0.5) * 140, vy: -40 - rnd() * 80, g: 220, life: 0.4 + rnd() * 0.4, size: 0.1, grow: 0.03, color: 0xffe080, c1: 0xff3000, add: true, alpha: 1, z: sy + 51 });
    this.smoke.emit({ x: sx, y: sy - 14, vy: -18, ax: this.wind, drag: 0.5, life: 1.4, size: 0.15, grow: 0.7, color: mulTint(0x4a4440, this.light), c1: mulTint(0x8a847c, this.light), alpha: 0.45, rot: rnd() * 6.28, z: sy + 49 });
  }
  // ------------------------------------------------------------ events -> effects
  fx(e) {
    const [sx, sy] = iso(e.x ?? 0, e.y ?? 0); const P = this.parts;
    switch (e.k) {
      case 'chop': for (let i = 0; i < 3; i++) P.emit({ x: sx + (Math.random() - 0.5) * 20, y: sy - 30, vx: (Math.random() - 0.5) * 60, vy: -40, g: 160, life: 0.5, size: 0.12, grow: 0.08, color: 0xc89a60, alpha: 1, z: sy + 5 }); break;
      case 'mine': for (let i = 0; i < 3; i++) P.emit({ x: sx + (Math.random() - 0.5) * 16, y: sy - 18, vx: (Math.random() - 0.5) * 70, vy: -50, g: 200, life: 0.4, size: 0.1, grow: 0.06, color: e.res === 'iron' ? 0xb08068 : 0xd8d2c0, alpha: 1, z: sy + 5 }); break;
      case 'hammer': P.emit({ x: sx + (Math.random() - 0.5) * 14, y: sy - 8, vx: (Math.random() - 0.5) * 30, vy: -20, life: 0.8, size: 0.35, grow: 1.1, color: 0xb0a080, alpha: 0.5, z: sy + 3 }); break;
      case 'chant': for (let i = 0; i < 3; i++) P.emit({ x: sx + (Math.random() - 0.5) * 18, y: sy - 30 - Math.random() * 16, vx: 0, vy: -16, life: 0.8, size: 0.13, grow: 0.06, color: 0xcfe0ff, add: true, alpha: 0.85, z: sy + 60 }); break;
      case 'convert': for (let i = 0; i < 18; i++) P.emit({ x: sx + (Math.random() - 0.5) * 30, y: sy - 10 - Math.random() * 50, vx: (Math.random() - 0.5) * 20, vy: -30, life: 1.1, size: 0.18, grow: 0.1, color: 0xfff2a0, add: true, alpha: 0.95, z: sy + 80 }); break;
      case 'relic': for (let i = 0; i < 14; i++) P.emit({ x: sx + (Math.random() - 0.5) * 40, y: sy - 40 - Math.random() * 40, vx: 0, vy: -20, life: 1.4, size: 0.16, grow: 0.08, color: 0xffd060, add: true, alpha: 0.9, z: sy + 80 }); break;
      case 'heal': for (let i = 0; i < 4; i++) P.emit({ x: sx + (Math.random() - 0.5) * 22, y: sy - 20 - Math.random() * 20, vx: (Math.random() - 0.5) * 8, vy: -22, life: 0.9, size: 0.14, grow: 0.05, color: 0x7dff9a, add: true, alpha: 0.9, z: sy + 60 }); break;   // healing sparkles
      case 'fish': {        // a net thrown into the water: splash and spreading ring
        const [tx, ty] = iso(e.tx ?? e.x, e.ty ?? e.y);
        for (let i = 0; i < 10; i++) { const a = i / 10 * 6.28; P.emit({ x: tx + Math.cos(a) * 14, y: ty + Math.sin(a) * 7, vx: Math.cos(a) * 25, vy: Math.sin(a) * 12 - 10, g: 60, life: 0.6, size: 0.1, grow: 0.04, color: 0xe8f4ff, alpha: 0.9, z: ty + 2 }); }
        P.emit({ x: tx, y: ty, life: 1.0, size: 0.6, grow: 2.4, color: 0xd0e8ff, alpha: 0.35, z: ty + 1 });
        break;
      }
      case 'gunshot': { const a = Math.atan2(iso(e.tx, e.ty)[1] - sy, iso(e.tx, e.ty)[0] - sx); P.emit({ x: sx + Math.cos(a) * 18, y: sy - 30 + Math.sin(a) * 9, life: 0.12, size: 0.35, grow: 0.5, color: 0xfff0b0, add: true, alpha: 1, z: sy + 900 }); for (let i = 0; i < 4; i++) P.emit({ x: sx + Math.cos(a) * 20, y: sy - 30, vx: Math.cos(a) * 20 + (Math.random() - 0.5) * 10, vy: -8, life: 1.6, size: 0.3, grow: 1.4, color: 0xd8d4cc, alpha: 0.5, z: sy + 900 }); break; }
      case 'cannon': for (let i = 0; i < 10; i++) P.emit({ x: sx + (Math.random() - 0.5) * 20, y: sy - 24, vx: (Math.random() - 0.5) * 40, vy: -12 - Math.random() * 10, life: 2.2, size: 0.6, grow: 2.2, color: i < 2 ? 0xfff0a0 : 0xcfcac2, add: i < 2, alpha: 0.6, z: sy + 900 }); break;
      case 'boom': for (let i = 0; i < 8; i++) this.smoke.emit({ x: sx + (Math.random() - 0.5) * 30, y: sy - 10, vx: (Math.random() - 0.5) * 60, vy: -30 - Math.random() * 30, ax: this.wind, drag: 0.9, life: 2.2 + Math.random(), size: 0.4, grow: 1.6, color: mulTint(0x3a342e, this.light), c1: mulTint(0x8a8278, this.light), alpha: 0.6, rot: Math.random() * 6.28, z: sy + 60 });
        for (let i = 0; i < 16; i++) P.emit({ x: sx + (Math.random() - 0.5) * 30, y: sy - 10, vx: (Math.random() - 0.5) * 90, vy: -40 - Math.random() * 60, g: 160, life: 0.8 + Math.random() * 0.6, size: i < 6 ? 0.6 : 0.15, grow: i < 6 ? 1.6 : 0.05, color: i < 6 ? 0xffa030 : 0x5a4a3a, add: i < 6, alpha: 0.9, z: sy + 50 }); break;
      case 'bullethit': P.emit({ x: sx, y: sy - 14, life: 0.4, size: 0.2, grow: 0.7, color: 0xc8b898, alpha: 0.6, z: sy + 2 }); break;
      case 'built': {
        const r = (e.n || 2) * 30;
        for (let i = 0; i < 18; i++) P.emit({ x: sx + (Math.random() - 0.5) * r * 2, y: sy + (Math.random() - 0.5) * r - 10, vx: (Math.random() - 0.5) * 40, vy: -15 - Math.random() * 20, life: 1.6 + Math.random(), size: 0.8, grow: 2.6, color: 0xc8b898, alpha: 0.55, z: sy + 80 });
        break;
      }
      case 'collapse': {        // the building comes down: a rolling dust cloud, flying beams and stones, a dark plume, sparks
        const n = Math.min(4, e.n || 2), r = n * 30, rnd = Math.random, L = this.light;
        for (let i = 0; i < 12 + n * 4; i++) { const a = rnd() * 6.283; this.smoke.emit({ x: sx + Math.cos(a) * r * 0.35 * rnd(), y: sy + Math.sin(a) * r * 0.18, vx: Math.cos(a) * (50 + rnd() * 60), vy: Math.sin(a) * (22 + rnd() * 26) - 10, drag: 1.3, life: 2.4 + rnd() * 1.6, size: 0.55, grow: 1.6 + n * 0.35, color: mulTint(0x857562, L), c1: mulTint(0xb4a890, L), alpha: 0.6, fadeIn: 0.04, rot: rnd() * 6.28, spin: (rnd() - 0.5) * 0.6, z: sy + 90 }); }
        if (e.type !== 'farm') for (let i = 0; i < 5 + n * 2; i++) this.smoke.emit({ x: sx + (rnd() - 0.5) * r, y: sy - 20 - rnd() * 30, vx: (rnd() - 0.5) * 30, vy: -(70 + rnd() * 60), ax: this.wind, drag: 0.45, life: 4 + rnd() * 2, size: 0.6, grow: 2.4 + n * 0.4, color: mulTint(0x2a2622, L), c1: mulTint(0x6e675f, L), alpha: 0.6, fadeIn: 0.05, rot: rnd() * 6.28, z: sy + 1500 });
        for (let i = 0; i < 14 + n * 5; i++) P.emit({ x: sx + (rnd() - 0.5) * r, y: sy - 20 - rnd() * 40, vx: (rnd() - 0.5) * 170, vy: -80 - rnd() * 120, g: 380, life: 0.7 + rnd() * 0.5, size: 0.09 + rnd() * 0.12, grow: 0.07, sy: 0.6 + rnd() * 0.8, rot: rnd() * 3, spin: (rnd() - 0.5) * 12, color: i % 3 ? 0x4a3828 : 0x8a8478, alpha: 1, z: sy + 95 });
        if (e.hit && e.type !== 'farm') for (let i = 0; i < 16; i++) this.flame.emit({ tex: this.emberT, x: sx + (rnd() - 0.5) * r, y: sy - 10 - rnd() * 30, vx: (rnd() - 0.5) * 120, vy: -70 - rnd() * 90, g: 60, drag: 0.4, life: 1.2 + rnd(), size: 0.14, grow: 0.04, color: 0xffe080, c1: 0xff3000, add: true, alpha: 1, z: sy + 1600 });
        break;
      }
      case 'die': { const u = UNITS[e.type]; if (u && !u.naval && u.cls !== 'siege') this.bleed(sx, sy, true); else P.emit({ x: sx, y: sy - 10, vy: -12, life: 0.9, size: 0.4, grow: 1.4, color: 0xa09080, alpha: 0.5, z: sy + 2 }); break; }
      case 'treefall': for (let i = 0; i < 10; i++) P.emit({ x: sx + (Math.random() - 0.5) * 40, y: sy - 40 - Math.random() * 40, vx: (Math.random() - 0.5) * 40, vy: 10, g: 40, life: 1.2, size: 0.18, grow: 0.12, color: this.W.opts && this.W.opts.season === 'gugur' ? 0xd08a2a : 0x4f8a2a, alpha: 0.9, z: sy + 20 }); break;
      case 'hit': {
        if (e.fire) break;                                       // burning: the fire shows it
        const u = e.u && UNITS[e.u];
        if (u && !u.naval && u.cls !== 'siege') { this.bleed(sx, sy, false); break; }
        if (Math.random() < 0.5) for (let i = 0; i < 2; i++) P.emit({ x: sx + (Math.random() - 0.5) * 30, y: sy - 20 - Math.random() * 30, vx: (Math.random() - 0.5) * 60, vy: -30, g: 200, life: 0.4, size: 0.08, grow: 0.04, color: e.b ? 0x8a7a66 : 0x6a5a4a, alpha: 0.9, z: sy + 40 });   // splinters and chips
        break;
      }
      case 'treasure': this.floatText(e.x, e.y, `+${e.amount} ${RES_NAME[TREASURES[e.type].res]}`); for (let i = 0; i < 24; i++) P.emit({ x: sx + (Math.random() - 0.5) * 40, y: sy - 10 - Math.random() * 30, vx: (Math.random() - 0.5) * 60, vy: -60 - Math.random() * 40, g: 90, life: 1.1, size: 0.12, grow: 0.02, color: 0xffd040, add: true, alpha: 1, z: sy + 50 }); break;
      case 'arrowhit': if (e.fire) this.fireBurst(sx, sy); else P.emit({ x: sx, y: sy - 12, life: 0.3, size: 0.2, grow: 0.5, color: 0xffffff, alpha: 0.5, z: sy + 2 }); break;
      case 'arrowmiss': if (e.water) P.emit({ x: sx, y: sy, life: 0.5, size: 0.15, grow: 0.6, color: 0xe0f0ff, alpha: 0.6, z: sy + 1 }); else if (e.fire) this.fireBurst(sx, sy); break;
      case 'board': case 'unload': for (let i = 0; i < 8; i++) P.emit({ x: sx + (Math.random() - 0.5) * 40, y: sy, vx: (Math.random() - 0.5) * 30, vy: -20, g: 80, life: 0.6, size: 0.1, grow: 0.05, color: 0xe0f0ff, alpha: 0.8, z: sy + 2 }); break;
      case 'pack': for (let i = 0; i < 8; i++) P.emit({ x: sx + (Math.random() - 0.5) * 40, y: sy - 6, vx: (Math.random() - 0.5) * 30, vy: -12, life: 1.0, size: 0.4, grow: 1.0, color: 0xb8a888, alpha: 0.5, z: sy + 3 }); break;
      case 'tradegold': this.floatText(e.x, e.y, `+${e.n} emas`); break;
      case 'reseed': for (let i = 0; i < 10; i++) P.emit({ x: sx + (Math.random() - 0.5) * 60, y: sy + (Math.random() - 0.5) * 30, vy: -14, life: 0.9, size: 0.12, grow: 0.05, color: 0x9ad04a, alpha: 0.9, z: sy + 2 }); break;
      case 'fishtrap': this.fx({ k: 'fish', x: e.x, y: e.y }); break;
      case 'age': for (let i = 0; i < 30; i++) P.emit({ x: sx + (Math.random() - 0.5) * 160, y: sy - Math.random() * 120, vy: -40, life: 1.5, size: 0.25, grow: 0.05, color: 0xffd860, add: true, alpha: 0.9, z: sy + 200 }); break;
    }
  }
}
