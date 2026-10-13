// Balance tournament: AI vs AI 1v1 games over maps, decks (personalities) and civilizations. Writes one JSON line per
// game.   node tests/tournament.mjs <firstGame> <count> <minutes> > out.jsonl
import { generate } from '../js/map.js';
import { step } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { DECKS, CIVS, UNITS } from '../js/data.js';
const first = +(process.argv[2] || 0), count = +(process.argv[3] || 4), mins = +(process.argv[4] || 60);
const MAPS = ['padang', 'rimba', 'danau', 'sungai', 'tambang', 'pegunungan', 'kepulauan'], DK = Object.keys(DECKS), CV = Object.keys(CIVS);
for (let g = first; g < first + count; g++) {
  const type = MAPS[g % MAPS.length], seed = 1000 + g * 17;
  const decks = [DK[g % DK.length], DK[(g * 3 + 2) % DK.length]], civs = [CV[(g * 5) % CV.length], CV[(g * 7 + 3) % CV.length]];
  const W = generate({ size: 144, seed, type, players: [0, 1].map(i => ({ name: 'AB'[i], color: ['blue', 'red'][i], ai: true, style: decks[i], civ: civs[i], team: i })) });
  const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
  const ev = {}, ageAt = [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], deaths = [{}, {}];
  let worst = 0, end = mins;
  for (let n = 1; n <= mins * 600; n++) {
    const t0 = performance.now();
    for (const a of ais) a.tick(); step(W);
    worst = Math.max(worst, performance.now() - t0);
    for (const e of W.ev) {
      ev[e.k] = (ev[e.k] || 0) + 1;
      if (e.k === 'age') ageAt[e.owner][e.age] = +(W.t / 60).toFixed(1);
      if (e.k === 'lifedeath') deaths[e.owner][e.why] = (deaths[e.owner][e.why] || 0) + 1;
    }
    W.ev.length = 0;
    if (W.winner >= 0) { end = +(W.t / 60).toFixed(1); break; }
  }
  const out = { g, map: type, seed, minutes: end, winner: W.winner, perfWorstMs: +worst.toFixed(0),
    players: W.players.map((P, i) => {
      const units = {}, blds = {};
      for (const e of W.ents.values()) if (e.owner === i) { if (e.kind === 'unit') units[e.type] = (units[e.type] || 0) + 1; else if (e.kind === 'building') blds[e.type] = (blds[e.type] || 0) + 1; }
      const s = P.stats;
      return { deck: decks[i], style: ais[i].style, civ: civs[i], alive: P.alive, age: P.age, ageAt: ageAt[i], pop: P.pop, prosper: P.prosper || 0, life: P.life ? { fun: Math.round(P.life.fun), health: Math.round(P.life.health), births: P.life.births } : null,
        terr: P.terrN || 0, gathered: Math.round(s.gathered), gres: Object.fromEntries(Object.entries(s.gres).map(([k, v]) => [k, Math.round(v)])), killed: s.killed, lost: s.lost, razed: s.razed, bldLost: s.bldLost,
        trained: s.tr, deaths: deaths[i], hungryDays: s.hungryDays, units, blds };
    }), events: Object.fromEntries(Object.entries(ev).filter(([k]) => ['outbreak', 'desert', 'birth', 'lifedeath', 'colony', 'colonyland', 'tribute', 'convert', 'wonderbuilt'].includes(k))) };
  console.log(JSON.stringify(out));
}
