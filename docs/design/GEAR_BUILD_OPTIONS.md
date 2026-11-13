# Gear build options

Browser verified; balance and human playtesting remain open.
Content version: `emberbound-content/0.9.0-build-gear`.

Every class has three additional gear choices in each of the six slots at Rare,
Epic and Legendary. These 216 definitions supplement all existing gear. Players
can mix individual pieces freely; there are no mandatory sets or set bonuses.

| Style | Gains | Gives up |
|---|---|---|
| Precision | Attack and critical-hit chance | Gear health, armor and attack speed |
| Tempo | Attack speed, allowing more attacks and effect triggers | Critical-hit chance, gear defenses and some attack |
| Bulwark | Health and armor | Gear attack speed, critical-hit chance and some attack |

Each alternative retains its source piece's effect behavior, weapon family,
rarity and encounter-level gate. Effects have unique source IDs for deterministic
event attribution. One piece occupies a slot, so it cannot stack its effect with
the source item in that same slot. Existing item definitions and effect values
are unchanged. Materials distinguish the three styles while retaining the
source piece's class cut and weapon animation.

## Provisional stat tuning

Let `rank` be 1 for Rare, 2 for Epic, and 3 for Legendary. The source is the first
existing compatible item in catalog order for that class, slot and rarity.

- Precision: source attack + `2 × rank`; source crit + `300 × rank` basis points.
- Tempo: source attack minus `rank`, floored at zero; source attack rate +
  `60 × rank` thousandths of an attack per second.
- Bulwark: source attack minus `2 × rank`, floored at zero; source health +
  `10 × rank`; source armor + `2 × rank`.

Stats not listed for a style contribute zero. Each new style gains and loses
stats against both other styles at the same tier; this does not establish equal
combat power. Build viability and class feel require separate balance playtests.
No changes were made to class techniques, XP curves, zone difficulty, rarity
weights, drop chances, Forge recipes, costs or unlocks. Expanding the eligible
item pool changes which named item a loot or Forge draw selects, and reduces the
chance of any particular existing item within that pool.

## Integration and compatibility

Adventure loot, caches and Forge use the existing class-compatible catalog pools.
Gear and Inventory search accept style names and trait tags, and comparisons show
stat tradeoffs without reporting a new source ID as a changed effect. Equipment
continues to apply through the existing safe-boundary commands in game-core.

New gear uses ordinary item definitions and instances, with no save fields or
schema migration. Older owned copies, equipment and pinned fight content retain
their identifiers. The intentional content update has its own version and parity
goldens; old content fixtures remain intact.

Automated checks cover all classes and slots, tradeoffs, effect parameters,
deterministic combat, loot eligibility, Forge output, save round-trips and skins.
Browser checks are separate from physical-device validation and human playtesting.

The Chromium walkthrough verified all 216 added icons, 72 equipment changes through
the real UI, 12 reloads after background saving, distinct style materials and three
mobile viewport sizes. All 31 simulation reference cases matched in Node,
Chromium and WebKit. No physical-device validation or human balance playtest was
performed for these additions.
