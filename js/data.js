// Game data in the spirit of Age of Empires II (Dark -> Feudal -> Castle Age). Times are in game-seconds.
export const RES = ['food', 'wood', 'gold', 'stone', 'iron'];
export const RES_NAME = { food: 'Makanan', wood: 'Kayu', gold: 'Emas', stone: 'Batu', iron: 'Besi' };
export const AGES = ['', 'Zaman Kegelapan', 'Zaman Feodal', 'Zaman Kastil'];
export const START_RES = { food: 200, wood: 200, gold: 100, stone: 200, iron: 0 };
export const POP_LIMIT = 125;
// terrain codes (map tiles). HILL: slower to climb, high ground gives +25% damage and +1 range; ROCK: impassable mountain.
export const TER = { GRASS: 0, DIRT: 1, FOREST: 2, WATER: 3, GRASS2: 4, HILL: 5, ROCK: 6 };

// ma / pa = melee / pierce armour, speed in tiles/s, range in tiles, los in tiles.
// cls drives the counter system: spear/infantry > cavalry > archer > infantry (bonus = extra damage vs a class).
// sprite / tint: specialists reuse a base sprite with a tint (and effects) until they get their own renders.
export const UNITS = {
  villager: { name: 'Penduduk Desa', hp: 25, atk: 3, ma: 0, pa: 0, speed: 0.8, range: 0, reload: 2.0, los: 4, cost: { food: 50 }, time: 25, age: 1, from: 'town_center', key: 'Q', desc: 'Mengumpulkan sumber daya, membangun dan memperbaiki.' },
  militia: { name: 'Milisi', hp: 40, atk: 4, ma: 0, pa: 1, speed: 0.9, range: 0, reload: 2.0, los: 4, cost: { food: 60, gold: 20 }, vsBuilding: 4, time: 21, age: 1, from: 'barracks', key: 'Q', line: 'sword', desc: 'Infanteri pedang serbaguna, kuat merobohkan bangunan.' },
  spearman: { name: 'Prajurit Tombak', hp: 45, atk: 3, ma: 0, pa: 0, speed: 1.0, range: 0, reload: 3.0, los: 4, cost: { food: 35, wood: 25 }, time: 22, age: 2, from: 'barracks', key: 'W', bonus: { cavalry: 15 }, vsBuilding: 2, line: 'spear', desc: 'Murah, penangkal kavaleri.' },
  archer: { name: 'Pemanah', hp: 30, atk: 4, ma: 0, pa: 0, speed: 0.96, range: 4, reload: 2.0, los: 6, acc: 0.8, cost: { wood: 25, gold: 45 }, time: 35, age: 2, from: 'archery_range', key: 'Q', proj: 'arrow', bonus: { infantry: 2 }, line: 'bow', desc: 'Menyerang dari jauh, efektif melawan infanteri.' },
  scout: { name: 'Kavaleri Pengintai', hp: 45, atk: 3, ma: 0, pa: 2, speed: 1.55, range: 0, reload: 2.0, los: 6, cost: { food: 80 }, time: 30, age: 2, from: 'stable', key: 'Q', cls: 'cavalry', bonus: { archer: 2 }, desc: 'Cepat, penglihatan luas.' },
  knight: { name: 'Ksatria', hp: 100, atk: 10, ma: 2, pa: 2, speed: 1.35, range: 0, reload: 1.8, los: 4, cost: { food: 60, gold: 75 }, vsBuilding: 3, time: 30, age: 3, from: 'stable', key: 'W', cls: 'cavalry', bonus: { archer: 4 }, line: 'heavycav', desc: 'Kavaleri berat, penghancur pemanah.' },
  // gunpowder + siege
  gunner: { name: 'Penembak Mesiu', hp: 35, atk: 14, ma: 0, pa: 1, speed: 0.9, range: 5, reload: 3.5, los: 6, acc: 0.6, cost: { food: 50, gold: 50, iron: 25 }, time: 34, age: 3, from: 'archery_range', key: 'W', proj: 'bullet', bonus: { infantry: 6, cavalry: 3 }, needsTech: 'gunpowder', sprite: 'archer', tint: 0x8c8a86, cls: 'archer', desc: 'Senapan api: tembakan berat, menembus zirah.' },
  ram: { name: 'Pendobrak', hp: 175, atk: 2, ma: 0, pa: 40, speed: 0.6, range: 0, reload: 4.0, los: 3, cost: { wood: 160, gold: 75 }, time: 40, age: 3, from: 'barracks', key: 'E', cls: 'siege', vsBuilding: 45, desc: 'Mesin pendobrak gerbang dan bangunan. Kebal panah.' },
  cannon: { name: 'Meriam', hp: 90, atk: 30, ma: 2, pa: 6, speed: 0.55, range: 9, reload: 6.5, los: 9, acc: 0.85, cost: { wood: 200, gold: 150, iron: 80 }, time: 50, age: 3, from: 'academy', key: 'Q', cls: 'siege', proj: 'ball', vsBuilding: 45, splash: 0.9, needsTech: 'gunpowder', desc: 'Meriam mesiu: jangkauan jauh, menghancurkan bangunan.' },
  // ships (move on water only)
  fishing_boat: { name: 'Kapal Nelayan', hp: 60, atk: 0, ma: 0, pa: 4, speed: 1.2, range: 0, reload: 2, los: 5, cost: { wood: 75 }, time: 30, age: 1, from: 'dock', key: 'Q', cls: 'ship', naval: true, fisher: true, desc: 'Menjala ikan di laut dan sungai; setor di Dermaga.' },
  transport_ship: { name: 'Kapal Angkut', hp: 150, atk: 0, ma: 0, pa: 6, speed: 1.4, range: 0, reload: 2, los: 6, cost: { wood: 125 }, time: 35, age: 2, from: 'dock', key: 'W', cls: 'ship', naval: true, capacity: 10, desc: 'Mengangkut 10 unit menyeberangi air.' },
  war_ship: { name: 'Kapal Perang', hp: 160, atk: 6, ma: 1, pa: 5, speed: 1.3, range: 6, reload: 2.5, los: 8, acc: 0.85, cost: { wood: 160, gold: 60 }, time: 40, age: 2, from: 'dock', key: 'E', cls: 'ship', naval: true, capacity: 3, proj: 'arrow', vsBuilding: 4, bonus: { ship: 4 }, desc: 'Kapal tempur pemanah; hanya bisa mengangkut 3 unit.' },
  // specialists (Akademi): replace a whole unit line once researched
  samurai: { name: 'Samurai', hp: 70, atk: 10, ma: 2, pa: 2, speed: 0.95, range: 0, reload: 1.8, los: 5, cost: { food: 60, gold: 45, iron: 20 }, time: 22, age: 3, from: 'barracks', key: 'Q', vsBuilding: 5, bonus: { infantry: 5 }, line: 'sword', sprite: 'militia', tint: 0xff8a80, scale: 1.08, desc: 'Pendekar elit: penghancur infanteri.' },
  ninja: { name: 'Ninja', hp: 45, atk: 8, ma: 0, pa: 2, speed: 1.3, range: 0, reload: 1.4, los: 6, cost: { food: 50, gold: 60, iron: 10 }, time: 22, age: 3, from: 'barracks', key: 'Q', bonus: { villager: 6, archer: 6, siege: 10 }, stealth: true, line: 'sword', sprite: 'militia', tint: 0x55555f, desc: 'Tak terlihat musuh kecuali sangat dekat. Pemburu pemanah, penduduk dan mesin perang.' },
  fire_archer: { name: 'Pemanah Api', hp: 32, atk: 5, ma: 0, pa: 0, speed: 0.96, range: 4, reload: 2.0, los: 6, acc: 0.8, cost: { wood: 30, gold: 50, iron: 10 }, time: 35, age: 3, from: 'archery_range', key: 'Q', proj: 'fire', bonus: { infantry: 2, ship: 6 }, vsBuilding: 8, fire: true, line: 'bow', sprite: 'archer', tint: 0xffb070, desc: 'Panah api: membakar bangunan dan kapal.' },
  crossbow: { name: 'Pemanah Silang', hp: 35, atk: 6, ma: 0, pa: 1, speed: 0.96, range: 5, reload: 2.0, los: 7, acc: 0.92, cost: { wood: 30, gold: 50, iron: 10 }, time: 30, age: 3, from: 'archery_range', key: 'Q', proj: 'arrow', bonus: { infantry: 3 }, line: 'bow', sprite: 'archer', tint: 0xc2d2e6, desc: 'Busur silang: jangkauan dan ketepatan tinggi.' },
  cataphract: { name: 'Katafrak', hp: 130, atk: 10, ma: 4, pa: 4, speed: 1.2, range: 0, reload: 1.8, los: 4, cost: { food: 70, gold: 80, iron: 30 }, time: 32, age: 3, from: 'stable', key: 'W', vsBuilding: 3, cls: 'cavalry', bonus: { archer: 4, infantry: 3 }, line: 'heavycav', sprite: 'knight', tint: 0x9aa6b8, desc: 'Kavaleri berzirah tebal, sulit ditombak.' },
  lancer: { name: 'Lancer', hp: 100, atk: 14, ma: 2, pa: 2, speed: 1.45, range: 0, reload: 1.8, los: 4, cost: { food: 70, gold: 80, iron: 15 }, time: 30, age: 3, from: 'stable', key: 'W', vsBuilding: 3, cls: 'cavalry', bonus: { archer: 5 }, charge: 12, line: 'heavycav', sprite: 'knight', tint: 0xffe4a0, desc: 'Tombak berkuda: serangan pertama sangat keras.' },
};
// Gaia (nature): animals and bandits. animal: herd = sheep (convertible), flee = deer, fight = boar (strikes back),
// predator = wolf (hunts villagers), guard = bear/bandit (protects a treasure). food = meat left on the carcass.
Object.assign(UNITS, {
  sheep: { name: 'Domba', hp: 7, atk: 0, ma: 0, pa: 0, speed: 0.7, range: 0, reload: 2, los: 3, animal: 'herd', food: 100, cls: 'animal', desc: 'Bisa digiring. Sembelih untuk 100 makanan.' },
  deer: { name: 'Rusa', hp: 5, atk: 0, ma: 0, pa: 0, speed: 1.35, range: 0, reload: 2, los: 4, animal: 'flee', food: 140, cls: 'animal', desc: 'Lari saat didekati. Buru untuk 140 makanan.' },
  boar: { name: 'Babi Hutan', hp: 75, atk: 7, ma: 0, pa: 1, speed: 0.95, range: 0, reload: 2.0, los: 4, animal: 'fight', food: 340, cls: 'animal', desc: 'Melawan balik! Buru bersama-sama untuk 340 makanan.' },
  wolf: { name: 'Serigala', hp: 25, atk: 3, ma: 0, pa: 0, speed: 1.2, range: 0, reload: 1.5, los: 6, animal: 'predator', cls: 'animal', desc: 'Pemangsa. Menyerang penduduk desa.' },
  bear: { name: 'Beruang', hp: 140, atk: 8, ma: 1, pa: 2, speed: 1.0, range: 0, reload: 2.0, los: 5, animal: 'guard', food: 250, cls: 'animal', desc: 'Penjaga harta karun yang buas.' },
  bandit: { name: 'Bandit', hp: 55, atk: 6, ma: 1, pa: 1, speed: 0.9, range: 0, reload: 2.0, los: 5, guard: true, cls: 'infantry', desc: 'Perampok yang menjaga harta jarahan.' },
});
for (const [k, u] of Object.entries(UNITS)) { u.id = k; u.cls = u.cls || (k === 'villager' ? 'villager' : u.range ? 'archer' : 'infantry'); u.sprite = u.sprite || k; }
export const MILITARY = (t) => { const u = UNITS[t]; return !!u && !u.animal && t !== 'villager' && !u.fisher && t !== 'transport_ship'; };
export const GAIA = -1;   // owner id of nature / bandits
export const TREASURES = {
  gold: { name: 'Peti Emas', res: 'gold', amount: [150, 300] }, food: { name: 'Gerobak Makanan', res: 'food', amount: [200, 350] },
  wood: { name: 'Tumpukan Kayu', res: 'wood', amount: [200, 300] }, stone: { name: 'Tumpukan Batu', res: 'stone', amount: [150, 250] },
};

