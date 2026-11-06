# Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ packages/game-core     pure TypeScript · deterministic · authoritative │
│   combat · classes · mastery · encounters · runs · loot · items      │
│   offline · commands · replay · saves (format + safe-write logic)    │
└───────────────▲──────────────────────────────────▲──────────────────┘
                │ reads content (injected)         │ same code
┌───────────────┴──────────────┐      ┌────────────┴───────────────────┐
│ packages/game-content (data) │      │ apps/server (spike)            │
│ packages/shared-types        │      │ Node replay tool               │
└──────────────────────────────┘      └────────────────────────────────┘
                │
┌───────────────┴──────────────────────────────────────────────────────┐
│ apps/mobile                                                          │
│   game/session.ts   GameSession: clock, commands, saves, catch-up    │
│      │  CombatFrame (per frame)         │ UiState (on events only)   │
│   render/  PixiJS combat (read-only)   ui/  React screens            │
│   platform/  Capacitor Filesystem, App lifecycle, perf monitor       │
│   game/offline.worker.ts  offline catch-up off the main thread       │
└───────────────┬──────────────────────────────────────────────────────┘
                │ Vite build (dist/) = browser preview
┌───────────────┴──────────────────────────────────────────────────────┐
│ Capacitor shell: android/ (built) · ios/ (generated, deferred)       │
└──────────────────────────────────────────────────────────────────────┘
```

## Repository

| Path | Purpose |
|---|---|
| `packages/shared-types` | Content schema, snapshots, `FightRecord`, `ItemInstance`, `CombatEvent`. |
| `packages/game-core` | Deterministic simulation. The public API is `src/index.ts`. |
| `packages/game-content` | Spike content data (Monk/Mage kits, Greenfields, items, loot tables, test rules). |
| `apps/mobile` | React + Vite + PixiJS + Capacitor app. The same build is the browser preview. |
| `apps/server` | Spike-only Node replay tool. No production backend. |
| `tools/` | Parity gate, purity check, benchmarks, browser smoke tests. |
| `docs/` | Product, design, architecture, migration and technical docs. |

Toolchain: npm workspaces, TypeScript 5.9, Vitest 5, Vite 8, React 19, PixiJS 8, Capacitor 8. Workspace packages export TypeScript source directly, so there is no package build step. Vite, tsx, Vitest and Bun consume `.ts` files as they are.

## Layer rules

1. **game-core is pure** (blocker B2).
   - It has no React, PixiJS, DOM, browser, Node or Capacitor dependencies, no timers, no `Math.random` and no wall-clock reads.
   - Enforced by `npm run check:purity` and by type-checking with an ES2022-only lib.
   - Content is injected (`new ContentIndex(snapshot)`), so a server can validate against a pinned content version.
2. **game-core decides every outcome.** State changes go through `applyCommand()` or `advanceAdventure()`. The profile is a plain JSON-safe object; game-core mutates it in place, and callers clone when they need the old state.
3. **Rendering is read-only** (blocker B3).
   - `CombatRenderer` receives `CombatFrame`s (current fight, playback position) and replays that fight's authoritative event log.
   - It never computes damage, HP or outcomes.
   - Fights are simulated in full when they start (the build snapshot rule guarantees they cannot change), so playback speed cannot affect results.
   - `tools/smoke/b3-render-independence.ts` checks that a rendered app session equals a headless replay of the same simulated time.
4. **React never owns the 60 FPS loop.**
   - `GameSession` runs one `requestAnimationFrame` loop that advances game-core and emits `CombatFrame`s to the renderer.
   - React subscribes with `useSyncExternalStore` to a `UiState` snapshot that changes only on meaningful events (fight settled, command, catch-up, toast), not per frame.
5. **The renderer is disposable.** It can be destroyed and recreated at any time (tab changes, WebGL context loss, failed start) without touching game state.

## Simulation flow (foreground)

```
rAF tick ──► advanceAdventure(profile, Δms, {offline:false, recordEvents:true, cache})
               ├─ rest phase: count down; at the fight boundary apply queued build changes
               ├─ fight phase: prepareFight() → executeRecord() (cached per fight)
               └─ fight end: settle rewards/loot, HP carry-over + 18% recovery, next stage
          ──► onEvent → UiState bump (toasts, run result), debounced save
          ──► emit CombatFrame → CombatRenderer.onFrame → render once
```

## Build snapshot rule (blocker B6)

- `applyCommand({type:"equip"|"setActiveClass"})` during an active fight writes to `profile.pending` and returns `{queued:true}`.
- `applyPendingBuild()` runs only at fight boundaries (fight end, or rest → fight). The ended fight's rewards and mastery go to the class that fought.
- When a new build applies, carried HP is clamped to the new maximum and never refilled.
- An explicit activity change (Push ↔ Farm) ends the attempt cleanly, keeps the Push checkpoint (same run seed, stage and HP), then applies queued changes.

## Offline catch-up (P3)

- `simulateOffline()` uses the same `advanceAdventure()` with `offline:true`:
  - A failed Push falls back to the strongest cleared zone, or the zone's trail.
  - A successful Push farms the zone it just cleared and never enters the unlocked zone.
  - The simulated time is capped at 8 h.
- `settleOffline()` is idempotent: settling the same moment twice grants nothing.
- In the app, catch-up runs in `game/offline.worker.ts`, with a main-thread fallback when workers are blocked. The overlay shows which path ran.
- Fights run without event recording and without the fight cache. 8 h is about 11,000 fights, taking about 100 ms in Node/V8 and about 145 ms in Bun/JSC on the build machine.

## Persistence

See [technical/CLIENT_RUNTIME.md](technical/CLIENT_RUNTIME.md). In short:

- A versioned envelope with a SHA-256 checksum.
- Crash-safe writes: temp, verify, backup, replace.
- Loading picks the newest valid of main / temp / backup.
- Files are stored with Capacitor Filesystem in the app's private data directory (IndexedDB in the browser build).

## Future-ready structures (not built)

- **Item instances:** stable ids, with optional `rolls`, `modifiers`, `provenance`, `upgrade` and `seasonal` fields. See [technical/ITEMS_CLASSES_CONTENT.md](technical/ITEMS_CLASSES_CONTENT.md).
- **Class tree:** `parentClassId`, `tier`, `unlockRequirements`, `masteryTrackId`.
- **Rules and time windows:** `RuleDef` with an optional `availability`, attached to zones or stages, and resolved into `activeRuleIds` when a fight starts.
- **Server replay:** `FightRecord` plus `replayFight()`.

## Architecture decisions

| Decision | Why |
|---|---|
| Event-driven integer-ms combat instead of fixed frame ticks | Exact, fast offline catch-up; no per-frame cost; deterministic. |
| Whole fight simulated at fight start | The build snapshot rule makes it valid; presentation cannot influence results; replays are trivial. |
| Pure-TS SHA-256 and UTF-8 | Works in insecure contexts and in every engine; no platform dependency. |
| Content injected, not imported by game-core | A server can pin content versions; tests can swap content. |
| npm workspaces exporting TS source | Minimal tooling; one language end to end. |
| Low logical resolution (~145 px wide) with integer device-pixel scale | Crisp pixel art, cheap fill rate on low-end GPUs, pixel-snapped motion. |
| One rAF loop driving both simulation and render | Deterministic ordering, no duplicate loops, easy to pause on background. |
| `pixi.js/unsafe-eval` module imported in every build | Pixi runs under strict CSP (private preview host) and browser/app stay identical. |
| Capacitor Filesystem for saves | Native private storage on devices; the OS may clear WebView storage. |
