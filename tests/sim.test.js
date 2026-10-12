// AI vs AI headless game: node tests/sim.test.js [minutes] [seed] [mapSize] [mapType|random] [players]
import { generate } from '../js/map.js';
import { step, TICK } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { AGES, UNITS } from '../js/data.js';
import { History, score } from '../js/stats.js';
const mins = +(process.argv[2] || 25), seed = +(process.argv[3] || 7), size = +(process.argv[4] || 144), type = process.argv[5] || 'random', np = +(process.argv[6] || 2);
const W = generate({ size, seed, type, players: ['blue', 'red', 'green', 'yellow'].slice(0, np).map((c, i) => ({ name: 'ABCD'[i], color: c, ai: true })) });
const ais = W.players.map((p, i) => new AI(W, i, i % 2 ? 'hard' : 'normal'));
const hist = new History(W);
console.log(`map ${W.map.name} (${W.map.type}) size ${size} seed ${seed} seats ${W.players.map(p => p.start.join(',')).join(' ')}`);
const t0 = Date.now(); let worst = 0, evc = {};
const found = {};
for (let n = 0; n < mins * 60 / TICK && W.winner < 0; n++) {
  const a = performance.now();
  for (const ai of ais) ai.tick();
  step(W);
  hist.tick();
  worst = Math.max(worst, performance.now() - a);
  for (const e of W.ev) { evc[e.k] = (evc[e.k] || 0) + 1; if (e.k === 'defeated' || e.k === 'victory') console.log(`   ${(W.t / 60).toFixed(1)}m ${e.k} ${e.k === 'victory' ? 'team ' + e.team : W.players[e.owner].name + (e.resign ? ' (resigned)' : '')}`); }
  W.ev.length = 0;
  for (const ai of ais) if (found[ai.pid] === undefined && ai.known.size) found[ai.pid] = W.t;
  if (n % (60 / TICK * 3) === 0) {
    const line = W.players.map(P => { let v = 0, m = 0, b = 0; for (const e of W.ents.values()) if (e.owner === P.id) { if (e.kind === 'unit') e.type === 'villager' ? v++ : UNITS[e.type].animal ? 0 : m++; else if (e.kind === 'building') b++; }
      return `${P.name}: ${AGES[P.age].split(' ')[1]} vil ${v} mil ${m} bld ${b} pop ${P.pop}/${P.popCap} F${P.res.food | 0} W${P.res.wood | 0} G${P.res.gold | 0} S${P.res.stone | 0} score ${score(W, P).total}`; }).join(' | ');
    console.log(`${(W.t / 60).toFixed(0).padStart(2)}m ${line}`);
  }
}
console.log('winner', W.winner, 'game min', (W.t / 60).toFixed(1), 'real s', ((Date.now() - t0) / 1000).toFixed(1), 'worst tick ms', worst.toFixed(1), 'ents', W.ents.size);
console.log('first enemy building spotted by AI (game min):', ais.map(a => `${W.players[a.pid].name} ${found[a.pid] !== undefined ? (found[a.pid] / 60).toFixed(1) : 'never'}`).join(' | '));
console.log('contact log:', hist.found.map(f => `${W.players[f.by].name} found ${W.players[f.of].name} @${(f.t / 60).toFixed(1)}m`).join(', ') || 'none');
console.log(JSON.stringify(evc));
console.log(W.players.map(p => `${p.name} killed ${p.stats.killed} lost ${p.stats.lost} razed ${p.stats.razed} bldLost ${p.stats.bldLost} built ${p.stats.built} treasures ${p.stats.treasures}`).join(' | '));
console.log(W.players.map(p => `${p.name} xp ${p.xp | 0} cards [${p.cards.join(',')}] trades ${p.stats.trades} market ${[...W.ents.values()].some(e => e.type === 'market' && e.owner === p.id)}`).join(' | '));
console.log('market prices', JSON.stringify(Object.fromEntries(Object.entries(W.market).map(([k, v]) => [k, Math.round(v)]))));