// n = footprint (tiles). drop = resources accepted. block=false lets units walk over it (farms). water = built on water.
export const BUILDINGS = {
  town_center: { name: 'Pusat Kota', n: 4, hp: 2400, ma: 3, pa: 5, cost: { wood: 275, stone: 100 }, time: 150, age: 1, pop: 5, los: 8, drop: ['food', 'wood', 'gold', 'stone', 'iron'], trains: ['villager'], techs: ['loom', 'wheelbarrow', 'torches', 'feudal', 'castle'], attack: { atk: 5, range: 6, reload: 2.0 }, key: 'Q', page: 0 },
  house: { name: 'Rumah', n: 2, hp: 550, ma: 0, pa: 7, cost: { wood: 25 }, time: 25, age: 1, pop: 5, los: 2 },
  mill: { name: 'Penggilingan', n: 2, hp: 600, ma: 0, pa: 7, cost: { wood: 100 }, time: 35, age: 1, los: 6, drop: ['food'], techs: ['horse_collar', 'granary'] },
  lumber_camp: { name: 'Kamp Penebang', n: 2, hp: 600, ma: 0, pa: 7, cost: { wood: 100 }, time: 35, age: 1, los: 6, drop: ['wood'], techs: ['double_bit_axe'] },
  mining_camp: { name: 'Kamp Tambang', n: 2, hp: 600, ma: 0, pa: 7, cost: { wood: 100 }, time: 35, age: 1, los: 6, drop: ['gold', 'stone', 'iron'], techs: ['gold_mining', 'iron_smelting'] },
  farm: { name: 'Ladang', n: 3, hp: 480, ma: 0, pa: 0, cost: { wood: 60 }, time: 15, age: 1, los: 1, block: false, food: 175, needs: ['mill'] },
  dock: { name: 'Dermaga', n: 3, hp: 1800, ma: 0, pa: 7, cost: { wood: 150 }, time: 35, age: 1, los: 7, water: true, drop: ['food'], trains: ['fishing_boat', 'transport_ship', 'war_ship'], techs: ['gillnets', 'careening'] },
  barracks: { name: 'Barak', n: 3, hp: 1200, ma: 0, pa: 7, cost: { wood: 175 }, time: 50, age: 1, los: 6, trains: ['militia', 'spearman', 'ram'] },
  archery_range: { name: 'Lapangan Panahan', n: 3, hp: 1500, ma: 0, pa: 7, cost: { wood: 175 }, time: 50, age: 2, los: 6, trains: ['archer', 'gunner'], needs: ['barracks'] },
  stable: { name: 'Istal', n: 3, hp: 1500, ma: 0, pa: 7, cost: { wood: 175 }, time: 50, age: 2, los: 6, trains: ['scout', 'knight'], needs: ['barracks'] },
  blacksmith: { name: 'Pandai Besi', n: 3, hp: 1800, ma: 1, pa: 7, cost: { wood: 150 }, time: 40, age: 2, los: 6, needs: ['barracks'], techs: ['forging', 'iron_casting', 'scale_mail', 'chain_mail', 'scale_barding', 'chain_barding', 'fletching', 'bodkin', 'padded_archer', 'doc_legion', 'doc_cavalry', 'doc_archers'] },
  academy: { name: 'Akademi', n: 4, hp: 2100, ma: 1, pa: 8, cost: { wood: 225, stone: 75 }, time: 60, age: 2, los: 7, needs: ['blacksmith'], trains: ['cannon'], techs: ['spy_network', 'masonry', 'ballistics', 'gunpowder', 'spec_samurai', 'spec_ninja', 'spec_fire', 'spec_crossbow', 'spec_cataphract', 'spec_lancer', 'doc_fortress', 'doc_blitz', 'doc_formation'], ability: 'spy' },
  market: { name: 'Pasar', n: 4, hp: 2100, ma: 0, pa: 7, cost: { wood: 175 }, time: 60, age: 2, los: 6, needs: ['mill'], market: true, techs: ['guilds', 'trade_route'] },
  watch_tower: { name: 'Menara Jaga', n: 1, hp: 1020, ma: 1, pa: 7, cost: { wood: 25, stone: 125 }, time: 80, age: 2, los: 10, attack: { atk: 5, range: 8, reload: 2.0 } },
  stone_wall: { name: 'Tembok Batu', n: 1, hp: 1800, ma: 8, pa: 10, cost: { stone: 5 }, time: 8, age: 2, los: 2, wall: true },
  gate: { name: 'Gerbang', n: 1, len: 3, hp: 2750, ma: 6, pa: 6, cost: { stone: 30 }, time: 70, age: 2, los: 4, gate: true },
  castle: { name: 'Kastil', n: 4, hp: 4800, ma: 8, pa: 11, cost: { stone: 650 }, time: 200, age: 3, pop: 20, los: 11, trains: ['knight'], techs: ['conscription'], attack: { atk: 11, range: 8, reload: 2.0, arrows: 3 } },
};
for (const [k, b] of Object.entries(BUILDINGS)) { b.id = k; if (b.block === undefined) b.block = true; }

