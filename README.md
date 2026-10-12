# Abad Kerajaan

> **For developers / the next AI:** read [`AI_HANDOFF.md`](AI_HANDOFF.md). It covers the architecture, every tool and pipeline (`_art`, `_audio`), how to test and deploy, and the known gotchas.

A browser RTS in the style of Age of Empires II. It uses pre-rendered 3D sprites (Blender) shown as 2D isometric graphics in PixiJS.

## Run
```
start.bat            (or: node server.cjs 8772)
http://localhost:8772
npm test             (map fairness, headless AI-vs-AI game, naval checks, online lockstep)
node tests/stuck.test.js 40 5 144 4   (stuck-unit detector, slower)
```

## Highlights
6 civilizations with unique units, monks (conversion, relics, relic victory), age paths, stances, formations, town bell, shift-queued orders, patrol / guard, autosave + saved games + replays, online multiplayer.

## Online (play with friends)
Menu → **🌐 Main Online** → *Buat Room* → *Salin Link*. A friend who opens the link (`?room=CODE`) joins the room. The host can add AIs, set teams and the map, then start. Up to 4 kingdoms, plus any number of spectators.
- Runs on Firebase Realtime Database (`js/firebase-config.js`, the same project as the other games), under `/age/rooms/{CODE}`.
- Deterministic **lockstep**: only commands travel. The host publishes a turn every 2 ticks and everyone simulates the same thing. Details are in `js/lockstep.js`.
- A dropped player's kingdom is run by an AI until they come back; reloading the page replays the game and catches up; if the host leaves, the next player takes over.

## Phone / tablet (touch)
Play in landscape. Tapping ⛶ or starting a game switches to fullscreen.
- **Tap** your unit or building to select it. **Double tap** selects all of that type on screen.
- **Tap** ground or a target while units are selected to move, gather, attack or build. With a production building selected, a tap sets its rally point.
- **One-finger drag** moves the camera. **Pinch** zooms (two fingers also pan).
- **Long-press, then drag** (or the ▢ button) selects an area.
- Touch bar:
  - ✖ cancels the selection or placement;
  - ⚔ selects every soldier on screen;
  - 🏰 jumps to the Town Center.
- Command buttons show their tooltip briefly on touch.
- When placing a building, the ghost follows your finger and a tap places it.
- Phones use a compact HUD, a render resolution capped at 1.5, and sprite atlases at 75% (50% on low-memory devices).

## Publish online (GitHub Pages)
`build.bat` builds the game into **`docs/`**, the folder GitHub Pages serves. The atlases are converted to WebP (assets go from about 37 MB to 25 MB), a `.nojekyll` file is added, and the build also writes `abad-kerajaan-web.zip` (for itch.io). It then offers:
1. **Done.** Commit and push yourself.
2. **Commit & push to GitHub.**
   - If this folder isn't a git repo yet, it runs `git init` and asks for the repo URL (default `REPO` at the top of `build.bat`). Create that repository on GitHub first, **empty**.
   - It then commits and pushes `main`.
   - One-time setup on GitHub: *Settings → Pages → Deploy from a branch → `main` / `/docs`*.
   - The game is then served at `https://<user>.github.io/<repo>/`.
3. **Firebase Hosting.** Deploys to the separate site `abad-kerajaan-game` (never the default site).

Screenshots used to live in `docs/`; they are now in `screenshots/`.

## Structure
- `js/data.js`: units, buildings, techs, costs, gather rates, player colours.
- `js/sim.js`: deterministic simulation with 0.1 s ticks. Input arrives as a command queue, so lockstep multiplayer can be added later. It covers A* pathing, gathering, building, combat, projectiles, fog and victory.
- `js/map.js`: map generator.
- `js/ai.js`: AI opponent with economy, age-up, military and attack waves.
- `js/render.js`: PixiJS v8. The terrain uses a custom shader (texture blend plus fog), with sprites, particles and selection drawn on top.
- `js/ui.js`, `js/main.js`: HUD, input, camera, hotkeys and menus.
- `js/audio.js`: synth SFX plus the music playlist in `assets/music`.
- `assets/`: sprite atlases produced by `../_art/pack.py`.

## Gameplay additions (v2)
- **Wildlife.** Sheep are herdable: whoever gets near first owns them. Villagers slaughter them for 100 food.
  - Deer run away when approached.
  - Boar fight back (hunt them in a group).
  - Wolves prey on villagers.
  - Bears and bandits guard treasures.
- **Hunting.** Villagers throw spears (range 2.5), then butcher the carcass (`hunt` animation) and carry meat. Carcasses slowly spoil.
- **Treasures (AoE3-style).** Gold chests, food carts, wood piles and stone piles are spread over the map, each guarded. Kill the guards, then touch the treasure with any unit to collect it.
- **Map sizes.** 112 / 144 / 180 / 220 tiles. Forests, mines, wolves and treasures scale with the map area.
- **Building variants.** Houses come in 3 shapes: the timber-framed thatched house, a two-storey stone and timber house, and a thatched cottage with a shed.
- **Voices.** Units speak when selected or ordered (`assets/voice`, Piper TTS). Each building has its own selection sound. Ambience (wind, birds) plays during the game, and a floating "+N" label appears when a treasure is collected.

- **Spectator mode (bot vs bot).** Pick *Mode: Tonton Bot vs Bot* in the menu. Every player is run by the AI and the whole map is revealed.
  - Speed: the 1x/2x/4x/8x buttons, or keys 1/2/4/8.
  - Tab switches the point of view (whose resources and age are shown).
  - C toggles the automatic camera, which follows fights and age-ups.
  - Scrolling by hand pauses the automatic camera for 8 s.
