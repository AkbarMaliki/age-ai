// Game data in the spirit of Age of Empires II (Dark -> Feudal -> Castle Age). Times are in game-seconds.
export const RES = ['food', 'wood', 'gold', 'stone'];
export const RES_NAME = { food: 'Makanan', wood: 'Kayu', gold: 'Emas', stone: 'Batu' };
export const AGES = ['', 'Zaman Kegelapan', 'Zaman Feodal', 'Zaman Kastil'];
export const START_RES = { food: 200, wood: 200, gold: 100, stone: 200 };
export const POP_LIMIT = 100;

// ma / pa = melee / pierce armour, speed in tiles/s, range in tiles, los in tiles
export const UNITS = {
  villager: { name: 'Penduduk Desa', hp: 25, atk: 3, ma: 0, pa: 0, speed: 0.8, range: 0, reload: 2.0, los: 4, cost: { food: 50 }, time: 25, age: 1, from: 'town_center', key: 'Q', desc: 'Mengumpulkan sumber daya dan membangun.' },
  militia: { name: 'Milisi', hp: 40, atk: 4, ma: 0, pa: 1, speed: 0.9, range: 0, reload: 2.0, los: 4, cost: { food: 60, gold: 20 }, time: 21, age: 1, from: 'barracks', key: 'Q', desc: 'Infanteri pedang dasar.' },
  spearman: { name: 'Prajurit Tombak', hp: 45, atk: 3, ma: 0, pa: 0, speed: 1.0, range: 0, reload: 3.0, los: 4, cost: { food: 35, wood: 25 }, time: 22, age: 2, from: 'barracks', key: 'W', bonus: { cavalry: 15 }, desc: 'Murah, kuat melawan kavaleri.' },
  archer: { name: 'Pemanah', hp: 30, atk: 4, ma: 0, pa: 0, speed: 0.96, range: 4, reload: 2.0, los: 6, acc: 0.8, cost: { wood: 25, gold: 45 }, time: 35, age: 2, from: 'archery_range', key: 'Q', proj: 'arrow', desc: 'Menyerang dari jarak jauh.' },
  scout: { name: 'Kavaleri Pengintai', hp: 45, atk: 3, ma: 0, pa: 2, speed: 1.55, range: 0, reload: 2.0, los: 6, cost: { food: 80 }, time: 30, age: 2, from: 'stable', key: 'Q', cls: 'cavalry', desc: 'Cepat, penglihatan luas.' },
  knight: { name: 'Ksatria', hp: 100, atk: 10, ma: 2, pa: 2, speed: 1.35, range: 0, reload: 1.8, los: 4, cost: { food: 60, gold: 75 }, time: 30, age: 3, from: 'stable', key: 'W', cls: 'cavalry', desc: 'Kavaleri berat yang tangguh.' },
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
for (const [k, u] of Object.entries(UNITS)) { u.id = k; u.cls = u.cls || (k === 'villager' ? 'villager' : u.range ? 'archer' : 'infantry'); }
export const GAIA = -1;   // owner id of nature / bandits
export const TREASURES = {
  gold: { name: 'Peti Emas', res: 'gold', amount: [150, 300] }, food: { name: 'Gerobak Makanan', res: 'food', amount: [200, 350] },
  wood: { name: 'Tumpukan Kayu', res: 'wood', amount: [200, 300] }, stone: { name: 'Tumpukan Batu', res: 'stone', amount: [150, 250] },
};

// n = footprint (tiles). drop = resources accepted. block=false lets units walk over it (farms).
export const BUILDINGS = {
  town_center: { name: 'Pusat Kota', n: 4, hp: 2400, ma: 3, pa: 5, cost: { wood: 275, stone: 100 }, time: 150, age: 1, pop: 5, los: 8, drop: ['food', 'wood', 'gold', 'stone'], trains: ['villager'], techs: ['loom', 'wheelbarrow', 'feudal', 'castle'], attack: { atk: 5, range: 6, reload: 2.0 }, key: 'Q', page: 0 },
  house: { name: 'Rumah', n: 2, hp: 550, ma: 0, pa: 7, cost: { wood: 25 }, time: 25, age: 1, pop: 5, los: 2, key: 'Q', page: 1 },
  mill: { name: 'Penggilingan', n: 2, hp: 600, ma: 0, pa: 7, cost: { wood: 100 }, time: 35, age: 1, los: 6, drop: ['food'], techs: ['horse_collar'], key: 'W', page: 1 },
  lumber_camp: { name: 'Kamp Penebang', n: 2, hp: 600, ma: 0, pa: 7, cost: { wood: 100 }, time: 35, age: 1, los: 6, drop: ['wood'], techs: ['double_bit_axe'], key: 'E', page: 1 },
  mining_camp: { name: 'Kamp Tambang', n: 2, hp: 600, ma: 0, pa: 7, cost: { wood: 100 }, time: 35, age: 1, los: 6, drop: ['gold', 'stone'], techs: ['gold_mining'], key: 'R', page: 1 },
  farm: { name: 'Ladang', n: 3, hp: 480, ma: 0, pa: 0, cost: { wood: 60 }, time: 15, age: 1, los: 1, block: false, food: 175, needs: ['mill'], key: 'A', page: 1 },
  barracks: { name: 'Barak', n: 3, hp: 1200, ma: 0, pa: 7, cost: { wood: 175 }, time: 50, age: 1, los: 6, trains: ['militia', 'spearman'], key: 'S', page: 1 },
  archery_range: { name: 'Lapangan Panahan', n: 3, hp: 1500, ma: 0, pa: 7, cost: { wood: 175 }, time: 50, age: 2, los: 6, trains: ['archer'], needs: ['barracks'], key: 'D', page: 1 },
  stable: { name: 'Istal', n: 3, hp: 1500, ma: 0, pa: 7, cost: { wood: 175 }, time: 50, age: 2, los: 6, trains: ['scout', 'knight'], needs: ['barracks'], key: 'F', page: 1 },
  watch_tower: { name: 'Menara Jaga', n: 1, hp: 1020, ma: 1, pa: 7, cost: { wood: 25, stone: 125 }, time: 80, age: 2, los: 10, attack: { atk: 5, range: 8, reload: 2.0 }, key: 'Z', page: 1 },
  stone_wall: { name: 'Tembok Batu', n: 1, hp: 1800, ma: 8, pa: 10, cost: { stone: 5 }, time: 8, age: 2, los: 2, wall: true, key: 'X', page: 1 },
  gate: { name: 'Gerbang', n: 1, len: 3, hp: 2750, ma: 6, pa: 6, cost: { stone: 30 }, time: 70, age: 2, los: 4, gate: true, key: 'C', page: 1 },
  castle: { name: 'Kastil', n: 4, hp: 4800, ma: 8, pa: 11, cost: { stone: 650 }, time: 200, age: 3, pop: 20, los: 11, trains: ['knight'], attack: { atk: 11, range: 8, reload: 2.0, arrows: 3 }, key: 'V', page: 1 },
};
for (const [k, b] of Object.entries(BUILDINGS)) { b.id = k; if (b.block === undefined) b.block = true; }

export const TECHS = {
  feudal: { name: 'Maju ke Zaman Feodal', cost: { food: 500 }, time: 130, age: 1, at: 'town_center', toAge: 2, key: 'E', reqCount: 2, reqFrom: ['mill', 'lumber_camp', 'mining_camp', 'barracks'] },
  castle: { name: 'Maju ke Zaman Kastil', cost: { food: 800, gold: 200 }, time: 160, age: 2, at: 'town_center', toAge: 3, key: 'E', reqCount: 2, reqFrom: ['archery_range', 'stable', 'watch_tower'] },
  loom: { name: 'Tenun', cost: { gold: 50 }, time: 25, age: 1, at: 'town_center', key: 'R', desc: 'Penduduk desa +15 HP, +1/+2 zirah.' },
  wheelbarrow: { name: 'Gerobak Dorong', cost: { food: 175, wood: 50 }, time: 75, age: 2, at: 'town_center', key: 'T', desc: 'Penduduk desa +10% kecepatan, +3 muatan.' },
  double_bit_axe: { name: 'Kapak Bermata Dua', cost: { food: 100, wood: 50 }, time: 25, age: 2, at: 'lumber_camp', key: 'Q', desc: 'Menebang kayu +20%.' },
  gold_mining: { name: 'Penambangan Emas', cost: { food: 100, wood: 75 }, time: 30, age: 2, at: 'mining_camp', key: 'Q', desc: 'Menambang emas +15%.' },
  horse_collar: { name: 'Kalung Kuda', cost: { food: 75, wood: 75 }, time: 20, age: 2, at: 'mill', key: 'Q', desc: 'Ladang +75 makanan.' },
};
for (const [k, t] of Object.entries(TECHS)) t.id = k;

export const RESOURCES = {
  tree: { res: 'wood', amount: 100, block: true },
  gold: { res: 'gold', amount: 800, block: true },
  stone: { res: 'stone', amount: 350, block: true },
  berry: { res: 'food', amount: 125, block: true },
  carcass: { res: 'food', amount: 100, block: false },
};
// gather rate per second (AoE2-like)
export const RATE = { tree: 0.39, gold: 0.38, stone: 0.36, berry: 0.31, farm: 0.33, carcass: 0.41 };
export const CARRY = 10;
export const PLAYER_COLORS = ['blue', 'red', 'green', 'yellow'];
export const PLAYER_RGB = { blue: [45, 95, 235], red: [225, 35, 35], green: [45, 175, 45], yellow: [235, 210, 35] };
export const PLAYER_NAMES = ['Kamu', 'Raja Merah', 'Adipati Hijau', 'Baron Kuning'];
export const GAME_SPEED = 1.6;   // AoE2 "normal" speed multiplier
