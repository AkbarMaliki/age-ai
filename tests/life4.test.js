// 4 AIs with the daily-life rules: who builds wells / taverns / hospitals / barns, and how the people fare.
// node tests/life4.test.js [minutes] [seed] [map]
import { generate } from '../js/map.js';
import { step } from '../js/sim.js';
import { AI } from '../js/ai.js';
const mins = +(process.argv[2] || 40), seed = +(process.argv[3] || 11), type = process.argv[4] || 'padang';
const W = generate({ size: 180, seed, type, players: ['blue', 'red', 'green', 'yellow'].map((c, i) => ({ name: 'ABCD'[i], color: c, ai: true })) });
const ais = W.players.map((p, i) => new AI(W, i, i % 2 ? 'hard' : 'normal')); const ev = {};
for (let n = 1; n <= mins * 600 && W.winner < 0; n++) { for (const a of ais) a.tick(); step(W); for (const e of W.ev) ev[e.k] = (ev[e.k] || 0) + 1; W.ev.length = 0;
  if (n % 6000 === 0) for (const P of W.players) { const L = P.life || {}; const ppl = [...W.dyn.values()].filter(u => u.owner === P.id && u.en !== undefined); const tired = ppl.filter(u => u.en < 12).length, sick = ppl.filter(u => u.sick).length;
    const c = {}; for (const e of W.dyn.values()) if (e.owner === P.id && ['well', 'tavern', 'hospital', 'barn'].includes(e.type) && e.built) c[e.type] = (c[e.type] || 0) + 1;
    console.log(`${n / 600}m ${P.name}(${ais[P.id].style}) age ${P.age} pop ${P.pop} fun ${Math.round(L.fun)} hp ${Math.round(L.health)} tired ${tired}/${ppl.length} sick ${sick} prosper ${P.prosper} ${JSON.stringify(c)}`); } }
console.log(JSON.stringify(Object.fromEntries(Object.entries(ev).filter(([k]) => ['birth', 'outbreak', 'lifedeath', 'desert', 'cured'].includes(k)))));
