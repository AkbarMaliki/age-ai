// Summarise tournament.mjs output (JSON lines on stdin or files given as arguments).
import fs from 'fs';
const lines = (process.argv.length > 2 ? process.argv.slice(2).map(f => fs.readFileSync(f, 'utf8')).join('\n') : fs.readFileSync(0, 'utf8')).split('\n').filter(l => l.startsWith('{'));
const G = lines.map(l => JSON.parse(l));
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const f1 = (x) => x.toFixed(1);
console.log(`games ${G.length} | decided ${G.filter(g => g.winner >= 0).length} | avg length (decided) ${f1(avg(G.filter(g => g.winner >= 0).map(g => g.minutes)))} min | worst tick ${Math.max(...G.map(g => g.perfWorstMs))} ms`);
const tally = (key) => {
  const t = {};
  for (const g of G) g.players.forEach((p, i) => { const k = p[key]; t[k] ||= { games: 0, wins: 0, losses: 0 }; t[k].games++; if (g.winner === i) t[k].wins++; else if (g.winner >= 0) t[k].losses++; });
  return Object.entries(t).map(([k, v]) => `${k} ${v.wins}W/${v.losses}L/${v.games - v.wins - v.losses}D`).join(' · ');
};
console.log('by personality:', tally('style'));
console.log('by civilization:', tally('civ'));
const byMap = {}; for (const g of G) { byMap[g.map] ||= []; byMap[g.map].push(g.winner >= 0 ? `${g.minutes}m` : 'draw'); }
console.log('by map:', Object.entries(byMap).map(([k, v]) => `${k} [${v.join(', ')}]`).join(' · '));
const P = G.flatMap(g => g.players);
for (const a of [2, 3, 4]) { const t = P.map(p => p.ageAt[a]).filter(Boolean); console.log(`age ${a}: reached by ${t.length}/${P.length}, avg at ${f1(avg(t))} min (min ${Math.min(...t)}, max ${Math.max(...t)})`); }
const tr = {}; for (const p of P) for (const [k, v] of Object.entries(p.trained || {})) tr[k] = (tr[k] || 0) + v;
console.log('units trained:', Object.entries(tr).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '));
const gr = { food: 0, wood: 0, gold: 0, stone: 0, iron: 0 }; for (const p of P) for (const k in gr) gr[k] += p.gres[k] || 0;
const tot = Object.values(gr).reduce((a, b) => a + b, 0); console.log('gathered share:', Object.entries(gr).map(([k, v]) => `${k} ${Math.round(v / tot * 100)}%`).join(', '));
const ev = {}; for (const g of G) for (const [k, v] of Object.entries(g.events)) ev[k] = (ev[k] || 0) + v; console.log('life/other events (all games):', JSON.stringify(ev));
const dc = {}; for (const p of P) for (const [k, v] of Object.entries(p.deaths || {})) dc[k] = (dc[k] || 0) + v; console.log('deaths from needs:', JSON.stringify(dc));
console.log(`life: fun ${f1(avg(P.filter(p => p.life).map(p => p.life.fun)))} health ${f1(avg(P.filter(p => p.life).map(p => p.life.health)))} prosper ${f1(avg(P.map(p => p.prosper)))} | hungry days ${f1(avg(P.map(p => p.hungryDays)))}/player`);
const bl = {}; for (const p of P) for (const k of ['tavern', 'well', 'hospital', 'barn', 'outpost', 'town_center', 'castle', 'market', 'monastery', 'dock', 'siege_workshop', 'wonder']) bl[k] = (bl[k] || 0) + (p.blds[k] ? 1 : 0);
console.log('players ending with (of ' + P.length + '):', JSON.stringify(bl));
console.log('per game:'); for (const g of G) console.log(`  #${g.g} ${g.map.padEnd(10)} ${String(g.minutes).padStart(4)}m ${g.winner >= 0 ? 'win ' + 'AB'[g.winner] : 'draw '} | ` + g.players.map(p => `${p.style}/${p.civ} age ${p.age} pop ${p.pop} k${p.killed}/l${p.lost} terr ${p.terr}`).join(' vs '));
