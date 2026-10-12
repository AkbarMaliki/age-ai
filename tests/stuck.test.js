// Stuck-unit detector: AI games, reports units that keep an order but barely move for 25 game-s, with a tile map around them.
//   node tests/stuck.test.js [minutes] [seed] [size] [players] [mapType]
import { generate } from '../js/map.js';
import { step, TICK } from '../js/sim.js';
import { AI } from '../js/ai.js';
const mins = +(process.argv[2] || 40), seed = +(process.argv[3] || 5), size = +(process.argv[4] || 144), np = +(process.argv[5] || 4), type = process.argv[6] || 'random';
const W = generate({ size, seed, type, players: ['blue', 'red', 'green', 'yellow'].slice(0, np).map((c, i) => ({ name: 'ABCD'[i], color: c, ai: true })) });
const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
const track = new Map(); let reports = 0; const seenIds = new Set();
for (let n = 0; n < mins * 600 && W.winner < 0; n++) {
  for (const ai of ais) ai.tick(); step(W); W.ev.length = 0;
  if (n % 50) continue;
  for (const u of W.dyn.values()) {
    if (u.kind !== 'unit' || u.owner < 0 || !u.order || u.order.t === 'attack') { track.delete(u.id); continue; }
    if (u.anim !== 'walk' && u.anim !== 'carry' && u.anim !== 'run') { track.delete(u.id); continue; }   // working, fighting or idle on purpose
    const k = track.get(u.id);
    if (!k || Math.hypot(u.x - k.x, u.y - k.y) > 1.2) { track.set(u.id, { x: u.x, y: u.y, t: W.t }); continue; }
    if (W.t - k.t > 25 && !seenIds.has(u.id)) {
      seenIds.add(u.id); reports++;
      if (reports <= 6) {
        const o = u.order, tgt = o.id && W.ents.get(o.id);
        console.log(`\n${(W.t / 60).toFixed(1)}m STUCK p${u.owner} ${u.type}#${u.id} at ${u.x.toFixed(1)},${u.y.toFixed(1)} order ${o.t}${o.kind ? ':' + o.kind : ''} tgt ${tgt ? tgt.type + '@' + tgt.x + ',' + tgt.y : '-'} anim ${u.anim} path ${u.path ? (u.path.complete ? 'ok' : 'partial') + u.path.pts.length + ' pi' + u.pi : '-'} fails ${u.fails || 0}`);
        const ci = Math.floor(u.x), cj = Math.floor(u.y); let s = '';
        for (let j = cj - 7; j <= cj + 7; j++) { let r = ''; for (let i = ci - 10; i <= ci + 10; i++) { if (i < 0 || j < 0 || i >= size || j >= size) { r += ' '; continue; } const e = W.ents.get(W.occ[j * size + i]); const here = [...W.dyn.values()].some(x => x.kind === 'unit' && x.id === u.id && Math.floor(x.x) === i && Math.floor(x.y) === j);
          r += here ? '@' : W.terrain[j * size + i] === 3 ? '~' : e ? (e.kind === 'building' ? e.type[0].toUpperCase() : e.type[0]) : '.'; } s += r + '\n'; }
        console.log(s);
      }
    }
  }
}
console.log('stuck units reported:', reports, 'game min', (W.t / 60).toFixed(1));
