// AI late game (v7): do the AIs reach the Imperial Age, use the siege workshop, the unit lines, trade, reseeding?
// node tests/imperial.test.js [minutes] [seed] [victory] [startRes]
import { generate } from '../js/map.js';
import { step, TICK } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { AGES, UNITS, TECHS } from '../js/data.js';
const mins = +(process.argv[2] || 40), seed = +(process.argv[3] || 5), victory = process.argv[4] || 'conquest', startRes = process.argv[5] || 'tinggi';
const W = generate({ size: 160, seed, type: 'padang', opts: { victory, startRes, popLimit: 200 },
  players: ['blue', 'red', 'green', 'yellow'].map((c, i) => ({ name: 'ABCD'[i], color: c, ai: true, team: i % 2 })) });
const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
const evc = {}, t0 = Date.now();
for (let n = 0; n < mins * 60 / TICK && W.winner < 0; n++) {
  for (const ai of ais) ai.tick();
  step(W);
  for (const e of W.ev) { evc[e.k] = (evc[e.k] || 0) + 1; if (['defeated', 'victory', 'wonderbuilt', 'kothcapture'].includes(e.k)) console.log(`   ${(W.t / 60).toFixed(1)}m ${e.k} ${e.owner ?? e.team ?? ''}`); }
  W.ev.length = 0;
  if (n % (60 / TICK * 5) === 0) console.log(`${(W.t / 60).toFixed(0).padStart(2)}m ` + W.players.map(P => `${P.name}:${AGES[P.age].split(' ')[1]} pop ${P.pop}`).join(' | '));
}
const types = {}, blds = {}; for (const e of W.ents.values()) { if (e.kind === 'unit' && e.owner >= 0) types[e.type] = (types[e.type] || 0) + 1; if (e.kind === 'building') blds[e.type] = (blds[e.type] || 0) + 1; }
const v7 = ['imperial', 'imperial_war', 'imperial_lore', 'man_at_arms', 'long_sword', 'champion', 'halberdier', 'arbalest', 'elite_skirm', 'heavy_ha', 'light_cav', 'hussar', 'cavalier', 'paladin', 'capped_ram', 'onager', 'heavy_scorpion', 'bow_saw', 'two_man_saw', 'heavy_plow', 'crop_rotation', 'gold_shaft', 'stone_mining', 'hand_cart', 'guard_tower', 'keep', 'galleon'];
console.log('winner', W.winner, 'min', (W.t / 60).toFixed(1), 'real s', ((Date.now() - t0) / 1000).toFixed(0));
console.log('ages', W.players.map(P => P.age).join(','));
console.log('v7 techs', W.players.map(P => `${P.name}[${v7.filter(t => P.techs.has(t)).join(' ')}]`).join('\n          '));
console.log('units', JSON.stringify(types)); console.log('buildings', JSON.stringify(blds)); console.log('events', JSON.stringify(evc));
const ok = W.players.some(P => P.age === 4) && W.players.some(P => v7.some(t => t !== 'imperial' && P.techs.has(t)));
console.log(ok ? 'imperial AI OK' : 'imperial AI FAIL'); if (!ok) process.exit(1);
