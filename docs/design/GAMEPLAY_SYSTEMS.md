# Gameplay systems

## IMPLEMENTED — character and classes

One persistent character has shared Character Level and two learned classes, Active and Alternate. Each has separate Mastery XP. All four classes (Monk, Mage, Warrior, Ranger) are implemented in the current C2-based Codex integration; human validation is still pending. Build changes during a fight are queued to a safe boundary.

## IMPLEMENTED / HUMAN VALIDATION OPEN — four-class promise

Warrior, Monk, Mage and Ranger must all be solo viable. No mandatory Tank/Healer/DPS trinity. C2 kits and Mage Arcane Ward are technically integrated; calibration is provisional until human class-feel testing.

## IMPLEMENTED — Mastery

Immediately viable, gradually specialized. M1/M5/M10/M15/M20 add or improve class mechanics; other ranks provide a secondary 2.5% class-base-attack foundation per rank above M1, calculated in hundredths. Class XP curves are explicit data. Current parameters and full milestone table: [ITEMS_CLASSES_CONTENT](../technical/ITEMS_CLASSES_CONTENT.md). Techniques remain the majority of measured M1→M20 gain; do not retune during A40 validation.

## IMPLEMENTED — Adventure

Greenfields, Darkwood and Ashen Mountains each currently have ten data-defined stages. Stage 5 is Elite; stage 10 is Boss. One stage is one encounter with 1–3 simultaneous enemies sharing an encounter budget. Combat logic must not assume ten stages universally.

Push attempts the selected zone and automatically advances within it. HP carries over, with configurable recovery (current default 18% max HP) between stages. Defeat loses run progress, not previously earned XP, Mastery, gold or gear. Successful full clears pay a cache, unlock the next zone and Farm the completed zone; entering the next zone is manual.

Farm repeats cleared content; safe fallback chooses completed content, with a Trail fallback before a safe full clear exists. Current app glue resumes safe farming after defeat so a result screen does not leave the character silently idle. A failure result remains a decision point to review/retry the build.

Closing or suspending is not death. Checkpoints reconstruct the run; offline uses the same simulation, capped at 24 h. Failed offline Push stops risky attempts and uses remaining time for safe Farm. Successful offline Push farms the just-cleared zone, never pushes the next one.

## IMPLEMENTED — gear and loot

Six slots: Weapon, Head, Chest, Gloves, Boots, Ring. Fixed named definitions and uniquely identified owned copies; UI groups duplicates. NEW status persists and comparison marks that group's copies reviewed. Loadout opens a slot-filtered item list, followed by in-place comparison; equip may be queued. Build summary describes stats/effects, not a universal rating. No Equip Best.

Current catalog: 30 items, five rarities × six slots. ITEM-EFFECTS-006 adds the ten
missing named Epic/Legendary effects for a provisional C3 playtest; all twelve
high-rarity items now have effects. [Effect contract](C3_ITEM_EFFECTS.md).
Gear includes combined name/effect search, rarity and NEW filters. Drop eligibility
and zone rarity ceilings are unchanged; human balance acceptance remains open.

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
No bulk/auto-salvage or automatic optimization. PR30 is integrated into master at
`9c4967b` after explicit merge approval; identical tree/source/artifact proof covers
the agreed web criteria. Human balance and native acceptance remain separate gates.

## DECIDED / NOT IMPLEMENTED — Solo Boss / Artifacts (PLANNED)

Separate permanent tier ladder; defeat does not erase cleared tiers. Auto-push may advance successful tiers until failure. Artifact milestones belong to this future system, not current Adventure checkpoints.

## OPEN — balance

A40 validates new C1 pacing. Short-fight drop scaling awaits a decision. Do not translate an old Godot feature into an IMPLEMENTED claim for TypeScript.
