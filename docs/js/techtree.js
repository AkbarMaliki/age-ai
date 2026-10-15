// Tech tree viewer: every building with what it trains and researches, laid out by age. Opened from the home menu
// (the whole tree) or in game (marks what this kingdom has already researched and what is still locked).
import { UNITS, BUILDINGS, TECHS, AGES, RES, RES_NAME, CIVS } from './data.js?v=20261015091550';

const $ = (id) => document.getElementById(id);
const ORDER = ['town_center', 'house', 'mill', 'lumber_camp', 'mining_camp', 'mine_shaft', 'dock', 'market', 'barracks', 'archery_range', 'stable', 'blacksmith', 'academy', 'monastery',
  'siege_workshop', 'castle', 'watch_tower', 'palisade', 'stone_wall', 'gate', 'wonder', 'well', 'tavern', 'hospital', 'barn', 'outpost'];
const GLYPH = { fishing_boat: '⛵', transport_ship: '🚢', war_ship: '⛴', fire_ship: '🔥', demo_ship: '💥', cannon_galleon: '💣', trade_cog: '⛵', trade_cart: '🛒', ram: '🪵', mangonel: '🪨', scorpion: '🏹', trebuchet_p: '🏗', cannon: '💣', unique: '★' };
const AGE_SHORT = ['', 'Kegelapan', 'Feodal', 'Kastil', 'Imperial'];
const costTxt = (c) => RES.filter(r => c && c[r]).map(r => `${c[r]} ${RES_NAME[r].toLowerCase()}`).join(', ');

// what a unit line upgrade does, in words
function upTxt(t) {
  const u = t.up; if (!u) return '';
  const parts = []; for (const [k, n] of [['hp', 'HP'], ['atk', 'serangan'], ['ma', 'zirah jarak dekat'], ['pa', 'zirah panah'], ['range', 'jarak'], ['vsBuilding', 'vs bangunan']]) if (u[k]) parts.push(`+${u[k]} ${n}`);
  return `${u.types.map(x => UNITS[x] ? UNITS[x].name : x).join(', ')} → <b>${u.name || ''}</b> ${parts.join(', ')}`;
}

let state = { tab: 'barracks', P: null, icon: () => '' };
export function openTechTree(P, iconCss) {
  state.P = P; state.icon = iconCss || (() => '');
  const m = $('techModal'); m.classList.remove('hidden');
  $('techClose').onclick = () => m.classList.add('hidden');
  render();
}
function render() {
  const P = state.P, icon = state.icon;
  $('techTabs').innerHTML = ORDER.filter(b => BUILDINGS[b]).map(b => `<button data-b="${b}" class="${b === state.tab ? 'on' : ''}"><i style="${icon(b === 'stone_wall' ? 'wall_post' : b === 'gate' ? 'gate_x' : b === 'palisade' ? 'pal_post' : b, 24 / 64)}"></i>${BUILDINGS[b].name}</button>`).join('');
  $('techTabs').querySelectorAll('button').forEach(x => x.onclick = () => { state.tab = x.dataset.b; render(); });
  const d = BUILDINGS[state.tab], cols = [[], [], [], [], []];
  for (const u0 of d.trains || []) {
    const u = u0 === 'unique' && P && P.civ && CIVS[P.civ] ? CIVS[P.civ].unique : u0, ud = UNITS[u];
    if (!ud) { cols[3].push({ kind: 'unit', key: u0, name: 'Unit Unik Peradaban', desc: 'Setiap peradaban punya unit uniknya sendiri, dilatih di Kastil.', cost: null, glyph: '★' }); continue; }
    if (ud.age > 4) continue;
    cols[Math.max(1, ud.age)].push({ kind: 'unit', key: u, name: ud.name, desc: ud.desc + (ud.needsTech ? ` <i>(butuh ${TECHS[ud.needsTech].name})</i>` : ''), cost: ud.cost, sprite: ud.sprite || u, glyph: GLYPH[u] || '' });
  }
  for (const t of d.techs || []) {
    const td = TECHS[t]; if (!td) continue;
    const after = td.after && TECHS[td.after] ? TECHS[td.after].name : '';
    cols[Math.max(1, td.age || 1)].push({ kind: 'tech', key: t, name: td.name, desc: (td.desc || '') + (td.up ? '<br>' + upTxt(td) : ''), cost: td.cost, glyph: td.glyph || (td.toAge ? '👑' : '📜'), after, group: td.group, toAge: td.toAge });
  }
  const st = (it) => {
    if (!P) return '';
    if (it.kind === 'tech') return P.techs.has(it.key) ? 'done' : it.group && [...P.techs].some(x => TECHS[x].group === it.group) ? 'closed' : '';
    return '';
  };
  const card = (it) => `<div class="tt ${it.kind} ${st(it)}" title="${it.name}">
      <i class="ic" style="${it.kind === 'unit' && it.sprite ? icon(it.sprite, 40 / 64) : ''}">${it.kind === 'unit' && it.sprite && icon(it.sprite) ? '' : it.glyph || ''}</i>
      <div><b>${it.name}${st(it) === 'done' ? ' ✔' : ''}</b>${it.after ? `<small class="aft">↳ setelah ${it.after}</small>` : ''}${it.group ? '<small class="grp">◆ pilih satu</small>' : ''}
      ${it.cost ? `<small class="cst">${costTxt(it.cost)}</small>` : ''}<p>${it.desc || ''}</p></div></div>`;
  const extra = { palisade: 'Pagar kayu: murah dan cepat, tersedia sejak Zaman Kegelapan.', stone_wall: 'Tembok batu: tarik garis untuk membangun.', gate: 'Gerbang: pasukan sendiri dan sekutu bisa lewat; bisa dikunci.', house: 'Menambah populasi +5.', wonder: 'Keajaiban Dunia: pertahankan 10 menit untuk menang.' }[state.tab];
  $('techBody').innerHTML = `<div class="tthead"><b>${d.name}</b> · tersedia sejak ${AGES[d.age]} · ${costTxt(d.cost)}${d.garrison ? ` · garnisun ${d.garrison}` : ''}${extra ? `<p>${extra}</p>` : ''}</div>
    <div class="ttcols">${[1, 2, 3, 4].map(a => `<div class="ttcol${P && P.age >= a ? ' reached' : ''}"><h4>${AGE_SHORT[a]}</h4>${cols[a].map(card).join('') || '<div class="none">—</div>'}</div>`).join('')}</div>`;
}
