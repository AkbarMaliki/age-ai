// Achievements (Prestasi) and a profile rank that grows across games — stored in this browser only.
const KEY = 'ak_profile';
export const RANKS = [[0, 'Petani'], [1500, 'Prajurit'], [4000, 'Kesatria'], [8000, 'Bangsawan'], [14000, 'Adipati'], [22000, 'Raja'], [35000, 'Maharaja']];
// r = summary of the finished game (see Game.summary)
export const ACH = [
  { id: 'first_win', name: 'Kemenangan Pertama', desc: 'Menangkan satu permainan.', ok: r => r.win },
  { id: 'win_hard', name: 'Penakluk Sejati', desc: 'Menang melawan AI Sulit.', ok: r => r.win && r.diff === 'hard' },
  { id: 'win_3', name: 'Raja Diraja', desc: 'Menang melawan 3 lawan sekaligus.', ok: r => r.win && r.players >= 4 },
  { id: 'quick_win', name: 'Serangan Kilat', desc: 'Menang sebelum menit 30.', ok: r => r.win && r.t < 1800 },
  { id: 'underdog', name: 'Bangkit dari Abu', desc: 'Menang setelah kehilangan Pusat Kota.', ok: r => r.win && r.lostTC },
  { id: 'fast_feudal', name: 'Fajar Feodal', desc: 'Capai Zaman Feodal sebelum menit 12.', ok: r => r.feudalAt && r.feudalAt < 720 },
  { id: 'castle_age', name: 'Penguasa Kastil', desc: 'Capai Zaman Kastil.', ok: r => r.age >= 3 },
  { id: 'boom', name: 'Kota Ramai', desc: 'Miliki 50 penduduk desa sekaligus.', ok: r => r.maxVil >= 50 },
  { id: 'builder', name: 'Arsitek Kerajaan', desc: 'Selesaikan 70 bangunan dalam satu permainan.', ok: r => r.built >= 70 },
  { id: 'killer', name: 'Panglima Perang', desc: 'Kalahkan 100 unit musuh dalam satu permainan.', ok: r => r.killed >= 100 },
  { id: 'razer', name: 'Pembakar Kota', desc: 'Hancurkan 30 bangunan musuh.', ok: r => r.razed >= 30 },
  { id: 'treasure', name: 'Pemburu Harta', desc: 'Ambil 4 harta karun.', ok: r => r.treasures >= 4 },
  { id: 'trader', name: 'Saudagar', desc: 'Lakukan 30 transaksi di Pasar.', ok: r => r.trades >= 30 },
  { id: 'cards', name: 'Restu Ibu Kota', desc: 'Terima 15 kiriman kartu.', ok: r => r.cards >= 15 },
  { id: 'gunpowder', name: 'Era Mesiu', desc: 'Teliti Bubuk Mesiu.', ok: r => r.techs.includes('gunpowder') },
  { id: 'specialist', name: 'Pasukan Elit', desc: 'Teliti satu pasukan khusus.', ok: r => r.techs.some(t => t.startsWith('spec_')) },
  { id: 'doctrines', name: 'Ahli Strategi', desc: 'Ambil dua doktrin dalam satu permainan.', ok: r => r.techs.filter(t => t.startsWith('doc_')).length >= 2 },
  { id: 'smith', name: 'Pandai Besi Agung', desc: 'Teliti 6 peningkatan Pandai Besi.', ok: r => r.techs.filter(t => ['forging', 'iron_casting', 'scale_mail', 'chain_mail', 'scale_barding', 'chain_barding', 'fletching', 'bodkin', 'padded_archer'].includes(t)).length >= 6 },
  { id: 'spy', name: 'Mata Elang', desc: 'Kirim mata-mata 3 kali.', ok: r => r.spies >= 3 },
  { id: 'fisher', name: 'Nelayan Ulung', desc: 'Tangkap 1500 makanan dari ikan.', ok: r => r.fished >= 1500 },
  { id: 'admiral', name: 'Laksamana', desc: 'Tenggelamkan 8 kapal musuh.', ok: r => r.shipsSunk >= 8 },
  { id: 'island', name: 'Penakluk Samudra', desc: 'Menang di peta Kepulauan.', ok: r => r.win && r.map === 'kepulauan' },
  { id: 'winter', name: 'Musim Dingin Abadi', desc: 'Menang di Musim Dingin.', ok: r => r.win && r.season === 'salju' },
  { id: 'granary', name: 'Lumbung Penuh', desc: 'Menang tanpa pernah kelaparan (dengan siklus siang-malam).', ok: r => r.win && r.night && r.hungryDays === 0 },
  { id: 'repair', name: 'Tukang Setia', desc: 'Perbaiki 2500 HP bangunan.', ok: r => r.repaired >= 2500 },
];
export function loadProfile() {
  try { return Object.assign({ games: 0, wins: 0, xp: 0, best: 0, ach: {} }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { return { games: 0, wins: 0, xp: 0, best: 0, ach: {} }; }
}
export function rankOf(xp) { let r = RANKS[0]; for (const x of RANKS) if (xp >= x[0]) r = x; const next = RANKS.find(x => x[0] > xp); return { name: r[1], next: next ? next[0] : null, nextName: next ? next[1] : null }; }
// record a finished game: returns { gained, unlocked: [ach], profile }
export function recordGame(r) {
  const p = loadProfile();
  const unlocked = ACH.filter(a => !p.ach[a.id] && a.ok(r));
  for (const a of unlocked) p.ach[a.id] = Date.now();
  const gained = Math.round(r.score / 2 + (r.win ? 500 : 100) + unlocked.length * 250);
  p.games++; if (r.win) p.wins++; p.xp += gained; p.best = Math.max(p.best, r.score);
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { }
  return { gained, unlocked, profile: p };
}
export function achievementsHtml() {
  const p = loadProfile(), rk = rankOf(p.xp);
  const done = ACH.filter(a => p.ach[a.id]).length;
  return `<p class="prof">Gelar: <b>${rk.name}</b> · XP ${p.xp}${rk.next ? ` (menuju <b>${rk.nextName}</b> di ${rk.next})` : ''} · Main ${p.games} · Menang ${p.wins} · Skor terbaik ${p.best}</p>
    <p>Prestasi terbuka: <b>${done} / ${ACH.length}</b></p>
    <div class="achs">${ACH.map(a => `<div class="ach ${p.ach[a.id] ? 'got' : ''}"><b>${p.ach[a.id] ? '🏆' : '🔒'} ${a.name}</b><small>${a.desc}</small></div>`).join('')}</div>`;
}
