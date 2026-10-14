// Home City shipments (AoE3 "kartu"): XP bar + available shipments in the top bar, and a deck panel to send a card.
// Watching bot vs bot it shows the deck of the player whose point of view is selected (read-only).
import { CARDS, AGES, XP, RES, DECKS, DECK_SIZE, UNITS } from './data.js?v=20261014092756';
import { command, cardOk } from './sim.js?v=20261014092756';

const $ = (id) => document.getElementById(id);

export class CardPanel {
  constructor(game) {
    this.g = game; this.open = false; this.t = 0; this.sig = '';
    $('btnCards').onclick = () => this.toggle();
    $('cardsClose').onclick = () => this.toggle(false);
  }
  toggle(on = !this.open) {
    this.open = on; $('cardsPanel').classList.toggle('hidden', !on); $('btnCards').classList.toggle('on', on);
    if (on && this.g.stats.open) this.g.stats.toggle(false);           // one overlay at a time
    this.g.snd.play('click'); this.sig = ''; if (on) this.render();
  }
  P() { return this.g.W.players[this.g.me]; }
  // top bar: XP towards the next shipment + shipments waiting
  bar() {
    const P = this.P(), prev = P.nextXp - (XP.first + XP.step * P.shipsEarned), f = Math.max(0, Math.min(1, (P.xp - prev) / (P.nextXp - prev)));
    $('cardXp').style.width = (f * 100).toFixed(1) + '%';
    $('cardN').textContent = P.ships || ''; $('btnCards').classList.toggle('ready', P.ships > 0 && !P.shipment && !this.g.watch);
    $('btnCards').title = `Kiriman Kerajaan (K) — XP ${Math.floor(P.xp)} / ${P.nextXp}`;
  }
  update(dt) {
    this.bar(); if (!this.open) return;
    this.t -= dt; if (this.t <= 0) { this.t = 0.4; this.render(); }
  }
  icon(c) {
    if (c.units) return `<i class="ci" style="${this.g.hud.iconStyle(UNITS[c.units[0][0]].sprite)}"></i>`;
    if (c.give) return `<i class="ci" style="${this.g.hud.iconStyle('res_' + RES.find(r => c.give[r]))}"></i>`;
    return `<i class="ci glyph">${c.glyph || '📜'}</i>`;
  }
  send(id) {
    const G = this.g, P = this.P();
    if (G.watch || P.ships < 1 || P.shipment || !cardOk(P, id)) { G.snd.play('nope'); return; }
    G.send({ t: 'card', pid: G.me, card: id }); G.snd.play('click');
  }
  render() {
    const G = this.g, P = this.P(), ro = G.watch || !P.alive;
    const used = {}; for (const c of P.cards) used[c] = (used[c] || 0) + 1;
    const sig = [P.ships, P.shipment && P.shipment.card, P.shipment && Math.ceil(P.shipment.t), P.age, P.cards.length, Math.floor(P.xp / 10), G.me].join();
    if (sig === this.sig) return; this.sig = sig;
    const ship = P.shipment ? `<div class="ship">🚢 Dalam perjalanan: <b>${CARDS[P.shipment.card].name}</b> — tiba dalam ${Math.ceil(P.shipment.t)} detik</div>` : '';
    $('cardsSub').innerHTML = `${ro ? `<b>${P.name}</b> · ` : ''}XP <b>${Math.floor(P.xp)}</b> / ${P.nextXp} · kiriman tersedia: <b class="${P.ships ? 'hl' : ''}">${P.ships}</b> · sudah diterima: ${P.cards.length}${ship}`;
    let h = '';
    for (const age of [1, 2, 3]) {
      h += `<h3>${AGES[age]}${P.age < age ? ' <small>— terkunci</small>' : ''}</h3><div class="deck">`;
      for (const c of Object.values(CARDS).filter(c => c.age === age && (!P.deck || P.deck.includes(c.id)))) {
        const n = used[c.id] || 0, ok = cardOk(P, c.id), can = ok && !ro && P.ships > 0 && !P.shipment;
        const state = P.age < age ? 'locked' : !ok ? 'used' : can ? 'ready' : '';
        h += `<button class="card ${state}" data-c="${c.id}" ${can ? '' : 'disabled'} title="${c.desc}">${this.icon(c)}<b>${c.name}</b><small>${c.desc}</small>`
          + `${c.repeat ? '<em>∞</em>' : ''}${n ? `<u>${c.repeat ? '×' + n : '✔ terkirim'}</u>` : ''}</button>`;
      }
      h += '</div>';
    }
    h += `<p class="hint">${ro ? 'Mode penonton: kartu dipilih otomatis oleh AI.' : 'XP didapat dari mengumpulkan sumber daya, membangun, meneliti, harta karun dan mengalahkan musuh. Setiap kiriman butuh ' + XP.travel + ' detik untuk tiba di Pusat Kota. ∞ = bisa dikirim berulang.'}</p>`;
    const body = $('cardsBody'); body.innerHTML = h;
    body.querySelectorAll('.card').forEach(b => b.onclick = () => this.send(b.dataset.c));
  }
}

