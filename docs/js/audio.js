// Synthesised medieval SFX (WebAudio) + streamed background music (assets/music/*.ogg|m4a).
const vq = (u) => globalThis.AK_VER ? u + '?v=' + globalThis.AK_VER : u;      // build version stamp (see tools/build.py)
let ctx = null, master = null, sfxG = null, musG = null;
const vol = { music: 0.5, sfx: 0.8 };
function ac() {
  if (!ctx) {
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.connect(ctx.destination);
      sfxG = ctx.createGain(); sfxG.connect(master); musG = ctx.createGain(); musG.connect(master);
      sfxG.gain.value = vol.sfx; musG.gain.value = vol.music;
    } catch { return null; }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
let nbuf = null;
function noise() { if (!nbuf) { nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } const s = ctx.createBufferSource(); s.buffer = nbuf; s.loop = true; return s; }
function env(g, t, a, p, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(p, 0.0002), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(f, d, type = 'sine', v = 0.2, w = 0, slide = 0, out = null) {
  if (!ctx) return; const t = ctx.currentTime + w, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(f * slide, t + d);
  env(g, t, 0.005, v, d); o.connect(g).connect(out || sfxG); o.start(t); o.stop(t + d + 0.05);
}
function hiss(d, f, q, v, w = 0, type = 'bandpass') {
  if (!ctx) return; const t = ctx.currentTime + w, s = noise(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
  fl.type = type; fl.frequency.value = f; fl.Q.value = q; env(g, t, 0.004, v, d); s.connect(fl).connect(g).connect(sfxG); s.start(t, Math.random()); s.stop(t + d + 0.05);
}
function horn(notes, step = 0.18, v = 0.12) {
  if (!ctx) return;
  notes.forEach((f, i) => { const t = ctx.currentTime + i * step; const o = ctx.createOscillator(), o2 = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'sawtooth'; o.frequency.value = f; o2.frequency.value = f * 1.005; lp.type = 'lowpass'; lp.frequency.setValueAtTime(400, t); lp.frequency.linearRampToValueAtTime(1800, t + 0.06);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(v, t + 0.04); g.gain.setValueAtTime(v, t + step * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
    o.connect(lp); o2.connect(lp); lp.connect(g).connect(sfxG); o.start(t); o2.start(t); o.stop(t + step * 1.7); o2.stop(t + step * 1.7); });
}
const last = {};
const SFX = {
  click() { tone(1400, 0.03, 'triangle', 0.08); hiss(0.02, 3000, 2, 0.05); },
  chop() { hiss(0.07, 700, 1.2, 0.28); tone(150, 0.08, 'sine', 0.22, 0, 0.7); },
  mine() { tone(2100 + Math.random() * 300, 0.12, 'sine', 0.09); tone(3150, 0.06, 'sine', 0.05); hiss(0.03, 6000, 1, 0.08); },
  hammer() { tone(320, 0.06, 'square', 0.06, 0, 0.6); hiss(0.04, 1100, 1.5, 0.2); },
  forage() { hiss(0.15, 3200, 0.7, 0.06); },
  treefall() { hiss(0.12, 1500, 0.8, 0.25); hiss(0.6, 300, 0.6, 0.25, 0.1, 'lowpass'); },
  swing() { hiss(0.12, 1800, 0.8, 0.1); tone(900 + Math.random() * 200, 0.07, 'square', 0.05, 0.08); tone(1360, 0.09, 'triangle', 0.05, 0.08); },
  shoot() { tone(240, 0.12, 'triangle', 0.12, 0, 0.75); hiss(0.08, 2500, 1, 0.06); },
  arrowhit() { hiss(0.05, 600, 1, 0.12); },
  die() { const t = ctx.currentTime, o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(190, t); o.frequency.exponentialRampToValueAtTime(85, t + 0.45); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 3; env(g, t, 0.02, 0.18, 0.45); o.connect(bp).connect(g).connect(sfxG); o.start(t); o.stop(t + 0.55); },
  dieVil() { SFX.die(); },
  collapse() { hiss(1.6, 220, 0.6, 0.45, 0, 'lowpass'); hiss(0.25, 1400, 0.8, 0.2); for (let i = 0; i < 5; i++) hiss(0.06, 900, 2, 0.12, 0.15 + i * 0.13); },
  built() { [523, 659, 784].forEach((f, i) => tone(f, 0.35, 'triangle', 0.12, i * 0.11)); },
  trained() { horn([196, 262], 0.16, 0.08); },
  trainedVil() { tone(660, 0.12, 'triangle', 0.1); tone(880, 0.18, 'triangle', 0.08, 0.1); },
  tech() { [784, 1047, 1319].forEach((f, i) => tone(f, 0.3, 'sine', 0.1, i * 0.08)); },
  age() { horn([262, 330, 392, 523], 0.22, 0.12); setTimeout(() => horn([392, 523], 0.4, 0.1), 900); },
  alert() { horn([220, 220, 165], 0.2, 0.11); },
  ackVil() { tone(520, 0.05, 'triangle', 0.06); tone(700, 0.06, 'triangle', 0.05, 0.05); },
  ackMil() { tone(980, 0.05, 'square', 0.04); tone(1470, 0.07, 'triangle', 0.04, 0.03); },
  ackCav() { hiss(0.25, 900, 0.6, 0.1); tone(140, 0.2, 'sawtooth', 0.04, 0, 0.8); },
  selVil() { tone(600, 0.05, 'triangle', 0.05); },
  selMil() { tone(1100, 0.04, 'square', 0.03); },
  selCav() { hiss(0.15, 1100, 0.6, 0.07); },
  selBld() { hiss(0.04, 1500, 1.4, 0.08); tone(300, 0.06, 'triangle', 0.05); },
  place() { tone(180, 0.08, 'triangle', 0.12); hiss(0.05, 900, 1, 0.12); },
  nope() { tone(140, 0.15, 'square', 0.05); },
  victory() { horn([392, 523, 659, 784, 659, 784], 0.25, 0.13); },
  defeat() { horn([392, 349, 311, 262], 0.45, 0.12); },
};
// AoE2-style "selected building" sounds and animal calls
function bell(f, v = 0.1, w = 0) { [[1, 1.4], [2.76, 0.9], [5.4, 0.5], [8.9, 0.25]].forEach(([m, d]) => tone(f * m, d * 1.4, 'sine', v / m ** 0.5, w)); }
function clang(w = 0) { tone(1900 + Math.random() * 200, 0.25, 'triangle', 0.06, w); tone(2850, 0.18, 'sine', 0.04, w); hiss(0.05, 4000, 1.2, 0.1, w); }
function creak(w = 0) { if (!ctx) return; const t = ctx.currentTime + w, o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(110, t + 0.35); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6; env(g, t, 0.05, 0.12, 0.35); o.connect(bp).connect(g).connect(sfxG); o.start(t); o.stop(t + 0.5); }
function voiceLike(f0, f1, d, formant, v = 0.12, vib = 6) {  // animal calls: buzzy source through a formant filter, with vibrato
  if (!ctx) return; const t = ctx.currentTime, o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + d);
  lfo.frequency.value = vib; lg.gain.value = f0 * 0.04; lfo.connect(lg).connect(o.frequency);
  bp.type = 'bandpass'; bp.frequency.value = formant; bp.Q.value = 2.5; env(g, t, 0.04, v, d);
  o.connect(bp).connect(g).connect(sfxG); o.start(t); lfo.start(t); o.stop(t + d + 0.1); lfo.stop(t + d + 0.1);
}
Object.assign(SFX, {
  sel_town_center() { bell(392, 0.09); },
  sel_barracks() { clang(); clang(0.16); },
  sel_archery_range() { tone(180, 0.25, 'triangle', 0.14, 0, 1.6); hiss(0.05, 2400, 1, 0.08); },
  sel_stable() { voiceLike(820, 380, 0.7, 1300, 0.09, 11); },
  sel_mill() { creak(); creak(0.4); },
  sel_lumber_camp() { SFX.chop(); setTimeout(() => SFX.chop(), 220); },
  sel_mining_camp() { SFX.mine(); setTimeout(() => SFX.mine(), 200); },
  sel_house() { hiss(0.05, 600, 1.5, 0.22); hiss(0.05, 600, 1.5, 0.2, 0.18); },
  sel_farm() { SFX.forage(); },
  sel_watch_tower() { bell(587, 0.06); },
  sel_castle() { horn([196, 262, 330], 0.2, 0.09); },
  sel_stone_wall() { hiss(0.2, 300, 0.7, 0.2, 0, 'lowpass'); },
  sel_gate() { creak(); },
  sheep() { voiceLike(310, 260, 0.55, 1100, 0.1, 14); },
  wolf() { voiceLike(420, 700, 1.1, 900, 0.06, 4); },
  bear() { voiceLike(95, 70, 0.8, 500, 0.16, 20); hiss(0.6, 400, 0.8, 0.08); },
  boar() { voiceLike(140, 110, 0.25, 700, 0.14, 25); },
  deer() { tone(900, 0.12, 'sine', 0.05, 0, 0.8); },
  treasure() { [1319, 1568, 2093, 2637].forEach((f, i) => tone(f, 0.4, 'sine', 0.07, i * 0.07)); hiss(0.4, 7000, 0.8, 0.05, 0.05); horn([392, 523], 0.18, 0.07); },
  hunt() { hiss(0.06, 1400, 1, 0.12); },
  gunshot() { hiss(0.18, 1800, 0.7, 0.32); tone(110, 0.12, 'square', 0.12, 0, 0.5); hiss(0.6, 500, 0.6, 0.08, 0.05, 'lowpass'); },
  cannon() { hiss(1.2, 160, 0.6, 0.55, 0, 'lowpass'); tone(55, 0.5, 'sine', 0.3, 0, 0.6); hiss(0.25, 1500, 0.8, 0.2); },
  boom() { hiss(1.0, 240, 0.6, 0.45, 0, 'lowpass'); for (let i = 0; i < 4; i++) hiss(0.08, 1200, 2, 0.12, 0.1 + i * 0.09); },
  coin() { [2637, 3136].forEach((f, i) => tone(f, 0.18, 'sine', 0.05, i * 0.06)); hiss(0.05, 6000, 1.5, 0.05); },
  sel_market() { SFX.coin(); setTimeout(() => SFX.coin(), 140); },
  card() { [659, 880, 1175].forEach((f, i) => tone(f, 0.28, 'triangle', 0.08, i * 0.09)); },
  ship() { horn([262, 392, 523], 0.28, 0.1); setTimeout(() => bell(784, 0.05), 500); },
});
const MIN_GAP = { gunshot: 0.08, cannon: 0.25, boom: 0.2, farm: 0.3, forage: 0.3, mine_gold: 0.2, mine_stone: 0.2, drop_wood: 0.25, drop_gold: 0.25, drop_food: 0.25, drop_stone: 0.25, hunt: 0.3, sheep: 1.5, wolf: 3, chop: 0.18, hammer: 0.15, swing: 0.07, arrowhit: 0.06, shoot: 0.05, die: 0.08 };

// ---------------- music
const EXT = (() => { try { return new Audio().canPlayType('audio/ogg; codecs="vorbis"') ? '.ogg' : '.m4a'; } catch { return '.m4a'; } })();
const PLAYLIST = { menu: ['menu'], game: ['game1', 'game2', 'game3', 'game4'] };
let cur = null, curName = null, listIdx = 0;
function fade(a, to, ms, done) { const from = a.volume, t0 = performance.now(); const f = () => { const k = Math.min(1, (performance.now() - t0) / ms); a.volume = Math.max(0, Math.min(1, from + (to - from) * k)); if (k < 1) setTimeout(f, 40); else done && done(); }; f(); }
function playMusic(name) {
  if (name === curName && cur && !cur.paused) return;
  if (cur) { const a = cur; fade(a, 0, 800, () => a.pause()); cur = null; }
  curName = name; if (!name) return;
  const list = PLAYLIST[name]; listIdx = Math.floor(Math.random() * list.length);
  const next = () => {
    if (curName !== name) return;
    const a = new Audio(`assets/music/${list[listIdx++ % list.length]}${EXT}`); a.volume = 0; a.loop = list.length === 1;
    a.onended = next; a.onerror = () => { };
    a.play().then(() => fade(a, vol.music * 0.6, 1500)).catch(() => { }); cur = a;
  };
  next();
}

// ---------------- sampled work sounds (assets/sfx, generated by _audio/sfx_age.py): several variants each,
// random pitch, panned/attenuated by where on screen the action happens
const SMP = { man: null, bufs: {}, live: 0 };
// recorded sounds (Kenney CC0, layered/softened by _audio/sfx_kenney.py); [sample, gain]
const SAMPLE_OF = { chop: ['chop', 0.55], hammer: ['build', 0.5], forage: ['forage', 0.45], hunt: ['hunt', 0.5], farm: ['farm', 0.5], mine_gold: ['mine_gold', 0.5], mine_stone: ['mine_stone', 0.5],
  drop_wood: ['drop_wood', 0.5], drop_gold: ['drop_gold', 0.5], drop_stone: ['drop_stone', 0.5], drop_food: ['drop_food', 0.5], swing: ['swing', 0.6], arrowhit: ['arrowhit', 0.45],
  sel_house: ['sel_house', 0.8], sel_mill: ['sel_mill', 0.8], sel_barracks: ['sel_barracks', 0.8], sel_mining_camp: ['sel_mining_camp', 0.8], sel_lumber_camp: ['sel_lumber_camp', 0.8], sel_town_center: ['sel_town_center', 0.7] };
// busy scenes: the same work sound may only repeat this often (seconds), and some hits are skipped
const WORK = new Set(['chop', 'hammer', 'forage', 'hunt', 'farm', 'mine_gold', 'mine_stone']);
function loadSamples() {
  const c = ac(); if (!c || SMP.man) return; SMP.man = {};
  fetch(vq('assets/sfx/sfx.json')).then(r => r.json()).then(man => { SMP.man = man;
    for (const [name, n] of Object.entries(man)) for (let i = 0; i < n; i++)
      fetch(vq(`assets/sfx/${name}_${i}${EXT}`)).then(r => r.arrayBuffer()).then(ab => c.decodeAudioData(ab)).then(b => { (SMP.bufs[name] ||= []).push(b); }).catch(() => { });
  }).catch(() => { });
}
function sample(name, gain = 1, pan = 0) {
  const list = SMP.bufs[name]; if (!list || !list.length || SMP.live > 7) return !!list;   // too many at once: drop it
  const s = ctx.createBufferSource(); s.buffer = list[(Math.random() * list.length) | 0]; s.playbackRate.value = 0.9 + Math.random() * 0.2;
  const g = ctx.createGain(); g.gain.value = gain * (0.8 + Math.random() * 0.25);
  s.connect(g);
  if (ctx.createStereoPanner) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p).connect(sfxG); } else g.connect(sfxG);
  SMP.live++; s.onended = () => SMP.live--; s.start();
  return true;
}

// ---------------- unit voices (assets/voice, generated by _audio/voices_age.py)
const VOICE = { man: null, bufs: new Map(), cur: null, t: 0 };
const voiceMeta = () => VOICE.man || (VOICE.man = fetch(vq('assets/voice/voice.json')).then(r => r.json()).catch(() => ({})));
async function voice(role, ev, seed = 0, force = false) {
  const c = ac(); if (!c) return;
  const now = performance.now(); if (!force && now - VOICE.t < 450) return; VOICE.t = now;
  const man = await voiceMeta(); let list = man[role]?.[ev] || (ev === 'work' ? man[role]?.move : null); if (!list || !list.length) return;
  const nspk = 1 + Math.max(...list.map(x => x.spk)), mine = list.filter(x => x.spk === seed % nspk);
  const pickL = mine.length ? mine : list, it = pickL[Math.floor(Math.random() * pickL.length)];
  const url = `assets/voice/${role}_${ev}_${it.n}${EXT}`;
  let buf = VOICE.bufs.get(url);
  if (!buf) { try { buf = await c.decodeAudioData(await (await fetch(url)).arrayBuffer()); VOICE.bufs.set(url, buf); } catch { return; } }
  if (VOICE.cur) try { VOICE.cur.stop(); } catch { }
  const s = c.createBufferSource(), g = c.createGain(); s.buffer = buf; g.gain.value = 1.0; s.connect(g).connect(sfxG); s.start(); VOICE.cur = s;
}
// ---------------- ambience: soft wind + occasional birdsong while playing
let amb = null;
function ambience(on) {
  if (!ac()) return;
  if (!on) { if (amb) { amb.g.gain.setTargetAtTime(0, ctx.currentTime, 0.5); clearInterval(amb.iv); amb = null; } return; }
  if (amb) return;
  const n = noise(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
  lp.type = 'lowpass'; lp.frequency.value = 420; lfo.frequency.value = 0.07; lg.gain.value = 180; lfo.connect(lg).connect(lp.frequency);
  g.gain.value = 0; g.gain.setTargetAtTime(0.035, ctx.currentTime, 2); n.connect(lp).connect(g).connect(sfxG); n.start(); lfo.start();
  const chirp = () => { if (Math.random() < 0.55) { const f = 2400 + Math.random() * 1800, k = 2 + (Math.random() * 4 | 0); for (let i = 0; i < k; i++) tone(f * (1 + (Math.random() - 0.5) * 0.15), 0.06, 'sine', 0.018, i * 0.11, 1.25); } };
  amb = { g, iv: setInterval(chirp, 3500) };
}

export class Sound {
  voice(role, ev, seed, force) { voice(role, ev, seed, force); }
  ambience(on) { ambience(on); }
  play(k, gain = 1, pan = 0) {
    if (!ac()) return; const now = performance.now() / 1000; if (MIN_GAP[k] && last[k] && now - last[k] < MIN_GAP[k]) return; last[k] = now;
    if (WORK.has(k) && Math.random() < 0.3) return;
    if (SAMPLE_OF[k] && sample(SAMPLE_OF[k][0], gain * SAMPLE_OF[k][1], pan)) return;
    if (SFX[k]) SFX[k]();
  }
  loadSamples() { loadSamples(); }
  music(name) { playMusic(name); }
  unlock() { ac(); }
  static ui() { if (ac()) SFX.click(); }
  static unlockStatic() { ac(); }
  static menuMusic() { playMusic('menu'); }
  static setVolume(m, s) { vol.music = m; vol.sfx = s; if (sfxG) sfxG.gain.value = s; if (cur) cur.volume = m * 0.6; }
}
