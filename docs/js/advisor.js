// The royal advisor ("!" top left): turns what your soldiers have seen — or what your spies brought home — into a
// read of each enemy's army and the paths they committed to, and suggests counters (units, doctrine, formation).
import { UNITS, TECHS, AGES, PLAYER_RGB, MILITARY, BUILDINGS } from './data.js?v=20261013205428';
import { idx } from './sim.js?v=20261013205428';

const $ = (id) => document.getElementById(id);
const CLS = (t) => { const c = UNITS[t] && UNITS[t].cls; return c === 'cavalry' ? 'cav' : c === 'archer' ? 'arch' : c === 'infantry' ? 'inf' : c === 'siege' ? 'siege' : c === 'ship' ? 'ship' : null; };
const NAME = { inf: 'INFANTERI', arch: 'PEMANAH', cav: 'KAVALERI', siege: 'MESIN PERANG', ship: 'ARMADA' };
const COUNTER = {
  cav: { units: 'Prajurit Tombak (+15 vs kavaleri) lalu riset Tombak Panjang (+22), Katafrak; sikap Diam di Tempat', doc: 'Doktrin: Legiun Baja', form: 'Kotak (+3 vs kavaleri)' },
  arch: { units: 'Pelempar Lembing (murah, tahan panah), Kavaleri / Ksatria, Ninja, Lancer', doc: 'Doktrin: Kavaleri Bangsawan', form: 'Menyebar (panah lebih sering meleset)' },
  inf: { units: 'Pemanah, Pemanah Berkuda (lari-tembak), Pemanah Silang, Penembak Mesiu, Samurai', doc: 'Doktrin: Hujan Panah', form: 'Tempur (pemanah di belakang perisai)' },
  siege: { units: 'Kavaleri cepat atau Ninja untuk memburu mesin perang', doc: 'Doktrin: Serangan Kilat', form: 'Menyebar (melawan meriam)' },
  ship: { units: 'Kapal Perang sendiri, Pemanah Api di pantai, Menara di tepi air', doc: '—', form: '—' },
};

