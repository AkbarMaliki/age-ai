// AoE2-style HUD: resource bar, command grid, selection info, diamond minimap, notifications, tooltips,
// day / season indicator and the advisor ("!") with counter-strategy advice.
import { UNITS, BUILDINGS, TECHS, RES, RES_NAME, AGES, PLAYER_RGB, TREASURES, MARKET, FORMATIONS, SEASONS, DAY, MILITARY } from './data.js';
import { canAfford, canBuild, canTrain, techOk, idx, buyPrice, sellPrice, marketFee, stat, bstat, trainType, techCost, costOf, timeOfDay, raining } from './sim.js';

const $ = (id) => document.getElementById(id);
const KEYS = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];
// villager build menu, two pages
const VIL_PAGES = [
  [['house', 0], ['mill', 1], ['lumber_camp', 2], ['mining_camp', 3], ['farm', 4], ['dock', 5], ['market', 6], ['blacksmith', 7], ['academy', 8]],
  [['barracks', 0], ['archery_range', 1], ['stable', 2], ['watch_tower', 3], ['castle', 4], ['stone_wall', 5], ['gate', 6]],
];
const BLD_DESC = { house: '+5 populasi', mill: 'Tempat setor makanan, membuka ladang', lumber_camp: 'Tempat setor kayu', mining_camp: 'Tempat setor emas, batu & besi', farm: 'Sumber makanan tak terbatas (perlu ditanam ulang)',
  barracks: 'Melatih infanteri dan Pendobrak', archery_range: 'Melatih pemanah dan penembak mesiu', stable: 'Melatih kavaleri', watch_tower: 'Menembakkan panah ke musuh', stone_wall: 'Tarik garis untuk membangun tembok',
  gate: 'Gerbang untuk pasukanmu', castle: 'Benteng kuat, melatih ksatria', market: 'Jual-beli makanan, kayu, batu dan besi dengan emas', dock: 'Dibangun di tepi air: kapal nelayan, angkut dan perang',
  blacksmith: 'Peningkatan senjata & zirah, dan memilih DOKTRIN perang pertama', academy: 'Riset: mata-mata, mesiu, pasukan khusus dan DOKTRIN kedua' };
// fixed slots per building (some have more commands than keys follow from the data)
const SLOTS = {
  town_center: { villager: 0, torches: 1, feudal: 2, castle: 2, loom: 3, wheelbarrow: 4 },
  blacksmith: { forging: 0, scale_mail: 1, scale_barding: 2, fletching: 3, padded_archer: 4, iron_casting: 5, chain_mail: 6, chain_barding: 7, bodkin: 8, doc_legion: 10, doc_cavalry: 11, doc_archers: 12 },
  academy: { spy_network: 0, masonry: 1, ballistics: 2, gunpowder: 3, cannon: 4, spec_samurai: 5, spec_ninja: 6, spec_fire: 7, spec_crossbow: 8, spec_cataphract: 9, spec_lancer: 10, doc_fortress: 11, doc_blitz: 12, doc_formation: 13, $spy: 14 },
  barracks: { militia: 0, spearman: 1, ram: 2 }, archery_range: { archer: 0, gunner: 1 }, stable: { scout: 0, knight: 1 }, dock: { fishing_boat: 0, transport_ship: 1, war_ship: 2, gillnets: 3, careening: 4 },
  castle: { knight: 1, conscription: 2 }, mill: { horse_collar: 0, granary: 1 }, mining_camp: { gold_mining: 0, iron_smelting: 1 }, lumber_camp: { double_bit_axe: 0 }, market: { guilds: 3, trade_route: 4 },
};
const GLYPH = { loom: '🧵', wheelbarrow: '🛒', torches: '🔥', double_bit_axe: '🪓', gold_mining: '⛏', iron_smelting: '⚒', horse_collar: '🐴', granary: '🏚', guilds: '⚖', trade_route: '🐫', gillnets: '🎣', careening: '⚓', conscription: '📯',
  forging: '🗡', iron_casting: '⚔', scale_mail: '🦺', chain_mail: '⛓', scale_barding: '🐎', chain_barding: '🏇', fletching: '🪶', bodkin: '🎯', padded_archer: '🧥', spy_network: '🕵', masonry: '🧱', ballistics: '📐', gunpowder: '💥',
  spec_samurai: '⛩', spec_ninja: '🥷', spec_fire: '🔥', spec_crossbow: '🏹', spec_cataphract: '🛡', spec_lancer: '🔱' };

