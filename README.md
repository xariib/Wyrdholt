# Wyrdholt: Idle

Wyrdholt is a portrait idle-fantasy RPG. Choose a class, push into Adventure, farm for gear, and adjust your build before trying again. The browser and Capacitor apps share the same deterministic game core.

## Play on Android

[**Download Wyrdholt for Android**](https://github.com/xariib/Wyrdholt/releases/latest/download/Wyrdholt-Idle.apk) · [Latest release notes](https://github.com/xariib/Wyrdholt/releases/latest)

Open the downloaded APK on your Android device and follow the installation prompts. When a newer version is available, Wyrdholt shows **Update available** in the game. Tap **View update** to download it and follow Android's installation prompts.

Open **Menu** for the encyclopedia, backup export, backup restore, or a confirmed restart. A backup can also be restored from the character creation screen.

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

## Project guide

- [Development roadmap and milestone gates](docs/ROADMAP.md)
- [Game systems and rules](docs/design/GAMEPLAY_SYSTEMS.md)
- [C4 Ashen King and Ashen Crown](docs/design/C4_SOLO_BOSSES.md)
- [C5 promotions and seasons](docs/design/C5_LONG_TERM.md)
- [Architecture](docs/ARCHITECTURE.md) and [save and lifecycle behavior](docs/technical/CLIENT_RUNTIME.md)
- [Build and Android update requirements](docs/technical/BUILD_AND_DEPLOY.md)
- [C1–C3 human playtest guide](docs/playtests/C3_HUMAN_GUIDE_DA.md)