// group = mutually exclusive choice (only one of the group per player). spec = turns a unit line into a specialist.
export const TECHS = {
  feudal: { name: 'Maju ke Zaman Feodal', cost: { food: 500 }, time: 130, age: 1, at: 'town_center', toAge: 2, key: 'E', reqCount: 2, reqFrom: ['mill', 'lumber_camp', 'mining_camp', 'barracks', 'dock'] },
  castle: { name: 'Maju ke Zaman Kastil', cost: { food: 800, gold: 200 }, time: 160, age: 2, at: 'town_center', toAge: 3, key: 'E', reqCount: 2, reqFrom: ['archery_range', 'stable', 'watch_tower', 'blacksmith', 'market', 'academy'] },
  loom: { name: 'Tenun', cost: { gold: 50 }, time: 25, age: 1, at: 'town_center', key: 'R', desc: 'Penduduk desa +15 HP, +1/+2 zirah.' },
  wheelbarrow: { name: 'Gerobak Dorong', cost: { food: 175, wood: 50 }, time: 75, age: 2, at: 'town_center', key: 'T', desc: 'Penduduk desa +10% kecepatan, +3 muatan.' },
  torches: { name: 'Obor Kerja', cost: { food: 150, wood: 100 }, time: 45, age: 2, at: 'town_center', key: 'W', desc: 'Lembur: penduduk desa tetap bekerja dengan obor sampai tengah malam (70% kecepatan), lalu pulang tidur.' },
  double_bit_axe: { name: 'Kapak Bermata Dua', cost: { food: 100, wood: 50 }, time: 25, age: 2, at: 'lumber_camp', key: 'Q', desc: 'Menebang kayu +20%.' },
  gold_mining: { name: 'Penambangan Emas', cost: { food: 100, wood: 75 }, time: 30, age: 2, at: 'mining_camp', key: 'Q', desc: 'Menambang emas +15%.' },
  iron_smelting: { name: 'Peleburan Besi', cost: { food: 150, wood: 100 }, time: 35, age: 2, at: 'mining_camp', key: 'W', desc: 'Menambang besi +20%.' },
  horse_collar: { name: 'Kalung Kuda', cost: { food: 75, wood: 75 }, time: 20, age: 2, at: 'mill', key: 'Q', desc: 'Ladang +75 makanan.' },
  granary: { name: 'Lumbung', cost: { food: 100, wood: 150 }, time: 30, age: 2, at: 'mill', key: 'W', desc: 'Jatah makan harian rakyat berkurang 40%.' },
  gillnets: { name: 'Jala Insang', cost: { food: 150, wood: 150 }, time: 40, age: 2, at: 'dock', key: 'R', desc: 'Menangkap ikan +25%.' },
  careening: { name: 'Lambung Kapal', cost: { food: 200, gold: 100 }, time: 40, age: 2, at: 'dock', key: 'T', desc: 'Kapal +1 zirah panah; Kapal Angkut memuat +5 unit.' },
  guilds: { name: 'Serikat Dagang', cost: { food: 300, gold: 100 }, time: 50, age: 2, at: 'market', key: 'R', desc: 'Komisi jual-beli di Pasar turun dari 30% menjadi 15%.' },
  trade_route: { name: 'Rute Dagang', cost: { food: 200, wood: 200 }, time: 60, age: 3, at: 'market', key: 'T', desc: 'Pedagang singgah: setiap Pasar menghasilkan 24 emas per menit.' },
  conscription: { name: 'Wajib Militer', cost: { food: 400, gold: 200 }, time: 60, age: 3, at: 'castle', key: 'E', desc: 'Semua tentara dilatih 33% lebih cepat.' },
  // ---- Blacksmith: three upgrade lines + the first, exclusive doctrine
  forging: { name: 'Tempa Besi', cost: { food: 150 }, time: 40, age: 2, at: 'blacksmith', key: 'Q', desc: 'Infanteri dan kavaleri +1 serangan.' },
  iron_casting: { name: 'Cor Besi', cost: { food: 220, iron: 100 }, time: 55, age: 3, at: 'blacksmith', key: 'Q', after: 'forging', desc: 'Infanteri dan kavaleri +1 serangan lagi.' },
  scale_mail: { name: 'Zirah Sisik', cost: { food: 100 }, time: 40, age: 2, at: 'blacksmith', key: 'W', desc: 'Infanteri +1/+1 zirah.' },
  chain_mail: { name: 'Zirah Rantai', cost: { food: 200, iron: 100 }, time: 55, age: 3, at: 'blacksmith', key: 'W', after: 'scale_mail', desc: 'Infanteri +1/+2 zirah lagi.' },
  scale_barding: { name: 'Zirah Kuda', cost: { food: 150 }, time: 45, age: 2, at: 'blacksmith', key: 'E', desc: 'Kavaleri +1/+1 zirah.' },
  chain_barding: { name: 'Zirah Rantai Kuda', cost: { food: 250, iron: 120 }, time: 60, age: 3, at: 'blacksmith', key: 'E', after: 'scale_barding', desc: 'Kavaleri +1/+2 zirah lagi.' },
  fletching: { name: 'Bulu Anak Panah', cost: { food: 100, wood: 50 }, time: 30, age: 2, at: 'blacksmith', key: 'R', desc: 'Pemanah, menara dan Pusat Kota +1 serangan, +1 jangkauan.' },
  bodkin: { name: 'Mata Panah Baja', cost: { food: 200, wood: 100, iron: 60 }, time: 50, age: 3, at: 'blacksmith', key: 'R', after: 'fletching', desc: 'Pemanah, menara dan Pusat Kota +1 serangan, +1 jangkauan lagi.' },
  padded_archer: { name: 'Rompi Pemanah', cost: { food: 100 }, time: 35, age: 2, at: 'blacksmith', key: 'T', desc: 'Pemanah +1/+1 zirah.' },
  doc_legion: { name: 'Doktrin: Legiun Baja', cost: { food: 200, gold: 100 }, time: 60, age: 2, at: 'blacksmith', key: 'A', group: 'doc1', glyph: '🛡', desc: 'Jalur INFANTERI. Infanteri +20% HP, +1 zirah dekat, dilatih 25% lebih cepat; tombak +5 vs kavaleri. Kuat melawan kavaleri, lemah melawan pemanah.' },
  doc_cavalry: { name: 'Doktrin: Kavaleri Bangsawan', cost: { food: 200, gold: 100 }, time: 60, age: 2, at: 'blacksmith', key: 'S', group: 'doc1', glyph: '🐎', desc: 'Jalur KAVALERI. Kavaleri +2 serangan, +15% HP, +10% kecepatan. Kuat melawan pemanah, lemah melawan tombak.' },
  doc_archers: { name: 'Doktrin: Hujan Panah', cost: { food: 200, gold: 100 }, time: 60, age: 2, at: 'blacksmith', key: 'D', group: 'doc1', glyph: '🏹', desc: 'Jalur PEMANAH. Pemanah +1 jangkauan, +15% ketepatan, +1 vs infanteri, dilatih 25% lebih cepat. Kuat melawan infanteri, lemah melawan kavaleri.' },
  // ---- Akademi: research, specialists (one per line), gunpowder, intelligence and the second doctrine
  spy_network: { name: 'Jaringan Mata-mata', cost: { food: 150, gold: 150 }, time: 45, age: 2, at: 'academy', key: 'Q', desc: 'Membuka kemampuan Akademi "Kirim Mata-mata": membuka posisi musuh 30 detik dan memberi laporan + saran strategi. Jeda 2 menit.' },
  masonry: { name: 'Pertukangan Batu', cost: { food: 150, stone: 150 }, time: 50, age: 2, at: 'academy', key: 'W', desc: 'Semua bangunan +15% HP dan +1/+1 zirah.' },
  ballistics: { name: 'Balistik', cost: { food: 250, gold: 150 }, time: 60, age: 3, at: 'academy', key: 'E', desc: 'Pemanah, penembak, kapal dan menara lebih tepat (+12% ketepatan).' },
  gunpowder: { name: 'Bubuk Mesiu', cost: { food: 400, gold: 300, iron: 200 }, time: 90, age: 3, at: 'academy', key: 'R', glyph: '💥', desc: 'Membuka Penembak Mesiu (Lapangan Panahan) dan Meriam (Akademi). Menara, Kastil dan Pusat Kota +2 serangan.' },
  spec_samurai: { name: 'Spesialis: Samurai', cost: { food: 300, gold: 200, iron: 100 }, time: 60, age: 3, at: 'academy', key: 'A', group: 'spec_sword', spec: ['militia', 'samurai'], desc: 'Milisi menjadi Samurai: pendekar elit penghancur infanteri.' },
  spec_ninja: { name: 'Spesialis: Ninja', cost: { food: 250, gold: 250, iron: 50 }, time: 60, age: 3, at: 'academy', key: 'S', group: 'spec_sword', spec: ['militia', 'ninja'], desc: 'Milisi menjadi Ninja: tak terlihat, pemburu pemanah dan penduduk.' },
  spec_fire: { name: 'Spesialis: Pemanah Api', cost: { food: 250, wood: 200, iron: 50 }, time: 60, age: 3, at: 'academy', key: 'D', group: 'spec_bow', spec: ['archer', 'fire_archer'], desc: 'Pemanah menjadi Pemanah Api: membakar bangunan dan kapal.' },
  spec_crossbow: { name: 'Spesialis: Pemanah Silang', cost: { food: 250, gold: 150, iron: 50 }, time: 60, age: 3, at: 'academy', key: 'F', group: 'spec_bow', spec: ['archer', 'crossbow'], desc: 'Pemanah menjadi Pemanah Silang: jangkauan dan ketepatan tinggi.' },
  spec_cataphract: { name: 'Spesialis: Katafrak', cost: { food: 300, gold: 250, iron: 100 }, time: 70, age: 3, at: 'academy', key: 'G', group: 'spec_cav', spec: ['knight', 'cataphract'], desc: 'Ksatria menjadi Katafrak: berzirah tebal, tahan tombak.' },
  spec_lancer: { name: 'Spesialis: Lancer', cost: { food: 300, gold: 250, iron: 60 }, time: 70, age: 3, at: 'academy', key: 'T', group: 'spec_cav', spec: ['knight', 'lancer'], desc: 'Ksatria menjadi Lancer: cepat, serangan pertama mematikan.' },
  doc_fortress: { name: 'Doktrin: Benteng Besi', cost: { food: 300, stone: 200 }, time: 70, age: 3, at: 'academy', key: 'Z', group: 'doc2', glyph: '🏰', desc: 'Jalur BERTAHAN. Bangunan +25% HP, menara/Kastil/Pusat Kota +2 serangan +1 jangkauan, penduduk desa +1/+1.' },
  doc_blitz: { name: 'Doktrin: Serangan Kilat', cost: { food: 300, gold: 200 }, time: 70, age: 3, at: 'academy', key: 'X', group: 'doc2', glyph: '⚡', desc: 'Jalur MENYERBU. Semua tentara +12% kecepatan, +4 vs bangunan; mesin perang +20% serangan.' },
  doc_formation: { name: 'Doktrin: Taktik Formasi', cost: { food: 300, gold: 150 }, time: 70, age: 3, at: 'academy', key: 'C', group: 'doc2', glyph: '⚔', desc: 'Jalur TAKTIK. Bonus formasi berlipat dua, infanteri +1 zirah panah, pemanah +1/+1.' },
};
for (const [k, t] of Object.entries(TECHS)) t.id = k;
// line -> specialist tech group (for UI / AI)
export const SPEC_OF = Object.fromEntries(Object.values(TECHS).filter(t => t.spec).map(t => [t.id, t.spec]));