- **Random, fair maps (v3).** Pick *Tipe peta* in the menu, or *Acak* for a random one each game: Padang Terbuka (open, lots of hunt), Rimba Lebat (dense forest), Danau Besar (big central lake), Lembah Sungai (rivers with shallow fords between players) and Bukit Tambang (rich, contested centre mines). Start positions, rotation and resource layout change every game, but every player gets the same layout and a balancing pass tops up anyone short of wood, gold, stone or food.
- **AI has to scout.** Computer players are under the fog of war too: they send their scout out, remember what they find, avoid wolves and guarded chests, and only attack buildings they have discovered.
- **Market (Pasar).** Feudal Age, needs a Mill. Buy or sell 100 food / wood / stone for gold; prices are shared and move with every trade. Techs: *Serikat Dagang* (fee 30% → 15%) and *Rute Dagang* (24 gold per minute per market).
- **Home City shipments (AoE3-style cards).** Gathering, building, research, treasures and kills give XP. Each full XP bar earns a shipment: open 🃏 *Kiriman* (key K) and pick a card — villagers, resource crates, soldiers or permanent bonuses (gather rate, villager speed, armour, market fee). It arrives at the Town Center 35 s later.
- **Winning, losing, surrender.** A kingdom is out when it has no units and no working buildings left (walls, gates, farms, houses and foundations don't count). *Menyerah* in the pause menu resigns; AI players resign when they can't recover. In 3–4 player games you can keep watching after you're beaten.
- **Military paths (v4).** Blacksmith upgrades (attack / armour lines, shown as gold pips over selected soldiers) and an exclusive *Doktrin* (Legion / Cavalry / Arrow Rain), a second doctrine at the *Akademi* (Fortress / Blitz / Formation tactics), one specialist per line (Samurai or Ninja, Fire Archers or Crossbows, Cataphracts or Lancers), gunpowder (needs **iron**) for gunners and cannons, battering rams. Spear > cavalry > archer > infantry, so different choices beat different opponents.
- **Formations** for soldiers: line, battle (shield wall in front, archers behind), box, spread.
- **Spies and the advisor.** The Akademi sends spies (enemy positions for 30 s); the *Penasihat* (! / J) reads the enemy army and suggests counters.
- **Living world.** Day and night (villagers rest, torches and lit windows, food upkeep at dawn), seasons (snow freezes rivers), rain, birds, chimney smoke, turning windmills, roads that connect every new building to the town, towns that change look with each age.
- **Terrain and water.** Hills (high ground bonus), mountain ridges with passes, islands. Docks with fishing boats, transports (carry 10) and warships; villagers can fish from the shore.
- **Decks and achievements.** Build a 20-card deck in the menu; computer players each get a random deck that shapes their style. 25 achievements and a rank that grows across games.
- **War statistics.** The 📊 *Statistik* button (or key I) opens a panel with score, economy (gather rate per minute, villager jobs, buildings, techs), military (army, kills, losses, buildings razed) and a timeline chart. While playing it shows your own kingdom plus what your scouts know about the enemy; in spectator mode and after the game it compares every kingdom.
- **Work sounds.** Sampled and procedurally designed (`../_audio/sfx_age.py`, 4 variants each), with random pitch and stereo panning by screen position:
  - axe on wood, pick on stone, pick on gold, hoe in soil, berry bush rustle, hammer and nail, butchering;
  - drop sounds for wood, gold, stone and food.

## Rebuilding the assets (folder `../_art`)
```
python zad/textures.py                # medieval cloth textures derived from 0 A.D. skins
python zad/resolve.py                 # 0 A.D. actors -> out/jobs/<unit>.json (+ downloads)
./render_units0ad.sh                  # Blender: skinned 0 A.D. units/animals, 5 directions (slow)
./render_structures.sh                # Blender: buildings, construction stages, nature, treasures, rubble
python pack.py units|buildings|terrain|icons   # units -> units_* (player colour) + fauna_* (gaia)
python ../_audio/songs_age.py         # BGM
python ../_audio/voices_age.py        # unit voice lines
python ../_audio/sfx_age.py           # work / impact sound effects
```
Colour sprites and `_mask` sprites are rendered separately. The mask marks the player-colour areas, which are tinted at load time.

## Controls
- Left click / drag: select. Right click: move, gather, attack or build (context-dependent).
- Command grid hotkeys: Q W E R T / A S D F G / Z X C V B.
- Esc: cancel. While placing a gate, R rotates it. For walls, click the start point and then the end point.
- Ctrl+0-9 saves a control group and 0-9 selects it (double-tap to jump to it). `.` selects an idle villager. H jumps to the Town Center. Space centres on the selection. Delete removes it. P/F3 pauses. I (or F4) opens the war statistics, K the shipment cards, J the advisor.
- Arrow keys or the screen edges scroll the camera. Click the minimap to jump. Mouse wheel zooms towards the cursor (down to 0.3x, or 0.22x in spectator mode); - and = zoom too.

## Credits
Units, animals, their animations, trees and some props are from 0 A.D. (Wildfire Games, CC-BY-SA 3.0). Voices are made with Piper TTS from redistributable datasets (OpenSLR 83 CC-BY-SA 4.0, LibriVox public domain). Textures are from Poly Haven and ambientCG (CC0). See `../_art/CREDITS.md`.
