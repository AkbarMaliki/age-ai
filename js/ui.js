// AoE2-style HUD: resource bar, command grid, selection info, diamond minimap, notifications, tooltips.
import { UNITS, BUILDINGS, TECHS, RES, RES_NAME, AGES, PLAYER_RGB, TREASURES } from './data.js';
import { canAfford, canBuild, techOk, idx } from './sim.js';

const $ = (id) => document.getElementById(id);
const KEYS = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];
const VIL_BUILD = [['house', 0], ['mill', 1], ['lumber_camp', 2], ['mining_camp', 3], ['farm', 4], ['barracks', 5], ['archery_range', 6], ['stable', 7], ['watch_tower', 10], ['stone_wall', 11], ['gate', 12], ['castle', 13]];

export class HUD {
  constructor(game) {
    this.g = game; this.icons = game.A.icons; this.btns = [];
    this.mini = $('miniCanvas'); this.miniCtx = this.mini.getContext('2d');
    this.miniBase = document.createElement('canvas'); this.miniBase.width = this.miniBase.height = game.W.size;
    this.miniT = 0; this.lastSig = '';
    const grid = $('cmd'); grid.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const b = document.createElement('button'); b.className = 'cb'; b.innerHTML = `<i></i><span>${KEYS[i]}</span>`;
      b.onmouseenter = () => this.tip(b); b.onmouseleave = () => this.tip(null);
      b.onpointerdown = (e) => { if (e.pointerType === 'touch') { this.tip(b); clearTimeout(this.tipT); this.tipT = setTimeout(() => this.tip(null), 1800); } };   // touch: show the tooltip briefly
      b.onclick = () => { if (b.act && !b.disabled) { this.g.sfx('click'); b.act(); } };
      grid.appendChild(b); this.btns.push(b);
    }
    for (const r of ['food', 'wood', 'gold', 'stone']) document.querySelector('.ri.' + r).setAttribute('style', this.iconStyle('res_' + r));
    this.mini.addEventListener('pointerdown', (e) => this.miniClick(e));
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());
    $('btnMenu').onclick = () => this.g.togglePause();
    $('idleVil').onclick = () => this.g.selectIdle();
  }
  iconStyle(key) { const p = this.icons.icons[key]; return p ? `background-image:url(assets/icons.png);background-position:-${p[0]}px -${p[1]}px` : ''; }
  costHtml(c) { return RES.filter(r => c[r]).map(r => `<b class="rc"><i style="${this.iconStyle('res_' + r)}"></i>${c[r]}</b>`).join(' '); }

  notify(msg, cls = '') {
    const n = document.createElement('div'); n.className = 'note ' + cls; n.textContent = msg; $('notify').appendChild(n);
    setTimeout(() => n.classList.add('fade'), 4500); setTimeout(() => n.remove(), 5200);
    while ($('notify').children.length > 6) $('notify').firstChild.remove();
  }
  tip(b) {
    const t = $('tooltip');
    if (!b || !b.tipHtml) { t.style.display = 'none'; return; }
    t.innerHTML = b.tipHtml; t.style.display = 'block';
    const r = b.getBoundingClientRect(); t.style.left = Math.max(4, r.left) + 'px'; t.style.bottom = (innerHeight - r.top + 8) + 'px';
  }
  setBtn(i, o) {
    const b = this.btns[i]; if (!o) { b.className = 'cb empty'; b.act = null; b.tipHtml = ''; b.firstChild.setAttribute('style', ''); b.firstChild.textContent = ''; return; }
    b.className = 'cb' + (o.disabled ? ' off' : '') + (o.active ? ' on' : ''); b.disabled = !!o.disabled; b.act = o.act;
    b.firstChild.setAttribute('style', o.icon ? this.iconStyle(o.icon) : ''); b.firstChild.textContent = o.icon && this.icons.icons[o.icon] ? '' : (o.glyph || '');
    b.tipHtml = `<b>${o.name}</b> <small>(${KEYS[i]})</small>${o.cost ? '<div>' + this.costHtml(o.cost) + '</div>' : ''}${o.desc ? '<div class="d">' + o.desc + '</div>' : ''}${o.why ? '<div class="why">' + o.why + '</div>' : ''}`;
  }
  hotkey(k) { const i = KEYS.indexOf(k.toUpperCase()); if (i >= 0 && this.btns[i].act && !this.btns[i].disabled) { this.g.sfx('click'); this.btns[i].act(); return true; } return false; }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.g, W = G.W, P = W.players[G.me];
    for (const r of RES) $('r_' + r).textContent = Math.floor(P.res[r]);
    $('r_pop').textContent = `${P.pop}/${P.popCap}`; $('r_pop').parentElement.classList.toggle('warn', P.pop >= P.popCap);
    $('ageName').textContent = AGES[P.age];
    const tt = Math.floor(W.t); $('clock').textContent = `${String(Math.floor(tt / 3600)).padStart(2, '0')}:${String(Math.floor(tt / 60) % 60).padStart(2, '0')}:${String(tt % 60).padStart(2, '0')}`;
    let idle = 0; for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner === G.me && e.type === 'villager' && !e.order) idle++;
    $('idleVil').classList.toggle('has', idle > 0); $('idleN').textContent = idle || '';
    const sel = G.sel.map(id => W.ents.get(id)).filter(Boolean);
    const sig = sel.map(e => e.id + ':' + (e.kind === 'building' ? e.built + ':' + e.queue.length : e.type)).join() + '|' + P.age + '|' + G.placing?.type;
    if (sig !== this.lastSig || (this.refreshT -= dt) <= 0) { this.lastSig = sig; this.refreshT = 0.5; this.buildCommands(sel); }
    this.buildInfo(sel);
    this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 0.4; this.drawMiniBase(); }
    this.drawMini();
  }
  buildCommands(sel) {
    const G = this.g, W = G.W, P = W.players[G.me];
    for (let i = 0; i < 15; i++) this.setBtn(i, null);
    const mine = sel.filter(e => e.owner === G.me);
    if (!mine.length || G.watch) return;      // spectators can inspect but not command
    const units = mine.filter(e => e.kind === 'unit');
    if (units.length) {
      if (units.some(u => u.type === 'villager')) {
        for (const [type, slot] of VIL_BUILD) {
          const d = BUILDINGS[type]; const ok = canBuild(W, G.me, type);
          let why = P.age < d.age ? `Butuh ${AGES[d.age]}` : (d.needs || []).filter(n => !G.hasBuilt(n)).map(n => 'Butuh ' + BUILDINGS[n].name).join(', ');
          if (ok && !canAfford(P, d.cost)) why = 'Sumber daya kurang';
          this.setBtn(slot, { icon: type === 'stone_wall' ? 'wall_post' : type === 'gate' ? 'gate_x' : type, name: d.name, cost: d.cost, why, disabled: !ok || !canAfford(P, d.cost), active: G.placing?.type === type, act: () => G.startPlace(type),
            desc: { house: '+5 populasi', mill: 'Tempat setor makanan, membuka ladang', lumber_camp: 'Tempat setor kayu', mining_camp: 'Tempat setor emas & batu', farm: 'Sumber makanan tak terbatas (perlu ditanam ulang)', barracks: 'Melatih infanteri', archery_range: 'Melatih pemanah', stable: 'Melatih kavaleri', watch_tower: 'Menembakkan panah ke musuh', stone_wall: 'Tarik garis untuk membangun tembok', gate: 'Gerbang untuk pasukanmu', castle: 'Benteng kuat, melatih ksatria' }[type] });
        }
      }
      this.setBtn(14, { glyph: '✋', name: 'Berhenti', act: () => G.stop() });
      this.setBtn(9, { glyph: '🗑', name: 'Hapus', act: () => G.deleteSel() });
      return;
    }
    const b = mine.find(e => e.kind === 'building'); if (!b) return;
    const d = BUILDINGS[b.type];
    this.setBtn(9, { glyph: '🗑', name: 'Hapus bangunan', act: () => G.deleteSel() });
    if (!b.built) return;
    (d.trains || []).forEach((u, k) => {
      const ud = UNITS[u]; const slot = 'QWERT'.indexOf(ud.key);
      const why = P.age < ud.age ? `Butuh ${AGES[ud.age]}` : !canAfford(P, ud.cost) ? 'Sumber daya kurang' : '';
      this.setBtn(slot >= 0 ? slot : k, { icon: u, name: ud.name, cost: ud.cost, desc: `${ud.desc}<br>HP ${ud.hp} · Serangan ${ud.atk}${ud.range ? ' · Jarak ' + ud.range : ''} · Zirah ${ud.ma}/${ud.pa}`, why, disabled: !!why || b.queue.length >= 5, act: () => G.train(b, u) });
    });
    (d.techs || []).forEach((t) => {
      const td = TECHS[t]; if (P.techs.has(t)) return;
      if (td.toAge && td.toAge !== P.age + 1) return;
      const ok = techOk(W, G.me, t, b);
      let why = P.age < td.age ? `Butuh ${AGES[td.age]}` : '';
      if (!why && td.reqCount) { const have = new Set(); for (const e of W.ents.values()) if (e.kind === 'building' && e.owner === G.me && e.built && td.reqFrom.includes(e.type)) have.add(e.type); if (have.size < td.reqCount) why = `Butuh ${td.reqCount} dari: ` + td.reqFrom.map(x => BUILDINGS[x].name).join(', '); }
      if (!why && !canAfford(P, td.cost)) why = 'Sumber daya kurang';
      const slot = 'QWERTASDFG'.indexOf(td.key);
      this.setBtn(slot >= 0 ? slot : 4, { glyph: td.toAge ? '👑' : { loom: '🧵', wheelbarrow: '🛒', double_bit_axe: '🪓', gold_mining: '⛏', horse_collar: '🐴' }[t] || '📜', name: td.name, cost: td.cost, desc: td.desc || (td.toAge ? 'Membuka bangunan & unit baru' : ''), why, disabled: !ok || !!why, act: () => G.research(b, t) });
    });
  }
  buildInfo(sel) {
    const G = this.g, W = G.W, el = $('info');
    if (!sel.length) { if (el.dataset.k !== 'none') { el.dataset.k = 'none'; el.innerHTML = '<div class="empty">Pilih unit atau bangunan</div>'; } return; }
    if (sel.length > 1) {
      const k = 'multi' + sel.map(e => e.id).join();
      if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = '<div class="multi">' + sel.slice(0, 40).map(e => `<i data-id="${e.id}" style="${this.iconStyle(e.type)}"><b></b></i>`).join('') + '</div>'; el.querySelectorAll('i').forEach(i => i.onclick = (ev) => { G.select([+i.dataset.id], ev.shiftKey); }); }
      el.querySelectorAll('i').forEach(i => { const e = W.ents.get(+i.dataset.id); if (e) i.firstChild.style.width = (e.hp / e.maxHp * 100) + '%'; });
      return;
    }
    const e = sel[0];
    const k = 'one' + e.id + (e.kind === 'building' ? e.queue.map(q => q.unit || q.tech).join() + e.built : '');
    const name = e.kind === 'unit' ? UNITS[e.type].name : e.kind === 'building' ? BUILDINGS[e.type].name : e.kind === 'treasure' ? 'Harta Karun: ' + TREASURES[e.type].name
      : e.type === 'carcass' ? 'Bangkai ' + UNITS[e.animal].name : { tree: 'Pohon', gold: 'Tambang Emas', stone: 'Tambang Batu', berry: 'Semak Berry' }[e.type];
    const owner = e.owner >= 0 ? W.players[e.owner] : null;
    if (el.dataset.k !== k) {
      el.dataset.k = k;
      const icon = e.kind === 'treasure' ? 'treasure_' + e.type : e.type === 'carcass' ? e.animal : e.kind === 'res' ? 'res_' + { tree: 'wood', gold: 'gold', stone: 'stone', berry: 'food' }[e.type] : e.type === 'stone_wall' ? 'wall_post' : e.type === 'gate' ? 'gate_x' : e.type;
      el.innerHTML = `<div class="one"><div class="por" style="${this.iconStyle(icon)}"></div><div class="nm"><b>${name}</b>${owner ? `<small style="color:rgb(${PLAYER_RGB[owner.color]})">${owner.name}</small>` : e.kind === 'unit' ? '<small class="gaia">Alam liar</small>' : ''}</div>
        <div class="hp"><i></i><span></span></div><div class="stats"></div><div class="queue"></div></div>`;
      if (e.kind === 'building') el.querySelector('.queue').innerHTML = e.queue.map((q, i) => `<i data-i="${i}" style="${q.unit ? this.iconStyle(q.unit) : ''}">${q.tech ? '📜' : ''}<b></b></i>`).join('');
      el.querySelectorAll('.queue i').forEach(i => i.onclick = () => G.cancel(e, +i.dataset.i));
    }
    const hp = e.kind === 'res' || e.kind === 'treasure' ? null : e;
    const hpEl = el.querySelector('.hp');
    if (hp) { hpEl.style.display = ''; hpEl.firstChild.style.width = (hp.hp / hp.maxHp * 100) + '%'; hpEl.lastChild.textContent = `${Math.ceil(hp.hp)}/${hp.maxHp}`; } else hpEl.style.display = 'none';
    let st = '';
    if (e.kind === 'treasure') st = `+${e.amount} ${RES_NAME[TREASURES[e.type].res]} · ${e.guarded ? '<b class="warn">Dijaga! Kalahkan penjaganya.</b>' : 'Sentuh dengan unit untuk mengambil.'}`;
    if (e.kind === 'unit' && UNITS[e.type].animal) { const d = UNITS[e.type]; st = (d.atk ? `⚔ ${d.atk} · ` : '') + d.desc; }
    else if (e.kind === 'unit') { const d = UNITS[e.type]; st = `⚔ ${d.atk}${d.range ? ' · 🏹 ' + d.range : ''} · 🛡 ${d.ma}/${d.pa}`; if (e.carry && e.carry.n >= 1) st += ` · <b class="rc"><i style="${this.iconStyle('res_' + e.carry.res)}"></i>${Math.floor(e.carry.n)}</b>`; }
    if (e.kind === 'res') st = `Sisa: <b>${Math.ceil(e.amount)}</b>`;
    if (e.kind === 'building') {
      const d = BUILDINGS[e.type];
      if (!e.built) st = `Membangun… ${Math.floor(e.progress * 100)}%`;
      else if (e.type === 'farm') st = `Makanan: <b>${Math.ceil(e.food)}</b>`;
      else if (e.queue[0]) { const q = e.queue[0]; const T = q.unit ? UNITS[q.unit].time : TECHS[q.tech].time; st = `${q.unit ? 'Melatih ' + UNITS[q.unit].name : 'Meneliti ' + TECHS[q.tech].name} ${Math.floor(q.t / T * 100)}%${W.players[e.owner].housed && q.unit ? ' — <b class="warn">butuh rumah!</b>' : ''}`; }
      else if (d.attack) st = `⚔ ${d.attack.atk} · 🏹 ${d.attack.range} · 🛡 ${d.ma}/${d.pa}`;
      else if (d.pop) st = `Populasi +${d.pop}`;
      const qi = el.querySelectorAll('.queue i');
      e.queue.forEach((q, i) => { if (qi[i]) { const T = q.unit ? UNITS[q.unit].time : TECHS[q.tech].time; qi[i].lastChild.style.width = (i === 0 ? q.t / T * 100 : 0) + '%'; } });
    }
    const se = el.querySelector('.stats'); if (se.innerHTML !== st) se.innerHTML = st;
  }

  // ---------------------------------------------------------------- minimap (diamond, like AoE2)
  drawMiniBase() {
    const G = this.g, W = G.W, S = W.size, P = W.players[G.me];
    const c = this.miniBase.getContext('2d'); const img = c.createImageData(S, S), d = img.data;
    const TC = [[88, 140, 54], [150, 120, 80], [56, 96, 40], [52, 100, 160], [70, 120, 46]];
    for (let k = 0; k < S * S; k++) {
      let col = TC[W.terrain[k]] || TC[0];
      const o = W.occ[k]; if (o) { const e = W.ents.get(o); if (e && e.kind === 'res') col = { tree: [30, 70, 24], gold: [230, 200, 40], stone: [170, 170, 170], berry: [200, 90, 120] }[e.type]; else if (e && e.kind === 'building' && (e.owner === G.me || P.exp[k] || G.watch)) col = PLAYER_RGB[W.players[e.owner].color] || [200, 200, 200]; }
      const f = G.watch ? 1 : P.exp[k] ? (P.vis[k] ? 1 : 0.55) : 0;
      d[k * 4] = col[0] * f; d[k * 4 + 1] = col[1] * f; d[k * 4 + 2] = col[2] * f; d[k * 4 + 3] = 255;
    }
    for (const e of W.dyn.values()) {
      if (e.kind !== 'unit' && e.kind !== 'treasure') continue; const k = idx(W, Math.floor(e.x), Math.floor(e.y));
      if (e.kind === 'treasure') { if (!P.exp[k] && !G.watch) continue; d[k * 4] = 255; d[k * 4 + 1] = 230; d[k * 4 + 2] = 90; continue; }
      if (e.owner !== G.me && !P.vis[k] && !G.watch) continue; const col = e.owner >= 0 ? PLAYER_RGB[W.players[e.owner].color] : UNITS[e.type].animal && !['wolf', 'bear'].includes(e.type) ? [235, 235, 220] : [150, 40, 30];
      for (const kk of [k, k + 1, k + S]) if (kk < S * S) { d[kk * 4] = col[0]; d[kk * 4 + 1] = col[1]; d[kk * 4 + 2] = col[2]; }
    }
    c.putImageData(img, 0, 0);
  }
  miniXform() {
    const w = this.mini.width, h = this.mini.height, S = this.g.W.size;
    // grid (x,y) -> minimap: x' = (x - y) * sx + w/2, y' = (x + y) * sy
    return { sx: w / (2 * S), sy: h / (2 * S), w, h };
  }
  drawMini() {
    const g = this.miniCtx, { sx, sy, w, h } = this.miniXform(), S = this.g.W.size;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h);
    g.setTransform(sx, sy, -sx, sy, w / 2, 0); g.imageSmoothingEnabled = false; g.drawImage(this.miniBase, 0, 0);
    g.setTransform(1, 0, 0, 1, 0, 0);
    // camera view
    const V = this.g.view, scr = this.g.app.screen;
    const corners = [[0, 0], [scr.width, 0], [scr.width, scr.height - 150], [0, scr.height - 150]].map(([px, py]) => V.screenToWorld(px, py)).map(([x, y]) => [(x - y) * sx + w / 2, (x + y) * sy]);
    g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); corners.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.stroke();
  }
  miniClick(e) {
    e.preventDefault();
    const r = this.mini.getBoundingClientRect(), { sx, sy, w } = this.miniXform();
    const mx = (e.clientX - r.left) * this.mini.width / r.width, my = (e.clientY - r.top) * this.mini.height / r.height;
    const a = (mx - w / 2) / sx, b = my / sy; const x = (a + b) / 2, y = (b - a) / 2;
    if (e.button === 2) this.g.rightClickWorld(x, y); else this.g.centerOn(x, y);
    const move = (ev) => { const mx2 = (ev.clientX - r.left) * this.mini.width / r.width, my2 = (ev.clientY - r.top) * this.mini.height / r.height; const a2 = (mx2 - w / 2) / sx, b2 = my2 / sy; this.g.centerOn((a2 + b2) / 2, (b2 - a2) / 2); };
    if (e.button === 0) { const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); }; addEventListener('pointermove', move); addEventListener('pointerup', up); }
  }
}