export class HUD {
  constructor(game) {
    this.g = game; this.icons = game.A.icons; this.btns = []; this.page = 0;
    this.mini = $('miniCanvas'); this.miniCtx = this.mini.getContext('2d');
    this.miniBase = document.createElement('canvas'); this.miniBase.width = this.miniBase.height = game.W.size;
    this.miniT = 0; this.lastSig = '';
    const grid = $('cmd'); grid.innerHTML = '';
    for (let i = 0; i < 15; i++) {
      const b = document.createElement('button'); b.className = 'cb'; b.innerHTML = `<i></i><em></em><span>${KEYS[i]}</span>`;
      b.onmouseenter = () => this.tip(b); b.onmouseleave = () => this.tip(null);
      b.onpointerdown = (e) => { if (e.pointerType === 'touch') { this.tip(b); clearTimeout(this.tipT); this.tipT = setTimeout(() => this.tip(null), 1800); } };   // touch: show the tooltip briefly
      b.onclick = () => { if (b.act && !b.disabled) { this.g.sfx('click'); b.act(); } };
      grid.appendChild(b); this.btns.push(b);
    }
    for (const r of RES) { const el = document.querySelector('.ri.' + r); if (el) el.setAttribute('style', this.iconStyle('res_' + r) || ''); }
    this.mini.addEventListener('pointerdown', (e) => this.miniClick(e));
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());
    $('btnMenu').onclick = () => this.g.togglePause();
    $('idleVil').onclick = () => this.g.selectIdle();
    $('advBtn').onclick = () => this.g.advisor.toggle();
  }
  iconStyle(key) { const p = this.icons.icons[key]; return p ? `background-image:url(assets/icons.png);background-position:-${p[0]}px -${p[1]}px` : ''; }
  costHtml(c) { return RES.filter(r => c[r]).map(r => `<b class="rc"><i style="${this.iconStyle('res_' + r)}">${this.icons.icons['res_' + r] ? '' : r === 'iron' ? '⛓' : ''}</i>${c[r]}</b>`).join(' '); }

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
    const b = this.btns[i]; b.children[1].textContent = (o && o.badge) || ''; b.children[1].className = (o && o.badgeCls) || '';
    if (!o) { b.className = 'cb empty'; b.act = null; b.tipHtml = ''; b.firstChild.setAttribute('style', ''); b.firstChild.textContent = ''; return; }
    b.className = 'cb' + (o.disabled ? ' off' : '') + (o.active ? ' on' : '') + (o.chosen ? ' chosen' : ''); b.disabled = !!o.disabled; b.act = o.act;
    b.firstChild.setAttribute('style', o.icon ? this.iconStyle(o.icon) : ''); b.firstChild.textContent = o.icon && this.icons.icons[o.icon] ? '' : (o.glyph || '');
    b.tipHtml = `<b>${o.name}</b> <small>(${KEYS[i]})</small>${o.cost ? '<div>' + this.costHtml(o.cost) + '</div>' : ''}${o.desc ? '<div class="d">' + o.desc + '</div>' : ''}${o.why ? '<div class="why">' + o.why + '</div>' : ''}`;
  }
  hotkey(k) { const i = KEYS.indexOf(k.toUpperCase()); if (i >= 0 && this.btns[i].act && !this.btns[i].disabled) { this.g.sfx('click'); this.btns[i].act(); return true; } return false; }
  unitDesc(P, type) {
    const s = stat(this.g.W, P.id, type), d = UNITS[type];
    const bonus = Object.entries(s.bonus || {}).map(([c, n]) => `+${n} vs ${{ cavalry: 'kavaleri', infantry: 'infanteri', archer: 'pemanah', villager: 'penduduk', siege: 'mesin perang', ship: 'kapal' }[c] || c}`).join(', ');
    return `${d.desc}<br>HP ${s.hp} · Serangan ${Math.round(s.atk)}${s.range ? ' · Jarak ' + s.range : ''} · Zirah ${s.ma}/${s.pa}${s.vsBuilding ? ' · +' + s.vsBuilding + ' vs bangunan' : ''}${bonus ? '<br>' + bonus : ''}`;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    const G = this.g, W = G.W, P = W.players[G.me];
    for (const r of RES) { const el = $('r_' + r); if (el) el.textContent = Math.floor(P.res[r]); }
    $('r_pop').textContent = `${P.pop}/${P.popCap}`; $('r_pop').parentElement.classList.toggle('warn', P.pop >= P.popCap);
    $('ageName').textContent = AGES[P.age];
    const tt = Math.floor(W.t); $('clock').textContent = `${String(Math.floor(tt / 3600)).padStart(2, '0')}:${String(Math.floor(tt / 60) % 60).padStart(2, '0')}:${String(tt % 60).padStart(2, '0')}`;
    // day / night, season, weather, hunger
    const tod = timeOfDay(W), night = W.night && W.opts.night !== 'off', toNight = Math.max(0, (1 - DAY.night - tod) * DAY.len);
    const di = `${night ? '🌙 Malam' : '☀ Hari ' + W.day}${raining(W) ? (W.season.snow ? ' · 🌨' : ' · 🌧') : ''} · ${{ semi: '🌱', kemarau: '🔆', gugur: '🍂', salju: '❄' }[W.opts.season] || ''}`;
    const de = $('dayInfo'); if (de.textContent !== di) de.textContent = di;
    de.title = `${SEASONS[W.opts.season].name}: ${SEASONS[W.opts.season].desc}\n` + (W.opts.night === 'off' ? 'Siklus siang-malam mati.' : night ? 'Malam: jarak pandang berkurang' + (W.opts.night === 'full' ? ', penduduk desa beristirahat di rumah (kecuali sudah riset Obor Kerja).' : '.') : `Malam tiba dalam ${Math.ceil(toNight / 60)} menit. Saat fajar setiap warga makan ${DAY.upkeep} makanan.`);
    de.classList.toggle('hungry', !!P.hungry);
    let idle = 0; for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner === G.me && e.type === 'villager' && !e.order) idle++;
    $('idleVil').classList.toggle('has', idle > 0); $('idleN').textContent = idle || '';
    const sel = G.sel.map(id => W.ents.get(id)).filter(Boolean);
    const sig = sel.map(e => e.id + ':' + (e.kind === 'building' ? e.built + ':' + e.queue.length : e.type + (e.form || '') + (e.cargo ? e.cargo.length : ''))).join() + '|' + P.age + '|' + G.placing?.type + '|' + this.page + '|' + P.techs.size;
    if (sig !== this.lastSig || (this.refreshT -= dt) <= 0) { this.lastSig = sig; this.refreshT = 0.5; this.buildCommands(sel); }
    this.buildInfo(sel);
    this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 0.4; this.drawMiniBase(); }
    this.drawMini();
  }
  buildCommands(sel) {
    const G = this.g, W = G.W, P = W.players[G.me];
    for (let i = 0; i < 15; i++) this.setBtn(i, null);
    const mine = sel.filter(e => e.owner === G.me);
    if (!mine.length || G.watch || G.lost) return;      // spectators can inspect but not command
    const units = mine.filter(e => e.kind === 'unit');
    if (units.length) {
      if (units.some(u => u.type === 'villager')) {
        for (const [type, slot] of VIL_PAGES[this.page]) {
          const d = BUILDINGS[type]; const ok = canBuild(W, G.me, type), cost = costOf(P, type);
          let why = P.age < d.age ? `Butuh ${AGES[d.age]}` : (d.needs || []).filter(n => !G.hasBuilt(n)).map(n => 'Butuh ' + BUILDINGS[n].name).join(', ');
          if (ok && !canAfford(P, cost)) why = 'Sumber daya kurang';
          this.setBtn(slot, { icon: type === 'stone_wall' ? 'wall_post' : type === 'gate' ? 'gate_x' : type, glyph: { dock: '⚓', blacksmith: '⚒', academy: '🏛' }[type], name: d.name, cost, why, disabled: !ok || !canAfford(P, cost), active: G.placing?.type === type, act: () => G.startPlace(type), desc: BLD_DESC[type] });
        }
        this.setBtn(9, { glyph: this.page ? '🏠' : '⚔', name: this.page ? 'Bangunan Ekonomi' : 'Bangunan Militer & Pertahanan', desc: 'Ganti halaman bangunan', act: () => { this.page = 1 - this.page; this.lastSig = ''; } });
      } else {
        // soldiers: formations (and ships: unload)
        const mil = units.filter(u => MILITARY(u.type) && !u.nav);
        if (mil.length) Object.entries(FORMATIONS).forEach(([f, d], k) => this.setBtn(k, { glyph: d.glyph, name: 'Formasi ' + d.name, desc: d.desc + (P.techs.has('doc_formation') ? '<br><b>Doktrin Taktik Formasi: bonus x2.</b>' : ''), active: (mil[0].form || 'garis') === f, act: () => G.setFormation(f) }));
        const ships = units.filter(u => u.cargo && u.cargo.length);
        if (ships.length) this.setBtn(5, { glyph: '⚓', name: 'Turunkan pasukan', desc: `Muatan: ${ships.reduce((s, u) => s + u.cargo.length, 0)} unit. Klik kanan di daratan dekat pantai, atau tekan untuk menurunkan di pantai terdekat.`, act: () => G.unloadHere() });
      }
      this.setBtn(13, { glyph: '🗑', name: 'Hapus', act: () => G.deleteSel() });
      this.setBtn(14, { glyph: '✋', name: 'Berhenti', act: () => G.stop() });
      return;
    }
    const b = mine.find(e => e.kind === 'building'); if (!b) return;
    const d = BUILDINGS[b.type], slots = SLOTS[b.type] || {};
    const many = (d.techs || []).length + (d.trains || []).length > 12;
    if (!many) this.setBtn(9, { glyph: '🗑', name: 'Hapus bangunan', act: () => G.deleteSel() });
    if (!b.built) { this.setBtn(9, { glyph: '🗑', name: 'Batalkan fondasi', act: () => G.deleteSel() }); return; }
    if (d.market) Object.keys(MARKET.base).forEach((r, k) => {      // buy on the top row, sell on the second row
      const bp = buyPrice(W, P, r), sp = sellPrice(W, P, r), fee = Math.round(marketFee(P) * 100), slot = k < 3 ? k : k + 7;
      this.setBtn(k < 3 ? k : 10 + (k - 3) * 2, { icon: 'res_' + r, glyph: r === 'iron' ? '⛓' : '', badge: '▲', badgeCls: 'buy', name: `Beli ${MARKET.lot} ${RES_NAME[r]}`, cost: { gold: bp }, disabled: P.res.gold < bp, why: P.res.gold < bp ? 'Emas kurang' : '',
        desc: `Harga naik setiap kali ada yang membeli. Komisi pasar ${fee}%.`, act: () => G.trade(b, r, true) });
      this.setBtn(k < 3 ? 5 + k : 11 + (k - 3) * 2, { icon: 'res_' + r, glyph: r === 'iron' ? '⛓' : '', badge: '▼', badgeCls: 'sell', name: `Jual ${MARKET.lot} ${RES_NAME[r]}`, desc: `Dapat <b>${sp} emas</b>. Harga turun setiap kali ada yang menjual.`, disabled: P.res[r] < MARKET.lot, why: P.res[r] < MARKET.lot ? `${RES_NAME[r]} kurang dari ${MARKET.lot}` : '', act: () => G.trade(b, r, false) });
    });
    (d.trains || []).forEach((u0, k) => {
      const u = trainType(P, u0), ud = UNITS[u]; const slot = slots[u0] ?? k;
      const why = P.age < ud.age ? `Butuh ${AGES[ud.age]}` : ud.needsTech && !P.techs.has(ud.needsTech) ? 'Butuh riset ' + TECHS[ud.needsTech].name : !canAfford(P, ud.cost) ? 'Sumber daya kurang' : '';
      this.setBtn(slot, { icon: ud.sprite === u ? u : ud.sprite, badge: ud.tint ? '★' : '', badgeCls: 'spec', glyph: { fishing_boat: '⛵', transport_ship: '🚢', war_ship: '⛴', ram: '🪵', cannon: '💣' }[u], name: ud.name, cost: ud.cost, desc: this.unitDesc(P, u), why, disabled: !!why || b.queue.length >= 5, act: () => G.train(b, u0) });
    });
    (d.techs || []).forEach((t) => {
      const td = TECHS[t], slot = slots[t] ?? 'QWERTASDFG'.indexOf(td.key);
      const groupDone = td.group && [...P.techs].find(x => TECHS[x].group === td.group);
      if (P.techs.has(t)) { if (td.group || td.spec) this.setBtn(slot, { glyph: td.glyph || GLYPH[t] || '📜', name: td.name + ' ✔', desc: td.desc, chosen: true, disabled: true, why: 'Pilihan ini sudah diambil.' }); return; }
      if (td.toAge && td.toAge !== P.age + 1) return;
      if (groupDone) { this.setBtn(slot, { glyph: td.glyph || GLYPH[t] || '📜', name: td.name, desc: td.desc, disabled: true, why: `Tertutup: kamu sudah memilih ${TECHS[groupDone].name}.` }); return; }
      const ok = techOk(W, G.me, t, b), cost = techCost(P, t);
      let why = P.age < td.age ? `Butuh ${AGES[td.age]}` : td.after && !P.techs.has(td.after) ? 'Butuh ' + TECHS[td.after].name : '';
      if (!why && td.reqCount) { const have = new Set(); for (const e of W.ents.values()) if (e.kind === 'building' && e.owner === G.me && e.built && td.reqFrom.includes(e.type)) have.add(e.type); if (have.size < td.reqCount) why = `Butuh ${td.reqCount} dari: ` + td.reqFrom.map(x => BUILDINGS[x].name).join(', '); }
      if (!why && !canAfford(P, cost)) why = 'Sumber daya kurang';
      if (!why && !ok) why = 'Sedang diteliti';
      const excl = td.group ? '<br><i>Pilihan eksklusif: hanya satu dari kelompok ini yang bisa diambil.</i>' : '';
      this.setBtn(slot >= 0 ? slot : 4, { glyph: td.toAge ? '👑' : td.glyph || GLYPH[t] || '📜', badge: td.group ? '◆' : '', badgeCls: 'excl', name: td.name, cost, desc: (td.desc || (td.toAge ? 'Membuka bangunan & unit baru' : '')) + excl, why, disabled: !ok || !!why, act: () => G.research(b, t) });
    });
    if (d.ability === 'spy') {
      const cd = Math.max(0, P.spyCd - W.t), has = P.techs.has('spy_network');
      this.setBtn(slots.$spy ?? 14, { glyph: '🕵', name: 'Kirim Mata-mata', desc: 'Posisi seluruh pasukan & bangunan musuh terlihat 30 detik, dan Penasihat (!) menerima laporan lengkap + saran strategi.', why: !has ? 'Butuh riset Jaringan Mata-mata' : cd ? `Siap dalam ${Math.ceil(cd)} detik` : '', disabled: !has || cd > 0, act: () => G.useSpy(b) });
    }
  }
  buildInfo(sel) {
    const G = this.g, W = G.W, el = $('info');
    if (!sel.length) { if (el.dataset.k !== 'none') { el.dataset.k = 'none'; el.innerHTML = '<div class="empty">Pilih unit atau bangunan</div>'; } return; }
    if (sel.length > 1) {
      const k = 'multi' + sel.map(e => e.id).join();
      if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = '<div class="multi">' + sel.slice(0, 40).map(e => `<i data-id="${e.id}" style="${this.iconStyle(UNITS[e.type] ? UNITS[e.type].sprite : e.type)}"><b></b></i>`).join('') + '</div>'; el.querySelectorAll('i').forEach(i => i.onclick = (ev) => { G.select([+i.dataset.id], ev.shiftKey); }); }
      el.querySelectorAll('i').forEach(i => { const e = W.ents.get(+i.dataset.id); if (e) i.firstChild.style.width = (e.hp / e.maxHp * 100) + '%'; });
      return;
    }
    const e = sel[0];
    const k = 'one' + e.id + e.type + (e.kind === 'building' ? e.queue.map(q => q.unit || q.tech).join() + e.built : '');
    const name = e.kind === 'unit' ? UNITS[e.type].name : e.kind === 'building' ? BUILDINGS[e.type].name : e.kind === 'treasure' ? 'Harta Karun: ' + TREASURES[e.type].name
      : e.type === 'carcass' ? 'Bangkai ' + UNITS[e.animal].name : { tree: 'Pohon', gold: 'Tambang Emas', stone: 'Tambang Batu', iron: 'Tambang Besi', berry: 'Semak Berry', fish: 'Kawanan Ikan' }[e.type];
    const owner = e.owner >= 0 ? W.players[e.owner] : null;
    if (el.dataset.k !== k) {
      el.dataset.k = k;
      const icon = e.kind === 'treasure' ? 'treasure_' + e.type : e.type === 'carcass' ? e.animal : e.kind === 'res' ? 'res_' + { tree: 'wood', gold: 'gold', stone: 'stone', iron: 'iron', berry: 'food', fish: 'food' }[e.type] : e.type === 'stone_wall' ? 'wall_post' : e.type === 'gate' ? 'gate_x' : e.kind === 'unit' ? UNITS[e.type].sprite : e.type;
      el.innerHTML = `<div class="one"><div class="por" style="${this.iconStyle(icon)}"></div><div class="nm"><b>${name}</b>${owner ? `<small style="color:rgb(${PLAYER_RGB[owner.color]})">${owner.name}</small>` : e.kind === 'unit' ? '<small class="gaia">Alam liar</small>' : ''}</div>
        <div class="hp"><i></i><span></span></div><div class="stats"></div><div class="queue"></div></div>`;
      if (e.kind === 'building') el.querySelector('.queue').innerHTML = e.queue.map((q, i) => `<i data-i="${i}" style="${q.unit ? this.iconStyle(UNITS[q.unit].sprite) : ''}">${q.tech ? (GLYPH[q.tech] || '📜') : ''}<b></b></i>`).join('');
      el.querySelectorAll('.queue i').forEach(i => i.onclick = () => G.cancel(e, +i.dataset.i));
    }
    const hp = e.kind === 'res' || e.kind === 'treasure' ? null : e;
    const hpEl = el.querySelector('.hp');
    if (hp) { hpEl.style.display = ''; hpEl.firstChild.style.width = (hp.hp / hp.maxHp * 100) + '%'; hpEl.lastChild.textContent = `${Math.ceil(hp.hp)}/${hp.maxHp}`; } else hpEl.style.display = 'none';
    let st = '';
    if (e.kind === 'treasure') st = `+${e.amount} ${RES_NAME[TREASURES[e.type].res]} · ${e.guarded ? '<b class="warn">Dijaga! Kalahkan penjaganya.</b>' : 'Sentuh dengan unit untuk mengambil.'}`;
    if (e.kind === 'unit' && UNITS[e.type].animal) { const d = UNITS[e.type]; st = (d.atk ? `⚔ ${d.atk} · ` : '') + d.desc; }
    else if (e.kind === 'unit') {
      const s = stat(W, e.owner, e.type);
      st = `⚔ ${Math.round(s.atk)}${s.range ? ' · 🏹 ' + s.range : ''} · 🛡 ${s.ma}/${s.pa}`;
      if (e.fb && (e.fb.ma || e.fb.pa)) st += ` <b class="good">(formasi ${e.fb.ma >= 0 ? '+' : ''}${e.fb.ma}/+${e.fb.pa})</b>`;
      if (e.form && e.form !== 'garis') st += ` · ${FORMATIONS[e.form].glyph} ${FORMATIONS[e.form].name}`;
      if (e.carry && e.carry.n >= 1) st += ` · <b class="rc"><i style="${this.iconStyle('res_' + e.carry.res)}"></i>${Math.floor(e.carry.n)}</b>`;
      if (e.cargo) st += ` · Muatan ${e.cargo.length}/${s.capacity}`;
      if (s.stealth) st += ' · <i>tak terlihat musuh</i>';
      if (e.order && e.order.t === 'rest') st += ' · <i>beristirahat (malam)</i>';
    }
    if (e.kind === 'res') st = `Sisa: <b>${Math.ceil(e.amount)}</b>` + (e.type === 'fish' ? ' · dijala dari tepi atau Kapal Nelayan' : '');
    if (e.kind === 'building') {
      const d = BUILDINGS[e.type], bs = bstat(W, e.owner, e.type);
      if (!e.built) st = `Membangun… ${Math.floor(e.progress * 100)}%` + (e.progress <= 0.001 ? ' · <i>fondasi belum dikerjakan (tak bisa diserang)</i>' : '');
      else if (e.type === 'farm') st = `Makanan: <b>${Math.ceil(e.food)}</b>`;
      else if (e.queue[0]) { const q = e.queue[0]; const T = q.unit ? stat(W, e.owner, q.unit).time : TECHS[q.tech].time; st = `${q.unit ? 'Melatih ' + UNITS[q.unit].name : 'Meneliti ' + TECHS[q.tech].name} ${Math.floor(q.t / T * 100)}%${W.players[e.owner].housed && q.unit ? ' — <b class="warn">butuh rumah!</b>' : ''}`; }
      else if (bs.attack) st = `⚔ ${bs.attack.atk} · 🏹 ${bs.attack.range} · 🛡 ${bs.ma}/${bs.pa}`;
      else if (d.market) { const P = W.players[e.owner]; st = 'Harga per 100: ' + Object.keys(MARKET.base).map(r => `<span class="mp"><i class="si" style="${this.iconStyle('res_' + r)}"></i>beli <b>${buyPrice(W, P, r)}</b> / jual <b>${sellPrice(W, P, r)}</b></span>`).join(' · ') + (P.techs.has('trade_route') ? ' · +24 emas/menit' : ''); }
      else if (d.pop) st = `Populasi +${d.pop}`;
      if (e.built && e.hp < e.maxHp && e.owner === G.me) st += ' · <b class="warn">Rusak</b> — klik kanan dengan penduduk desa untuk memperbaiki';
      if (e.burn && e.burn > W.t) st += ' · <b class="warn">🔥 terbakar!</b>';
      if (e.owner === this.g.me) { let n = 0; for (const u of W.dyn.values()) if (u.inside === e.id) n++; if (n) st += ` · 🌙 ${n} penduduk tidur di dalam`; }
      const qi = el.querySelectorAll('.queue i');
      e.queue.forEach((q, i) => { if (qi[i]) { const T = q.unit ? stat(W, e.owner, q.unit).time : TECHS[q.tech].time; qi[i].lastChild.style.width = (i === 0 ? q.t / T * 100 : 0) + '%'; } });
    }
    const se = el.querySelector('.stats'); if (se.innerHTML !== st) se.innerHTML = st;
  }

  // ---------------------------------------------------------------- minimap (diamond, like AoE2)
  drawMiniBase() {
    const G = this.g, W = G.W, S = W.size, P = W.players[G.me];
    const c = this.miniBase.getContext('2d'); const img = c.createImageData(S, S), d = img.data;
    const snow = W.season && W.season.snow;
    const TC = [[88, 140, 54], [150, 120, 80], [56, 96, 40], W.frozen ? [190, 215, 230] : [52, 100, 160], [70, 120, 46], [112, 138, 70], [118, 112, 104]];
    for (let k = 0; k < S * S; k++) {
      let col = TC[W.terrain[k]] || TC[0];
      if (W.road[k]) col = [176, 150, 108];
      if (snow && W.terrain[k] !== 3) col = [col[0] * 0.4 + 140, col[1] * 0.4 + 145, col[2] * 0.4 + 150];
      const o = W.occ[k]; if (o) { const e = W.ents.get(o); if (e && e.kind === 'res') col = { tree: [30, 70, 24], gold: [230, 200, 40], stone: [170, 170, 170], iron: [150, 100, 80], berry: [200, 90, 120], fish: [120, 170, 220] }[e.type]; else if (e && e.kind === 'building' && (e.owner === G.me || P.exp[k] || G.seeAll)) col = PLAYER_RGB[W.players[e.owner].color] || [200, 200, 200]; }
      const f = G.seeAll ? 1 : P.exp[k] ? (P.vis[k] ? 1 : 0.55) : 0;
      d[k * 4] = col[0] * f; d[k * 4 + 1] = col[1] * f; d[k * 4 + 2] = col[2] * f; d[k * 4 + 3] = 255;
    }
    for (const e of W.dyn.values()) {
      if ((e.kind !== 'unit' && e.kind !== 'treasure') || e.inside) continue; const k = idx(W, Math.floor(e.x), Math.floor(e.y));
      if (e.kind === 'treasure') { if (!P.exp[k] && !G.seeAll) continue; d[k * 4] = 255; d[k * 4 + 1] = 230; d[k * 4 + 2] = 90; continue; }
      if (e.owner !== G.me && !P.vis[k] && !G.seeAll) continue; const col = e.owner >= 0 ? PLAYER_RGB[W.players[e.owner].color] : UNITS[e.type].animal && !['wolf', 'bear'].includes(e.type) ? [235, 235, 220] : [150, 40, 30];
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
