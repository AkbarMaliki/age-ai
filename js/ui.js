// AoE2-style HUD: resource bar, command grid, selection info, diamond minimap, notifications, tooltips,
// day / season indicator and the advisor ("!") with counter-strategy advice.
import { CIVS, RELICS, WONDER_TIME, KOTH_TIME } from './data.js';
import { UNITS, BUILDINGS, TECHS, RES, RES_NAME, AGES, PLAYER_RGB, TREASURES, MARKET, FORMATIONS, SEASONS, DAY, MILITARY } from './data.js';
import { canAfford, canBuild, canTrain, techOk, idx, buyPrice, sellPrice, marketFee, stat, bstat, trainType, techCost, costOf, timeOfDay, raining, STANCES, unitCost, personName, personAge, townsMax } from './sim.js';
import { NAMES, LIFE, TOWN_POP } from './data.js';

const $ = (id) => document.getElementById(id);
const KEYS = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];
// villager build menu, two pages
const VIL_PAGES = [
  [['house', 0], ['mill', 1], ['lumber_camp', 2], ['mining_camp', 3], ['farm', 4], ['dock', 5], ['market', 6], ['blacksmith', 7], ['academy', 8], ['monastery', 10], ['wonder', 11], ['town_center', 12]],
  [['barracks', 0], ['archery_range', 1], ['stable', 2], ['siege_workshop', 3], ['castle', 4], ['watch_tower', 5], ['palisade', 6], ['stone_wall', 7], ['gate', 8], ['outpost', 10]],
  [['house', 0], ['well', 1], ['tavern', 2], ['hospital', 3], ['barn', 4], ['market', 5], ['monastery', 6], ['farm', 7], ['mill', 8]],
];
const PAGE_NAME = ['🏠 Ekonomi', '⚔ Militer & Pertahanan', '🍺 Kehidupan Warga'];
const BLD_DESC = { house: '+5 populasi', mill: 'Tempat setor makanan, membuka ladang', lumber_camp: 'Tempat setor kayu', mining_camp: 'Tempat setor emas, batu & besi', farm: 'Sumber makanan tak terbatas (perlu ditanam ulang)',
  barracks: 'Melatih infanteri dan Pendobrak', archery_range: 'Melatih pemanah dan penembak mesiu', stable: 'Melatih kavaleri', watch_tower: 'Menembakkan panah ke musuh', stone_wall: 'Tarik garis untuk membangun tembok',
  gate: 'Gerbang untuk pasukanmu', castle: 'Benteng kuat, melatih ksatria', market: 'Jual-beli makanan, kayu, batu dan besi dengan emas', dock: 'Dibangun di tepi air: kapal nelayan, angkut dan perang',
  blacksmith: 'Peningkatan senjata & zirah, dan memilih DOKTRIN perang pertama', academy: 'Riset: mata-mata, mesiu, pasukan khusus dan DOKTRIN kedua',
  monastery: 'Melatih Biarawan; simpan relik di sini untuk emas', palisade: 'Pagar kayu murah dan cepat (Zaman Kegelapan). Tarik garis seperti tembok.', siege_workshop: 'Melatih Pendobrak, Mangonel dan Skorpion',
  wonder: `Keajaiban Dunia: pertahankan ${WONDER_TIME / 60} menit untuk MENANG`,
  outpost: 'Pos Perbatasan: memperluas wilayah kekuasaan (radius 9) dan mengawasi. Di wilayah sendiri pengumpulan +10%; di wilayah musuh hanya bangunan militer yang boleh dibangun.',
  town_center: 'Kota baru: wilayah kekuasaan radius 18, setor semua sumber daya, latih penduduk. Satu Pusat Kota per zaman (2 di Feodal, 3 di Kastil, 4 di Imperial).',
  well: 'Air bersih untuk warga dalam 10 petak. Warga yang haus bekerja lambat dan bisa jatuh sakit.', tavern: 'Kedai: hiburan, makan dan minum — warga mampir saat senja. Tanpa hiburan warga bosan, malas, lalu pergi.',
  hospital: 'Balai Pengobatan: menyembuhkan yang sakit dan menahan wabah.', barn: 'Kandang dengan padang: domba/sapi di sini bertambah gemuk dan menghasilkan susu. Bisa membeli ternak.' };
