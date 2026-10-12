// War statistics: score, live kingdom snapshot, timeline history, first-contact log, and the "Statistik Perang" panel.
// Playing: only your own kingdom in full, plus fog-limited intel on enemies. Watching bot vs bot: every kingdom side by side.
import { UNITS, BUILDINGS, TECHS, RES, RES_NAME, AGES, PLAYER_RGB, CARDS } from './data.js';

const $ = (id) => document.getElementById(id);
const sum = (c) => RES.reduce((s, r) => s + ((c && c[r]) || 0), 0);
const fmt = (n) => Math.round(n).toLocaleString('id-ID');
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const rgb = (P) => `rgb(${PLAYER_RGB[P.color] || [200, 200, 200]})`;
const ARMY = ['militia', 'spearman', 'archer', 'scout', 'knight'];
const JOBS = [['food', 'Makanan', '#d8a04a'], ['wood', 'Kayu', '#8a5a2c'], ['gold', 'Emas', '#e8c840'], ['stone', 'Batu', '#a8a8a0'], ['build', 'Membangun', '#5aa0d8'], ['walk', 'Berjalan', '#7a7a70'], ['idle', 'Menganggur', '#d05040']];
const JOB_OF = { tree: 'wood', gold: 'gold', stone: 'stone', berry: 'food', farm: 'food', carcass: 'food' };

export function exploredPct(W, P) { let n = 0; const e = P.exp; for (let k = 0; k < e.length; k++) n += e[k]; return n / e.length * 100; }
// AoE2-style score: economy (resources gathered), military (value destroyed), technology (research spent), exploration
export function score(W, P, explored = exploredPct(W, P)) {
  const s = P.stats; let tech = (P.age - 1) * 100;
  for (const t of P.techs) tech += sum(TECHS[t].cost) / 10;
  const econ = Math.floor(s.gathered / 10), mil = Math.floor(s.killVal / 10), expl = Math.round(explored * 2);
  return { econ, mil, tech: Math.floor(tech), expl, total: econ + mil + Math.floor(tech) + expl };
}
// what every kingdom has right now (one pass over the dynamic entities)
export function snapshot(W) {
  const out = W.players.map(() => ({ vil: 0, army: {}, armyN: 0, jobs: { food: 0, wood: 0, gold: 0, stone: 0, build: 0, walk: 0, idle: 0 }, bld: {}, bldN: 0, constructing: 0 }));
  for (const e of W.dyn.values()) {
    const o = out[e.owner]; if (!o) continue;
    if (e.kind === 'unit') {
      if (UNITS[e.type].animal) continue;
      if (e.type === 'villager') {
        o.vil++; const q = e.order;
        const job = !q ? 'idle' : q.t === 'gather' ? JOB_OF[q.kind] || 'food' : q.t === 'drop' ? (q.then ? JOB_OF[q.then.kind] || 'food' : (e.carry && e.carry.res) || 'food') : q.t === 'build' ? 'build' : q.t === 'attack' && q.hunt ? 'food' : 'walk';
        o.jobs[job]++;
      } else { o.army[e.type] = (o.army[e.type] || 0) + 1; o.armyN++; }
    } else if (e.kind === 'building') {
      if (!e.built) { o.constructing++; continue; }
      o.bld[e.type] = (o.bld[e.type] || 0) + 1; if (!BUILDINGS[e.type].wall) o.bldN++;
    }
  }
  return out;
}

// timeline samples + who discovered whom (an enemy building seen for the first time)
export class History {
  constructor(W, every = 10) { this.W = W; this.every = every; this.rows = []; this.next = 0; this.found = []; this.fset = new Set(); this.ct = 0; this.onFound = null; }
  tick() {
    const W = this.W;
    if (W.t >= this.ct) { this.ct = W.t + 2; this.contacts(); }
    if (W.t < this.next) return; this.next = W.t + this.every;
    const snap = snapshot(W);
    this.rows.push({ t: W.t, p: W.players.map((P, i) => ({ score: score(W, P).total, pop: P.pop, vil: snap[i].vil, army: snap[i].armyN, gathered: P.stats.gathered, gres: { ...P.stats.gres } })) });
  }
  contacts() {
    const W = this.W, S = W.size, np = W.players.length;
    for (const b of W.dyn.values()) {
      if (b.kind !== 'building' || BUILDINGS[b.type].wall) continue;
      const k = Math.floor(b.y + b.h / 2) * S + Math.floor(b.x + b.w / 2);
      for (let p = 0; p < np; p++) {
        const P = W.players[p]; if (p === b.owner || P.team === W.players[b.owner].team || !P.vis[k] || this.fset.has(p * 8 + b.owner)) continue;
        this.fset.add(p * 8 + b.owner); const f = { by: p, of: b.owner, t: W.t, x: b.x + b.w / 2, y: b.y + b.h / 2 };
        this.found.push(f); if (this.onFound) this.onFound(f);
      }
    }
  }
  foundAt(by, of) { const f = this.found.find(f => f.by === by && f.of === of); return f ? f.t : null; }
  // gather rate per minute over the last `win` game-seconds
  rate(pid, res, win = 60) {
    const W = this.W, now = W.players[pid].stats.gres[res];
    let old = null; for (let i = this.rows.length - 1; i >= 0; i--) { old = this.rows[i]; if (W.t - old.t >= win) break; }
    if (!old || W.t - old.t < 5) return 0;
    return (now - old.p[pid].gres[res]) / (W.t - old.t) * 60;
  }
}

