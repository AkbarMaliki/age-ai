# Abad Kerajaan

> **For developers / the next AI:** read [`AI_HANDOFF.md`](AI_HANDOFF.md). It covers the architecture, every tool and pipeline (`_art`, `_audio`), how to test and deploy, and the known gotchas.

A browser RTS in the style of Age of Empires II. It uses pre-rendered 3D sprites (Blender) shown as 2D isometric graphics in PixiJS.

## Run
```
start.bat            (or: node server.cjs 8772)
http://localhost:8772
npm test             (headless AI-vs-AI game in the sim)
```

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
- Ctrl+0-9 saves a control group and 0-9 selects it (double-tap to jump to it). `.` selects an idle villager. H jumps to the Town Center. Space centres on the selection. Delete removes it. P/F3 pauses.
- Arrow keys or the screen edges scroll the camera. Click the minimap to jump. Mouse wheel zooms towards the cursor (down to 0.3x, or 0.22x in spectator mode); - and = zoom too.

## Credits
Units, animals, their animations, trees and some props are from 0 A.D. (Wildfire Games, CC-BY-SA 3.0). Voices are made with Piper TTS from redistributable datasets (OpenSLR 83 CC-BY-SA 4.0, LibriVox public domain). Textures are from Poly Haven and ambientCG (CC0). See `../_art/CREDITS.md`.