// fixed slots per building (some have more commands than keys follow from the data)
const SLOTS = {
  town_center: { villager: 0, torches: 1, hand_cart: 2, loom: 3, wheelbarrow: 4, feudal: 5, feudal_war: 6, feudal_wall: 7, castle: 5, castle_war: 6, castle_trade: 7, imperial: 5, imperial_war: 6, imperial_lore: 7, civic_defense: 8, $bell: 10, $out: 11 },
  blacksmith: { forging: 0, scale_mail: 1, scale_barding: 2, fletching: 3, padded_archer: 4, iron_casting: 5, chain_mail: 6, chain_barding: 7, bodkin: 8, doc_legion: 10, doc_cavalry: 11, doc_archers: 12 },
  academy: { spy_network: 0, masonry: 1, ballistics: 2, gunpowder: 3, cannon: 4, healer: 5, medicine: 6, doc_fortress: 10, doc_blitz: 11, doc_formation: 12, $spy: 13 },
  // upgrade chains share one slot: only the next step of a line is shown
  barracks: { militia: 0, spearman: 1, man_at_arms: 5, long_sword: 5, champion: 5, pikes: 6, halberdier: 6, drill: 7 },
  archery_range: { archer: 0, skirmisher: 1, horse_archer: 2, gunner: 3, arbalest: 5, elite_skirm: 6, heavy_ha: 7, thumb_ring: 10, parthian: 11 },
  stable: { scout: 0, knight: 1, light_cav: 5, hussar: 5, cavalier: 6, paladin: 6, husbandry: 10, flank_tactics: 11 },
  dock: { fishing_boat: 0, transport_ship: 1, war_ship: 2, fire_ship: 3, demo_ship: 4, cannon_galleon: 5, trade_cog: 6, $trap: 7, gillnets: 10, careening: 11, galleon: 12 },
  siege_workshop: { ram: 0, mangonel: 1, scorpion: 2, capped_ram: 5, onager: 6, heavy_scorpion: 7 },
  tavern: { brewery: 5, minstrels: 6 }, hospital: { herbalism: 5, quarantine: 6, sanitation: 7 }, barn: { sheep: 0, cow: 1, fodder: 5 },
  castle: { knight: 0, unique: 1, trebuchet_p: 2, conscription: 5, $out: 11 }, monastery: { monk: 0, fervor: 5, sanctity: 6, illumination: 7 },
  mill: { horse_collar: 0, heavy_plow: 0, crop_rotation: 0, granary: 1, $reseed: 5 }, mining_camp: { gold_mining: 0, gold_shaft: 0, iron_smelting: 1, stone_mining: 2, stone_shaft: 2 },
  lumber_camp: { double_bit_axe: 0, bow_saw: 0, two_man_saw: 0 }, market: { trade_cart: 8, guilds: 3, trade_route: 4 }, watch_tower: { guard_tower: 0, keep: 0, $out: 11 }, gate: { $lock: 0 },
};
// buildings with more commands than fit: extra pages (slot 14 flips)
const PAGES = { academy: [null, { $name: 'Pasukan Khusus', spec_samurai: 0, spec_ninja: 1, spec_fire: 5, spec_crossbow: 6, spec_cataphract: 10, spec_lancer: 11 }] };
const STANCE = {
  agresif: ['⚔', 'Agresif', 'Mengejar dan menyerang musuh yang terlihat (bawaan).'],
  bertahan: ['🚩', 'Bertahan', 'Menyerang musuh yang mendekat, lalu kembali ke posnya (tidak mengejar jauh). Cocok untuk penjaga.'],
  diam: ['⛔', 'Diam di Tempat', 'Tidak bergerak sama sekali; hanya menyerang yang masuk jangkauan. Cocok untuk barisan tombak dan pemanah di balik tembok.'],
  pasif: ['🕊', 'Pasif', 'Tidak pernah menyerang otomatis, bahkan bila diserang. Untuk mundur atau mengintai.'],
};
const GLYPH = { loom: '🧵', wheelbarrow: '🛒', torches: '🔥', double_bit_axe: '🪓', gold_mining: '⛏', iron_smelting: '⚒', horse_collar: '🐴', granary: '🏚', guilds: '⚖', trade_route: '🐫', gillnets: '🎣', careening: '⚓', conscription: '📯',
  forging: '🗡', iron_casting: '⚔', scale_mail: '🦺', chain_mail: '⛓', scale_barding: '🐎', chain_barding: '🏇', fletching: '🪶', bodkin: '🎯', padded_archer: '🧥', spy_network: '🕵', masonry: '🧱', ballistics: '📐', gunpowder: '💥',
  spec_samurai: '⛩', spec_ninja: '🥷', spec_fire: '🔥', spec_crossbow: '🏹', spec_cataphract: '🛡', spec_lancer: '🔱',
  hand_cart: '🛞', bow_saw: '🪚', two_man_saw: '🪚', heavy_plow: '🌾', crop_rotation: '🔄', gold_shaft: '⛏', stone_mining: '🪨', stone_shaft: '🪨', man_at_arms: '🗡', long_sword: '⚔', champion: '🏆', halberdier: '🔱',
  arbalest: '🏹', elite_skirm: '🎯', heavy_ha: '🐎', light_cav: '🐴', hussar: '🐴', cavalier: '🏇', paladin: '👑', capped_ram: '🪵', onager: '🪨', heavy_scorpion: '🏹', guard_tower: '🗼', keep: '🏯', galleon: '⛵' };
const UGLYPH = { sheep: '🐑', cow: '🐄', child: '🧒', fishing_boat: '⛵', transport_ship: '🚢', war_ship: '⛴', ram: '🪵', cannon: '💣', mangonel: '🪨', scorpion: '🏹', trebuchet_p: '🏗', trebuchet: '🏗', trade_cart: '🛒', trade_cog: '⛵', fire_ship: '🔥', demo_ship: '💥', galleon: '⛴', cannon_galleon: '💣', king: '👑' };
const RES_GLYPH = { food: '🍖', wood: '🪵', gold: '🪙', stone: '🪨', iron: '⛓' };
const garrisonCapOf = (W, b) => { const d = BUILDINGS[b.type]; return d && d.garrison ? d.garrison : 0; };
const insideOf = (W, b) => { let soldiers = 0, vils = 0; for (const u of W.dyn.values()) if (u.kind === 'unit' && u.inside === b.id) { if (u.order && u.order.t === 'garrison') soldiers++; else vils++; } return { soldiers, vils }; };

