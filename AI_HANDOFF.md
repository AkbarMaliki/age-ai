# Abad Kerajaan — handoff guide for the next AI / developer

> **Ringkas (ID):** Dokumen ini menjelaskan cara kerja game RTS ala Age of Empires II "Abad Kerajaan": tiga folder kerja, semua tools dan pipeline yang sudah dibuat, cara menjalankan/menguji/deploy, jebakan yang sudah ditemukan, dan daftar pekerjaan berikutnya. Baca ini dulu sebelum mengubah apa pun.

The user is Indonesian and talks to the AI in Indonesian. UI text is in Indonesian; code and comments are in English.

The user's goals, in order:
1. Look as close to AoE2 as possible (realistic, not cartoony).
2. Complete AoE2-style mechanics.
3. Runs well in a browser, phones included.
4. Lively UX: sound, voices, feedback.

---

## 1. Folder map (all under `Desktop/ai test/`)

| Folder | What | Language |
|---|---|---|
| `age/` | **The game.** Static web app: PixiJS v8 from CDN via an import map, ES modules, no bundler. | JS |
| `_art/` | **Sprite factory.** Blender (headless, Cycles CPU) renders 3D models into isometric sprites; Python packs them into atlases in `age/assets`. | Python + bpy |
| `_audio/` | **Sound studio.** Music (SoundFont + pedalboard), unit voices (Piper TTS), sound effects (Kenney CC0 recordings). | Python |
| `frontier/` | Another, older RTS project. Only its `node_modules/playwright-core` is reused for browser tests. **Its Firebase hosting is the default site of project `vuez-63625`. Never deploy over it.** | TS |

Other folders (`overcooked`, `monopoly-ai`, `poker-ai`, …) are other games by the same user and are unrelated.

## 2. Run / test / deploy (in `age/`)