// ---------------------------------------------------------------- panel
const TABS = [['sum', 'Ringkasan'], ['eco', 'Ekonomi'], ['mil', 'Militer'], ['time', 'Linimasa']];
const METRICS = [['score', 'Skor'], ['pop', 'Populasi'], ['army', 'Tentara'], ['vil', 'Penduduk desa'], ['gathered', 'Sumber daya terkumpul']];
const DASH = [[], [7, 4], [2, 3], [9, 3, 2, 3]];     // per seat: second cue besides colour

export class StatsPanel {
  constructor(game, hist) {
    this.g = game; this.h = hist; this.tab = 'sum'; this.metric = 'score'; this.open = false; this.t = 0;
    try { this.tab = localStorage.getItem('ak_statsTab') || 'sum'; } catch { }
    $('statsTabs').innerHTML = TABS.map(([k, n]) => `<button data-t="${k}" class="tb">${n}</button>`).join('');
    $('statsTabs').querySelectorAll('button').forEach(b => b.onclick = () => { this.tab = b.dataset.t; try { localStorage.setItem('ak_statsTab', this.tab); } catch { } this.g.snd.play('click'); this.render(); });
    $('statsClose').onclick = () => this.toggle(false);
    $('btnStats').onclick = () => this.toggle();
  }
  toggle(on = !this.open) {
    this.open = on; $('statsPanel').classList.toggle('hidden', !on); $('btnStats').classList.toggle('on', on);
    if (on && this.g.cards && this.g.cards.open) this.g.cards.toggle(false);     // one overlay at a time
    this.g.snd.play('click'); if (on) this.render();
  }
  update(dt) { if (!this.open) return; this.t -= dt; if (this.t <= 0) { this.t = 0.5; this.render(); } }
  // everyone is shown in full when watching or once the game is over; while playing only your own kingdom (fog of war)
  all() { return this.g.watch || this.g.over; }
  shown() { const W = this.g.W; return this.all() ? W.players : [W.players[this.g.me]]; }
  icon(k) { const n = UNITS[k] ? UNITS[k].name : RES_NAME[k.slice(4)] || ''; return `<i class="si" title="${n}" style="${this.g.hud.iconStyle(k)}"></i>`; }
  render() {
    const G = this.g, W = G.W;
    $('statsTabs').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === this.tab));
    $('statsSub').textContent = `${W.map ? W.map.name + ' · ' : ''}${W.size}×${W.size} · menit ${mmss(W.t)}${this.all() ? ' · semua kerajaan' : ' · kerajaanmu'}`;
    const body = $('statsBody');
    if (this.tab === 'time') { this.renderTimeline(body); return; }
    const ps = this.shown(), snap = snapshot(W), ex = ps.map(P => exploredPct(W, P));
    const head = `<tr><th></th>${ps.map(P => `<th style="color:${rgb(P)}">${P.name}${P.alive ? '' : ' ☠'}</th>`).join('')}</tr>`;
    const row = (label, f, cls = '') => `<tr class="${cls}"><td>${label}</td>${ps.map((P, i) => `<td>${f(P, snap[P.id], i)}</td>`).join('')}</tr>`;
    const best = (vals) => { const m = Math.max(...vals); return (v) => ps.length > 1 && v === m && m > 0 ? ' class="best"' : ''; };
    let h = '';
    if (this.tab === 'sum') {
      const sc = ps.map((P, i) => score(W, P, ex[i])), bS = best(sc.map(s => s.total));
      h += `<table class="st${this.all() ? '' : ' solo'}">` + head
        + `<tr><td>Skor</td>${sc.map(s => `<td${bS(s.total)}><b class="big">${fmt(s.total)}</b><small>Ekonomi ${fmt(s.econ)} · Militer ${fmt(s.mil)} · Teknologi ${fmt(s.tech)} · Jelajah ${fmt(s.expl)}</small></td>`).join('')}</tr>`
        + row('Zaman', P => AGES[P.age])
        + row('Populasi', P => `${P.pop} / ${P.popCap}${P.pop >= P.popCap && P.popCap < 100 ? ' <b class="warn">penuh!</b>' : ''}`)
        + row('Penduduk desa', (P, s) => s.vil + (s.jobs.idle ? ` <b class="warn">(${s.jobs.idle} menganggur)</b>` : ''))
        + row('Tentara', (P, s) => s.armyN)
        + row('Bangunan', (P, s) => s.bldN + (s.constructing ? ` <small>+${s.constructing} dibangun</small>` : ''))
        + row('Persediaan', P => RES.map(r => `<span class="rv">${this.icon('res_' + r)}${fmt(P.res[r])}</span>`).join(''))
        + row('Wilayah dijelajahi', (P, s, i) => `${ex[i].toFixed(0)}%`)
        + row('Harta karun', P => P.stats.treasures)
        + row('Kiriman kerajaan', P => `${P.cards.length} diterima · XP ${fmt(P.xp)}` + (P.cards.length ? '<small>' + P.cards.map(c => CARDS[c].name).join(' · ') + '</small>' : ''))
        + row('Musuh ditemukan', P => this.contactsOf(P))
        + '</table>';
      if (!this.all()) h += this.intel();
    } else if (this.tab === 'eco') {
      h += `<table class="st${this.all() ? '' : ' solo'}">` + head;
      for (const r of RES) {
        const rates = ps.map(P => this.h.rate(P.id, r)), bR = best(rates);
        h += `<tr><td>${this.icon('res_' + r)} ${RES_NAME[r]}</td>${ps.map((P, i) => `<td${bR(rates[i])}><b>${fmt(rates[i])}</b>/menit<small>persediaan ${fmt(P.res[r])} · total ${fmt(P.stats.gres[r])}</small></td>`).join('')}</tr>`;
      }
      h += row('Total terkumpul', P => `<b>${fmt(P.stats.gathered)}</b>`)
        + row('Transaksi pasar', P => P.stats.trades || '—')
        + row('Pekerjaan penduduk', (P, s) => this.jobBar(s))
        + row('Bangunan', (P, s) => Object.entries(s.bld).filter(([t]) => !BUILDINGS[t].wall).sort((a, b) => b[1] - a[1]).map(([t, n]) => `<span class="chip">${BUILDINGS[t].name} ×${n}</span>`).join('') + (s.bld.stone_wall ? `<span class="chip">Tembok ×${s.bld.stone_wall}</span>` : '') || '—')
        + row('Teknologi', P => [...P.techs].filter(t => !TECHS[t].toAge).map(t => `<span class="chip">${TECHS[t].name}</span>`).join('') || '—')
        + '</table>' + `<div class="legend">${JOBS.map(([, n, c]) => `<span><i style="background:${c}"></i>${n}</span>`).join('')}</div>`;
    } else if (this.tab === 'mil') {
      const kd = ps.map(P => P.stats.killed / Math.max(1, P.stats.lost)), bK = best(ps.map(P => P.stats.killed)), bR = best(ps.map(P => P.stats.razed));
      h += `<table class="st${this.all() ? '' : ' solo'}">` + head
        + row('Tentara aktif', (P, s) => ARMY.filter(t => s.army[t]).map(t => `<span class="rv">${this.icon(t)}${s.army[t]}</span>`).join('') || '—')
        + row('Unit dilatih', P => Object.entries(P.stats.tr).map(([t, n]) => `<span class="rv">${this.icon(t)}${n}</span>`).join('') || '—')
        + `<tr><td>Unit musuh dibunuh</td>${ps.map(P => `<td${bK(P.stats.killed)}><b>${P.stats.killed}</b><small>termasuk ${P.stats.vilKilled} penduduk desa</small></td>`).join('')}</tr>`
        + row('Unit hilang', P => P.stats.lost)
        + row('Rasio bunuh/hilang', (P, s, i) => kd[i].toFixed(2))
        + `<tr><td>Bangunan dihancurkan</td>${ps.map(P => `<td${bR(P.stats.razed)}>${P.stats.razed}</td>`).join('')}</tr>`
        + row('Bangunan hilang', P => P.stats.bldLost)
        + row('Nilai dihancurkan', P => fmt(P.stats.killVal))
        + row('Nilai hilang', P => fmt(P.stats.lostVal))
        + '</table>';
      if (!this.all()) h += this.intel();
    }
    if (body.dataset.k !== this.tab) { body.dataset.k = this.tab; body.scrollTop = 0; }
    body.innerHTML = h;
  }
  contactsOf(P) {
    const W = this.g.W, foes = W.players.filter(Q => Q.team !== P.team);
    return foes.map(Q => { const t = this.h.foundAt(P.id, Q.id); return `<span class="chip" style="border-color:${rgb(Q)}">${Q.name}: ${t === null ? '<i>belum</i>' : 'menit ' + mmss(t)}</span>`; }).join('') || '—';
  }
  jobBar(s) {
    const n = Math.max(1, s.vil);
    return `<div class="jobs">${JOBS.map(([k, name, c]) => s.jobs[k] ? `<i style="width:${s.jobs[k] / n * 100}%;background:${c}" title="${name}: ${s.jobs[k]}">${s.jobs[k]}</i>` : '').join('')}</div>`;
  }
  // what we know about the enemies through our own fog of war
  intel() {
    const G = this.g, W = G.W, P = W.players[G.me], S = W.size;
    const foes = W.players.filter(Q => Q.team !== P.team);
    const seen = foes.map(() => ({ bld: 0, army: 0, vil: 0 }));
    for (const e of W.dyn.values()) {
      const i = foes.findIndex(Q => Q.id === e.owner); if (i < 0) continue;
      if (e.kind === 'building') { if (P.exp[Math.floor(e.y + e.h / 2) * S + Math.floor(e.x + e.w / 2)] && !BUILDINGS[e.type].wall) seen[i].bld++; }
      else if (e.kind === 'unit' && P.vis[Math.floor(e.y) * S + Math.floor(e.x)]) e.type === 'villager' ? seen[i].vil++ : seen[i].army++;
    }
    return `<h3>Intel musuh <small>(hanya yang terlihat oleh pasukanmu)</small></h3><table class="st intel"><tr><th>Kerajaan</th><th>Zaman</th><th>Wilayah</th><th>Bangunan diketahui</th><th>Terlihat sekarang</th></tr>`
      + foes.map((Q, i) => { const t = this.h.foundAt(P.id, Q.id);
        return `<tr><td style="color:${rgb(Q)}"><b>${Q.name}</b>${Q.alive ? '' : ' ☠'}</td><td>${AGES[Q.age]}</td><td>${t === null ? '<b class="warn">Belum ditemukan</b> — kirim pengintai!' : 'Ditemukan menit ' + mmss(t)}</td><td>${seen[i].bld}</td><td>${seen[i].army} tentara · ${seen[i].vil} penduduk</td></tr>`; }).join('')
      + '</table>';
  }
  // ---- timeline: one line per kingdom, crosshair + tooltip on hover
  renderTimeline(body) {
    const G = this.g, W = G.W, ps = this.shown();
    if (body.dataset.k !== 'time') {
      body.dataset.k = 'time';
      body.innerHTML = `<div class="metrics">${METRICS.map(([k, n]) => `<button data-m="${k}" class="tb">${n}</button>`).join('')}</div>
        <div class="chartWrap"><canvas id="statsChart"></canvas><div id="statsTip"></div></div><div class="legend" id="statsLegend"></div><div id="statsEvents"></div>`;
      body.querySelectorAll('.metrics button').forEach(b => b.onclick = () => { this.metric = b.dataset.m; this.g.snd.play('click'); this.renderTimeline(body); });
      const cv = $('statsChart');
      cv.onpointermove = (e) => { this.hoverX = e.offsetX; this.drawChart(); };
      cv.onpointerleave = () => { this.hoverX = null; this.drawChart(); };
    }
    body.querySelectorAll('.metrics button').forEach(b => b.classList.toggle('on', b.dataset.m === this.metric));
    $('statsLegend').innerHTML = ps.map(P => `<span><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="${rgb(P)}" stroke-width="2" stroke-dasharray="${DASH[P.id % 4].join(',')}"/></svg>${P.name}</span>`).join('');
    const ev = this.h.found.filter(f => ps.some(P => P.id === f.by));
    $('statsEvents').innerHTML = ev.length ? '<b>Kontak pertama:</b> ' + ev.map(f => `<span class="chip">menit ${mmss(f.t)} — <b style="color:${rgb(W.players[f.by])}">${W.players[f.by].name}</b> menemukan <b style="color:${rgb(W.players[f.of])}">${W.players[f.of].name}</b></span>`).join('') : '<i>Belum ada kerajaan yang menemukan musuhnya.</i>';
    this.drawChart();
  }
  drawChart() {
    const cv = $('statsChart'); if (!cv) return;
    const W = this.g.W, ps = this.shown(), rows = this.h.rows, m = this.metric;
    const dpr = Math.min(2, devicePixelRatio || 1), w = cv.clientWidth, hgt = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, hgt);
    const L = 48, R = 86, T = 10, B = 24, pw = w - L - R, ph = hgt - T - B;
    const val = (row, P) => row.p[P.id] ? row.p[P.id][m] : 0;
    const tMax = Math.max(60, rows.length ? rows[rows.length - 1].t : 60);
    let vMax = 1; for (const row of rows) for (const P of ps) vMax = Math.max(vMax, val(row, P));
    const mag = 10 ** Math.floor(Math.log10(vMax)), stepV = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => vMax / s <= 5) || mag * 10, top = Math.ceil(vMax / stepV) * stepV;
    const X = (t) => L + t / tMax * pw, Y = (v) => T + ph - v / top * ph;
    // recessive grid + axes, text in ink colours
    g.font = '12px Alegreya, Georgia, serif'; g.lineWidth = 1; g.textBaseline = 'middle';
    for (let v = 0; v <= top + 1e-6; v += stepV) { g.strokeStyle = v ? '#ffffff14' : '#ffffff40'; g.beginPath(); g.moveTo(L, Math.round(Y(v)) + 0.5); g.lineTo(L + pw, Math.round(Y(v)) + 0.5); g.stroke(); g.fillStyle = '#c8bca0'; g.textAlign = 'right'; g.fillText(fmt(v), L - 6, Y(v)); }
    const stepT = [60, 120, 300, 600, 900, 1800].find(s => tMax / s <= 8) || 3600;
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (let t = 0; t <= tMax; t += stepT) g.fillText(`${t / 60}m`, X(t), T + ph + 6);
    if (!rows.length) { g.fillStyle = '#c8bca0'; g.textAlign = 'center'; g.fillText('Data linimasa muncul setelah 10 detik permainan.', L + pw / 2, T + ph / 2); return; }
    // lines (2px) with a dash pattern per kingdom, end-of-line name labels
    const ends = [];
    for (const P of ps) {
      g.strokeStyle = rgb(P); g.lineWidth = 2; g.lineJoin = 'round'; g.setLineDash(DASH[P.id % 4]); g.beginPath();
      rows.forEach((row, i) => { const x = X(row.t), y = Y(val(row, P)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.setLineDash([]);
      ends.push({ P, y: Y(val(rows[rows.length - 1], P)) });
    }
    ends.sort((a, b) => a.y - b.y); for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 14);
    g.textAlign = 'left'; g.textBaseline = 'middle';
    for (const e of ends) { g.fillStyle = rgb(e.P); g.fillRect(L + pw + 6, e.y - 1, 8, 2); g.fillStyle = '#f2e6c9'; g.fillText(e.P.name, L + pw + 18, Math.min(T + ph, e.y)); }
    // hover: crosshair + tooltip for the nearest sample
    const tip = $('statsTip');
    if (this.hoverX == null || this.hoverX < L || this.hoverX > L + pw) { tip.style.display = 'none'; return; }
    const tt = (this.hoverX - L) / pw * tMax; let row = rows[0]; for (const r of rows) if (Math.abs(r.t - tt) < Math.abs(row.t - tt)) row = r;
    const x = X(row.t); g.strokeStyle = '#ffffff55'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, T); g.lineTo(Math.round(x) + 0.5, T + ph); g.stroke();
    for (const P of ps) { g.fillStyle = rgb(P); g.strokeStyle = '#241b13'; g.lineWidth = 2; g.beginPath(); g.arc(x, Y(val(row, P)), 4, 0, 6.29); g.fill(); g.stroke(); }
    tip.style.display = 'block'; tip.innerHTML = `<b>Menit ${mmss(row.t)}</b>` + [...ps].sort((a, b) => val(row, b) - val(row, a)).map(P => `<div><i style="background:${rgb(P)}"></i>${P.name}<b>${fmt(val(row, P))}</b></div>`).join('');
    tip.style.left = Math.min(x + 12, w - tip.offsetWidth - 4) + 'px';
  }
}