// ---------------------------------------------------------------- deck builder (main menu)
// Pick up to DECK_SIZE cards from the whole pool, or start from one of the ready-made decks. Saved in this browser.
const TAG = { eko: 'Ekonomi', mil: 'Militer', def: 'Pertahanan', tek: 'Teknologi', laut: 'Laut' };
export class DeckBuilder {
  constructor(store, iconStyle) {
    this.store = store; this.iconStyle = iconStyle;
    this.deck = store.get('deck', null) || [...DECKS.makmur.cards];
    $('deckClose').onclick = () => this.close();
    $('deckPreset').innerHTML = '<option value="">— dek siap pakai —</option>' + Object.entries(DECKS).map(([k, d]) => `<option value="${k}">${d.name}: ${d.desc}</option>`).join('');
    $('deckPreset').onchange = () => { const d = DECKS[$('deckPreset').value]; if (d) { this.deck = [...d.cards]; this.save(); this.render(); } };
    $('deckClear').onclick = () => { this.deck = []; this.save(); this.render(); };
  }
  open() { $('deckModal').classList.remove('hidden'); this.render(); }
  close() { if (this.deck.length < 8) { $('deckWarn').textContent = 'Dek butuh minimal 8 kartu.'; return; } $('deckModal').classList.add('hidden'); }
  save() { this.store.set('deck', this.deck); }
  summary() { const t = {}; for (const id of this.deck) { const g = CARDS[id] && CARDS[id].tag; t[g] = (t[g] || 0) + 1; } return Object.entries(t).map(([g, n]) => `${TAG[g] || g} ${n}`).join(' · '); }
  render() {
    $('deckCount').textContent = `${this.deck.length} / ${DECK_SIZE} kartu · ${this.summary()}`; $('deckWarn').textContent = '';
    let h = '';
    for (const age of [1, 2, 3]) {
      h += `<h3>${AGES[age]}</h3><div class="deck">`;
      for (const c of Object.values(CARDS).filter(c => c.age === age)) {
        const inD = this.deck.includes(c.id);
        const icon = c.units ? `<i class="ci" style="${this.iconStyle(UNITS[c.units[0][0]].sprite)}"></i>` : c.give ? `<i class="ci" style="${this.iconStyle('res_' + RES.find(r => c.give[r]))}"></i>` : `<i class="ci glyph">${c.glyph || '📜'}</i>`;
        h += `<button class="card ${inD ? 'ready' : 'used'}" data-c="${c.id}" title="${c.desc}">${icon}<b>${c.name}</b><small>${c.desc}</small><em class="tag t-${c.tag}">${TAG[c.tag] || ''}</em>${c.repeat ? '<u>∞</u>' : ''}</button>`;
      }
      h += '</div>';
    }
    const body = $('deckBody'); body.innerHTML = h;
    body.querySelectorAll('.card').forEach(b => b.onclick = () => {
      const id = b.dataset.c, i = this.deck.indexOf(id);
      if (i >= 0) this.deck.splice(i, 1); else if (this.deck.length < DECK_SIZE) this.deck.push(id); else { $('deckWarn').textContent = `Dek penuh (${DECK_SIZE}). Lepas kartu lain dulu.`; return; }
      this.save(); this.render();
    });
  }
}