// formations: how a group lines up and what it gains
export const FORMATIONS = {
  garis: { name: 'Garis', glyph: '〰', desc: 'Barisan lebar biasa. Tanpa bonus.' },
  tempur: { name: 'Tempur', glyph: '🛡', desc: 'Infanteri & kavaleri di depan sebagai perisai, pemanah dan mesin perang di belakang. Pemanah yang terlindung +2 zirah panah, barisan depan +1 zirah dekat.' },
  kotak: { name: 'Kotak', glyph: '▣', desc: 'Blok rapat. +1/+1 zirah dan +3 vs kavaleri, tapi 15% lebih lambat.' },
  menyebar: { name: 'Menyebar', glyph: '✳', desc: 'Jarak lebar: panah dan meriam musuh 35% lebih sering meleset, tapi -1 zirah dekat.' },
};

export const RESOURCES = {
  tree: { res: 'wood', amount: 100, block: true },
  gold: { res: 'gold', amount: 800, block: true },
  stone: { res: 'stone', amount: 350, block: true },
  iron: { res: 'iron', amount: 600, block: true },
  berry: { res: 'food', amount: 125, block: true },
  fish: { res: 'food', amount: 250, block: true, water: true },
  carcass: { res: 'food', amount: 100, block: false },
};
// Market (AoE2): buy / sell 100 of a resource for gold. Prices are shared by everyone; each trade moves the price,
// and prices drift back towards the base price over time.
export const MARKET = { lot: 100, base: { food: 100, wood: 100, stone: 130, iron: 150 }, step: 4, fee: 0.3, feeGuilds: 0.15, min: 20, max: 1000, drift: 1 / 15, tradeGold: 0.4 };