export class Advisor {
  constructor(game) {
    this.g = game; this.open = false; this.seen = new Map(); this.report = null; this.fresh = false; this.t = 0; this.lastMain = {};
    $('advClose').onclick = () => this.toggle(false);
  }
  toggle(on = !this.open) {
    this.open = on; $('advPanel').classList.toggle('hidden', !on);
    if (on) { this.fresh = false; this.render(); if (this.g.stats.open) this.g.stats.toggle(false); if (this.g.cards.open) this.g.cards.toggle(false); }
    this.g.snd.play('click');
  }
  // keep a memory of enemy units our side has seen (the human gets the same fog-limited knowledge as the AI)
  observe() {
    const G = this.g, W = G.W, P = W.players[G.me];
    for (const e of W.dyn.values()) {
      if (e.kind !== 'unit' || e.owner < 0 || e.owner === G.me || W.players[e.owner].team === P.team || !MILITARY(e.type)) continue;
      if (G.watch || P.vis[idx(W, Math.floor(e.x), Math.floor(e.y))]) this.seen.set(e.id, { type: e.type, owner: e.owner, t: W.t });
    }
    for (const [id, s] of this.seen) if (W.t - s.t > 240 || (!W.ents.has(id) && W.t - s.t > 20)) this.seen.delete(id);
  }
  onSpy(report) { this.report = report; this.fresh = true; }
  update(dt) {
    if ((this.t -= dt) > 0) return; this.t = 1;
    this.observe();
    const a = this.analyse();
    for (const e of a) if (e.main && e.main !== this.lastMain[e.id]) { this.lastMain[e.id] = e.main; if (e.n >= 5) this.fresh = true; }
    $('advBtn').classList.toggle('fresh', this.fresh); $('advBtn').classList.toggle('hidden', this.g.watch);
    if (this.open) this.render();
  }
  // per enemy: army make-up (from sightings, or the spy report if it's recent), doctrines and specialists (spies only)
  analyse() {
    const G = this.g, W = G.W, me = W.players[G.me], rep = this.report && W.t - this.report[0]?.t < 300 ? this.report : null;
    return W.players.filter(Q => Q.team !== me.team && Q.alive).map(Q => {
      const army = {};
      const r = rep && rep.find(x => x.id === Q.id);
      if (r) Object.assign(army, r.army);
      else for (const s of this.seen.values()) if (s.owner === Q.id) army[s.type] = (army[s.type] || 0) + 1;
      const cls = { inf: 0, arch: 0, cav: 0, siege: 0, ship: 0 }; let n = 0;
      for (const [t, k] of Object.entries(army)) { const c = CLS(t); if (c) { cls[c] += k; n += k; } }
      const main = n ? Object.entries(cls).sort((a, b) => b[1] - a[1])[0][0] : null;
      return { id: Q.id, name: Q.name, color: Q.color, age: Q.age, army, cls, n, main, spied: !!r, techs: r ? r.techs : [], vil: r ? r.vil : null, bld: r ? r.bld : null };
    });
  }
  render() {
    const G = this.g, W = G.W, P = W.players[G.me], list = this.analyse();
    const myCls = { inf: 0, arch: 0, cav: 0, siege: 0 }; let mine = 0, myVil = 0;
    for (const e of W.dyn.values()) if (e.kind === 'unit' && e.owner === G.me) { if (e.type === 'villager') myVil++; else if (MILITARY(e.type) && !e.nav) { const c = CLS(e.type); if (myCls[c] !== undefined) { myCls[c]++; mine++; } } }
    let h = '';
    if (!list.length) h = '<p>Tidak ada musuh tersisa.</p>';
    for (const e of list) {
      const pct = (c) => e.n ? Math.round(e.cls[c] / e.n * 100) : 0;
      h += `<div class="adv"><h3 style="color:rgb(${PLAYER_RGB[e.color]})">${e.name} <small>${AGES[e.age]}${e.spied ? ' · 🕵 laporan mata-mata' : e.n ? ' · dari pengamatan pasukanmu' : ''}</small></h3>`;
      if (!e.n) { h += `<p>Belum ada pasukan ${e.name} yang terlihat. <b>Kirim pengintai</b> atau gunakan <b>Mata-mata</b> di Akademi.</p></div>`; continue; }
      h += `<div class="mixbar">${['inf', 'arch', 'cav', 'siege', 'ship'].filter(c => e.cls[c]).map(c => `<i class="m-${c}" style="width:${pct(c)}%" title="${NAME[c]} ${pct(c)}%">${pct(c) >= 12 ? NAME[c].slice(0, 3) + ' ' + pct(c) + '%' : ''}</i>`).join('')}</div>`;
      h += `<p>Kekuatan utama: <b>${NAME[e.main]}</b> (${e.n} unit${e.spied ? '' : ' terlihat'}).</p>`;
      const C = COUNTER[e.main];
      h += `<ul class="tips"><li>🗡 <b>Latih:</b> ${C.units}</li><li>📜 <b>${C.doc}</b></li><li>🛡 <b>Formasi:</b> ${C.form}</li>`;
      const docs = e.techs.filter(t => TECHS[t].group);
      if (e.techs.includes('doc_fortress')) h += '<li>🏰 Musuh memilih <b>Benteng Besi</b>: bawa <b>Pendobrak / Meriam</b> dan <b>Pemanah Api</b>; jangan serang menara dengan pemanah biasa.</li>';
      if (e.techs.includes('doc_blitz')) h += '<li>⚡ Musuh memilih <b>Serangan Kilat</b>: siapkan <b>menara & tembok</b>, pakai formasi <b>Kotak</b>, simpan pasukan di rumah.</li>';
      if (e.techs.includes('spec_ninja')) h += '<li>🥷 Musuh punya <b>Ninja</b> yang tak terlihat: lindungi penduduk dengan menara, jangan biarkan pemanah tanpa pengawal.</li>';
      if (e.techs.includes('gunpowder')) h += '<li>💥 Musuh sudah punya <b>mesiu</b>: pakai formasi <b>Menyebar</b>, serbu meriam dengan kavaleri.</li>';
      if (e.vil !== null && e.vil > myVil + 8) h += `<li>🌾 Ekonomi musuh lebih besar (${e.vil} vs ${myVil} penduduk): serang penduduknya atau tambah penduduk desa.</li>`;
      if (docs.length) h += `<li>📖 Jalur musuh: ${docs.map(t => TECHS[t].name.replace('Doktrin: ', '')).join(', ')}</li>`;
      h += '</ul></div>';
    }
    // our own balance
    const myMain = mine ? Object.entries(myCls).sort((a, b) => b[1] - a[1])[0][0] : null;
    const threats = list.filter(e => e.main && myMain && ((e.main === 'arch' && myMain === 'inf') || (e.main === 'cav' && myMain === 'arch') || (e.main === 'inf' && myMain === 'cav')));
    h += `<div class="adv mine"><h3>Pasukanmu <small>${mine} tentara</small></h3>`;
    if (threats.length) h += `<p class="warn">⚠ Pasukanmu (${NAME[myMain]}) <b>lemah</b> melawan ${threats.map(t => t.name).join(', ')} (${NAME[threats[0].main]}). Ubah komposisi!</p>`;
    if (!P.techs.has('doc_legion') && !P.techs.has('doc_cavalry') && !P.techs.has('doc_archers') && P.age >= 2) h += '<p>Belum memilih <b>Doktrin</b> di Pandai Besi — pilih jalur militer utamamu.</p>';
    if (P.age >= 2 && !W.dyn.size) h += '';
    h += '<p class="hint">Segitiga dasar: <b>Tombak</b> mengalahkan <b>Kavaleri</b>, <b>Kavaleri</b> mengalahkan <b>Pemanah</b>, <b>Pemanah</b> mengalahkan <b>Infanteri</b>. Doktrin dan pasukan khusus memperkuat satu sisi — pilih sesuai musuhmu. Pelempar Lembing menangkal pemanah; Tabib menjaga pasukan tetap hidup; serangan dari samping/belakang +25%; Lonceng Kota (B) melindungi penduduk saat diserbu.</p></div>';
    $('advBody').innerHTML = h;
  }
}
