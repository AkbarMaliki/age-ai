// Why does a far stronger AI not finish its enemy? Replays one tournament game and logs the leader's army.
//   node tests/probe_finish.mjs <game> <fromMinute> <toMinute>
import { generate } from '../js/map.js';
import { step } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { DECKS, CIVS, UNITS, MILITARY } from '../js/data.js';
const g = +(process.argv[2] || 4), from = +(process.argv[3] || 40), to = +(process.argv[4] || 60);
const MAPS = ['padang', 'rimba', 'danau', 'sungai', 'tambang', 'pegunungan', 'kepulauan'], DK = Object.keys(DECKS), CV = Object.keys(CIVS);
const type = MAPS[g % MAPS.length], seed = 1000 + g * 17;
const decks = [DK[g % DK.length], DK[(g * 3 + 2) % DK.length]], civs = [CV[(g * 5) % CV.length], CV[(g * 7 + 3) % CV.length]];
const W = generate({ size: 144, seed, type, players: [0, 1].map(i => ({ name: 'AB'[i], color: ['blue', 'red'][i], ai: true, style: decks[i], civ: civs[i], team: i })) });
const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
for (let n = 1; n <= to * 600; n++) {
  for (const a of ais) a.tick(); step(W); W.ev.length = 0;
  if (W.winner >= 0) { console.log('winner', W.winner, 'at', (W.t / 60).toFixed(1)); break; }
  if (n >= from * 600 && n % 1200 === 0) {
    const lead = W.players[0].pop >= W.players[1].pop ? 0 : 1, A = ais[lead], foe = 1 - lead;
    const army = [...W.dyn.values()].filter(u => u.kind === 'unit' && u.owner === lead && MILITARY(u.type) && !u.nav && !UNITS[u.type].hero && !UNITS[u.type].trade);
    const ord = {}; for (const u of army) { const k = u.order ? u.order.t + (u.order.amove ? '+a' : '') : 'idle'; ord[k] = (ord[k] || 0) + 1; }
    const watch = A.tw ? [...A.tw.values()].reduce((s, x) => s + x.size, 0) : 0;
    const fb = [...W.dyn.values()].filter(e => e.kind === 'building' && e.owner === foe);
    const fbk = {}; for (const b of fb) fbk[b.type] = (fbk[b.type] || 0) + 1;
    const known = [...A.known.values()].filter(k => k.owner === foe).length;
    console.log(`m${(W.t / 60).toFixed(0)} lead ${lead} pop ${W.players[lead].pop}/${W.players[lead].popLim} vs ${W.players[foe].pop} | army ${army.length} cap ${A.armyCap} guard ${A.guard ? A.guard.size : 0} watch ${watch} | orders ${JSON.stringify(ord)} | lastAttack ${(A.lastAttack / 60).toFixed(1)}m | foe blds ${fb.length} known ${known} ${JSON.stringify(fbk)} | inv ${!!A.inv} | foe units ${[...W.dyn.values()].filter(u => u.kind === 'unit' && u.owner === foe).length}`);
  }
}
