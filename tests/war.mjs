// Late-game war check: do big AI empires actually conquer each other?  node tests/war.mjs [minutes] [seed] [size] [players] [map] [diff]
// Prints every 10 game-min: towns (TCs), buildings, army and pop per kingdom, eliminations and the war chronicle.
import { generate } from '../js/map.js';
import { step, TICK } from '../js/sim.js';
import { AI } from '../js/ai.js';
const mins = +(process.argv[2] || 120), seed = +(process.argv[3] || 11), size = +(process.argv[4] || 220), np = +(process.argv[5] || 4), type = process.argv[6] || 'padang', diff = process.argv[7] || 'hard';
const W = generate({ size, seed, type, players: ['blue', 'red', 'green', 'yellow'].slice(0, np).map((c, i) => ({ name: ['Biru', 'Merah', 'Hijau', 'Kuning'][i], color: c, ai: true, team: i })) });
const ais = W.players.map((p, i) => new AI(W, i, diff));
const t0 = Date.now(); let worst = 0;
for (let n = 1; n <= mins * 60 / TICK && W.winner < 0; n++) {
  const a = performance.now();
  for (const ai of ais) ai.tick(); step(W);
  worst = Math.max(worst, performance.now() - a);
  for (const e of W.ev) {
    if (e.k === 'defeated') console.log(`   ${(W.t / 60).toFixed(1)}m DEFEATED ${W.players[e.owner].name}${e.resign ? ' (resigned)' : ''}`);
    if (e.k === 'victory') console.log(`   ${(W.t / 60).toFixed(1)}m VICTORY team ${e.team}`);
    if (e.k === 'war') console.log(`   ${(W.t / 60).toFixed(1)}m [${W.players[e.owner].name}] ${e.text}`);
  }
  W.ev.length = 0;
  if (process.env.WARDBG && n % 1200 === 0 && W.t > +process.env.WARDBG * 60) for (const ai of ais) {
    const w = ai.war; if (!w || !W.players[ai.pid].alive) continue;
    const mem = [...w.units].map(id => W.ents.get(id)).filter(Boolean), ord = {};
    for (const u of mem) { const k = !u.order ? 'idle' : u.order.t + (u.order.amove ? '*' : ''); ord[k] = (ord[k] || 0) + 1; }
    const tg = new Map(); for (const u of mem) if (u.order && u.order.t === 'attack') { const e = W.ents.get(u.order.id); const k = e ? e.kind[0] + ':' + e.type : '?'; tg.set(k, (tg.get(k) || 0) + 1); }
    const cx = mem.reduce((a, u) => a + u.x, 0) / (mem.length || 1), cy = mem.reduce((a, u) => a + u.y, 0) / (mem.length || 1);
    const tgts = [...ai.known.entries()].filter(([, k]) => k.owner === w.foe && k.type !== 'farm' && Math.hypot(k.x - w.city.x, k.y - w.city.y) < 22).map(([id, k]) => k.type + (W.ents.has(id) ? '' : '(gone)'));
    console.log(`     dbg ${W.players[ai.pid].name} ${w.phase} ${(W.t - w.t | 0)}s n${mem.length} d${Math.hypot(cx - w.city.x, cy - w.city.y) | 0} ${JSON.stringify(ord)} atk${JSON.stringify([...tg])} tg[${tgts.join(',')}]`);
  }
  if (n % (600 * 10) === 0) {
    console.log(`${(W.t / 60).toFixed(0).padStart(3)}m ` + W.players.map(P => {
      let tc = 0, b = 0, m = 0; for (const e of W.dyn.values()) if (e.owner === P.id) { if (e.kind === 'building' && e.built) { b++; if (e.type === 'town_center') tc++; } else if (e.kind === 'unit' && e.type !== 'villager' && e.type !== 'child') m++; }
      return `${P.name}${P.alive ? '' : '☠'} tc${tc} b${b} mil${m} pop${P.pop} k${P.stats.killed} rz${P.stats.razed}`;
    }).join(' | ') + `  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
}
console.log('winner', W.winner, 'game min', (W.t / 60).toFixed(1), 'real s', ((Date.now() - t0) / 1000).toFixed(0), 'worst tick', worst.toFixed(0));
