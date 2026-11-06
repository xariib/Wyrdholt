# Wyrdholt: Idle: Art Runtime Contract (Darkwood vertical slice v1)

This contract is binding for integration. `production/animation_meta.json` is the canonical presentation metadata.

## The eight rules

1. **Frame dimensions are NOT globally fixed.**
   - Hero frames are 64 × 64, but the Warrior attack is **72 × 72**.
   - Enemy frames are 64 × 48 (Dire Wolf) and 56 × 48 (Gloom Spider), but the Dire Wolf attack is **72 × 56**.
   - VFX have their own sizes.
2. **Every animation uses its declared `frame` size and `anchor`**, as listed in `animation_meta.json` per animation.
3. **World position stays stable across animation changes.**
   - The actor's world point is placed at the anchor pixel of whatever frame is current.
   - Formula: `draw_x = world_x − anchor_x × scale`, `draw_y = world_y − anchor_y × scale`.
   - Example: the Warrior at idle uses anchor (32, 60) in a 64 × 64 frame, and at attack uses anchor (36, 64) in a 72 × 72 frame. Both map to the same world point.
4. **Larger animation frames are never fit-scaled down.**
   - Never scale any frame to fit a box, a viewport or a smaller frame.
   - Never crop a frame.
5. **Combat art displays at 2×.** 1 art px = 2 CSS px, integer nearest-neighbour. This covers the background, actors and combat VFX.
6. **Gear and Character hero portraits display at 3×.** The 64 × 64 frame becomes 192 × 192 CSS px, plus a ≥ 8 CSS px margin. Never mix 2× and 3× art inside one framed panel.
7. **Animation and VFX are presentation-only.**
   - They react to runtime events (ATTACK, HIT, CRIT, WARD, DEATH).
   - They never decide outcomes.
8. **Gameplay timing and outcomes remain authoritative outside the artwork.**
   - The `ms` values in the metadata are *proposals*.
   - The runtime may scale them, following the compression rules below.
   - No damage, proc or state change may wait for an animation frame.

## Playback rules (from the approved animation bible)

**Structure:**

- Every actor has idle (4, loops), attack (4), hit (2) and death (4, last frame held).
- Attack order: anticipation → **impact (frame 1)** → hold → recover.

**Fitting runtime timing:**

- The impact frame is never skipped, and never shown for less than its `min_ms`.
- If attacks arrive faster than the animation:
  1. Drop *recover* first.
  2. Then compress anticipation down to `min_ms`.
  3. Then compress *hold*.
- CRIT lengthens only the hold (`crit_hold_ms`) and swaps in the `*_crit` impact VFX.

**Priority:** DEATH > HIT > ATTACK > IDLE.

- A hit never interrupts the impact frame.
- Death ends on its held last frame.

**`*_hit_flash.png`:** the exact silhouette in Ivory. It is optional: show it for one frame (about 50 ms) on HIT.

**Arcane Ward:**

- Driven by ward state only: gain → `form`, then `idle_loop`; absorb → `absorb_hit`; reaches 0 → `break`.
- `BACK` draws under the Mage and `FRONT` draws over it.
- When the ward absorbs a hit, the Mage plays only hit frame 01.

## Layer order

| Layer | Content |
|---|---|
| 0 | background |
| 1 | shadow |
| 2 | ward back |
| 3 | actor |
| 4 | ward front / Warrior slash |
| 5 | projectiles |
| 6 | impact VFX |
| 7 | UI (HP bars and damage numbers, positioned relative to the **frame top**, never to the visible silhouette) |

## VFX attachment

Every VFX entry in `animation_meta.json` has an `attach` rule.

| Effect | Attach rule |
|---|---|
| Melee impacts: Monk impact (Ivory/Gold), Warrior impact (Steel + Crimson), Dire Wolf bite (Crimson) | centred on the **target** contact point, starting on the attacker's impact frame. Heroes and enemies do not travel at the approved combat spacing. |
| Arcane bolt, arrow | spawn at the attacker's `fx_projectile_spawn` on the impact frame; travel right |
| Venom glob | spawns at the Gloom Spider's `fx_projectile_spawn` on the impact frame; travels left |
| Warrior slash | a 72 × 72 overlay that shares the Warrior attack frame and anchor. Slash 00 plays with attack 01, slash 01 with attack 02. |

All VFX are palette pixels with alpha 0/255. The only runtime effect allowed is one uniform alpha fade on a whole frame. Do not add glow, blur or additive blending.

## Environment

**Background file:** `production/environment/bg_darkwood_combat.png`, 224 × 272 native.

**Placement:**

- **Ground / feet line:** y = 222 (native). Every actor's anchor y sits on this line.
- **Visible combat stage:** x 14–208 (195 px), which is 390 CSS px at 2×. The extra width is bleed for wider phones: anchor the background bottom-centre and crop the sides.
- **Reference world anchors (native background coordinates, from the approved mock):**

| Actor | x | y |
|---|---|---|
| Hero | 50 | 222 |
| Dire Wolf, front slot | 119 | 222 |
| Gloom Spider, front slot | 171 | 222 |

- **3-enemy formations:** the back-row slot sits 12 px higher, is drawn behind, and gets offset HP bars. This is a recommendation; slot layout belongs to Codex.
