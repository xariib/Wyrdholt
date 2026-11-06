# Deterministic game-core

**Migration blocker B1.** Any fight must replay exactly, with the same complete result, in Node, WebKit and the mobile apps. This document describes how `packages/game-core` guarantees that.

## Replay inputs

A fight is fully described by a `FightRecord` (`packages/shared-types`):

| Field | Meaning |
|---|---|
| `rulesVersion` | `RULES_VERSION` in `game-core/src/rules/version.ts`. Bump it on any change to authoritative behavior. |
| `contentVersion`, `contentHash` | Content version string and SHA-256 of the canonical content snapshot. |
| `seed` | 32-bit fight seed. |
| `build` | Build snapshot: Character Level, class, mastery XP of that class, equipped instance ids, artifact. |
| `itemInstances` | Every item instance the fight can read (the equipped ones), including any per-instance data. |
| `encounter` | Zone and stage. |
| `startHp100` | HP carried into the stage (x100), or `null` for full HP. |
| `activeRuleIds` | Rules resolved when the fight started (time windows already applied). |

Nothing else can influence the result: no wall-clock, frame rate, device, locale or UI state.

`executeRecord()` in `replay/replay.ts` is the **only** code path that turns a record into a result. The live game (`prepareFight`), offline catch-up, the Node replay tool and the in-app self-test all use it, so live results are replayable by construction.

## Time model

- The simulation clock is **integer milliseconds**, starting at 0 for each fight.
- Combat is **event-driven**: the loop jumps to the next scheduled moment (an attack, a DoT tick, a status expiry). This keeps offline catch-up fast. There is no frame-based stepping and no wall-clock read.
- Attack intervals: `interval = max(minAttackIntervalMs, round(1,000,000 × 10,000 / (attackRateMilli × (10,000 + hasteBp))))`.
- Haste changes apply from the next scheduled attack. The pending attack is never rescheduled.
- DoTs tick every `tickMs` from their first application. Refreshing extends the expiry and keeps the tick cadence. A tick that lands exactly on the expiry still happens.
- Adventure time also uses integer ms: fights, rests (`restMs`, `completionRestMs`, `defeatRestMs`) and offline time. Advancing in one call or in many small calls gives the identical result (tested).

### Tie-break order at the same millisecond

1. DoT ticks (actors in order hero, e0, e1, e2; statuses in application order)
2. Status expiries (same order)
3. Attacks (hero first, then enemies by index)

## Number representation

| Quantity | Unit |
|---|---|
| HP, damage, healing | integer HP × 100 (`hp100`) |
| Percentages, chances, multipliers | basis points (10,000 = 100%) |
| Attack rate | attacks per second × 1,000 (`attackRateMilli`), additive |
| Time | integer milliseconds |
| XP, gold | integers |

- All authoritative values are **safe integers**. `canonicalJson()` throws on any non-integer number, so a float that slips into content, a save or an event log fails loudly.
- Products passed to `mulDivRound` / `mulDivFloor` must stay ≤ 2^52. The helpers compute an exact remainder, so the result is exact regardless of floating-point quotient rounding.
- **One rounding rule: round half up** (all authoritative values are non-negative).
- Curves (character XP, mastery XP) are computed iteratively in milli-units, with no `Math.pow`.
- Forbidden in game-core (enforced by `tools/check-core-purity.mjs`):
  - `Math.random`, `Date`, `performance.now`
  - `Math.sin/cos/tan/exp/log/pow/...` and the `**` operator (implementation-approximated in ECMAScript)
  - DOM/browser globals, Node APIs, timers, `TextEncoder`, `crypto`
- `game-core` is also type-checked with `lib: ["ES2022"]` and no ambient types, so browser or Node globals do not compile.

## PRNG

- **Algorithm:** xoshiro128** (32-bit), seeded with splitmix32 (`math/prng.ts`). It uses only `Math.imul`, shifts and xor, which ECMAScript specifies exactly.
- **Streams:** `deriveSeed(seed, label)` mixes an FNV-1a hash of a label into the seed. Streams are independent, so one system's draws cannot shift another's:
  - `run/<runIndex>/stage/<stageIndex>/fight` — combat
  - `run/<runIndex>/stage/<stageIndex>/loot` — stage drop
  - `run/<runIndex>/stage/<stageIndex>/cache/<n>` — completion cache rolls
  - A future Forge uses its own stream.
- **Draw order per damage instance:** variance, then crit.
- **Chance rolls** (`rollBp`) consume randomness only when 0 < chance < 100%.
- **Bounded integers** use rejection sampling (`nextInt`), so they are unbiased.
- **Seeds:**
  - `profile.masterSeed` is the root. It is generated on the client at character creation; a server will issue it later.
  - Every run gets a new `runIndex` from `adventure.runCounter`.
  - Leaving and returning replays the same stage seed, so a player cannot reroll by restarting the app.

## Hashing

