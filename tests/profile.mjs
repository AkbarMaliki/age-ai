// Profile one tournament game (same setup as tournament.mjs game #N): worst sim tick and the slowest AI methods.   node tests/profile.mjs <game>
import { generate } from '../js/map.js';
import { step } from '../js/sim.js';
import { AI } from '../js/ai.js';
import { DECKS, CIVS } from '../js/data.js';
const g = +(process.argv[2] || 20), MAPS = ['padang', 'rimba', 'danau', 'sungai', 'tambang', 'pegunungan', 'kepulauan'], DK = Object.keys(DECKS), CV = Object.keys(CIVS);
const type = MAPS[g % MAPS.length], seed = 1000 + g * 17, decks = [DK[g % DK.length], DK[(g * 3 + 2) % DK.length]], civs = [CV[(g * 5) % CV.length], CV[(g * 7 + 3) % CV.length]];
const W = generate({ size: 144, seed, type, players: [0, 1].map(i => ({ name: 'AB'[i], color: ['blue', 'red'][i], ai: true, style: decks[i], civ: civs[i], team: i })) });
const ais = W.players.map((p, i) => new AI(W, i, 'hard'));
// time the AI methods and the sim
const T = {}; const wrap = (o, name, key) => { const f = o[name].bind(o); o[name] = (...a) => { const t = performance.now(); const r = f(...a); const d = performance.now() - t; const k = key + '.' + name; if (d > (T[k] || [0])[0]) T[k] = [d, (W.t / 60).toFixed(1)]; return r; }; };
for (const a of ais) for (const m of ['tick', 'expand', 'lifeCare', 'research', 'trainArmy', 'water', 'homeGuard', 'defend', 'scoutTick', 'build', 'planSpot', 'expansionSite', 'otherLand', 'coast', 'enemyTarget', 'exploreTarget', 'invasion', 'economy2', 'wallRing', 'dockSpot']) if (a[m]) wrap(a, m, 'ai' + a.pid);
globalThis.__P = {}; let ws = [0, 0], spikes = [];
for (let n = 1; n <= 60 * 600 && W.winner < 0; n++) { for (const a of ais) a.tick(); const t = performance.now(); step(W); const d = performance.now() - t; if (d > ws[0]) ws = [d, (W.t / 60).toFixed(1)]; if (d > 120) spikes.push((W.t / 60).toFixed(1) + 'm ' + d.toFixed(0) + 'ms ent ' + Math.round(globalThis.__P._entities) + ' sep ' + Math.round(globalThis.__P._separate) + ' top ' + JSON.stringify(Object.entries(globalThis.__P.byOrder).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => k + '=' + Math.round(v)))); W.ev.length = 0; }
console.log(spikes.slice(0, 12).join(String.fromCharCode(10))); console.log('step worst', ws.map(x => typeof x === 'number' ? x.toFixed(0) : x));
for (const [k, v] of Object.entries(T).sort((a, b) => b[1][0] - a[1][0]).slice(0, 10)) console.log(k.padEnd(24), v[0].toFixed(0) + 'ms @' + v[1] + 'm');
