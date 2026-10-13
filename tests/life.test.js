// Daily life (v10): AI vs AI with needs, families, disease, livestock. node tests/life.test.js [minutes] [seed] [map]
import { generate } from '../js/map.js';
import { step } from '../js/sim.js';
import { AI } from '../js/ai.js';
const mins = +(process.argv[2] || 35), seed = +(process.argv[3] || 3), type = process.argv[4] || 'padang';
const W = generate({ size: 144, seed, type, players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red', ai: true }] });
const ais = W.players.map((p, i) => new AI(W, i, 'hard')); const ev = {};
for (let n = 1; n <= mins * 600 && W.winner < 0; n++) { for (const a of ais) a.tick(); step(W); for (const e of W.ev) ev[e.k] = (ev[e.k] || 0) + 1; W.ev.length = 0;
  if (n % 3000 === 0) console.log(`${n / 600}m ` + W.players.map(P => { const L = P.life || {}; return `${P.name}: age ${P.age} pop ${P.pop} fun ${Math.round(L.fun)} hp ${Math.round(L.health)} need ${Math.round(L.need)} sick ${L.sick} homeless ${L.homeless} prosper ${P.prosper}`; }).join(' | ')); }
const blds = W.players.map(P => { const c = {}; for (const e of W.ents.values()) if (e.owner === P.id && (e.kind === 'building' || ['sheep', 'cow', 'child', 'fishing_boat'].includes(e.type))) c[e.type] = (c[e.type] || 0) + 1; return c; });
console.log('A', JSON.stringify(blds[0])); console.log('B', JSON.stringify(blds[1]));
console.log('life events', JSON.stringify(Object.fromEntries(Object.entries(ev).filter(([k]) => ['birth', 'grownup', 'outbreak', 'contagion', 'cured', 'lifedeath', 'desert', 'penned', 'enter', 'hungry', 'fish'].includes(k)))));
