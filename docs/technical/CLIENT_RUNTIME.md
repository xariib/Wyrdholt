# Client runtime

## React / PixiJS / game-core boundaries

| Layer | Owns | Must not |
|---|---|---|
| `game-core` | Rules, outcomes, profile mutations | Import UI, render, platform or time APIs |
| `game/session.ts` (`GameSession`) | The profile on the client, the rAF clock, commands, saving, catch-up, the event → UI mapping | Contain game rules |
| `render/CombatRenderer.ts` | Pixel scene, animation, floating numbers, effects | Compute damage, HP or outcomes; mutate the profile |
| `ui/**` (React) | Screens, sheets, overlays, dev tools | Run per-frame updates; embed game rules (view models in `ui/gearModel.ts` only read) |
| `platform/**` | Capacitor Filesystem, App lifecycle, device info, perf monitor | Contain game rules |

`UiState` is replaced (new object) only when `GameSession.bump()` runs:

- after settled fights
- after commands
- during catch-up start and end
- when a toast appears

Components read the (mutable) profile during those renders.

## PixiJS rendering

- **Setup:** `Application.init({ preference: "webgl", autoStart: false, sharedTicker: false, antialias: false, roundPixels: true, powerPreference: "low-power" })`.
- **Rendering:** `GameSession` emits one `CombatFrame` per rAF, and the renderer calls `renderer.render(stage)` once. There is no second loop.
- **Loading:** `CombatView` imports `render/CombatRenderer` **dynamically after `session.ready`**. PixiJS (about 268 KB) is therefore not in the startup bundle and cannot delay the first interactive screen (F6). `render/pixelArt.ts` must stay Pixi-free, because the React icons use it; Pixi textures live in `render/textures.ts`.
- **Resolution:**
  - `scale = round(deviceWidthPx / 145)` (between 2 and 12)
  - logical size = `floor(device / scale)`
  - canvas backing = logical × scale
  - `TextureSource.defaultOptions.scaleMode = "nearest"`, and CSS `image-rendering: pixelated`
- **Art:** character and monster sprites are original placeholder pixel grids (`render/pixelArt.ts`), generated into textures at startup with a white "flash" twin for hit feedback. The background is procedural (`render/background.ts`).
- **Playback:** a cursor walks the fight's event list up to `elapsedMs`. Events more than 450 ms behind are applied without transient effects (fast-forward after a tab switch or resume).
- **Feedback:**
  - attack lunge, hit flash and knockback
  - pixel-font floating numbers (crits larger, yellow, with a 1-px screen shake)
  - DoT tick numbers coloured by status
  - status pips; a haste aura for Flow
  - Mage fireball projectile, Wildfire ring, Stormcall bolt
  - enemy slide-in on spawn, death fade
  - recovery "+HP" during rests
- **Context loss:** `webglcontextlost` marks the renderer lost. React destroys it and creates a new one (also on the next foreground). The simulation is unaffected.
- **Hidden tab:** `setVisible(false)` skips rendering; on return it fast-forwards to the current frame.

## Save storage

- `platform/storage.ts` implements `SaveFileAdapter` with **@capacitor/filesystem**, `Directory.Data`:
  - Android/iOS: the app's private files directory, not WebView storage (which the OS may clear).
  - Browser build: Capacitor's IndexedDB implementation.
- **Envelope:** `{format, schema, rulesVersion, contentVersion, savedAtWallMs, checksum, payload}`. The payload is canonical JSON; the checksum is SHA-256.
- **Compact inventory:** plain instances are grouped by catalog item as id lists; instances with per-instance data are stored in full.
- **Size:** 5,000+ items is about 55 KB. Provenance is kept in memory only (schema 1).
- **Write** (`writeSaveSafely`):
  1. Write the temp file.
  2. Read it back and verify it.
  3. Copy the current main file to the backup.
  4. Remove main, then rename temp to main.

  At every crash point at least one valid file exists (tested at each step).
- **Load** (`loadSaveSafely`): parse main, temp and backup, and pick the newest valid one. Problems are reported in Developer tools.
- **Migration:** `migrate()` is the entry point; schema 1 is the first TypeScript format. **Old Godot saves are not imported.**
- **When the app saves:**
  - 1.5 s after settled events or commands (debounced)
  - every 10 s while playing
  - immediately on background
  - after catch-up

  Saves are serialized through a promise chain, so writes never overlap.