| Task | Command |
|---|---|
| Play locally | `start.bat` (opens http://localhost:8772, keeps a server window open) or `node server.cjs 8772`. `stop.bat` kills whatever listens on 8772. |
| Map fairness test | `node tests/map.test.js [seeds]`: every map type × 2/3/4 players; prints per-player home wood/gold/stone/food and fails if any resource gap between players exceeds 25% or a town can't walk to the others. Part of `npm test`. |
| Headless AI-vs-AI sim test | `npm test`, or `node tests/sim.test.js [minutes] [seed] [mapSize] [mapType\|random] [players]`. Also prints when each AI first spotted an enemy building (scouting check: normally 2–12 game-min). Prints the economy every 3 min, worst tick in ms and event counts. A healthy run: 25 game-min on a 144 map in about 5 s, worst tick under 60 ms. |
| Browser tests | Needs the server running. Run `node tests/browser/<name>.cjs [outDir]` with `<name>` one of `features`, `mobile`, `spectator`, `freecam`, `zoom`, `stats`, `endgame` (market, cards, surrender, defeat screen). `stats` covers the war statistics panel. They use system Chrome (`C:/Program Files/Google/Chrome/Application/chrome.exe`, `--use-angle=d3d11`). Set `BASE=http://localhost:PORT/` to test another server, e.g. a served `docs/` build. Debug hook: `window.__ak = { game, start, app }`. Fast-forward pattern: `import('/js/sim.js')` then call `step(W)` in a loop with `ai.tick()`. |
| Build for the web | `build.bat` runs `python tools/build.py`. It writes **`docs/`** (GitHub Pages "main /docs"): PNG atlases become WebP (assets go from about 37 MB to 25 MB), it adds `.nojekyll` and a cache-busting `?v=` on main.js and style.css, and also writes `abad-kerajaan-web.zip` for itch.io. |
| Deploy | `build.bat` then pick an option:<br>**2 = git commit & push.** Runs `git init` + `remote add` if needed; the default repo is `https://github.com/AkbarMaliki/abad-kerajaan.git`. The user must enable Pages (main / docs) once.<br>**3 = Firebase Hosting.** Uses the *separate* site `abad-kerajaan-game` via `npx firebase-tools@13`, because the user's Node is 18.20 and firebase-tools 14 needs Node 20. |

`docs/` is generated, so never hand-edit it. Edit the source and rebuild. Screenshots for the user live in `screenshots/`.

## 3. Game architecture (`age/js`, about 2.7k lines)

```
main.js   boot, menu, Game class: loop, events -> fx/sound/notify, camera, input (mouse + touch), placement,
          spectator mode, zoom, fullscreen. IS_TOUCH flag. window.__ak debug handle.
sim.js    deterministic simulation (no rendering). TICK = 0.1 game-s. Every input is a queued command (lockstep-ready).
ai.js     computer player (one AI instance per AI player; spectator mode = AI for everyone).
map.js    random map types (MAP_TYPES: padang, rimba, danau, sungai, tambang; 'random' picks one), random rotation + seats,
          one shared home layout per game, map-wide features copied per seat, balance() top-up, connect() safety carve.
cards.js  CardPanel: Home City shipment deck (AoE3 cards), XP bar in the top bar; DeckBuilder (menu, 20-card deck).
advisor.js "!" Penasihat: enemy army mix from sightings / spy reports -> counter units, doctrine, formation.
achievements.js 25 achievements + profile rank (localStorage ak_profile), recorded on the end screen.
stats.js  score(), snapshot(), History (timeline every 10 game-s + first-contact log), StatsPanel ("Statistik Perang").
data.js   all numbers: UNITS (incl. animals/bandit), BUILDINGS, TECHS, RESOURCES, RATE, TREASURES, GAIA = -1.
render.js PixiJS View: terrain mesh + custom shader (texture blend, water, fog), depth-sorted sprites, particles,
          selection/HP bars, rally flags, floating text, fx(event) effects, spectator reveal.
ui.js     HUD: top resource bar, 5x3 command grid (hotkeys QWERT/ASDFG/ZXCVB), info panel, diamond minimap, tooltips.
assets.js atlas loader; per-player tint baked on a canvas; mobile atlas downscale (CanvasSource resolution trick).
audio.js  synth SFX fallback + sampled SFX (assets/sfx) with pan/attenuation + unit voices + music playlists + ambience.
```

### Simulation essentials (`sim.js`)
- **Entities** live in `W.ents` (Map id → entity), with `kind` one of unit | building | res | proj | corpse | rubble | treasure | timer.
- **`W.dyn`** holds every entity except static resources (trees, mines, berries). Iterate `W.dyn` for anything per-tick; never iterate `W.ents` in hot paths, since about 3000 trees live there. Remove entities **only** with `del(W, id)`, which deletes from both maps.
- **`W.ugrid` / `unitsNear(W, x, y, r, fn)`** is a coarse 8-tile grid of units, rebuilt each tick. Use it for neighbourhood queries.
- **Occupancy:** `W.occ` (tile → entity id) marks blocking buildings and resources. `passable(W, i, j, owner)` treats your own gates as open.
- **Regions:** `regions(W)` labels connected walkable areas and recomputes lazily when `W.regionDirty`. `canReach(W, u, t, reach)` rejects unreachable targets before running A*. `markUnreachable` remembers them for 25 s. This was the big late-game performance fix; don't remove it.
- **A\*:** `findPath` uses 8 directions with no corner cutting, a flat binary heap, and weighted A* (heuristic ×1.8 for trips longer than 24 tiles). Budgets per tick: 10 searches, 25k nodes. `smooth()` has a bounded look-ahead of 10, because unbounded look-ahead was O(n³).
- **Gaia** (nature and bandits) has owner `-1`. `W.gaia` is a pseudo-player, so use `pl(W, owner)` instead of `W.players[owner]` whenever the owner might be gaia.
  - `UNITS[t].animal` is one of `herd` (sheep, convertible), `flee` (deer), `fight` (boar strikes back), `predator` (wolf) or `guard` (bear). Bandits have `guard: true`.
  - Behaviour lives in `gaiaTick`.
  - Passive animals are never auto-targeted (`passive()`).
- **Hunting:** a villager sent to an animal gets `{t: 'attack', hunt: true}` and throws spears (range 2.5). When the animal dies, a `res` of type `carcass` is created. It doesn't block, and it slowly spoils. The villager then gathers it with the `hunt` animation and carries meat.
- **Treasures:** `kind: 'treasure'` with `guards: [ids]`. `treasureTick` pays the first non-gaia unit that comes within 1.4 tiles once no guard is within 9 tiles, then emits the `treasure` event.
- **Events:** `W.ev`, drained each frame by `Game.onEvent`, or `onSpectatorEvent` in spectator mode. Event names:
  - Work and combat: chop, mine (`res`), farm, forage, hunt, hammer, swing, shoot, arrowhit, hit, die, treefall.
  - Economy: deposit (`res`), built, trained, tech, age, housed, sheep, treasure.
  - Structures and game state: collapse, place, ack, defeated, victory.
- **Villager mechanics:**
  - Carry 10 (+3 with Wheelbarrow), with AoE2-like gather rates (`RATE`). Drops go to the nearest drop site.
  - Building speed follows the AoE2 formula `3t/(n+2)`.
  - After finishing a building, a villager auto-gathers the matching resource, or helps the nearest foundation within 12 tiles.

### v4 systems (sim.js unless noted)
- **Derived stats:** never read `UNITS[t].atk` etc. for gameplay — use `stat(W, owner, type)` / `bstat(W, owner, type)`; they apply blacksmith techs, doctrines (`group: 'doc1'|'doc2'`, exclusive), cards (`P.mods`), specialists. Cached per player, invalidated by `bumpStats` (also stretches existing units' HP).
- **Counters:** `cls` + `bonus` in data.js: spear > cavalry > archer > infantry. Specialists (`TECHS[t].spec = [from, to]`, exclusive per line) convert existing units and `trainType(P, type)` maps future training. Specialists reuse base sprites with `tint` / `scale` (`UNITS[t].sprite`). Ninja `stealth`: `hiddenFrom(W, e, pid)` (render + targeting).
- **Iron** is the 5th resource (RES). Mining camps / TC accept it. Used by late blacksmith techs, Akademi, gunpowder units.
- **Terrain:** `TER` codes in data.js. HILL: 0.72x speed, +25% damage and +1 range / los from high ground. ROCK: impassable. Water passable for land units when `W.frozen` (winter). `passable(W, i, j, owner, nav)` — `nav` = ships (open water only). Regions are kept for land and water separately.
- **Ships:** `UNITS[t].naval` -> `u.nav`. Fishing boats gather `fish` (res on water) and drop at a dock; transports carry `capacity` units (`board` order / `unload` command, cargo is removed from `W.ents` while aboard and dies with the ship). Docks: `BUILDINGS.dock.water`, placement needs water + a shore tile.
- **Roads:** `buildRoad` on every finished building (A* from its door to the nearest TC/castle, merging into existing roads) -> `W.road` (+15% speed). Rendered from a road mask texture.
- **Day / night** (`W.opts.night` full/visual/off, `DAY` in data.js): dusk sends gatherers, builders and idle villagers home (`rest` order; houses shelter 5, a TC 15) where they go inside (`u.inside` = building id: hidden, not targetable, skipped by separation / minimap / box select; any other order or the home falling brings them out) unless `torches` tech / `nightWork` card. `restNow(W, P)`: idle / newly trained villagers go home too and the AI sends nobody out until dawn; night los x0.65; dawn: food upkeep per pop, hunger slows gathering for the day.
- **Seasons / weather:** `SEASONS` (farm/hunt/berry/speed/los modifiers, `frozen`, `snow`); rain periods (`W.rainUntil`) lower accuracy and los.
- **Formations:** `u.form` (garis/tempur/kotak/menyebar) via `{ t: 'form' }`; `formationTick` computes `u.fb` (armour / miss / speed bonuses); formations march at the slowest member's speed (`order.gs`).
- **Foundations** with 0% progress are not `targetable` (enemies used to fixate on fresh foundations).
- **Repair:** villager right-click on own damaged building -> `repair` order, costs half the build cost per HP.
- **Spy ability** (Akademi + spy_network): `{ t: 'ability' }` -> enemy positions in vision 30 s + `spy` event with `spyReport()`.
- **AI** (ai.js): personality from a random `DECKS` preset (`STYLE`), counter-picks doctrines / specialists / unit mix from `foes` sightings + spy reports, formations per attack, towers + a wall ring with gates (`wallRing`), repairs, docks / fishing / fleet / transport invasions on islands (`invasion` state machine), forward camps on big maps, and a town planner in `build()` (street grid every 7 tiles, rows of houses, no building on roads).
- **Renderer:** relief shading (hills/rock), road mask, snow / autumn / ice uniforms, day-night `uLight` multiplying every sprite tint, additive glow pool (windows, torches, campfires), chimney smoke, birds, rain / snow overlay, windmill sails (`mill_body` + `mill_sail_N`), TC sprite by age (`town_center_dark` / `_castle`), house style by the age it was built in.
- **Art added:** `_art/structures.py` blacksmith, academy, dock, town_center_dark/_castle, iron_a/b, `mill_anim`; `_art/vehicles.py` (new) renders fishing_boat, transport_ship, war_ship, ram, cannon in the unit layout. Pack into THIS repo with `python -c "import pack,os; pack.OUTD=os.path.abspath('../age-ai/assets'); pack.PLAYER_UNITS += [...]; pack.units(); pack.buildings(); pack.icons()"` (pack.py defaults to ../age/assets).
- **Path budget:** A* is capped per tick (`W.paths` / `W.nodes`). A gatherer that fails to reach a resource twice marks it with `markUnreachable` (`unreachable(W, id, owner)`), and `nearestResource` plus the AI's hunting skip it, so nobody retries enclosed sheep and carcasses forever (this used to saturate the budget and freeze every unit on islands maps).
- **Late shift:** `torches` tech / `nightWork` card no longer mean all-night work. Villagers work by torchlight until `MIDNIGHT` (middle of the night, sim.js), then `restVillagers` sends them indoors like everyone else (`W.midnight` flag in `dayTick`; `restNow` covers both).
- **Night light map (render.js):** at night the world is drawn unlit, then a half-resolution `RenderTexture` (ambient colour + additive radial pools from `light2()` calls: carried torches, windows, campfires, burning buildings) is multiplied over the world layers (sprite `lightS`, between `sky` and `over`, so health bars and the placement ghost stay bright).
- **Docks on big islands:** `ai.dockSpot()` ring-searches up to ~110 tiles for the nearest explored dock site a builder from home can reach (the coast can be 40+ tiles from the TC on 220/280 island maps; the old 8-tile search never found it, so no ships were built). Fish search 80 on island maps; `coast()` up to 110 tiles, same landmass.
- **Specialist icons:** `pack.icons()` builds gunner/samurai/ninja/fire_archer/crossbow/cataphract/lancer icons from the tinted base portrait on a purple ground with an emoji badge (Windows `seguiemj.ttf`), plus `stone_wall`/`gate` aliases.
- **AI food reserve:** from 40% of the day until the dawn upkeep, `ai.foodKeep` (tomorrow's upkeep +15%) is never spent on villagers, soldiers, scouts, techs or the next age; the market buys food if short. Winter scales the AI's farm count by 1 / `season.farm`. Builders give up on foundations they can't reach (`unreachable`), the AI cancels them, and wall-ring tiles must touch the home region.
- **Units atlas** now also holds fishing_boat, transport_ship, war_ship, ram and cannon (`pack.PLAYER_UNITS += [...]`).
- Tests: `npm test` = map + sim + `tests/naval.test.js` (dock, fishing, board/sail/unload, warship fire). Slower ones: `tests/stuck.test.js [min] [seed] [size] [players] [map]` (stuck-unit detector). Browser: `tests/browser/world.cjs` (seasons, day/night, formations, advisor, deck, achievements), `tests/browser/vehicles.cjs` (ship / siege sprites).

### Strategy layer v5 (data.js / sim.js / ai.js)
- **Age paths:** each age-up is one of three exclusive techs (`group: 'age2' | 'age3'`): feudal (Kemakmuran: +10% gather), feudal_war (Pedang: 4 free militia, +15% train speed), feudal_wall (Benteng: +250 stone, +15% building HP, +1 tower attack), castle (Akademi Agung: `mods.techCost` 25% cheaper/faster research via `techCost` / `techTime`), castle_war (Panji Perang: 3 knights, +10% HP), castle_trade (Jalur Sutra: gold trickle, -10% market fee). Techs may carry `mods` / `give` / `units` (applied in `finishTech`, `giftUnits` shared with card shipments). The AI picks from `STYLE.ages` (25% chance to improvise).
- **New units** (own 0 A.D.-based renders): skirmisher (anti-archer, `proj: 'javelin'`), horse_archer (`mounted`, `kite`), pikeman (`pikes` tech converts spearmen), healer (`heal`, `healRange`; auto-heals, smart right-click heals). Specialists no longer reuse tinted base sprites.
- **New techs:** drill, pikes, thumb_ring, parthian (all archers kite), husbandry, flank_tactics, medicine (healers +50%, soldiers regenerate after 8 s unhurt, via `u.hitT`), civic_defense.
- **Tactics:**
  - Stances: `{ t: 'stance', s }` with `u.stance` = undefined (agresif) | bertahan (returns to `o.gx/gy` beyond 6 tiles) | diam (never moves for auto targets) | pasif (no auto attacks, no retaliation).
  - Town bell: `{ t: 'bell', on }` sets `P.bell`. `restNow` is true while it rings, so villagers shelter in `ROOM` buildings. `W.garr` counts who is inside, and buildings with an attack fire extra arrows: 1 per 4 sheltered villagers, 1 per 2 with civic_defense, at most +5 (more made weak players unkillable).
  - Flank: melee hits from more than 100° off the target's facing do x1.25 (x1.5 cavalry with flank_tactics).
  - `findEnemy` prefers targets the unit has a bonus against, and melee cavalry dives for archers, siege and healers.
  - Kiting: units with `s.kite` step away from melee while reloading (`meleeThreat`).
  - The AI rings the bell when 4 or more enemies are at its TC and outnumber the defenders.
- UI: academy has two pages (`PAGES` in ui.js, slot 14 flips). TC row 2 holds the three age paths, slot 10 the bell (hotkey B). Soldiers get formations in row 1 and stances in row 2.
- Art: `zad/resolve.py` recipes for the 11 units (`ELITE` frame counts, `prop_tex`, `force_props`, per-recipe rider states). Custom textures live in `downloads/0ad/textures/skins/custom/` (samurai red lacquer, ninja black). `zad/make_arquebus.py` builds the gunner's matchlock prop. `bl/common.py` renders on the GPU with `AK_GPU=1` (OptiX).
- **Villager self-defence** (`villagerDefend` in sim.js, called from `damage`): a villager hit in melee fights back (`order.defend`, `order.resume` = its old order) and up to 3 villagers within 3 tiles join. They give up 5 tiles from where they started, and ignore archers, ships, sheltering and badly hurt villagers.
- Lockstep: a host that has used up every turn (e.g. just promoted) publishes the next turns itself; this used to deadlock host migration.
- Tests: `tests/tactics.test.js`. Art: `_art/render_new_units.sh` renders the v5 units one after another (`AK_GPU=1`, `AK_SAMPLES=12`; parallel Blenders crawl), then `pack._pack_set('units', pack.PLAYER_UNITS, True); pack.icons()` with `pack.OUTD` set to this repo.

### v6: civilizations, monks & relics, command queue, saves / replays, new menu
- **Civilizations** (`CIVS` in data.js; `P.civ`):
  - Bonuses come from `mods`, `start` (resources, extra villagers spawned in map.js), `stat` (per class) / `unitStat` (per unit) multipliers in `stat()`, and `cost` discounts via `unitCost(P, type)`. Use `unitCost` everywhere instead of `UNITS[t].cost`.
  - The unique unit is `P.spec.unique`; the castle's `'unique'` train slot resolves it via `trainType`, and `canTrain` lets it skip its research.
- **Monks** (Biara/monastery; `UNITS.monk` with `convert`, `faith`, `heal`):
  - `convert` order: needs full `u.faith`, then channels 4–10 s (`W.rnd`) before `changeOwner`. Monks, siege, ships and animals can't be converted.
  - Relics: `addRelic` places them in map.js (one per player, symmetric, plus the centre). The `relic` order picks one up (`u.relic` / `r.carrier`) and carries it into a monastery (`r.inBld`).
  - `relicTick` (every second) drops relics whose carrier died or whose monastery fell, pays `RELICS.gold`/s per kept relic, and runs the optional relic victory (`W.opts.relicWin`, hold every relic `RELICS.win` s).
- **Command queue / extra orders:**
  - A command with `q: true` is queued. `CMD` is set while `applyCmd` runs, so `setOrder` pushes to `u.oq` for queued player orders and clears the queue for normal ones; internal setOrders are untouched. The next queued order is popped when idle.
  - New orders `patrol` (`ax/ay/bx/by/leg`), `follow` (guard a friendly unit; an enemy target means attack) and `ground` (splash siege bombards a point).
  - UI: row 3 of the soldier grid opens a targeting mode (`Game.startTarget`); Shift + right click queues. Selected units draw their queued path.
- **Saves / replays** (js/saves.js, `Game.makeSetup` / `record` / `feed` / `tickOnce`):
  - A save is `{ setup, cmds: [[tick, cmd]], tick }`. `setup` holds every random choice (seed, civs, AI styles); every player command is logged in `Game.send`, and online commands in `Lockstep.boundary`.
  - Load = rebuild from setup and fast-forward to `tick` (`Game.ff`) feeding commands before the AIs think, then play on. Replay = same in spectator mode at normal speed.
  - Autosave slot `auto` every 2 game-minutes offline. `tests/browser/saves.cjs` checks that load and replay reach the same state hash.
  - **UI must never change sim state directly**, or saves and online diverge.
- **Menu:** home has 5 big buttons plus an icon row. Every setting lives in `#setup` (the generic `.seg[data-k]` binding still drives `opts`); there are also `#settingsModal`, `#civModal` and `#loadModal`. Tests still start a game with `#btnPlay` (Main Cepat = last settings).
- Art: `structures.py` `monastery`, `relic`; monk recipe in `zad/resolve.py` (Celtic healer, brown habit, hood).

### v7: Imperial Age, siege, garrisons, trade, eco II, ships, game modes, diplomacy, lobby rules, tech tree
- **Imperial Age** (`AGES[4]`): TC techs `imperial` / `imperial_war` / `imperial_lore` (`group: 'age4'`, `toAge: 4`, `reqFrom` castle/siege workshop/monastery/academy/market).
- **Unit lines:** a tech with `up: { types, name, hp, atk, ma, pa, range, splash, vsBuilding, bonus }` is applied in `stat()` (the `name` overrides the display name; `stat(W, pid, type).name` is what the UI shows). Chains use `after`; the UI shows only the next step of a chain (techs of one line share a slot in `SLOTS`).
- **Siege workshop:** ram (moved off the barracks), `mangonel` (splash, `minRange`, proj `rock`), `scorpion` (proj `bolt`, line splash). `trebuchet_p` (packed, trained at the castle) ⇄ `trebuchet` (`packs` points at the other form; `u.packT` 4 s). It packs when told to move and unpacks when an attack target is in range. The `pack` command toggles it.
- **Garrison:** order `garrison` (`u.inside = host id`, healing 1 HP/s). Hosts: buildings with `garrison: n` (TC 15, castle 20, tower 5) and rams (infantry; +8% speed each). `separate()` builds `W.garr`/`W.garrK`; arrows per building = villagers (bell) + soldiers. `ungarrison {bid}` empties a host. Military smart right-click on an own garrisonable building/ram = garrison.
- **Walls:** `palisade` (Dark Age, wood; sprites `pal_*`), `guard_tower` / `keep` techs change `bstat` and the sprite key; gates `lock` (`b.locked`, allies pass when unlocked).
- **Trade:** `trade_cart` (market) / `trade_cog` (dock), order `trade { home, dest, leg }`; gold = distance × 0.9 (own) / 1.3 (ally) delivered at home (`tradegold` event).
- **Economy II:** gather techs with `mods.gather`, `farmFood` (farm size), `hand_cart`. Reseed queue `W.reseed[pid]` (pre-paid; `reseed {n}` ±; an exhausted farm with a queue is replanted). `fishtrap {bid}` lays a 700-food fish res (`trap: true`).
- **Ships:** `fire_ship`, `demo_ship` (`explode`), `cannon_galleon` (gunpowder, Imperial), `galleon` tech (war ship line).
- **Game modes** (`W.opts.victory`, `ruleTick` every second): `regicide` (`P.king`, a hero unit; killing it defeats the player), `koth` (`W.monument` via `addMonument`; one team alone within 5 tiles captures; hold `KOTH_TIME`), wonders (any mode: `W.wonders` id → built time, hold `WONDER_TIME`). `W.opts.treaty` (seconds) makes `enemies()` false until it ends. `START_PRESETS` (standar/sedang/tinggi/deathmatch), `W.opts.popLimit`.
- **Diplomacy:** teams are fixed at setup (`opts.teams` ffa/ally in `Game.makeSetup`; the lobby already had teams). Allies share vision. `tribute {to, res, n}` (80% arrives), `flare {x, y}` (Alt+click map/minimap, or 🤝 panel).
- **Setup/lobby:** `#setup .rules` segs (victory, treaty, startRes, popLimit, speed) → `setup.*` → `generate` opts. Online: lobby `CFG` has the same keys; `Lockstep.update` multiplies by `setup.speed`.
- **UI:** goal countdowns in `#goalInfo` (treaty, wonders, monument), `#diploPanel`, `js/techtree.js` (`#techModal`, from the home icon row and 🌳 in game). Render stand-ins (`SPRITE_FALLBACK`, `BLD_FALLBACK`) keep units visible if an atlas lacks their art.
- **AI:** `agePath[4]`; saves for the next age (`this.reserve` + `afford()`; armies/research only spend above the age-up cost after 5–7 min in an age); unit-line and eco techs; siege workshop + mangonel/scorpion; trebuchets vs castles/towers/wonders (explicit smart attack on the wave target); fire/demolition ships vs fleets; trade carts to allied markets; reseed queue and fish traps; tribute to starving allies; king garrisoned; army to the monument in KotH; no waves during a treaty; palisade ring for the walls style; wonder when rich.
- **Tests:** `tests/rules.test.js` (in `npm test`) checks every rule headlessly; `node tests/imperial.test.js [min] [seed] [victory] [startRes]` plays a 2v2 AI game and lists v7 techs used (AIs reach Imperial around 45–50 min with standard resources); `tests/browser/rules.cjs` drives the setup rules, diplomacy, tech tree and new buttons.
- Art: `structures.py` siege_workshop, wonder, monument, guard_tower, keep, fish_trap, pal_*; `vehicles.py` mangonel, scorpion, trebuchet(_p), fire/demo ship, galleon, cannon galleon, trade cart/cog (`_art/render_v7.sh`); king = 0 A.D. Alexander (`zad/resolve.py`).

### v8: the kingdom looks older with every age (render only)
- **Buildings:** `structures.py` `AGE_STYLE` + `styled(M, age)` re-materials a building (Dark = thatch/daub/field stone, Feudal = default, Castle = ashlar + slate, Imperial = limestone, blue glazed tiles, red lacquer, gold trim) and `decorate()` adds pennants / a gold finial. Rendered as `<key>_a1/_a3/_a4` (`blender ... structures.py -- ages`, or `name@age`). `common.pbr(..., sat=)` desaturates a texture before tinting. `render.buildingKey` appends `_a<age>` (the owner's current age, like AoE2) when the atlas has it; houses pick a variant by `id % 3`.
- **Roads:** `W.road[k] = owner + 1` (sim treats it as a boolean). `updateRoads` writes the owner's age into the green channel; the terrain shader draws earth → gravel → cobbles → paved slabs with kerbs. `buildProps()` places street furniture by a fixed hash along roads of Castle/Imperial kingdoms (`lamp_a3`, `lamp_a4`, `banner_a4` sprites; lamps add light pools at night). Visual only.
- **Unit looks:** an `up` tech may carry `look: { type: sprite }`; `stat()` sets `s.sprite`, `View.unitSet` and `HUD.spriteOf` use it when the atlas has it. Looks: `militia_2` (Man-at-Arms/Long Sword), `militia_3` (Champion), `halberdier`, `arbalest`, `hussar`, `paladin` (recipes at the end of `zad/resolve.py`; run `python zad/resolve.py <names>` to write the jobs before `render_units.py`). Script: `_art/render_ages2.sh`.

### Online multiplayer (js/net.js, js/lockstep.js, js/lobby.js)
- **Firebase RTDB** (config `js/firebase-config.js`, project vuez-63625 like the other games). Room `/age/rooms/{CODE}`: `meta` (host, status, lobby cfg), `players` (seats incl. bots), `watchers`, `game` (seed, cfg, seats; written at start), `turns/n`, `in/pid`, `ack/pid`, `chat`. `/age/index/{code}` = created, used to sweep rooms older than 24 h. Link `?room=CODE` auto-joins (lobby) / rejoins (running game, same `sessionStorage` pid) / watches.
- **Lockstep:** the sim and AI are fully deterministic (seeded rng, no Math.random / time). The host publishes turn n+LEAD (TPT=2 ticks, LEAD=3) at the start of turn n with all queued commands. Commands are JSON strings and the host overrides `pid` with the sender's seat. Clients only simulate turns they have. Host waits for players more than 40 turns behind. Every 25 turns a state hash (`stateHash`) is compared, and a mismatch shows a desync warning.
- **Meta commands** `_ai` / `_human` (host, after 15 s offline / on return) attach or detach an AI for that seat on every client. Host migration: the first-joined online human takes `meta/host` by transaction and continues publishing after a 1.5 s grace.
- **Game integration:** every player action goes through `Game.send(c)`, never `command(W, …)` directly (that would desync). UI must never mutate sim state: the old local `u.form = f` was removed for this reason. AIs for bot seats run on all clients. Online: no pause or speed change; Enter / 💬 opens chat.
- **Tests:** `tests/online.test.js` (in-memory fake RTDB with latency: host + guest + late spectator, drop/rejoin AI handover, host migration; hashes must match). `tests/browser/online.cjs` (two real browser profiles against the real RTDB: lobby via link, start, guest command, chat, same hash, reload-rejoin, host leaves; deletes its room).
- Cross-browser float differences (Chrome vs Firefox Math.* functions) could in theory desync. They would be detected and reported, not silently diverge.

### End of game, Market, cards
- **Defeat (conquest):** `keepsAlive(e)` — a player stays in while they own a non-animal unit or a *finished* building other than walls, gates, farms and houses. `checkVictory` (every 10 ticks) then destroys the loser's leftovers. **Resign:** command `{ t: 'resign' }` (pause menu "Menyerah", confirm twice; AI `hopeless()` = no TC and no way back for 20 s). Event `defeated` has `resign`. In 3–4 player games a beaten human gets "Tonton sisa pertandingan" (map revealed, `Game.lost`/`seeAll`).
- **AI targeting:** `enemyTarget()` skips farms (non-blocking, so soldiers never auto-acquire them — armies used to idle on an enemy farm forever) and prefers Town Centers and production; a target attacked 3 times without falling is skipped for 240 s; when few enemy buildings are left, waves of 5 finish the job; survivors are hunted via `foes` sightings and `staleTarget()`. Melee units have `vsBuilding` attack bonus.
- **Market (`Pasar`, Feudal, needs Mill):** command `{ t: 'trade', bid, res, buy }`, lots of 100; prices in `W.market` are shared and move ±`MARKET.step` per trade and drift back to `MARKET.base`; fee 30% (15% with `guilds`, card `merchants` −10%); `trade_route` tech = 24 gold/min per market. Sprite rendered by `_art/structures.py market` and packed with `pack.OUTD` pointed at this repo's `assets` (pack.py defaults to `../age/assets`).
- **Cards (AoE3 shipments):** `addXp()` from gathering, building, research, kills, treasures (`XP` in data.js); thresholds grow by `XP.step`. `P.ships` available, command `{ t: 'card', card }`, one shipment travels at a time (`XP.travel` s) and `deliver()` applies `give` / `units` / `mod` (`P.mods`: gather %, villager speed, soldier armour, market fee). Events `shipready`, `shipsent`, `shipment`. AI: `pickCard()`.

### Map generator (`map.js`) notes
- Fairness: per-player resources follow one random layout `L` (angles relative to the direction of the map centre); forests, loose trees, neutral mines, wolves and mid treasures are generated for seat 0's wedge and rotated to every seat. `balance()` then tops up any player below 88% of the best on wood/gold/stone/food within 26 tiles (`homeResources`). `connect()` carves a path if a town is cut off.
- `noise2` wraps around. It used to read past its grid for the stretched lookups (`n2(i * 2, …)`), returning NaN, so forests silently failed on part of the map — that's why trees used to bunch up in one region.
- River (`sungai`): one arm between each pair of neighbouring seats; fords are dirt tiles marked `reserved = 2` (nothing spawns on them).
- `W.map = { type, name, desc, seed }`.

### AI (`ai.js`) key points
- `DIFF` is easy, normal or hard. Every `think` seconds the AI:
  - trains villagers and builds houses;
  - places a mill at the berries;
  - relocates lumber camps when the average tree-to-camp distance is over 6 (`needCamp` reserves wood for this);
  - builds a mining camp and farms;
  - ages up and researches techs;
  - assigns idle villagers by a deficit-based weighting (`meat()` prefers carcasses, then sheep, then deer);
  - rebalances piling resources (`rbT` timer);
  - trains military, defends against threats, sends attack waves;
  - hunts treasures (`treasureHunt`: the scout grabs free ones, an idle army of 5 or more clears guarded ones).
- **Fog of war (no cheating):** the AI only uses what it has seen. `remember()` stores enemy buildings seen in its vision (`known`), and forgets them when seen destroyed. Gaia animals seen are kept in `seen` (with `danger` for wolves, bears and bandits). Resource lookups go through `this.res()` → `nearestResource(..., known = P.exp)`. Treasures only count on explored tiles. `enemyTarget()` only picks from `known`.
- **Scouting:** `scoutTick()` drives the scout cavalry (`explorer`). It first circles the home ring, then `exploreTarget()` scores 8×8 cells (unexplored share, distance, same distance from the centre as our base, avoiding known towers/TCs, remembered beasts, guarded chests and paths past them). `evade()` rides away from wolves, guards and enemy soldiers within 5 tiles. A wounded scout runs home; below 40% HP it retires and `replaceScout()` trains a new one (Feudal+), or a party of 3 militia in the Dark Age that searches with the army sweep (`lastSweep`). The explorer is never pulled into base defence.
- **Starvation guard:** if food < 60 and too few are on food, half the villagers are moved to meat/berries/farms (wolves eating the sheep used to deadlock the economy).
- AI randomness uses its own `this.rnd` (seeded from `W.seed`), never `W.rnd`.
- Use time-based timers (`W.t > this.xT`), **not** `W.tick % N`: AI ticks aren't aligned to tick multiples, so modulo checks almost never fire. That was a real bug.

### Rendering notes
- Iso projection: `iso(x, y) = [(x - y) * 48, (x + y) * 24]` (96×48 tiles). Sprites are anchored at the feet.
- `pickDir` uses 5 rendered screen directions (90, 135, 180, 225, 270) and mirrors the other 3.
- Unit sprite set (`View.unitSet`):
  - villagers → `villager_m` / `villager_f` by id parity (corpses use `sk`);
  - player units → `A.units`; animals and bandits → `A.fauna`.
- Animation names (`View.unitAnim`):
  - villager: idle, walk, attack, die, build, chop, mine, farm, forage, hunt, carry_wood / carry_food / carry_meat / carry_gold / carry_stone;
  - military: idle, walk, attack, die;
  - animals: also run.
- Buildings:
  - construction stages use `<type>_c0|c1|c2`;
  - houses pick `house`, `house_b` or `house_c` by `id % 3`;
  - farms switch to `farm_seed` when depleted;
  - walls are composed from post plus half-segments in `wallSprites`.
- Spectator mode: `view.reveal = true` shows the whole map. The minimap honours `G.watch`.

### Input (main.js)
- **Desktop:**
  - left click selects, drag box-selects;
  - right click is a smart command (move, gather, attack, build, hunt, treasure);
  - wheel zooms towards the cursor (`zoomAt`; min 0.3, or 0.22 in spectator mode), `-` and `=` zoom too;
  - edge scroll, arrow keys, or middle-drag move the camera;
  - Ctrl+number saves a control group, `.` selects an idle villager, H jumps to the TC, Space centres on the selection, Delete deletes, P/F3 pauses.
- **Touch** (`touchDown/Move/Up`, `handleTap`):
  - tap selects or issues an order, double tap selects the same type on screen;
  - one-finger drag pans, pinch zooms and pans;
  - long-press then drag, or the ▢ button, box-selects;
  - the building ghost follows the finger;
  - touch bar: ✖ cancel, ▢ box, ⚔ army, 🏰 Town Center, ⛶ fullscreen.
  - Compact HUD CSS lives in `@media (max-height: 560px)`. In portrait an overlay asks the player to rotate the phone.
- **War statistics** (`📊 Statistik` button in the top bar, key I or F4, Esc closes): a non-blocking overlay with tabs Ringkasan / Ekonomi / Militer / Linimasa. Playing: your own kingdom in detail plus fog-limited enemy intel (age, when found, buildings known, units visible now). Watching, or after the game ends: every kingdom side by side. The end screen has a button to open it.
- **Spectator** (menu: Mode → Tonton Bot vs Bot):
  - every player is AI;
  - speed 1x/2x/4x/8x (keys 1, 2, 4, 8);
  - Tab switches the point of view;
  - C toggles the automatic camera, which is OFF by default; any manual camera move turns it off;
  - left-drag and WASD pan.

## 4. Art pipeline (`_art/`)

The AoE2 approach: 3D models are pre-rendered to 2D sprites, and the game only draws images.

Common conventions (`bl/common.py`):
- Tile = 3 m; `TILE_PX = 96`; camera is ortho with Euler(60°, 0, 45°).
- Frames are rendered at `SS = 2` and Lanczos-downscaled.
- Sun direction is (0.82, 0.18, −0.72), set by `aoe_light()`. A shadow catcher plane sits on the ground.
- `render_pair()` renders colour plus a `_mask.png` (white = player colour). Materials can name their own mask material via `m['mask_mat']`.
- `C.to_px()` gives the anchor and **calls `view_layer.update()` first**. Without it every anchor became the image centre; that bug cost a re-pack once.

| Tool | Purpose | Run |
|---|---|---|
| `zeroad.py` | Fetch 0 A.D. actors (GitHub raw mirror), convert static COLLADA to OBJ (`dae2obj.py`, pycollada; Blender 5 has no COLLADA importer), write `downloads/0ad/manifest.json` | `python zeroad.py <actor.xml[:variant]> ...` |
| `zad/resolve.py` | **Unit recipes.** Resolves 0 A.D. actors, variant files, props and animations into `out/jobs/<unit>.json` and downloads everything. Edit `RECIPES` to change look or gear. | `python zad/resolve.py [unit ...]` |
| `zad/skin.py` | numpy COLLADA reader: geometry, skin controllers, node trees, baked matrix animations, `pose(t)`, `mesh_points()`. Runs inside Blender. | (library) |
| `zad/render_units.py` | Blender renderer for skinned actors: poses body and props (prop points `prop-<attach>`; a skinned prop uses its own skeleton unless it shares the parent's), builds materials (player_trans → mask = 1 − alpha), renders 5 directions × frames. 0 A.D. models face −Y, so θ + π. `--preview` renders 2 frames × 2 directions. | `blender -b --factory-startup -P zad/render_units.py -- <unit> [anims] [--preview]` |
| `zad/textures.py` | Turns Celtic plaid skins into plain medieval wool (`plain`), dyes areas (`dye`), and makes areas partly player-coloured (`pc_area`). Writes `downloads/0ad/textures/skins/custom/`. | `python zad/textures.py` |
| `render_units0ad.sh` | Full render of all units and animals (about 4 h on CPU; animals use 12 samples). | `./render_units0ad.sh [unit ...]` |
| `structures.py` | Buildings: construction stages c0/c1/c2, house variants `house_b` / `house_c`, nature (0 A.D. oaks, mines), treasures, rubble. `ANCHOR_ONLY=1` recomputes anchors without rendering. | `blender -b --factory-startup -P structures.py -- all\|name,name` or `./render_structures.sh` |
| `bl/buildings.py`, `bl/assets.py` | Procedural building parts (timber frames, roofs, materials) and the `zad()` loader for converted 0 A.D. meshes | (library) |
| `units.py` + `bl/rig.py` | **Legacy** procedural humans and horses. No longer used by the game: the user found them "too cartoony". | — |
| `post.py` | `process()`: fixes shadow-catcher haze, 2× downscale, colour grade, sharpen. **`fix_shadow` treats only translucent pixels (`a < 0.97`) as shadow**, otherwise dark horses and hair turn see-through. `tint()` applies player colour. | (library) |
| `pack.py` | Packs atlases into `age/assets`:<br>`units` → `units_N.png` + masks (player units; tinted per colour at load time);<br>`fauna_N.png` (animals and bandit, gaia tint baked in, no mask);<br>`buildings` → buildings + `nature` (prefixes oak_, stump, gold_, stone_, berry, rubble_, treasure_);<br>`terrain`;<br>`icons` (64 px portraits). The rosters `PLAYER_UNITS` and `FAUNA` are at the top. | `python pack.py units\|buildings\|terrain\|icons` |
| `unit_sheet.py` | Contact sheet of frames at game scale, for checking renders | `python unit_sheet.py out.jpg unit:anim:dir:frame ...` |
| `CREDITS.md` | Required attributions. | — |

Licences: 0 A.D. assets are **CC-BY-SA 3.0** and must stay credited (the menu footer and `CREDITS.md`). The Poly Haven and ambientCG textures are CC0.

**Adding a new unit:**
1. Add a recipe to `zad/resolve.py`.
2. Run `python zad/resolve.py <unit>`.
3. Run `render_units.py -- <unit> --preview`, then check it with `unit_sheet.py`.
4. Do the full render.
5. Add the unit to `PLAYER_UNITS` or `FAUNA` in `pack.py`, then run `pack.py units` and `pack.py icons`.
6. Add it to `UNITS` in `data.js`, and to `UNIT_BOX` in `render.js` (selection radius and HP-bar height).
7. Add a train button (the building's `trains`), voice role mapping and AI usage as needed.

**Adding a building:**
1. Write a builder in `structures.py` and add it to the `B` registry: `(builder, tiles, has_construction_stages)`.
2. Render it, then run `pack.py buildings` and `pack.py icons`.
3. Add it to `BUILDINGS` in `data.js` with a `key` hotkey, and to `VIL_BUILD` in `ui.js` with a grid slot.

## 5. Audio pipeline (`_audio/`)

| Tool | Purpose |
|---|---|
| `engine.py` | Song notation, per-track SoundFont rendering (tinysoundfont + GeneralUser GS), automatic gain staging (`ROLE_DB` or `song.levels`), mix and FX (pedalboard), seamless loop (renders 2 passes and keeps the second), loudness to −18 LUFS, ogg + m4a output (ffmpeg from winget). |
| `songs_age.py` | Game music: `menu` "Panggilan Raja", `game1` "Fajar Kerajaan", `game2` "Ladang dan Benteng", `game3` "Genderang Perang". Orchestral (horns, strings, choir, timpani). The user asked for "penyemangat perang, tidak berisik"; bagpipe and shawm are avoided. |
| `voices_age.py` | Unit voices with **Piper TTS**, roles vm / vf / sol / cav and events sel / move / work / attack. Writes `age/assets/voice/` + `voice.json`. **Licensing: only `en_GB-northern_english_male` (CC-BY-SA) and `en_GB-cori` (public domain) are used.** `semaine` and `ryan` are non-commercial; don't reintroduce them. Speaker variety comes from pitch and tempo. |
| `sfx_kenney.py` | **Current sound effects.** Real recordings from Kenney *RPG Audio* + *Impact Sounds* (CC0), in `downloads/kenney/*.zip`. They are layered, low-passed, compressed and RMS-matched into `age/assets/sfx/` + `sfx.json`. The user found the earlier procedural ones harsh. |
| `sfx_age.py` | Old procedural (modal + granular) effects. **Superseded**; kept for reference. |

The game side (`audio.js`):
- `SAMPLE_OF` maps event keys to sample names and gains; `WORK` work sounds are thinned (30% skipped) and `MIN_GAP` throttles repeats.
- At most 8 samples play at once, with stereo pan and attenuation by screen position (`Game.sfx`).
- Building selection uses `sel_<type>`; animal calls are synthesised.
- Voices: one at a time, the speaker stays consistent per unit id, sel throttled to 450 ms.

## 6. Performance budget (measured)
- **Sim:** about 0.23 ms per tick on average for a 25-minute 1v1 on a 144 map with no CPU contention.
- **Browser:** 60 FPS with about 850 visible sprites at 0.22 zoom on a 4-player 180 map.
- **Atlases:** units ≈ 3.25 pages of 2048², tinted once per player colour (GPU cost ≈ 16 MB × pages × colours). Phones use atlas scale 0.75 (0.5 when `deviceMemory` ≤ 3) and render resolution ≤ 1.5.
- **Measurement gotcha:** Blender renders in the background skew timings heavily (all cores busy). Re-measure when the CPU is idle.

## 7. Known issues / ideas for next steps
- AI vs AI 1v1 games usually end in 35–60 game-min (conquest or resignation).
- Specialists, gunners and cannons reuse tinted base sprites; dedicated 0 A.D.-style renders would look better.
- Villager fishing reuses the forage animation plus a net-splash effect.
- AI economy is a bit slower than AoE2 AI: Feudal at about 14–17 game-min. Tune `ai.js` weights.
- Still missing vs AoE2 (user did not pick these yet): changing diplomacy mid-game, map editor/scenarios/campaign, sandbox AI scripting, hotkey editor, ranked matchmaking.
- Building variants exist only for houses; barracks, mill and the camps could get them too, the same way (render `<type>_b`, then pick by `id % n` in `render.js`).
- Phone support is tested only in Chrome device emulation, not on a real device.
- The sim worst tick can still spike to about 50–80 ms in big late-game fights (A*). A flow-field per group move would help.
- Loading tints each atlas page per player colour in JS (a pixel loop), so it takes a few seconds with 4 players.

## 8. Gotchas collected the hard way
- `C.to_px()` must run after `view_layer.update()`, otherwise every anchor is the image centre.
- Blender 5: no COLLADA importer (use pycollada or `zad/skin.py`); `ArrayModifier.constant_offset_displace`; `transform_apply(location=False, rotation=False)` in `box()`.
- 0 A.D.:
  - actor variants live in `art/variants/...`, not `art/actors/variants`;
  - prop points are joints named `prop-<attachpoint>`;
  - bows are skinned with their own skeleton;
  - the horse texture alpha isn't transparency (material `no_trans`).
- Bash heredocs with backticks or quotes inside Python sometimes fail in this Windows Git Bash. Write patch scripts to a file and run them instead.
- The `GAME_SPEED` 1.6 multiplier runs in real time; the spectator speed multiplies on top (main loop cap: 8 ticks per frame).
- Windows: `start.bat` closes immediately if port 8772 is already in use (it now detects that and just opens the browser).
