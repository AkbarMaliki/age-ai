// Atlas loading + per-player colour tinting (done once on a canvas, like AoE2's player-colour palette swap).
import { Texture, Rectangle, CanvasSource } from 'pixi.js';
import { PLAYER_RGB } from './data.js?v=20261014170741';

// build version (set by tools/build.py in index.html): a new deploy never mixes with files cached from the last one
export const vq = (u) => globalThis.AK_VER ? u + (u.includes('?') ? '&' : '?') + 'v=' + globalThis.AK_VER : u;
const img = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('load ' + src)); i.src = vq(src); });
const json = (src) => fetch(vq(src)).then(r => { if (!r.ok) throw new Error('load ' + src); return r.json(); });

function tintCanvas(base, mask, rgb) {
  const w = base.width, h = base.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(base, 0, 0);
  if (!mask) return c;
  const d = g.getImageData(0, 0, w, h), px = d.data;
  const mc = document.createElement('canvas'); mc.width = w; mc.height = h; const mg = mc.getContext('2d', { willReadFrequently: true }); mg.drawImage(mask, 0, 0);
  const m = mg.getImageData(0, 0, w, h).data;
  const [r, gg, b] = rgb;
  for (let i = 0; i < px.length; i += 4) {
    const k = m[i] / 255 * 0.95; if (k < 0.02) continue;
    const lum = Math.min(1.15, Math.max(0.12, (px[i] + px[i + 1] + px[i + 2]) / 765 * 1.45));
    px[i] = px[i] * (1 - k) + Math.min(255, r * lum) * k;
    px[i + 1] = px[i + 1] * (1 - k) + Math.min(255, gg * lum) * k;
    px[i + 2] = px[i + 2] * (1 - k) + Math.min(255, b * lum) * k;
  }
  g.putImageData(d, 0, 0);
  return c;
}

// draw an image into a smaller canvas (mobile memory saving); frames keep their logical size via source resolution
function shrink(im, k) {
  if (k >= 1) return im;
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.width * k)); c.height = Math.max(1, Math.round(im.height * k));
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height); return c;
}
const toSource = (c, k) => k >= 1 ? Texture.from(c).source : new CanvasSource({ resource: c, resolution: k });

export class Atlas {
  static async load(base, name, colors, onProgress, scale = 1) {
    const a = new Atlas(); a.meta = await json(`${base}/${name}.json`);
    a.pages = {};      // color -> [TextureSource]
    const imgs = (await Promise.all(a.meta.pages.map(p => img(`${base}/${p}`)))).map(im => shrink(im, scale));
    const masks = a.meta.mask ? (await Promise.all(a.meta.pages.map(p => img(`${base}/${p.replace(name + '_', name + '_mask_')}`)))).map(im => shrink(im, scale)) : null;
    for (const col of (a.meta.mask ? colors : ['none'])) {
      a.pages[col] = imgs.map((im, i) => { const c = a.meta.mask ? tintCanvas(im, masks[i], PLAYER_RGB[col]) : im; return toSource(c, scale); });
      onProgress?.();
    }
    a.cache = new Map();
    return a;
  }
  has(key) { return !!this.meta.frames[key]; }
  // texture + anchor for a frame key, for a player colour
  get(key, col = 'none') {
    const ck = col + '|' + key; let t = this.cache.get(ck);
    if (t) return t;
    const f = this.meta.frames[key]; if (!f) return null;
    const [pg, x, y, w, h, ax, ay] = f;
    const pages = this.pages[col] || this.pages[Object.keys(this.pages)[0]];
    t = { tex: new Texture({ source: pages[pg], frame: new Rectangle(x, y, w, h) }), ax: ax / w, ay: ay / h, w, h };
    this.cache.set(ck, t);
    return t;
  }
}

export async function loadAll(colors, onProgress, scale = 1) {
  const base = 'assets';
  const steps = 2 * colors.length + 3;
  let done = 0; const tick = () => onProgress?.(++done / steps);
  const [units, buildings, nature, fauna, icons] = await Promise.all([
    Atlas.load(base, 'units', colors, tick, scale), Atlas.load(base, 'buildings', colors, tick, scale), Atlas.load(base, 'nature', colors, tick, scale), Atlas.load(base, 'fauna', colors, tick, scale),
    json(`${base}/icons.json`),
  ]);
  const terrain = {};
  for (const n of ['grass', 'grass2', 'dirt', 'forest']) terrain[n] = await Texture.from(await img(`${base}/terrain/${n}.jpg`));
  tick();
  return { units, buildings, nature, fauna, icons, terrain };
}