- **SHA-256 is implemented in pure TypeScript** (`hash/sha256.ts`, with its own UTF-8 encoder). WebCrypto is unavailable over plain http, and Node's crypto is unavailable in browsers.
- **Canonical JSON:** sorted keys, integers only, `undefined` skipped.
- **Fight hash** = `sha256(canonicalJson({ record, events, final }))`, where:
  - `events` is the **complete event stream** (`spawn`, `attack`, `hit`, `heal`, `status`, `status_end`, `tick`, `death`, `end`), with all amounts and HP after each event;
  - `final` is the full summary: outcome, duration, hero and enemy HP and statuses, counters, proc counts, RNG draw count.
- A different seed that still wins produces a different hash (tested). Matching only win/loss is never accepted.

## Item-instance ids

- Ids come from `profile.inventory.nextInstanceId`, a per-character monotonic counter. Loot rolled during a fight gets the same ids on every replay of the same command sequence.
- Ids are never random and never derived from wall-clock time.

## Parity gate (Gate A)

`npm run parity` runs the self-test cases (`selftest/fixtures.ts`) in the engines below. There are 12 cases on the C1 branches and 18 on `c2-warrior-ranger`.

| Engine | How |
|---|---|
| Node (V8) | `tsx tools/parity/run-node.ts` |
| Bun (JavaScriptCore) | `bun tools/parity/run-node.ts` |
| WebKit browser | WebKitGTK MiniBrowser via WebKitWebDriver under Xvfb (`tools/parity/run-webkit.mjs`) |
| Chromium browser | Playwright |

The cases cover:

- 1-, 2- and 3-enemy fights
- Monk and Mage at M1, M5, M10, M15 and M20
- item effects (Poison, Bleed, Ember Burn, chain lightning, haste)
- HP carry-over input and a timeout
- the rules hook and a time-windowed rule
- a 12-minute chunked Push session
- a 2-hour offline catch-up with fallback
- the build snapshot rule
- C2 branch only: Warrior M10 against an Elite; Warrior M20 with an item Bleed line against the 3-enemy Darkwood Boss; Ranger M5 Split Arrow against 2 enemies; Ranger M20 Venom Burst with an item Poison line against 3 enemies; offline Adventure with a Warrior/Ranger character; Mage M7 with Arcane Ward against the 3-enemy Darkwood Boss

Every engine must reproduce the golden hashes in `selftest/golden.json`, which records the rules version and content hash it was generated for. The same fixtures run on phones through **Developer tools → Run determinism self-test**, in the app and in the browser build.

Regenerate golden hashes only after an intentional rules or content change: `npm run golden:update`, then bump `RULES_VERSION` or the content version.

### C1 equivalence gate (C2 branch)

C2 work must not change C1 results. `packages/game-core/test/c1-equivalence.test.ts` enforces this with fixtures captured **on the C1 retune engine** (tag `c1-retune-candidate-20260921.1244`, rules `emberbound-rules/0.3.0`, content `emberbound-content/0.2.1-c1`) by `tools/parity/capture-c1-equivalence.ts`. They were first captured on the C1 playtest engine (16 Sep 2026) and recaptured when the branch was rebased onto `c1-retune` (22 Sep 2026):

- the frozen C1 content snapshot (`test/fixtures/c1-content.json`)
- its 12 golden hashes (`c1-golden.json`)
- 15 extra results (`c1-equivalence.json`): an 8-hour offline catch-up and a Boss fight for each of Greenfields, Darkwood and Ashen × Monk and Mage, plus three guards for the approved retune behavior: a 30-hour absence capped at 24 hours, a failed Darkwood Push followed by the safe Farm for the rest of a day, and the fixed-point Mastery foundation (attack at every rank M1–M20)

The current engine must reproduce all of them byte-for-byte from that snapshot. This is why `RULES_VERSION` stays `emberbound-rules/0.3.0` on the C2 branch while the content version moves to `emberbound-content/0.4.0-c2`: the new C2 mechanics (including the Mage `ward`) change nothing for content that does not use them. If an intentional rules change ever breaks this gate, bump `RULES_VERSION` and recapture; never edit the fixtures by hand.

Per-mechanic damage attribution for balance reports is computed from the event stream in tools (`tools/sim/class-metrics.ts`). New counters were deliberately not added to `FightSummary`, because that would change every C1 hash. The one exception, `absorbed100`, is only present when the kit has a ward (no C1 kit does).

## Server replay (spike)

`npm run replay -- <record.json> --expect=<hash>` validates a submitted fight in Node and exits non-zero on a mismatch. **Developer tools → Copy current fight record** exports a record from a phone.

## Known limits

- Offline duration comes from the device clock until a server provides authoritative time.
- Parity with the Godot prototype is behavioral, not seed-for-seed. The Godot PRNG and float math were replaced on purpose.
- Godot's float mastery curve rounds differently: M15 is 5,652 here versus 5,651 in the report, and M20 is within ±2 XP.

## Device results

**Build `20260916.0905`, in-app self-test:** 12/12 identical hashes on:

- Samsung Galaxy A40, Android System WebView **97.0.4692.98**
- OnePlus 11, WebView **151.0.7922.199**
- RedMagic 11, WebView **153.0.8010.36**

The same golden hashes came out of V8 releases about four years apart, plus JavaScriptCore and WebKitGTK in the parity gate.
