# Gameplay systems

## IMPLEMENTED — character and classes

One persistent character has shared Character Level and two learned classes, Active and Alternate. Each has separate Mastery XP. All four classes (Monk, Mage, Warrior, Ranger) are implemented in the current C2-based Codex integration; human validation is still pending. Build changes during a fight are queued to a safe boundary.

## IMPLEMENTED / HUMAN VALIDATION OPEN — four-class promise

Warrior, Monk, Mage and Ranger must all be solo viable. No mandatory Tank/Healer/DPS trinity. Chromium verified class selection, Mastery display and switching on `51b82b7`. Calibration is provisional until human class-feel testing. [Current four-class balance checks](C3_ITEM_EFFECTS.md#validation-boundaries)

## IMPLEMENTED — Mastery

Immediately viable, gradually specialized. M1/M5/M10/M15/M20 add or improve class mechanics; other ranks provide a secondary 2.5% class-base-attack foundation per rank above M1, calculated in hundredths. Class XP curves are explicit data. Current parameters and full milestone table: [ITEMS_CLASSES_CONTENT](../technical/ITEMS_CLASSES_CONTENT.md). Techniques remain the majority of measured M1→M20 gain. Keep the tuning fixed during the Android pacing playtest.

## IMPLEMENTED — Adventure

Greenfields, Darkwood and Ashen Mountains each currently have ten data-defined stages. Stage 5 is Elite; stage 10 is Boss. One stage is one encounter with 1–3 simultaneous enemies sharing an encounter budget. Combat logic must not assume ten stages universally.

Push attempts the selected zone and automatically advances within it. HP carries over, with configurable recovery (current default 18% max HP) between stages. Defeat loses run progress, not previously earned XP, Mastery, gold or gear. Successful full clears pay a cache, unlock the next zone and Farm the completed zone; entering the next zone is manual.

Farm repeats cleared content; safe fallback chooses completed content, with a Trail fallback before a safe full clear exists. Current app glue resumes safe farming after defeat so a result screen does not leave the character silently idle. A failure result remains a decision point to review/retry the build.

Closing or suspending is not death. Checkpoints reconstruct the run; offline uses the same simulation, capped at 24 h. Failed offline Push stops risky attempts and uses remaining time for safe Farm. Successful offline Push farms the just-cleared zone, never pushes the next one.

## IMPLEMENTED — gear and loot

Six slots: Weapon, Head, Chest, Gloves, Boots, Ring. Fixed named definitions and uniquely identified owned copies; UI groups duplicates. NEW status persists and comparison marks that group's copies reviewed. Loadout opens a slot-filtered item list, followed by in-place comparison; equip may be queued. Build summary describes stats/effects, not a universal rating. No Equip Best.

Monks wield wraps, Mages wield staves, Warriors wield swords, and Rangers wield
bows. All six slots, including rings, have class-specific gear at every rarity.
Formerly shared armor and rings have one version per class with identical stats
and effects. Adventure drops and clear
caches use the class that fought. Forge results use the active class. Encounter
level gates and zone rarity ceilings still apply. [Effect contract](C3_ITEM_EFFECTS.md).

Gear includes name and effect search, rarity filters, and a NEW filter. A class
only sees compatible gear in Loadout, Inventory, Forge and the gear encyclopedia;
copy counts and NEW badges follow the same active-class view. Other classes' copies
and review state stay saved and become visible when that class becomes active.
A class switch returns incompatible gear to inventory and fills empty slots with the
first compatible owned copy by acquisition order. In an older save, shared copies
become versions for the active class at a safe fight boundary; an unequipped copy
queued for the alternate class becomes that class's version. IDs, locks, bonuses,
and review state are preserved. An incompatible old equipped weapon gets a
same-rarity replacement, retaining the original copy in inventory. Archived shared
definitions remain available to replay old fights but cannot drop or be forged.

Combat presentation uses animated poses with idle motion, anticipation, attack
steps and hit recoil. Health bars remain steady; damage and contact effects still
follow the deterministic event log. Large character portraits play their idle
animation and pause when hidden or when reduced motion is requested.

Character appearance follows the six equipped copies in combat, the header, and
Character/Gear portraits. Each named class item supplies its own visual layer and
matching inventory icon. Every new character starts with an empty inventory and
all six equipment slots empty. Empty slots show plain clothing, bare hands/feet, or an
uncovered head. Mixed rarities remain visibly mixed. Queued equipment appears only
after it becomes equipped, and current combat uses the fight's pinned build.
These skins are derived presentation data, with no save fields or stat changes.
An empty Weapon slot uses a bare-handed guard, melee approach, punch and physical
contact effects for every class. Equipping a weapon switches the attack pose,
wind-up and effects to wraps, sword, staff or bow at the same safe build boundary.
Weaponless attacks do not launch arrows or staff bolts; class mechanics and logged
damage timing remain authoritative.
Bare-handed movement uses a longer approach, visible contact and continuous return
through both recovery poses. Incoming hit reactions wait for that return; health
and damage effects still update at their logged times.

## INTEGRATED FOR WEB TESTING / HUMAN VALIDATION OPEN — Forge V1

Slot-targeted fusion uses same-slot, same-rarity items. Guaranteed +1 rarity;
possible capped +2, never total failure. Exact selected copies are reviewed before
consumption; equipped and queued copies are protected. Named result comparison carries the exact forged
instance into the existing equip flow, even with older identical copies. Greenfields/Darkwood/Ashen clears gate output tiers.
5/5/6/10-copy recipes and provisional costs/odds remain test tuning. The integrated
web integration is FORGE-INTEGRATION-004,
merged into master; human economy/UX acceptance remains open. Its guarded session
publishes the result after verified save readback. First Forge use writes schema 2;
non-Forge saves stay schema 1 until first player lock. Per-copy player locks are
integrated via ITEM-LOCKS-007/schema 3 and protect both eligibility and stale Forge
commands. [Lock contract](C3_ITEM_LOCKS.md). No broader C3 gate is declared accepted.

## INTEGRATED FOR WEB TESTING / HUMAN BALANCE OPEN — single-copy salvage

SALVAGE-008 adds explicit review/confirmation of one concrete owned copy in Gear.
Locked/equipped/queued copies are protected in UI and core; only the selected ID
is removed with an approved fixed Gold reward, saved together before success.
Retries cannot pay twice; schemas 1/2/3 remain unchanged. [Approved rule](C3_SALVAGE.md).
Manual batch salvage uses the same rewards and commits the selected copies together.
The controlled Chromium flow verified single and batch salvage, including recovery
after an injected save fault. Human balance and native acceptance remain separate gates.
[Batch salvage contract](C3_BULK_SALVAGE.md)

## IMPLEMENTED / HUMAN VALIDATION OPEN — Solo Bosses and Artifacts

The Ashen King unlocks after the first Ashen Mountains clear and has five permanent tiers. Each attempt runs automatically from full HP. Defeat and timeout retain completed tiers. Online auto-push is optional. Offline play finishes the active tier and then farms safe Adventure content.

The Ashen Crown grants both classes a permanent Attack bonus that upgrades at tiers 1, 3, and 5. The first attempt creates a schema 4 save. [C4 rules and validation](C4_SOLO_BOSSES.md)

## OPEN — balance

The next C1 pacing playtest is on the REDMAGIC 11 Pro. Short-fight drop scaling awaits a decision. Do not translate an old Godot feature into an IMPLEMENTED claim for TypeScript.
