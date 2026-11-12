# Wyrdholt: Idle

Wyrdholt is a portrait idle-fantasy RPG. Choose a class, push into Adventure, farm for gear, and adjust your build before trying again. The browser and Capacitor apps share the same deterministic game core.

## Play on Android

[**Download Wyrdholt for Android**](https://github.com/xariib/Wyrdholt/releases/latest/download/Wyrdholt-Idle.apk) · [Latest release notes](https://github.com/xariib/Wyrdholt/releases/latest)

Open the downloaded APK on your Android device and follow the installation prompts. To update from inside Wyrdholt, open **Menu → App updates** and choose **Check for updates**. When an update is available, choose **Download update**, then **Install update**, and confirm in Android.

Open **Menu** for the encyclopedia, backup export, backup restore, or a confirmed restart. On Android 10 and later, **Back up save** exports a JSON file to **Downloads/Wyrdholt**. A backup can also be restored from the character creation screen.

This repository starts from the game snapshot identified as `81153feef35d1bad949fe11329ecfe4223b7ac59` in the source ZIP. The active branch is `main`.

## Build and test

Use Node 24 and run from the repository root.

```sh
npm ci
npm run typecheck
npm run check:purity
npm test
npm run check:art
npm run build:web
```

Run `npm run dev` for development or `npm run preview:web` to play the built game. The build is written to `apps/mobile/dist`.

## Online play

Online Play is disabled in the standard build. For local development, start the authority service and opt in when starting the browser app. Enable account creation before starting the service.

```powershell
$env:WYRDHOLT_AUTHORITY_REGISTRATION = 'true'
npm run authority
```

In the browser app terminal, set `$env:VITE_WYRDHOLT_ONLINE_PLAY = 'true'` and run `npm run dev`. Choose **Open online adventure** and use `http://127.0.0.1:8787` as the server origin. Each account keeps one server-side character. The account key lets you reconnect. [Authority and live configuration](docs/technical/ONLINE_AUTHORITY.md)

## Browser save tests

```sh
npx playwright install chromium
npm run test:save:web
```

The tests serve the built game locally and use disposable browser contexts. They cover save recovery, offline catch-up, the C3 inventory, Forge, and salvage flow, and C4 boss entry and settlement across reloads. To use an installed Chromium-based browser, set `CHROMIUM_EXECUTABLE_PATH` to its executable. Reports go to `tools/smoke/out` by default.

Run `node --import tsx tools/smoke/online-check.mjs` against a build made with `VITE_WYRDHOLT_ONLINE_PLAY=true` to check the local authority flow.

## Visual regression checks

After building, run `node --import tsx tools/visual/mobile-review.mjs` for disposable-fixture screenshots at six phone/tablet sizes, including short landscape, large balances, safe areas, equipment sheets and boss combat. Run `node tools/visual/combat-layout-check.mjs` to check all four classes and poses against the actual canvas clipping bounds in three backgrounds. Both tools start a local preview, accept `CHROMIUM_EXECUTABLE_PATH`, and keep evidence under ignored `tools/smoke/out`.

Short browser viewports scroll instead of shrinking away the combat area. Android remains portrait. Browser screenshots do not replace physical-device visual acceptance.

Run `node --import tsx tools/visual/character-animation-check.mjs` to verify empty starting inventories and equipment, unarmed attack movement, steady health labels, animated portraits and reduced-motion support for all four classes.

Run `node --import tsx tools/visual/gear-skins-check.mjs` to check equipped appearances:
all four classes from empty slots through Legendary gear, distinct pixels for each
named item and icon, matching combat/portrait layers, pose clipping, queued equipment
through the real Gear UI, and appearances after reload. It also checks four distinct
unarmored silhouettes and produces a class body/attack comparison sheet. It starts a local Vite server
and writes a visual review sheet and disposable-fixture screenshots to ignored
`tools/smoke/out/gear-skins`. This browser check does not replace device testing or
human art acceptance.

Run `node --import tsx tools/visual/unarmed-combat-check.mjs` after building to verify
all four classes with empty Weapon slots: melee approach, fist hits without weapon
effects, queued weapon equips, the restored weapon animation, and reload behavior.
It uses disposable browser saves and keeps evidence in `tools/smoke/out/unarmed-combat`.

Run `node --import tsx tools/visual/hunt-regressions.mjs` after building to check
repeated backup restores with reused item IDs (combat stats, skins and health bars)
and the living, healed pose during rest after a defeat. It uses disposable saves;
reports and screenshots stay in ignored `tools/smoke/out/hunt-regressions`.

## Mobile performance checks

After `npm run build:web`, run `node tools/perf/combat-profile.mjs`. It serves the build locally and checks all four classes at 360 × 640 with six-times CPU throttling. The report records combat-art decoded bytes, health/status geometry rebuilds, HUD mutations, and renderer timings while Adventure is visible and hidden. Set `CHROMIUM_EXECUTABLE_PATH` to use an installed Chromium browser. Reports stay in ignored `tools/perf/out`.

For before/after comparisons, preserve the earlier build and pass its directory and a report name: `node tools/perf/combat-profile.mjs artifacts/performance/before-dist before`. Startup profiling is available through `node tools/perf/startup-profile.mjs http://127.0.0.1:4173/ --rate=6 --runs=3` against a running preview.

Browser throttling is a comparison tool, not an older-phone guarantee. Validate the Android build on a physical budget phone as well: cold start, a two-minute combat measurement including three enemies and Mage ward, navigation with a large inventory, offline return, background/resume, and a longer session for heat and battery use. The build compatibility check retains the Chrome/WebView 97 target.

## Project guide

- [Development roadmap and milestone gates](docs/ROADMAP.md)
- [Game systems and rules](docs/design/GAMEPLAY_SYSTEMS.md)
- [C4 Ashen King and Ashen Crown](docs/design/C4_SOLO_BOSSES.md)
- [C5 promotions and seasons](docs/design/C5_LONG_TERM.md)
- [Architecture](docs/ARCHITECTURE.md) and [save and lifecycle behavior](docs/technical/CLIENT_RUNTIME.md)
- [Build and Android update requirements](docs/technical/BUILD_AND_DEPLOY.md)
- [C1–C3 human playtest guide](docs/playtests/C3_HUMAN_GUIDE_DA.md)
