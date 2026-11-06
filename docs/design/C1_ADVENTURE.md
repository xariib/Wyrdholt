# C1 — Adventure foundation: design brief

**Status:** retuned after the A40 playtest (Kalvoz, 21 Sep 2026): 24-hour offline storage, Darkwood on day 1–2, smoother Mastery. All retune targets pass in simulation; waiting for the next A40 playtest.
**Results:** docs/reports/C1_RETUNE.md (current). History: docs/reports/C1_PACING.md and C1_CLASS_BALANCE.md (first C1 fit), C1_PLAYTEST_INVESTIGATION.md (why it was retuned).
**Scope:** Darkwood, Ashen Mountains, final zone pacing, Push/Farm across three zones, offline progression, run failures, manual zone transitions.
**Out of scope** (later milestones):

- Warrior and Ranger kits (C2)
- named effects for the new Epic/Legendary items and the Forge (C3)
- Solo Bosses and Artifacts (C4)
- seasons (C5)

## 1. Approved targets

Retune of 21 Sep 2026 (Kalvoz). The first C1 targets assumed three check-ins a day; the A40 playtest showed that a normal player simulated only about half of real time.

| # | Target | Source |
|---|---|---|
| T1 | **Normal play** (two check-ins a day) first-clears **Ashen Mountains on day 6–8**: the week-one wall | Kalvoz |
| T2 | About **90–180 items per day** (C1's 30–60 per 8-hour night, now per full day of storage); never thousands | Kalvoz, Roadmap |
| T3 | Do not recreate: level 3 → 24 overnight, thousands of items per night, mastery maxed in one session, finite content exhausted in hours | Roadmap |
| R1 | A **once-a-day** player keeps at least about **75–80%** of the three-check-in progression (Character XP and Mastery XP by day 7) | Kalvoz |
| R2 | A twice-a-day player is **much closer** to the full path (≥ 90%) | Kalvoz |

## 2. Derived targets (all data-driven)

| # | Target | Why |
|---|---|---|
| D1 | Greenfields first clear **within the first 30-minute session** | The first session must end on a win and an unlock |
| D2 | Darkwood first clear **day 1–2** in normal and engaged play, **≤ day 3** once a day. Expected state at the wall: **L10 M7** with the Greenfields Rare set, a calibration anchor rather than a gate | The first meaningful wall, not multi-day waiting (Kalvoz) |
| D2c | **At least one failed Darkwood Push** before the clear, and after a level, Mastery or gear change the next attempt ends **closer** (P1) | FAIL → farm → gain → retry → closer → clear |
| D3 | Character Level at the Ashen first clear ≈ **18–21** | Keeps level meaningful against zone levels |
| D4 | Level 30 (cap) takes **months** | The permanent layer must outlast seasons |
| D5 | Active-class Mastery: **M5 and M7 on day 1** (Darkwood), **M15 on day 6–9** (Ashen), **M20 not before day 21** | M20 is the future promotion gate (C5) |
| D6 | Normal fights at-level last **~8–12 s**, the Elite ~20 s, the Zone Boss ~30–45 s | Readable combat |
| D7 | A run that fails should usually fail in **stages 5–10**, not stage 1 | Walls are the Elite and the Boss, not trash |
| D8 | Monk and Mage meet the class targets in §8 | Warrior and Ranger follow in C2 |
| D9 | Every Mastery rank moves the Boss visibly; the techniques at M1/M5/M10/M15/M20 stay the majority of the class-specialization value | Smooth walls without making the flat bonus the main value (Kalvoz) |

## 3. Model player (simulation only)

The simulation is a measuring stick, not a game feature. Its gear heuristic is **not** "Equip Best" in the game.

**Check-in patterns** (local time). Every report runs all three:

| Pattern | Sessions | Role |
|---|---|---|
| 1×/day | 19:00, 20 min | light play (R1) |
| **2×/day** | 08:00 10 min, 19:00 20 min | **normal play: the calibration schedule** for the XP tables |
| 3×/day | 08:00 10 min, 12:30 10 min, 19:00 20 min | engaged play (the first C1 model) |

- **Day 0:** install at 19:00 with a 30-minute first session.
- **Offline storage:** a full day (24 h). With it, every pattern simulates all of real time (the 8-hour cap simulated 35% / 69% / 79%).

**Policy at every session start:**

1. Equip upgrades, judged by a simple score on the resolved hero stats (tools only).
2. If an unlocked, uncleared zone exists: **Push** it. After a failure, Farm the strongest cleared zone (or the trail) for the rest of the session.
3. When leaving: set Push if an uncleared unlocked zone exists (offline makes one attempt, then farms), else Farm the strongest cleared zone.
4. Keep the starting class active. The alternate class earns no mastery.
5. During a session, after a failed Push, retry when the level, mastery rank or gear has changed since the failure (checked every 5 minutes).

**Runs:** 12 seeds × {Monk, Mage}, for 21 days.

**Metrics:**

- hours and calendar day at each first clear and each level
- Push attempts and failures per zone, and the failing stage
- drops per night by rarity
- fights per night
- Mastery rank over time
- level at each first clear
- 8-hour catch-up compute time

## 4. Levers (all in `packages/game-content`)

| Lever | Change in C1 |
|---|---|
| XP to next level | Explicit per-level table (`config.levelXp.steps`) instead of a +40% curve, **fitted** by `tools/sim/fit-tables.ts` to the target hours in `tools/sim/pacing-targets.ts` |
| Mastery XP per rank | Explicit per-rank table (`track.xp.steps`), fitted the same way |
| Stage budgets | Generated by `tools/sim/tune-budgets.ts` against an **expected build** per zone (`tools/sim/expected-builds.ts`): HP so fights last 10 / 20 / 36 s; damage at the geometric mean of each class's 50%-clear point |
| Expected builds | Greenfields L5 M2 with starter gear · Darkwood **L10 M7** with the full Greenfields Rare set (retune; was L12 M9) · Ashen L19 M14 with the full Darkwood Epic set (gear saturates within 1–2 days, so level and mastery carry the time gate) |
| Offline storage | `config.offlineCapMs`: **24 h** (retune; was 8 h) |
| Mastery foundation | `track.foundationAttackBpPerRank`: **250** (2.5% of class base attack per rank above M1, applied in hundredths of attack since rules 0.3.0; was 120 in whole units) |
| Stage rewards | Per-zone XP, gold and mastery formula |
| Stage drops | Per-zone chance, low after Greenfields |
| Boss drops | Their own table with a repeat chance well under 100% |
| Completion cache | The first clear always rolls; repeats roll with `repeatRollChanceBp` |
| Loot quality | Zone tables follow PROGRESSION_BALANCE: Greenfields C/U/R; Darkwood up to Epic; Ashen up to Legendary. The max rarity is enforced in code. |
| Short fights | Stage drops roll at full chance for victories of at least `config.lootFullChanceMs` (10 s) and proportionally less for shorter ones, so farming far below your power does not flood the bag (T2, T3) |

**Rules changes** (bump `RULES_VERSION`, regenerate golden hashes):

- the level and mastery tables
- the repeat cache roll chance
- a separate cache loot table
- zone mastery overrides and Elite/Boss reward multipliers
- short-fight loot scaling

## 5. Content

| Zone | Levels | Stages | Elite (5) | Boss (10) | Cache (first clear) |
|---|---|---|---|---|---|
| Greenfields | 1–6 | 10 | Thornback Boar | Elder Root + Sproutling | XP/gold/mastery + 1 guaranteed roll |
| Darkwood | 7–14 | 10 | *Thornwarden* | **Hollow Matron** + adds | + 1 guaranteed roll (up to Epic) |
| Ashen Mountains | 14–20 | 10 | *Ember Warlord* | **Caldera Drake** | + 1 guaranteed roll (up to Legendary) |

- **Enemy names:** the bosses come from the Godot reports. The other Darkwood and Ashen enemies are *provisional* originals, each with a pixel-art placeholder sprite and a procedural background.
- **Item catalog:** completes the five-rarity × six-slot catalog named in PROGRESSION_BALANCE. The new Epic/Legendary items get stats only; their named effects come in C3.

## 6. Player-facing flow

- **Adventure** shows a **zone list:** locked (with its requirement), unlocked, or cleared, plus the stage best.
  - Uncleared unlocked zone: **Push** (resumes its checkpoint).
  - Cleared zone: **Farm**.
- **Push success** farms the zone it just cleared. A **Begin <next zone>** card appears; tapping it is the only way into new content.
- **Run failure** shows a result with the stage reached, a new best, the last attempts in the zone and what changed since the previous one, and **Retry Push / Change build / Keep farming <safe zone>**. The safe Farm starts at once, so closing the game never stops progress (hotfix).
- **Farm** always names its target: "Farm <zone>" in a cleared zone, "Safe farm · <strongest cleared zone>" in an uncleared one, "Farm the trail" only before any clear.
- **Offline:**
  - A failed Push records the failure point and farms safe content.
  - A failed Farm steps down through cleared zones.
  - The summary lists time per activity and, after a failed Push, "Push failed at <zone> · stage N", the enemy HP left, "Safe farming switched to <zone> for <duration>", and Character XP, Mastery XP, gold and items.

## 7. Acceptance for C1

- [x] T1: median Ashen first clear on day 6–8 for Monk and for Mage; no seed before day 5 or after day 10. *(Monk 8, Mage 7; range 6–8.)*
- [x] T2: median drops per 8-hour night 30–60 in week 1; no night above 90. *(46 / 49.5; max 79.)*
- [x] D1–D5 met or reported with numbers. *(All met; see C1_PACING.md.)*
- [x] Class targets CT1/CT2 (§8) met in every zone.
- [x] Unit tests for tables, cache repeat chance, three-zone transitions, offline step-down, and the save round-trip. Golden hashes regenerated; parity gate passes.
- [x] 8-hour catch-up on the build machine is faster than Phase B (fewer, longer fights). *(86 ms vs 111 ms.)*
- [ ] Functional UI for the zone list, transitions and failures; smoke tests pass; APK and preview built.
- [ ] **Stop for Kalvoz's playtest.** C1 changes pacing materially.

## 8. Class-performance targets (Kalvoz decision, 16 Sep 2026)

Approved intent: *both classes clear 40–60% at each zone's expected build.*

Push outcomes are close to deterministic (±1 level moves a class from ~0% to ~100%), so the same intent is measured in levels. A class's **wall level** is the build level at which that class alone clears 50%.

**Kalvoz, 16 Sep 2026:** the wall-level metric replaces 40–60% as the **primary** metric, but not alone. A sanity check must also show that the same expected progression state does not give an extreme class split without a clear gameplay reason.

**Primary targets** (tuned against):

| # | Target | Tool |
|---|---|---|
| CT1 | Wall gap between classes **≤ 1.0 level** in every zone | `bun tools/sim/class-report.ts` |
| CT2 | Normal-stage fight length, slowest / fastest class **≤ 1.25** in every zone | same |

**Class-split sanity check** (a tripwire, not a tuning target):

| # | Check at the same expected progression state | Tool |
|---|---|---|
| CS1 | Survivability ratio (per-class 50%-clear damage scale, max / min) **≤ 1.20** | `class-report.ts` |
| CS2 | Boss fight length, slowest / fastest class **≤ 1.40** | same |
| CS3 | One level either side of the expected build, the classes agree: at L+1 every class clears **≥ 90%**; at L−1 every class clears **≤ 10%** | same |
| CS4 | Model player: per zone, the classes' median first-clear days differ by **≤ 1 day**, and their seed ranges overlap | `bun tools/sim/pacing.ts` |

- A failed sanity check is only accepted with a written gameplay reason in `CLASS_SPLIT_EXCEPTIONS` (`tools/sim/class-targets.ts`). C1 has no exceptions.

- Each zone's damage is calibrated to the geometric mean of the classes' 50% points.
- Class numbers are tuned in `packages/game-content/src/classes.ts` with controlled grids (`--patch`), never by guessing one value at a time.
- The chosen values and every option tried are in `docs/reports/C1_CLASS_BALANCE.md`.
- **Result (C1 build):**
  - CT1 0.77 / 0.63 / 0.42 levels; CT2 1.13 / 1.11 / 1.13.
  - CS1 1.12 / 1.05 / 1.02; CS2 1.20 / 1.30 / 1.11.
  - CS3: L+1 lowest 100% / 100% / 97%; L−1 highest 0% / 1% / 1%.
  - CS4: median gap 0 / 1 / 1 day, ranges overlap.
  - All pass (Greenfields / Darkwood / Ashen).

## 9. Decisions after the build (Kalvoz, 16 Sep 2026)

| # | Question | Decision |
|---|---|---|
| 1 | Wall level instead of 40–60% | **Yes, as the primary metric, plus the class-split sanity check (§8).** |
| 2 | Short fights drop less loot | *Open.* |
| 3 | Test saves from older rules | **Yes, for the prototype phase:** rules change → fresh test character. |
| 4 | Mage shows more HP/armor than Monk | **Keep for C1** (the human playtest matters more now). **In C2,** move part of the Mage's survivability from raw HP/armor into a class mechanic, e.g. a shield, barrier or ward. Target fantasy: the Mage is frailer, with more burst and control; the Monk is physically robust, with self-sustain. |