const P_BELL = (W, e) => !!(W.players[e.owner] && W.players[e.owner].bell);
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
  // k: scale of a 64 px icon (small boxes shrink the whole sheet, so the offsets must shrink too)
  iconStyle(key, k = 1) { const p = this.icons.icons[key]; return p ? `background-image:url(assets/icons.png);background-position:-${p[0] * k}px -${p[1] * k}px` + (k !== 1 ? `;background-size:${1024 * k}px auto` : '') : ''; }
  // portrait of a unit as this kingdom fields it (upgraded lines have their own look)
  spriteOf(owner, type) { const d = UNITS[type]; if (!d) return type; const s = owner >= 0 && !d.animal ? stat(this.g.W, owner, type).sprite : null; return s && this.icons.icons[s] ? s : d.sprite; }
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
    if (this.popT !== P.popLim) { this.popT = P.popLim; $('r_pop').parentElement.title = `Populasi / kapasitas rumah. Batas kerajaan: ${P.popLim} (+${TOWN_POP} untuk tiap Pusat Kota baru)`; }
    $('ageName').textContent = AGES[P.age];
    const tt = Math.floor(W.t); $('clock').textContent = `${String(Math.floor(tt / 3600)).padStart(2, '0')}:${String(Math.floor(tt / 60) % 60).padStart(2, '0')}:${String(tt % 60).padStart(2, '0')}`;
    // day / night, season, weather, hunger
    const tod = timeOfDay(W), night = W.night && W.opts.night !== 'off', toNight = Math.max(0, (1 - DAY.night - tod) * DAY.len);
    const di = `${night ? '🌙 Malam' : '☀ Hari ' + W.day}${raining(W) ? (W.season.snow ? ' · 🌨' : ' · 🌧') : ''} · ${{ semi: '🌱', kemarau: '🔆', gugur: '🍂', salju: '❄' }[W.opts.season] || ''}`;
    const de = $('dayInfo'); if (de.textContent !== di) de.textContent = di;
    de.title = `${SEASONS[W.opts.season].name}: ${SEASONS[W.opts.season].desc}\n` + (W.opts.night === 'off' ? 'Siklus siang-malam mati.' : night ? 'Malam: jarak pandang berkurang' + (W.opts.night === 'full' ? ', penduduk desa beristirahat di rumah (kecuali sudah riset Obor Kerja).' : '.') : `Malam tiba dalam ${Math.ceil(toNight / 60)} menit. Saat fajar setiap warga makan ${DAY.upkeep} makanan.`);
    de.classList.toggle('hungry', !!P.hungry);
    this.goals(W, P); this.lifeBar(W, P);
    let idle = 0; for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner === G.me && e.type === 'villager' && !e.order) idle++;
    $('idleVil').classList.toggle('has', idle > 0); $('idleN').textContent = idle || '';
    const sel = G.sel.map(id => W.ents.get(id)).filter(Boolean);
    const sig = sel.map(e => e.id + ':' + (e.kind === 'building' ? e.built + ':' + e.queue.length : e.type + (e.form || '') + (e.cargo ? e.cargo.length : ''))).join() + '|' + P.age + '|' + G.placing?.type + '|' + this.page + '|' + P.techs.size;
    if (sig !== this.lastSig || (this.refreshT -= dt) <= 0) { this.lastSig = sig; this.refreshT = 0.5; this.buildCommands(sel); }
    this.buildInfo(sel);
    this.miniT -= dt; if (this.miniT <= 0) { this.miniT = 0.4; this.drawMiniBase(); }
    this.drawMini();
  }
  // the people at a glance: happiness, health, the sick, newborns, prosperity
  lifeBar(W, P) {
    const L = W.opts.life && P.life, el = $('lifeInfo'); if (!el) return;
    if (this.landN === undefined) { this.landN = 0; for (const k of W.terrain) if (k !== 3) this.landN++; } const land = this.landN;
    const terr = `<span title="Wilayah kekuasaan: bagian daratan peta yang kamu kuasai (Pusat Kota, Kastil, Pos Perbatasan)">🗺 ${land ? Math.round((P.terrN || 0) / land * 100) : 0}%</span>`;
    if (!L) { if (el.innerHTML !== terr) el.innerHTML = terr; return; }
    // a word from the steward when the people suffer (at most every few minutes per topic)
    if (!this.g.watch && W.t > 120) {
      const has = (t) => { for (const b of W.dyn.values()) if (b.kind === 'building' && b.owner === P.id && b.type === t) return true; return false; };
      const say = (k, msg) => { this.hints = this.hints || {}; if (W.t - (this.hints[k] || -999) > 240) { this.hints[k] = W.t; this.notify(msg, 'bad'); } };
      if (L.fun < 35) say('fun', has('tavern') ? '🎭 Warga bosan dan malas bekerja. Bangun Kedai kedua atau riset Pemusik Keliling.' : '🎭 Warga mulai bosan dan malas bekerja — bangun Kedai (halaman 🍺 Kehidupan Warga).');
      if (L.need < 30) say('need', '💧 Warga lapar atau kehausan — pastikan lumbung cukup dan bangun Sumur dekat tempat kerja.');
      if (L.sick >= 3 && !has('hospital')) say('sick', '🤒 Banyak yang sakit — Balai Pengobatan (Zaman Feodal) menyembuhkan dan menahan wabah.');
      if (L.homeless >= 3) say('home', '🏚 Ada warga tanpa rumah — mereka tidur di luar dan tidak bisa berkeluarga.');
    }
    const col = (v) => v >= 65 ? 'good' : v >= 35 ? 'mid' : 'bad';
    const html = `<span class="${col(L.fun)}" title="Kebahagiaan rata-rata (hiburan): Kedai, Biara, Pasar">😊 ${Math.round(L.fun)}</span><span class="${col(L.health)}" title="Kesehatan rata-rata">❤ ${Math.round(L.health)}</span><span class="${col(L.need)}" title="Makan & minum (yang paling kurang)">🍞 ${Math.round(L.need)}</span>${L.sick ? `<span class="bad" title="Warga sakit — Balai Pengobatan menyembuhkan dan menahan wabah">🤒 ${L.sick}</span>` : ''}${L.homeless ? `<span class="mid" title="Tanpa rumah">🏚 ${L.homeless}</span>` : ''}<span title="Kelahiran">👶 ${L.births}</span>${terr}<span class="${col(P.prosper)}" title="Indeks Kemakmuran${W.opts.victory === 'prosper' ? ` — pertahankan di atas ${LIFE.prosperWin} selama 10 menit untuk menang` : ''}">⭐ ${P.prosper}</span>`;
    if (el.innerHTML !== html) el.innerHTML = html;
  }
  // top bar countdowns: wonders standing, the monument held, the treaty still running
  goals(W, P) {
    const out = [], mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    if (W.opts.treaty && W.t < W.opts.treaty) out.push(`<span title="Gencatan senjata: tidak ada yang bisa menyerang">🕊 ${mmss(W.opts.treaty - W.t)}</span>`);
    for (const [id, t0] of W.wonders || []) { const b = W.ents.get(id); if (!b) continue; const o = W.players[b.owner]; out.push(`<span title="Keajaiban ${o.name}: menang bila bertahan" style="color:rgb(${PLAYER_RGB[o.color]})">🏛 ${mmss(Math.max(0, WONDER_TIME - (W.t - t0)))}</span>`); }
    if (W.opts.victory === 'prosper') for (const Q of W.players) if (Q.prosperSince) out.push(`<span title="Kemakmuran ${Q.name} di atas ${LIFE.prosperWin}" style="color:rgb(${PLAYER_RGB[Q.color]})">⭐ ${mmss(Math.max(0, 600 - (W.t - Q.prosperSince)))}</span>`);
    const m = W.monument; if (m && m.team >= 0) { const o = W.players[m.owner] || W.players.find(q => q.team === m.team); if (o) out.push(`<span title="Monumen dikuasai ${o.name}" style="color:rgb(${PLAYER_RGB[o.color]})">⛰ ${mmss(Math.max(0, KOTH_TIME - (W.t - m.since)))}</span>`); }
    const html = out.join(' '), el = $('goalInfo'); if (el && el.innerHTML !== html) { el.innerHTML = html; el.classList.toggle('hidden', !html); }
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
          if (type === 'town_center' && !ok && P.age >= d.age) why = `Batas Pusat Kota tercapai (maks ${townsMax(P)} di zaman ini)`;
          this.setBtn(slot, { icon: type === 'stone_wall' ? 'wall_post' : type === 'palisade' ? 'pal_post' : type === 'gate' ? 'gate_x' : type, glyph: { dock: '⚓', blacksmith: '⚒', academy: '🏛', monastery: '✝', wonder: '🏛', siege_workshop: '⚙', palisade: '🪵', well: '🪣', tavern: '🍺', hospital: '⚕', barn: '🐄', outpost: '🚩', town_center: '🏰' }[type], name: d.name, cost, why, disabled: !ok || !canAfford(P, cost), active: G.placing?.type === type, act: () => G.startPlace(type), desc: BLD_DESC[type] });
        }
        const nx = (this.page + 1) % VIL_PAGES.length;
        this.setBtn(9, { glyph: PAGE_NAME[nx].split(' ')[0], name: 'Halaman: ' + PAGE_NAME[nx].slice(3), desc: 'Ganti halaman bangunan (Ekonomi → Militer → Kehidupan Warga)', act: () => { this.page = nx; this.lastSig = ''; } });
      } else {
        // soldiers: formations (and ships: unload)
        const mil = units.filter(u => MILITARY(u.type) && !u.nav);
        if (mil.length) Object.entries(FORMATIONS).forEach(([f, d], k) => this.setBtn(k, { glyph: d.glyph, name: 'Formasi ' + d.name, desc: d.desc + (P.techs.has('doc_formation') ? '<br><b>Doktrin Taktik Formasi: bonus x2.</b>' : ''), active: (mil[0].form || 'garis') === f, act: () => G.setFormation(f) }));
        if (mil.length) STANCES.forEach((st, k) => this.setBtn(5 + k, { glyph: STANCE[st][0], name: 'Sikap: ' + STANCE[st][1], desc: STANCE[st][2], active: (mil[0].stance || 'agresif') === st, act: () => G.setStance(st) }));
        if (mil.length) {
          this.setBtn(10, { glyph: '🔁', name: 'Patroli', desc: 'Bolak-balik antara posisi sekarang dan titik yang kamu klik, menyerang musuh yang terlihat. (Shift: tambahkan ke antrean)', act: () => G.startTarget('patrol') });
          this.setBtn(9, { glyph: '🏰', name: 'Jaga Kota', desc: 'Pasukan terpilih menjadi penjaga kota: berpatroli keliling pos-pos jaga di sekitar Pusat Kota dan menyerang musuh yang masuk. Sisanya bebas berperang di luar.', act: () => G.townWatch() });
          this.setBtn(11, { glyph: '🛡', name: 'Kawal', desc: 'Klik unit kawan untuk dikawal: mengikuti dan menyerang musuh yang mendekatinya (mis. kawal Biarawan atau Pendobrak).', act: () => G.startTarget('follow') });
          if (mil.some(u => stat(W, u.owner, u.type).splash)) this.setBtn(12, { glyph: '🎯', name: 'Serang Tanah', desc: 'Mesin pengepung menembaki titik tertentu (ledakan area), misalnya kerumunan di balik tembok.', act: () => G.startTarget('ground') });
        }
        const treb = units.filter(u => UNITS[u.type].packs);
        if (treb.length) { const packed = treb.some(u => u.type === 'trebuchet_p'); this.setBtn(12, { glyph: '🏗', name: packed ? 'Pasang Trebuchet' : 'Bongkar Trebuchet', desc: packed ? 'Pasang di tempat (4 detik) agar bisa menembak. Trebuchet juga memasang diri otomatis saat diperintah menyerang.' : 'Bongkar (4 detik) agar bisa berjalan. Terjadi otomatis saat diperintah bergerak.', act: () => G.send({ t: 'pack', pid: G.me, ids: treb.map(u => u.id) }) }); }
        const rams = units.filter(u => insideOf(W, u).soldiers);
        if (rams.length) this.setBtn(12, { glyph: '⏏', name: 'Keluarkan Pasukan', desc: `${rams.reduce((a, r) => a + insideOf(W, r).soldiers, 0)} infanteri di dalam Pendobrak (tiap penumpang +8% kecepatan).`, act: () => rams.forEach(r => G.send({ t: 'ungarrison', pid: G.me, bid: r.id })) });
        const ships = units.filter(u => u.cargo && u.cargo.length);
        if (ships.length) this.setBtn(12, { glyph: '⚓', name: 'Turunkan pasukan', desc: `Muatan: ${ships.reduce((s, u) => s + u.cargo.length, 0)} unit. Klik kanan di daratan dekat pantai, atau tekan untuk menurunkan di pantai terdekat.`, act: () => G.unloadHere() });
      }
      this.setBtn(13, { glyph: '🗑', name: 'Hapus', act: () => G.deleteSel() });
      this.setBtn(14, { glyph: '✋', name: 'Berhenti', act: () => G.stop() });
      return;
    }
    const b = mine.find(e => e.kind === 'building'); if (!b) return;
    const d = BUILDINGS[b.type], pages = PAGES[b.type], pg = pages ? (this.bpage || 0) % pages.length : 0;
    const slots = pages && pages[pg] ? pages[pg] : SLOTS[b.type] || {}, shown = (k) => !pages || k in slots;
    if (pages) this.setBtn(14, { glyph: pg ? '📜' : '⭐', name: pg ? 'Kembali: Riset & Unit' : 'Halaman: Pasukan Khusus', desc: pg ? 'Riset, unit dan doktrin Akademi.' : 'Spesialis: mengubah satu jalur unit menjadi pasukan elit (pilih satu per jalur).', act: () => { this.bpage = pg + 1; this.lastSig = ''; } });
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
      if (!shown(u0)) return;
      const u = trainType(P, u0), ud = UNITS[u]; const slot = slots[u0] ?? k; if (!ud) return;
      const why = P.age < ud.age ? `Butuh ${AGES[ud.age]}` : ud.needsTech && !P.techs.has(ud.needsTech) ? 'Butuh riset ' + TECHS[ud.needsTech].name : !canAfford(P, unitCost(P, u)) ? 'Sumber daya kurang' : '';
      const sn = stat(W, G.me, u).name;
      this.setBtn(slot, { icon: ud.sprite === u ? this.spriteOf(G.me, u) : ud.sprite, badge: u !== u0 ? '★' : '', badgeCls: 'spec', glyph: UGLYPH[u], name: sn || ud.name, cost: unitCost(P, u), desc: this.unitDesc(P, u), why, disabled: !!why || b.queue.length >= 5, act: () => G.train(b, u0) });
    });
    (d.techs || []).forEach((t) => {
      if (!shown(t)) return;
      const td = TECHS[t], slot = slots[t] ?? 'QWERTASDFG'.indexOf(td.key);
      if (td.after && !P.techs.has(td.after) && (d.techs || []).includes(td.after)) return;          // a later step of a line waits for the earlier one
      const groupDone = td.group && [...P.techs].find(x => TECHS[x].group === td.group);
      if (P.techs.has(t)) { if (td.toAge || (d.techs || []).some(x => TECHS[x].after === t)) return; if (td.group || td.spec) this.setBtn(slot, { glyph: td.glyph || GLYPH[t] || '📜', name: td.name + ' ✔', desc: td.desc, chosen: true, disabled: true, why: 'Pilihan ini sudah diambil.' }); return; }
      if (td.toAge && td.toAge !== P.age + 1) return;
      if (td.toAge && b.queue.some(q => q.tech && TECHS[q.tech].toAge && q.tech !== t)) return;      // one path already chosen and in progress
      if (groupDone) { this.setBtn(slot, { glyph: td.glyph || GLYPH[t] || '📜', name: td.name, desc: td.desc, disabled: true, why: `Tertutup: kamu sudah memilih ${TECHS[groupDone].name}.` }); return; }
      const ok = techOk(W, G.me, t, b), cost = techCost(P, t);
      let why = P.age < td.age ? `Butuh ${AGES[td.age]}` : td.after && !P.techs.has(td.after) ? 'Butuh ' + TECHS[td.after].name : '';
      if (!why && td.reqCount) { const have = new Set(); for (const e of W.ents.values()) if (e.kind === 'building' && e.owner === G.me && e.built && td.reqFrom.includes(e.type)) have.add(e.type); if (have.size < td.reqCount) why = `Butuh ${td.reqCount} dari: ` + td.reqFrom.map(x => BUILDINGS[x].name).join(', '); }
      if (!why && !canAfford(P, cost)) why = 'Sumber daya kurang';
      if (!why && !ok) why = 'Sedang diteliti';
      const excl = td.group ? '<br><i>Pilihan eksklusif: hanya satu dari kelompok ini yang bisa diambil.</i>' : '';
      this.setBtn(slot >= 0 ? slot : 4, { glyph: td.toAge ? '👑' : td.glyph || GLYPH[t] || '📜', badge: td.group ? '◆' : '', badgeCls: 'excl', name: td.name, cost, desc: (td.desc || (td.toAge ? 'Membuka bangunan & unit baru' : '')) + excl, why, disabled: !ok || !!why, act: () => G.research(b, t) });
    });
    if (d.ability === 'bell') {
      const on = !!P.bell, n = W.garr ? [...W.garr.values()].reduce((a, k) => a + k, 0) : 0;
      this.setBtn(slots.$bell ?? 10, { glyph: '🔔', name: on ? 'Bunyikan lagi: kembali bekerja' : 'Lonceng Kota', active: on, desc: on ? `${n} penduduk sedang berlindung. Tekan untuk mengembalikan mereka ke pekerjaan.` : 'Semua penduduk desa lari berlindung ke Pusat Kota, Kastil, menara dan rumah terdekat. Di Pusat Kota, Kastil dan menara mereka menambah anak panah (1 per 4 penduduk, Pertahanan Rakyat: 1 per 2; maks +5). Hotkey: B (tanpa pilihan).', act: () => G.ringBell(!on) });
    }
    if (shown('$out') && garrisonCapOf(W, b)) {
      const n = insideOf(W, b).soldiers;
      this.setBtn(slots.$out ?? 11, { glyph: '⏏', name: 'Keluarkan Garnisun', desc: `${n} / ${garrisonCapOf(W, b)} tentara di dalam. Tentara di dalam menambah panah bangunan dan sembuh perlahan. Masukkan tentara: pilih lalu klik kanan bangunan ini.`, disabled: !n, why: n ? '' : 'Tidak ada garnisun', act: () => G.send({ t: 'ungarrison', pid: G.me, bid: b.id }) });
    }
    if (d.gate && shown('$lock')) this.setBtn(slots.$lock ?? 0, { glyph: b.locked ? '🔒' : '🔓', name: b.locked ? 'Buka Kunci Gerbang' : 'Kunci Gerbang', active: !!b.locked, desc: b.locked ? 'Gerbang terkunci: tidak ada yang bisa lewat, termasuk pasukanmu.' : 'Kunci gerbang agar tidak bisa dilewati siapa pun (pasukan sendiri dan sekutu biasanya bisa lewat).', act: () => G.send({ t: 'lock', pid: G.me, bid: b.id }) });
    if (d.reseed && shown('$reseed')) {
      const q = W.reseed[G.me] || 0, fc = costOf(P, 'farm');
      this.setBtn(slots.$reseed ?? 5, { glyph: '🌱', badge: q ? String(q) : '', name: 'Antre Tanam Ulang (+1)', cost: fc, desc: `Bayar di muka: ladang yang habis langsung ditanam ulang di tempat oleh petaninya. Antrean: <b>${q}</b>. (Shift+klik: +5)`, disabled: !canAfford(P, fc), why: canAfford(P, fc) ? '' : 'Kayu kurang', act: () => G.send({ t: 'reseed', pid: G.me, bid: b.id, n: G.keys && G.keys.Shift ? 5 : 1 }) });
      this.setBtn((slots.$reseed ?? 5) + 1, { glyph: '➖', name: 'Batalkan 1 Antrean Tanam', desc: 'Kayunya dikembalikan.', disabled: !q, act: () => G.send({ t: 'reseed', pid: G.me, bid: b.id, n: -1 }) });
    }
    if (d.fishtrap && shown('$trap')) {
      const ok = P.age >= 2 && P.res.wood >= 100;
      this.setBtn(slots.$trap ?? 7, { glyph: '🪤', name: 'Perangkap Ikan', cost: { wood: 100 }, desc: 'Pasang perangkap ikan (700 makanan) di air dekat Dermaga — dijala Kapal Nelayan seperti kawanan ikan.', why: P.age < 2 ? `Butuh ${AGES[2]}` : !ok ? 'Kayu kurang' : '', disabled: !ok, act: () => G.send({ t: 'fishtrap', pid: G.me, bid: b.id }) });
    }
    if (d.ability === 'spy' && shown('$spy')) {
      const cd = Math.max(0, P.spyCd - W.t), has = P.techs.has('spy_network');
      this.setBtn(slots.$spy ?? 14, { glyph: '🕵', name: 'Kirim Mata-mata', desc: 'Posisi seluruh pasukan & bangunan musuh terlihat 30 detik, dan Penasihat (!) menerima laporan lengkap + saran strategi.', why: !has ? 'Butuh riset Jaringan Mata-mata' : cd ? `Siap dalam ${Math.ceil(cd)} detik` : '', disabled: !has || cd > 0, act: () => G.useSpy(b) });
    }
  }
  buildInfo(sel) {
    const G = this.g, W = G.W, el = $('info');
    if (!sel.length) { if (el.dataset.k !== 'none') { el.dataset.k = 'none'; el.innerHTML = '<div class="empty">Pilih unit atau bangunan</div>'; } return; }
    if (sel.length > 1) {
      const k = 'multi' + sel.map(e => e.id).join();
      if (el.dataset.k !== k) { el.dataset.k = k; el.innerHTML = '<div class="multi">' + sel.slice(0, 40).map(e => `<i data-id="${e.id}" style="${this.iconStyle(UNITS[e.type] ? this.spriteOf(e.owner, e.type) : e.type, 36 / 64)}"><b></b></i>`).join('') + '</div>'; el.querySelectorAll('i').forEach(i => i.onclick = (ev) => { G.select([+i.dataset.id], ev.shiftKey); }); }
      el.querySelectorAll('i').forEach(i => { const e = W.ents.get(+i.dataset.id); if (e) i.firstChild.style.width = (e.hp / e.maxHp * 100) + '%'; });
      return;
    }
    const e = sel[0];
    const k = 'one' + e.id + e.type + (e.kind === 'building' ? e.queue.map(q => q.unit || q.tech).join() + e.built : '');
    const name = e.kind === 'unit' && e.nm !== undefined ? `${personName(e)} <small class="role">${stat(W, e.owner, e.type).name || UNITS[e.type].name}</small>` : e.kind === 'monument' ? 'Monumen Raja Bukit' : e.kind === 'unit' && stat(W, e.owner, e.type).name ? stat(W, e.owner, e.type).name : e.kind === 'relic' ? 'Relik' : e.kind === 'unit' ? UNITS[e.type].name : e.kind === 'building' ? BUILDINGS[e.type].name : e.kind === 'treasure' ? 'Harta Karun: ' + TREASURES[e.type].name
      : e.type === 'carcass' ? 'Bangkai ' + UNITS[e.animal].name : e.trap ? 'Perangkap Ikan' : { tree: 'Pohon', gold: 'Tambang Emas', stone: 'Tambang Batu', iron: 'Tambang Besi', berry: 'Semak Berry', fish: 'Kawanan Ikan' }[e.type];
    const owner = e.owner >= 0 ? W.players[e.owner] : null;
    if (el.dataset.k !== k) {
      el.dataset.k = k;
      const icon = e.kind === 'monument' ? 'monument' : e.type === 'palisade' ? 'pal_post' : e.kind === 'relic' ? 'relic' : e.kind === 'treasure' ? 'treasure_' + e.type : e.type === 'carcass' ? e.animal : e.kind === 'res' ? 'res_' + { tree: 'wood', gold: 'gold', stone: 'stone', iron: 'iron', berry: 'food', fish: 'food' }[e.type] : e.type === 'stone_wall' ? 'wall_post' : e.type === 'gate' ? 'gate_x' : e.kind === 'unit' ? this.spriteOf(e.owner, e.type) : e.type;
      el.innerHTML = `<div class="one"><div class="por" style="${this.iconStyle(icon)}">${this.icons.icons[icon] ? '' : UGLYPH[e.type] || ''}</div><div class="nm"><b>${name}</b>${owner ? `<small style="color:rgb(${PLAYER_RGB[owner.color]})">${owner.name}</small>` : e.kind === 'unit' ? '<small class="gaia">Alam liar</small>' : ''}</div>
        <div class="hp"><i></i><span></span></div><div class="stats"></div><div class="queue"></div></div>`;
      if (e.kind === 'building') el.querySelector('.queue').innerHTML = e.queue.map((q, i) => `<i data-i="${i}" style="${q.unit ? this.iconStyle(UNITS[q.unit].sprite, 42 / 64) : ''}">${q.tech ? (GLYPH[q.tech] || '📜') : ''}<b></b></i>`).join('');
      el.querySelectorAll('.queue i').forEach(i => i.onclick = () => G.cancel(e, +i.dataset.i));
    }
    const hp = e.kind === 'res' || e.kind === 'treasure' || e.kind === 'monument' ? null : e;
    const hpEl = el.querySelector('.hp');
    if (hp) { hpEl.style.display = ''; hpEl.firstChild.style.width = (hp.hp / hp.maxHp * 100) + '%'; hpEl.lastChild.textContent = `${Math.ceil(hp.hp)}/${hp.maxHp}`; } else hpEl.style.display = 'none';
    let st = '';
    if (e.kind === 'treasure') st = `+${e.amount} ${RES_NAME[TREASURES[e.type].res]} · ${e.guarded ? '<b class="warn">Dijaga! Kalahkan penjaganya.</b>' : 'Sentuh dengan unit untuk mengambil.'}`;
    if (e.kind === 'unit' && UNITS[e.type].animal) { const d = UNITS[e.type]; st = (d.atk ? `⚔ ${d.atk} · ` : '') + (d.fat ? `🍖 ${Math.round(e.meat || d.food)}/${d.fat}${e.pen ? ' · di padang kandang' : ''} · ` : '') + d.desc; }
    else if (e.kind === 'unit') {
      const s = stat(W, e.owner, e.type);
      st = `⚔ ${Math.round(s.atk)}${s.range ? ' · 🏹 ' + s.range : ''} · 🛡 ${s.ma}/${s.pa}`;
      if (e.fb && (e.fb.ma || e.fb.pa)) st += ` <b class="good">(formasi ${e.fb.ma >= 0 ? '+' : ''}${e.fb.ma}/+${e.fb.pa})</b>`;
      if (e.form && e.form !== 'garis') st += ` · ${FORMATIONS[e.form].glyph} ${FORMATIONS[e.form].name}`;
      if (e.carry && e.carry.n >= 1) st += ` · <b class="rc"><i style="${this.iconStyle('res_' + e.carry.res)}"></i>${Math.floor(e.carry.n)}</b>`;
      if (e.cargo) st += ` · Muatan ${e.cargo.length}/${s.capacity}`;
      if (s.stealth) st += ' · <i>tak terlihat musuh</i>';
      if (e.order && e.order.t === 'rest') st += P_BELL(W, e) ? ' · <i>berlindung (lonceng kota)</i>' : ' · <i>beristirahat (malam)</i>';
      if (e.stance) st += ` · ${STANCE[e.stance][0]} ${STANCE[e.stance][1]}`;
      if (s.heal) st += ` · ⚕ ${s.heal.toFixed(1)} HP/dtk`;
      if (s.kite) st += ' · ↩ lari-tembak';
      if (UNITS[e.type].trade) st += e.order && e.order.t === 'trade' ? ` · 🪙 rute dagang (${e.goldLoad ? 'membawa ' + e.goldLoad + ' emas' : 'menuju pasar tujuan'})` : ' · klik kanan Pasar' + (UNITS[e.type].naval ? '/Dermaga' : '') + ' lain (sendiri atau sekutu) untuk berdagang';
      if (UNITS[e.type].packs) st += e.type === 'trebuchet_p' ? ' · 🏗 terbongkar (bisa berjalan)' : ' · 🏗 terpasang (bisa menembak)';
      if (UNITS[e.type].hero) st += ' · 👑 Raja — jika tewas, kerajaan kalah!';
      { const n = insideOf(W, e).soldiers; if (n) st += ` · ⛑ ${n} penumpang`; }
    }
    if (e.kind === 'unit' && e.nm !== undefined) {
      const bar = (v, g, t) => `<i class="nd" title="${t}: ${Math.round(v)}"><em>${g}</em><span class="tr"><b style="width:${Math.max(0, Math.min(100, v))}%;background:${v >= 60 ? '#5fbf4a' : v >= 30 ? '#d9b23a' : '#d0402a'}"></b></span></i>`;
      const home = e.homeId && W.ents.get(e.homeId), mates = home ? [...W.dyn.values()].filter(u => u.homeId === home.id && u !== e).length : 0;
      st = `<div class="who">${e.sex === 'f' ? '♀' : '♂'} ${personAge(W, e)} th · keluarga ${NAMES.fam[e.fam]}${home ? ` · rumah bersama ${mates} orang` : e.type === 'villager' || e.type === 'child' ? ' · <b class="warn">tanpa rumah</b>' : ''}${e.sick ? ' · <b class="warn">🤒 sakit</b>' : ''}${e.type === 'child' ? ` · dewasa dalam ${Math.max(0, Math.ceil((LIFE.growUp - (W.t - e.born)) / 60))} mnt` : ''}</div>`
        + `<div class="needs">${bar(e.hu, '🍞', 'Kenyang')}${bar(e.th, '💧', 'Minum')}${bar(e.en, '⚡', 'Energi')}${bar(e.fu, '🎭', 'Hiburan')}${bar(e.he, '❤', 'Kesehatan')}${MILITARY(e.type) ? `<span class="wr" title="Kekuatan serangan (sakit, lelah, lapar atau tidak bahagia melemahkan)">💪 ${Math.round((0.8 + 0.2 * Math.min(1, e.wr ?? 1)) * 100)}%</span>` : `<span class="wr" title="Kecepatan kerja (sakit, lelah, lapar, haus atau bosan memperlambat)">⚒ ${Math.round((e.wr ?? 1) * 100)}%</span>`}<span class="wr" title="Kecepatan berjalan">🦶 ${Math.round((0.7 + 0.3 * Math.min(1, e.wr ?? 1)) * 100)}%</span></div><div class="cs">${st}</div>`;
    }
    if (e.kind === 'unit' && e.faith !== undefined) st += ` · ✝ iman ${Math.round(e.faith * 100)}%${e.relic ? ' · 📿 membawa relik' : ''}`;
    if (e.kind === 'relic') st = e.carrier ? 'Sedang dibawa seorang Biarawan.' : 'Relik suci. Hanya Biarawan yang bisa membawanya ke Biara (+30 emas/menit). Klik kanan dengan Biarawan.';
    if (e.kind === 'building' && BUILDINGS[e.type].relics && e.built) { let n = 0; for (const r of W.dyn.values()) if (r.kind === 'relic' && r.inBld === e.id) n++; st += ` · 📿 ${n} relik (+${Math.round(n * RELICS.gold * 60)} emas/menit)`; }
    if (e.kind === 'building' && e.type === 'town_center' && owner && owner.civ && CIVS[owner.civ]) st += ` · ${CIVS[owner.civ].glyph} ${CIVS[owner.civ].name}`;
    if (e.kind === 'res') st = `Sisa: <b>${Math.ceil(e.amount)}</b>` + (e.type === 'fish' ? (e.trap ? ' · perangkap ikan' : ' · dijala dari tepi atau Kapal Nelayan') : '');
    if (e.kind === 'monument') { const o = W.players[e.owner]; st = (o ? `Dikuasai <b style="color:rgb(${PLAYER_RGB[o.color]})">${o.name}</b> · ` : 'Belum dikuasai · ') + `Kuasai sendirian (tanpa musuh dalam 5 petak) selama ${KOTH_TIME / 60} menit untuk menang.`; }
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
      if (e.owner === this.g.me && !d.tavern && !d.hospital) { const { soldiers, vils } = insideOf(W, e); if (vils) st += ` · 🌙 ${vils} penduduk di dalam`; if (soldiers) st += ` · ⛑ garnisun ${soldiers}/${garrisonCapOf(W, e)}`; }
      if (d.gate && e.locked) st += ' · 🔒 terkunci';
      if (d.tavern || d.hospital) { let n = 0; for (const u of W.dyn.values()) if (u.inside === e.id) n++; st += d.tavern ? ` · 🍺 ${n} pengunjung (maks ${d.tavern})` : ` · ⚕ ${n} pasien`; }
      if (d.pen) st += ` · 🐑 ${e.herd || 0}/${d.penCap} ternak di padang — klik kanan domba/sapi ke sini`;
      if (d.well) st += ' · 💧 air untuk warga dalam 10 petak';
      if (e.type === 'house' && e.owner === this.g.me) { const fam = [...W.dyn.values()].filter(u => u.homeId === e.id); if (fam.length) st += `<div class="who">🏠 ${fam.map(u => personName(u).split(' ')[0] + (u.type === 'child' ? ' (anak)' : '')).join(', ')}</div>`; }
      if (d.reseed && e.owner === this.g.me) st += ` · 🌱 antrean tanam ulang: ${W.reseed[e.owner] || 0}`;
      if (d.wonder && W.wonders && W.wonders.has(e.id)) st += ` · 🏛 menang dalam ${Math.ceil((WONDER_TIME - (W.t - W.wonders.get(e.id))) / 60)} menit`;
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
      if ((e.kind !== 'unit' && e.kind !== 'treasure' && e.kind !== 'relic') || e.inside) continue; const k = idx(W, Math.floor(e.x), Math.floor(e.y));
      if (e.kind === 'relic') { if ((!P.exp[k] && !G.seeAll) || e.inBld || e.carrier) continue; d[k * 4] = 255; d[k * 4 + 1] = 255; d[k * 4 + 2] = 255; continue; }   // relics: white dots
      if (e.kind === 'treasure') { if (!P.exp[k] && !G.seeAll) continue; d[k * 4] = 255; d[k * 4 + 1] = 230; d[k * 4 + 2] = 90; continue; }
      if (e.owner !== G.me && !P.vis[k] && !G.seeAll) continue; const col = e.owner >= 0 ? PLAYER_RGB[W.players[e.owner].color] : UNITS[e.type].animal && !['wolf', 'bear'].includes(e.type) ? [235, 235, 220] : [150, 40, 30];
      for (const kk of [k, k + 1, k + S]) if (kk < S * S) { d[kk * 4] = col[0]; d[kk * 4 + 1] = col[1]; d[kk * 4 + 2] = col[2]; }
    }
    if (W.monument) { const m = W.monument, col = m.owner >= 0 ? PLAYER_RGB[W.players[m.owner].color] : [255, 255, 255]; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const k = idx(W, Math.floor(m.x) + di, Math.floor(m.y) + dj); d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2]; } }
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
    const now = performance.now(); this.flares = (this.flares || []).filter(f => now - f.t < 6000);       // flares: pulsing rings
    for (const f of this.flares) { const k = ((now - f.t) / 1000) % 1, x = (f.x - f.y) * sx + w / 2, y = (f.x + f.y) * sy; g.strokeStyle = f.color; g.lineWidth = 2; g.globalAlpha = 1 - k; g.beginPath(); g.arc(x, y, 3 + k * 12, 0, 6.283); g.stroke(); g.globalAlpha = 1; }
  }
  miniClick(e) {
    e.preventDefault();
    const r = this.mini.getBoundingClientRect(), { sx, sy, w } = this.miniXform();
    const mx = (e.clientX - r.left) * this.mini.width / r.width, my = (e.clientY - r.top) * this.mini.height / r.height;
    const a = (mx - w / 2) / sx, b = my / sy; const x = (a + b) / 2, y = (b - a) / 2;
    if (e.button === 0 && e.altKey) { this.g.sendFlare(x, y); return; }
    if (e.button === 2) this.g.rightClickWorld(x, y); else this.g.centerOn(x, y);
    const move = (ev) => { const mx2 = (ev.clientX - r.left) * this.mini.width / r.width, my2 = (ev.clientY - r.top) * this.mini.height / r.height; const a2 = (mx2 - w / 2) / sx, b2 = my2 / sy; this.g.centerOn((a2 + b2) / 2, (b2 - a2) / 2); };
    if (e.button === 0) { const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); }; addEventListener('pointermove', move); addEventListener('pointerup', up); }
  }
}
