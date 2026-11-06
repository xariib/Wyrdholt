# Wyrdholt: Idle

Wyrdholt is a portrait idle-fantasy RPG. Choose a class, push into Adventure, farm for gear, and adjust your build before trying again. The browser and Capacitor apps share the same deterministic game core.

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

## Browser save tests

```sh
npx playwright install chromium
npm run test:save:web
```

The tests serve the built game locally and use disposable browser contexts. They cover save recovery, offline catch-up, reload, and the C3 inventory, Forge, and salvage flow. To use an installed Chromium-based browser, set `CHROMIUM_EXECUTABLE_PATH` to its executable. Reports go to `tools/smoke/out` by default.

## Project guide

- [Game systems and rules](docs/design/GAMEPLAY_SYSTEMS.md)
- [Architecture](docs/ARCHITECTURE.md) and [save and lifecycle behavior](docs/technical/CLIENT_RUNTIME.md)
- [Build and Android update requirements](docs/technical/BUILD_AND_DEPLOY.md)
- [Human playtest guide](docs/playtests/C3_HUMAN_GUIDE_DA.md)
