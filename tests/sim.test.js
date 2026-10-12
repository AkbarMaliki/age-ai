// AI vs AI headless game: node tests/sim.test.js [minutes] [seed]
import { generate } from '../js/map.js';
import { step, TICK } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { AGES, UNITS } from '../js/data.js';
const mins = +(process.argv[2] || 25), seed = +(process.argv[3] || 7), size = +(process.argv[4] || 144);
const W = generate({ size, seed, players: [{ name: 'A', color: 'blue', ai: true }, { name: 'B', color: 'red', ai: true }] });
const ais = [new AI(W, 0, 'normal'), new AI(W, 1, 'hard')];
const t0 = Date.now(); let worst = 0, evc = {};
for (let n = 0; n < mins * 60 / TICK && W.winner < 0; n++) {
  const a = performance.now();
  for (const ai of ais) ai.tick();
  step(W);
  worst = Math.max(worst, performance.now() - a);
  for (const e of W.ev) evc[e.k] = (evc[e.k] || 0) + 1; W.ev.length = 0;
  if (n % (60 / TICK * 3) === 0) {
    const line = W.players.map(P => { let v = 0, m = 0, b = 0; for (const e of W.ents.values()) if (e.owner === P.id) { if (e.kind === 'unit') e.type === 'villager' ? v++ : UNITS[e.type].animal ? 0 : m++; else if (e.kind === 'building') b++; }
      return `${P.name}: ${AGES[P.age].split(' ')[1]} vil ${v} mil ${m} bld ${b} pop ${P.pop}/${P.popCap} F${P.res.food | 0} W${P.res.wood | 0} G${P.res.gold | 0} S${P.res.stone | 0}`; }).join(' | ');
    console.log(`${(W.t / 60).toFixed(0).padStart(2)}m ${line}`);
  }
}
console.log('winner', W.winner, 'game min', (W.t / 60).toFixed(1), 'real s', ((Date.now() - t0) / 1000).toFixed(1), 'worst tick ms', worst.toFixed(1), 'ents', W.ents.size);
console.log(JSON.stringify(evc));
console.log(W.players.map(p => `${p.name} killed ${p.stats.killed} lost ${p.stats.lost} built ${p.stats.built}`).join(' | '));