## Lifecycle

`platform/lifecycle.ts` merges these signals:

- `visibilitychange`, `pagehide`, `pageshow`
- on native: `App` `appStateChange`, `pause` and `resume`

| Event | What the session does |
|---|---|
| Background | Stop the rAF clock, pause the perf monitor, set `lastSettledWallMs = now`, save immediately. |
| Foreground | Settle `now − lastSettledWallMs` with **offline rules** (`simulateOffline`), in the worker. Show the summary if the absence was ≥ 60 s or a Push finished or failed. Save, restart the clock. |
| Frozen frame (> 5 s gap without a visibility event) | Treated as an absence and settled by wall clock. |

**Backgrounding or closing the app is never death.** A defeat only happens inside simulated combat.

A run's checkpoint is the stage start (stage, HP, seed) plus the progress into the current fight or rest. A restart replays the same fight from the same seed.

## Offline worker

- `game/offline.worker.ts` builds its own `ContentIndex` and runs `simulateOffline()`.
- `game/offlineRunner.ts` posts the profile and awaits the result with a 60-s timeout. If the worker cannot be created or fails, it falls back to the main thread (`main-thread-fallback`).
- **Short absences** (≤ 30 min, `MAIN_THREAD_CATCH_UP_MS` in `session.ts`) settle on the main thread (`main-thread-short`) with no busy screen. Their compute is a few ms, while a cold worker costs hundreds of ms on slow phones (F6). The 8-hour buttons always use the worker.
- **After a startup or resume catch-up, the save is not awaited.** A crash before it lands just settles the same absence again next time (deterministic, idempotent).
- Timings shown to the tester:
  - `computeMs`: inside the worker
  - `totalMs`: button to result, including messaging

## Touch hardening

- **CSS:**
  - `user-select: none`, `-webkit-touch-callout: none`, `-webkit-tap-highlight-color: transparent`
  - `touch-action: manipulation`, `overscroll-behavior: none` on the page and `contain` on scroll areas
  - `image-rendering: pixelated`
- **Viewport:** `maximum-scale=1, user-scalable=no, viewport-fit=cover`. `gesturestart` is prevented on iOS.
- **Buttons act on `click`:** the browser only fires it for a tap, not for a scroll gesture that started on the button.
- **Safe areas:** `--sat/--sab/--sal/--sar` = Capacitor's `--safe-area-inset-*` (Android `insetsHandling: "css"`) with an `env()` fallback. `MainActivity` enables edge-to-edge.
- **Orientation:** portrait only (AndroidManifest, iOS Info.plist).
- **Nothing depends on hover or right-click.** Touch targets are at least 40–48 px.

## Developer tools (spike builds)

Open with the **DEV** button in the header. It is compiled in unless `EMBERBOUND_DEV_TOOLS=false`.

- **Build info:** build id, platform, engine/WebView version, rules and content versions and hash, renderer size and scale, memory (where exposed), save storage and size.
- **Performance overlay:**
  - FPS, frame time, median FPS in the window, longest period below 50 FPS, window length (green at ≥ 120 s)
  - startup time plus `js · save · catch-up · combat` phases (`perfMonitor.mark`)
  - `P3 8h bench` (8-hour buttons only) and `last return` (real absences)
  - JS heap, labelled coarse (Chromium rounds it; not for R1)
  - **Start measurement** resets the window
  - The overlay has `pointer-events: none` except its button, so it never blocks the UI below
- **Determinism self-test (B1)** with per-case hashes.
- **8-hour catch-up:** benchmark (discard) or simulate (keep).
- **Test helpers:** grant sample gear, copy current fight record (for `npm run replay`), copy save file, reset save (tap twice).
- `window.__ember` test hook (`exportSave`, `simulatedMs`) for automated smoke tests.

## Saves from older test builds (C1)

**Approved by Kalvoz for the prototype phase (16 Sep 2026):** rules change → fresh test character.

- There is no save migration yet.
- If a loaded save has a different `rulesVersion` (for example a Phase B character on the C1 build), the app does **not** continue it. The old level would not match the new XP tables.
- Instead, the create screen shows a notice, and the old save is replaced when the new character is first saved.
- `tools/smoke/outdated-save-check.mjs` covers this path.
- Real save migrations belong to the backend-ready milestone (C6).