// day / night: a day lasts `len` game-s, the last `night` share of it is night. Each dawn every citizen eats `upkeep`
// food; when the granary runs dry the kingdom goes hungry for a day (slower work). Night: shorter sight, villagers rest.
export const DAY = { len: 420, night: 0.24, upkeep: 2, hungry: 0.75, nightLos: 0.65 };
// seasons change the look and some rules for the whole game; weather comes and goes
export const SEASONS = {
  semi: { name: 'Musim Semi', desc: 'Hijau dan subur. Ladang +10%.', farm: 1.1 },
  kemarau: { name: 'Musim Kemarau', desc: 'Panas dan kering. Buah beri lebih sedikit, jarak pandang luas.', berry: 0.75, los: 1 },
  gugur: { name: 'Musim Gugur', desc: 'Daun berguguran. Berburu +15%, sering hujan.', hunt: 1.15, rain: 0.35 },
  salju: { name: 'Musim Dingin', desc: 'Bersalju: semua unit 10% lebih lambat, ladang -25%, sungai dan danau membeku sehingga bisa diseberangi!', speed: 0.9, farm: 0.75, frozen: true, snow: true },
};
export const SEASON_KEYS = Object.keys(SEASONS);

// Home City shipments (AoE3): experience from gathering, building, research, treasures and combat earns shipments;
// each one sends one card from the deck to the Town Center. units = [[type, n]], give = resources, mod = lasting bonus,
// reveal = map knowledge. tag = deck category (eko / mil / def / tek / laut).
export const XP = { gather: 0.4, build: 0.4, tech: 0.4, kill: 0.5, treasure: 1, first: 250, step: 100, travel: 35 };
export const DECK_SIZE = 20;
export const CARDS = {
  // Dark Age
  vil3: { name: '3 Penduduk Desa', age: 1, tag: 'eko', units: [['villager', 3]], desc: 'Tiga penduduk desa tiba di Pusat Kota.' },
  food300: { name: '300 Makanan', age: 1, tag: 'eko', give: { food: 300 }, repeat: true },
  wood300: { name: '300 Kayu', age: 1, tag: 'eko', give: { wood: 300 }, repeat: true },
  gold200: { name: '200 Emas', age: 1, tag: 'eko', give: { gold: 200 }, repeat: true },
  stone200: { name: '200 Batu', age: 1, tag: 'def', give: { stone: 200 }, repeat: true },
  sheep6: { name: 'Kawanan Domba', age: 1, tag: 'eko', units: [['sheep', 6]], desc: 'Enam domba gemuk (600 makanan) dikirim ke kotamu.' },
  axe: { name: 'Kapak Baja', age: 1, tag: 'eko', mod: { gather: { wood: 0.15 } }, glyph: '🪓', desc: 'Penduduk desa menebang kayu 15% lebih cepat.' },
  baskets: { name: 'Keranjang Anyam', age: 1, tag: 'eko', mod: { gather: { food: 0.1 } }, glyph: '🧺', desc: 'Mengumpulkan makanan 10% lebih cepat.' },
  boots: { name: 'Sepatu Kulit', age: 1, tag: 'eko', mod: { vilSpeed: 0.1 }, glyph: '👢', desc: 'Penduduk desa berjalan 10% lebih cepat.' },
  scouts2: { name: '2 Kavaleri Pengintai', age: 1, tag: 'mil', units: [['scout', 2]], desc: 'Dua pengintai berkuda untuk menjelajah dan mengganggu.' },
  militia4: { name: '4 Milisi', age: 1, tag: 'mil', units: [['militia', 4]], repeat: true, desc: 'Empat milisi untuk serangan dini atau bertahan.' },
  nets: { name: 'Jala Nelayan', age: 1, tag: 'laut', mod: { fish: 0.25 }, glyph: '🎣', desc: 'Menangkap ikan 25% lebih cepat (dari tepi maupun kapal).' },
  fishboats2: { name: '2 Kapal Nelayan', age: 1, tag: 'laut', units: [['fishing_boat', 2]], desc: 'Dua kapal nelayan muncul di dekat dermagamu (atau Pusat Kota bila tak ada).' },
  torchlight: { name: 'Obor Malam', age: 1, tag: 'eko', mod: { nightWork: 1 }, glyph: '🔥', desc: 'Lembur: penduduk desa bekerja dengan obor sampai tengah malam.' },
  granary: { name: 'Lumbung Kerajaan', age: 1, tag: 'eko', mod: { upkeep: -0.5 }, glyph: '🏚', desc: 'Jatah makan harian rakyat berkurang 50%.' },
  builders: { name: 'Bahan Bangunan', age: 1, tag: 'def', mod: { buildSpeed: 0.3 }, glyph: '🔨', desc: 'Penduduk desa membangun 30% lebih cepat.' },
  // Feudal Age
  vil5: { name: '5 Penduduk Desa', age: 2, tag: 'eko', units: [['villager', 5]], desc: 'Lima penduduk desa tiba di Pusat Kota.' },
  food700: { name: '700 Makanan', age: 2, tag: 'eko', give: { food: 700 }, repeat: true },
  wood600: { name: '600 Kayu', age: 2, tag: 'eko', give: { wood: 600 }, repeat: true },
  gold500: { name: '500 Emas', age: 2, tag: 'eko', give: { gold: 500 }, repeat: true },
  stone400: { name: '400 Batu', age: 2, tag: 'def', give: { stone: 400 }, repeat: true },
  iron300: { name: '300 Besi', age: 2, tag: 'tek', give: { iron: 300 }, repeat: true },
  spear5: { name: '5 Prajurit Tombak', age: 2, tag: 'mil', units: [['spearman', 5]], repeat: true, desc: 'Lima prajurit tombak siap bertempur.' },
  archer4: { name: '4 Pemanah', age: 2, tag: 'mil', units: [['archer', 4]], repeat: true, desc: 'Empat pemanah siap bertempur.' },
  miners: { name: 'Penambang Ahli', age: 2, tag: 'eko', mod: { gather: { gold: 0.15, stone: 0.15, iron: 0.15 } }, glyph: '⛏', desc: 'Menambang emas, batu dan besi 15% lebih cepat.' },
  armor: { name: 'Zirah Tempaan', age: 2, tag: 'mil', mod: { ma: 1, pa: 1 }, glyph: '🛡', desc: 'Semua tentara mendapat +1 zirah jarak dekat dan +1 zirah jarak jauh.' },
  merchants: { name: 'Pedagang Ulung', age: 2, tag: 'eko', mod: { fee: -0.1 }, glyph: '⚖', desc: 'Komisi Pasar berkurang 10%.' },
  masons: { name: 'Tukang Batu Ahli', age: 2, tag: 'def', mod: { bldHp: 0.2, repair: 0.5 }, glyph: '🧱', desc: 'Bangunan +20% HP; perbaikan 50% lebih cepat.' },
  stonecutters: { name: 'Pemahat Batu', age: 2, tag: 'def', mod: { gather: { stone: 0.25 }, wallCost: -0.5 }, glyph: '🪨', desc: 'Menambang batu +25%, tembok dan gerbang 50% lebih murah.' },
  drill: { name: 'Latihan Baris-Berbaris', age: 2, tag: 'mil', mod: { infHp: 0.15 }, glyph: '🥁', desc: 'Infanteri +15% HP.' },
  farriers: { name: 'Tukang Ladam', age: 2, tag: 'mil', mod: { cavSpeed: 0.1 }, glyph: '🧲', desc: 'Kavaleri 10% lebih cepat.' },
  arrowsmith: { name: 'Pandai Panah', age: 2, tag: 'mil', mod: { archAtk: 1 }, glyph: '🎯', desc: 'Pemanah +1 serangan.' },
  rations: { name: 'Ransum Prajurit', age: 2, tag: 'mil', mod: { trainSpeed: 0.2 }, glyph: '🍖', desc: 'Semua tentara dilatih 20% lebih cepat.' },
  survey: { name: 'Juru Peta', age: 2, tag: 'tek', reveal: 'map', glyph: '🗺', desc: 'Seluruh medan peta tergambar (tanpa melihat unit musuh).' },
  spies: { name: 'Mata-mata Istana', age: 2, tag: 'tek', reveal: 'enemy', glyph: '👁', desc: 'Lokasi kota-kota musuh terungkap.' },
  warships2: { name: '2 Kapal Perang', age: 2, tag: 'laut', units: [['war_ship', 2]], repeat: true, desc: 'Dua kapal perang muncul di dekat dermagamu.' },
  transport1: { name: 'Kapal Angkut', age: 2, tag: 'laut', units: [['transport_ship', 1]], desc: 'Satu kapal angkut untuk menyeberangkan pasukan.' },
  // Castle Age
  knight3: { name: '3 Ksatria', age: 3, tag: 'mil', units: [['knight', 3]], repeat: true, desc: 'Tiga ksatria berkuda dari ibu kota.' },
  gunners4: { name: '4 Penembak Mesiu', age: 3, tag: 'mil', units: [['gunner', 4]], repeat: true, desc: 'Empat penembak bersenapan api.' },
  ram2: { name: '2 Pendobrak', age: 3, tag: 'mil', units: [['ram', 2]], repeat: true, desc: 'Dua pendobrak untuk merobohkan benteng musuh.' },
  cannon1: { name: 'Meriam Kerajaan', age: 3, tag: 'tek', units: [['cannon', 1]], desc: 'Satu meriam mesiu langsung dari ibu kota.' },
  food1000: { name: '1000 Makanan', age: 3, tag: 'eko', give: { food: 1000 }, repeat: true },
  wood1000: { name: '1000 Kayu', age: 3, tag: 'eko', give: { wood: 1000 }, repeat: true },
  gold1000: { name: '1000 Emas', age: 3, tag: 'eko', give: { gold: 1000 }, repeat: true },
  iron600: { name: '600 Besi', age: 3, tag: 'tek', give: { iron: 600 }, repeat: true },
  plough: { name: 'Bajak Besi', age: 3, tag: 'eko', mod: { gather: { food: 0.2 } }, glyph: '🌾', desc: 'Mengumpulkan makanan 20% lebih cepat.' },
  fortify: { name: 'Benteng Diperkuat', age: 3, tag: 'def', mod: { towerAtk: 2, bldHp: 0.15 }, glyph: '🏯', desc: 'Menara, Kastil dan Pusat Kota +2 serangan; bangunan +15% HP.' },
  royal_guard: { name: 'Pengawal Kerajaan', age: 3, tag: 'mil', mod: { milHp: 0.1 }, glyph: '👑', desc: 'Semua tentara +10% HP.' },
  treasury: { name: 'Armada Dagang', age: 3, tag: 'eko', mod: { trickle: 0.6 }, glyph: '💰', desc: 'Pemasukan emas tetap 36 per menit.' },
  alchemy: { name: 'Alkimia', age: 3, tag: 'tek', mod: { gunpowderCost: -0.5 }, glyph: '⚗', desc: 'Riset Bubuk Mesiu 50% lebih murah.' },
};
for (const [k, c] of Object.entries(CARDS)) {
  c.id = k;
  if (!c.desc && c.give) c.desc = 'Kiriman sumber daya dari ibu kota.' + (c.repeat ? ' Bisa dikirim berulang kali.' : '');
  else if (c.repeat) c.desc += ' Bisa dikirim berulang kali.';
}
// pre-built decks: the computer picks one per game (it shapes how that AI plays); players can start from them too
export const DECKS = {
  makmur: { name: 'Pedagang Makmur', style: 'eko', desc: 'Ekonomi cepat, lalu pasukan besar.', cards: ['vil3', 'sheep6', 'axe', 'baskets', 'boots', 'granary', 'food300', 'wood300', 'vil5', 'miners', 'merchants', 'food700', 'wood600', 'gold500', 'armor', 'plough', 'treasury', 'knight3', 'food1000', 'gold1000'] },
  penakluk: { name: 'Penakluk', style: 'serbu', desc: 'Serangan dini dan terus-menerus.', cards: ['militia4', 'scouts2', 'vil3', 'food300', 'gold200', 'builders', 'spear5', 'archer4', 'armor', 'drill', 'farriers', 'rations', 'gold500', 'spies', 'knight3', 'ram2', 'gunners4', 'royal_guard', 'food700', 'gold1000'] },
  benteng: { name: 'Penjaga Benteng', style: 'benteng', desc: 'Tembok, menara, lalu serangan balik.', cards: ['vil3', 'stone200', 'builders', 'wood300', 'torchlight', 'stone400', 'masons', 'stonecutters', 'vil5', 'spear5', 'archer4', 'arrowsmith', 'armor', 'fortify', 'royal_guard', 'cannon1', 'food700', 'wood600', 'iron600', 'gold1000'] },
  cendekia: { name: 'Cendekiawan', style: 'ilmu', desc: 'Teknologi, mesiu dan pasukan khusus.', cards: ['vil3', 'boots', 'baskets', 'food300', 'gold200', 'vil5', 'iron300', 'miners', 'survey', 'spies', 'gold500', 'archer4', 'alchemy', 'cannon1', 'gunners4', 'iron600', 'plough', 'food1000', 'gold1000', 'treasury'] },
  bahari: { name: 'Penguasa Laut', style: 'laut', desc: 'Ikan, dermaga dan armada perang.', cards: ['nets', 'fishboats2', 'vil3', 'wood300', 'granary', 'food300', 'transport1', 'warships2', 'wood600', 'vil5', 'miners', 'armor', 'archer4', 'spear5', 'gold500', 'food700', 'knight3', 'wood1000', 'gold1000', 'plough'] },
};

// gather rate per second (AoE2-like)
export const RATE = { tree: 0.39, gold: 0.38, stone: 0.36, iron: 0.33, berry: 0.31, farm: 0.33, carcass: 0.41, fish: 0.42 };
export const CARRY = 10;
export const PLAYER_COLORS = ['blue', 'red', 'green', 'yellow'];
export const PLAYER_RGB = { blue: [45, 95, 235], red: [225, 35, 35], green: [45, 175, 45], yellow: [235, 210, 35] };
export const PLAYER_NAMES = ['Kamu', 'Raja Merah', 'Adipati Hijau', 'Baron Kuning'];
export const GAME_SPEED = 1.6;   // AoE2 "normal" speed multiplier
