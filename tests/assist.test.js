// Main + Bantuan AI: the helper runs the economy of a player who does nothing, never touches what the player holds
// (selected, or ordered in the last `delay` seconds), takes over what was left alone, keeps to its scope, never makes
// the player's own decisions, and decides the same way again from the same command log (saves, replays).
//   node tests/assist.test.js [seed]
import { generate } from '../js/map.js';
import { step, command, nearestFree, addUnit, TICK } from '../js/sim.js';
import { GAME_SPEED, MILITARY } from '../js/data.js';
import { AI } from '../js/ai.js';
import { Assist } from '../js/assist.js';
const seed = +(process.argv[2] || 7);
let fails = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const world = () => generate({ size: 160, seed, type: 'padang', players: [0, 1].map(i => ({ name: ['Kamu', 'Merah'][i], color: ['blue', 'red'][i], ai: i > 0, team: i })) });
const game = (o) => { const W = world(); return { W, ai: new AI(W, 1, 'easy'), as: new Assist(W, 0, o) }; };
const tick = (G) => { G.ai.tick(); G.as.tick(); step(G.W); const ev = G.W.ev.slice(); G.W.ev.length = 0; return ev; };
const run = (G, s, each) => { const ev = []; for (let k = 0; k < s / TICK; k++) { ev.push(...tick(G)); if (each) each(); } return ev; };
const mine = (W, f) => [...W.dyn.values()].filter(e => e.owner === 0 && f(e));
const secs = (real) => real * GAME_SPEED;        // real seconds at 1x -> game seconds

// ---- a player who does nothing: the economy helper runs the town
{
  const G = game({ scope: 'eco', delay: 10 }), { W } = G, P = W.players[0];
  const v0 = mine(W, e => e.type === 'villager').length;
  const ev = run(G, 240);
  const vils = mine(W, e => e.type === 'villager');
  ok(vils.length > v0 + 4, `more villagers trained (${v0} -> ${vils.length})`);
  ok(vils.filter(v => v.order).length >= vils.length * 0.8, `they are put to work (${vils.filter(v => v.order).length}/${vils.length} busy)`);
  ok(mine(W, e => e.kind === 'building' && e.type === 'house').length >= 1, 'houses go up');
  ok(!mine(W, e => e.kind === 'building' && ['barracks', 'archery_range', 'stable'].includes(e.type)).length, 'economy scope: no military buildings');
  ok(P.age === 1 && ![...W.dyn.values()].some(b => b.owner === 0 && b.kind === 'building' && b.queue.some(q => q.tech && q.tech.startsWith('feudal'))), 'economy scope: no age-up in the queue');
  const scout = mine(W, e => e.kind === 'unit' && MILITARY(e.type))[0];
  ok(!scout || !scout.order, 'economy scope: the soldiers stay the player\'s (the scout was not sent anywhere)');
  ok(!ev.some(e => e.k === 'war' && e.owner === 0) && !(W.chron || []).some(c => c.owner === 0), 'economy scope: no war stories in the player\'s name');
}
// ---- what the player holds stays theirs; what they leave alone is taken over after the delay
{
  const G = game({ scope: 'eco', delay: 10 }), { W } = G;
  run(G, 6);
  const vils = mine(W, e => e.type === 'villager'), held = vils[0], sent = vils[1];
  G.as.select([held.id]);
  command(W, { t: 'stop', pid: 0, ids: [held.id] });
  const [gx, gy] = nearestFree(W, sent.x + 6, sent.y + 6, 0, 6);
  const c = { t: 'move', pid: 0, ids: [sent.id], x: gx + 0.5, y: gy + 0.5 }; command(W, c); G.as.note(c);
  let heldTaken = false, sentTaken = -1;
  run(G, secs(9), () => { if (held.order) heldTaken = true; if (sentTaken < 0 && sent.order && sent.order.t !== 'move') sentTaken = W.t; });
  ok(!heldTaken, 'a selected villager is left alone');
  ok(sentTaken < 0, 'a villager the player just ordered is left alone while the delay runs');
  run(G, secs(8), () => { if (sentTaken < 0 && sent.order && sent.order.t !== 'move') sentTaken = W.t; });
  ok(sentTaken > 0, 'after the delay the idle villager is put to work');
  ok(!held.order, 'still selected: still left alone');
  G.as.select([]);
  run(G, secs(4)); ok(!held.order, 'just let go: the delay starts again');
  run(G, secs(9)); ok(!!held.order, 'let go for longer than the delay: put to work');
}
// ---- the gate: the player's own decisions never pass, and nothing goes to a unit the player holds
{
  const G = game({ scope: 'full', delay: 10 }), { W } = G, as = G.as;
  run(G, 2);
  const [a, b] = mine(W, e => e.type === 'villager'); as.select([a.id]);
  const tc = W.ents.get(W.players[0].tc);
  for (const t of ['resign', 'tribute', 'pact', 'card', 'delete', 'bell', 'hire', 'mercaccept']) ok(as.gate({ t, pid: 0, id: tc.id, ids: [b.id], to: 1, with: 1 }) === null, `"${t}" is the player's call`);
  ok(as.gate({ t: 'smart', pid: 0, ids: [a.id], target: tc.id }) === null, 'no orders to the selected villager');
  ok(as.gate({ t: 'smart', pid: 0, ids: [a.id, b.id], target: tc.id }).ids.join() === String(b.id), 'a group order keeps only the free units');
  ok(as.gate({ t: 'place', pid: 0, type: 'house', i: 1, j: 1, ids: [a.id] }) === null, 'no foundation without a free builder');
  as.select([tc.id]);
  ok(as.gate({ t: 'train', pid: 0, bid: tc.id, type: 'villager' }) === null, 'a selected Town Center is the player\'s');
  as.select([]); as.scope = 'eco';
  for (let k = 0; k < secs(11) / TICK; k++) step(W);
  ok(!!as.gate({ t: 'train', pid: 0, bid: tc.id, type: 'villager' }), 'left alone: the helper may train villagers there');
  ok(as.gate({ t: 'research', pid: 0, bid: tc.id, tech: 'feudal' }) === null && !!as.gate({ t: 'research', pid: 0, bid: tc.id, tech: 'loom' }), 'economy scope: Loom yes, the age-up no');
  ok(as.gate({ t: 'place', pid: 0, type: 'barracks', i: 1, j: 1, ids: [b.id] }) === null && !!as.gate({ t: 'place', pid: 0, type: 'mill', i: 1, j: 1, ids: [b.id] }), 'economy scope: a mill yes, a barracks no');
  const [sx, sy] = nearestFree(W, tc.x + 6, tc.y + 6, 0, 6), sol = addUnit(W, 0, 'militia', sx + 0.5, sy + 0.5);
  for (let k = 0; k < secs(11) / TICK; k++) step(W);
  ok(as.gate({ t: 'move', pid: 0, ids: [sol.id], x: 5, y: 5 }) === null, 'economy scope: soldiers stay the player\'s');
  as.scope = 'full'; ok(!!as.gate({ t: 'move', pid: 0, ids: [sol.id], x: 5, y: 5 }), 'full scope: an idle soldier may be led');
  as.on = false; const n0 = W.cmds.length; as.tick(); ok(W.cmds.length === n0, 'switched off: the helper does nothing');
}
// ---- full scope with plenty to spend: it builds for war too
{
  const G = game({ scope: 'full', delay: 10 }), { W } = G, P = W.players[0];
  P.age = 2; for (const r of ['food', 'wood', 'gold', 'stone']) P.res[r] = 3000;
  for (let k = 0; k < 10; k++) { const tc = W.ents.get(P.tc), f = nearestFree(W, tc.x + 3 + k % 5, tc.y + 6 + (k / 5 | 0), 0, 6); addUnit(W, 0, 'villager', f[0] + 0.5, f[1] + 0.5); }
  run(G, 120);
  ok(mine(W, e => e.kind === 'building' && ['barracks', 'archery_range', 'stable'].includes(e.type)).length >= 1, 'full scope: military buildings go up');
}
// ---- the same log, the same helper (saves / replays)
{
  const play = () => {
    const G = game({ scope: 'eco', delay: 10 }), { W } = G; let h = 0;
    for (let k = 0; k < 900; k++) {
      if (k === 100) { const v = mine(W, e => e.type === 'villager')[0]; G.as.select([v.id]); }
      if (k === 400) G.as.select([]);
      tick(G);
    }
    for (const e of W.dyn.values()) if (e.owner === 0) h = (h * 31 + Math.round(e.x * 100) + Math.round(e.y * 7) + (e.order ? e.order.t.length : 0)) % 1e9;
    return h + ':' + W.players[0].res.food + ':' + W.players[0].res.wood;
  };
  const a = play(), b = play(); ok(a === b, `two runs from the same log end identical (${a})`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall ok'); process.exit(fails ? 1 : 0);
