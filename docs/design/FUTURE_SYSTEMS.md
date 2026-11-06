# Future systems — design, not implementation

## DECIDED / NOT IMPLEMENTED — class advancement

Four base classes initially have one promotion path each: Base → Promotion. Direction for requirements: Character Level, base M20 and a Promotion Trial. Character never resets; no rebirth. Existing class-tree fields are scaffolding, not a playable promotion system.

## OPEN — advancement

Exact level/trial content and whether both learned classes can promote remain unresolved.

## DECIDED / NOT IMPLEMENTED — seasons

Finite seasons, not an endless permanent ladder. Direction includes seasonal boss ladder, Season Rule, Season Relic, reward track and server-validated leaderboards. Permanent character progression does not reset; only the future Season Relic resets. Seasonal presentation must not imply inventory/class resets. Existing PRODUCT.md suggests approximately 6–8 weeks and calendar-unlocked tiers; these are future direction, not a live schedule.

## OPEN — seasons

Exact duration, tier cadence, reward entitlement and archival/reset treatment of seasonal rankings require specification. Do not infer extra reset rules from the word seasonal.

## DECIDED / NOT IMPLEMENTED — dungeons

Asynchronous parties of three characters. Every character remains solo capable; no mandatory Tank/Healer/DPS slots. Builds contribute single-target damage, AoE, Crit, Burn, Poison, Bleed, armor pressure and buffs/debuffs. Encounters should reward complementary capabilities without requiring one class.

Future friend/guild characters may be borrowed while their owner is offline. Party members must be represented by authoritative, versioned character/build snapshots. A borrowed character's later equipment change must not silently rewrite an accepted attempt. Outcomes come from actual deterministic game-core combat, not a percentage-success roll. This is a design requirement, not a claim that C1 already simulates parties.

Async reward settlement must safely credit eligible participants exactly once, including reconnect/retry cases. Snapshot/rules/content identity and attempt identity must make outcomes auditable; the future authority layer owns validation. No client-only mock may grant rewards.

## OPEN — dungeons

Borrow consent/availability, duplicate characters, entry costs, attempt limits, snapshot expiry, simultaneous borrowing, participant eligibility, reward allocation and failed-attempt treatment. No exact limits are decided here.

## DECIDED / NOT IMPLEMENTED — guilds

Shared progression and organization: membership, gameplay-earned resources, treasury, projects, facilities, achievements, raids, expeditions, cosmetics, merchants and content unlocks. Resources primarily enter through gameplay, not a mandatory daily Donate chore.

Avoid enormous permanent passive multipliers (+100% damage/XP), account-age snowball and a reward structure that makes newer guilds irrelevant. Prefer unlocking shared activities/options over multiplying all personal progression.

## OPEN — guild concepts

Guild Hall, Blacksmith, Alchemist, Raid Hall, Expedition Table and Trophy Hall are possible facilities, not implementation requirements. Membership permissions, treasury spending, departure behavior, project costs, resource accounting and catch-up rules remain open. No guild-only competitive stat advantage is approved by a mock facility card.

## DECIDED / NOT IMPLEMENTED — raids

Asynchronous multi-day guild encounters: individual attempts contribute to shared boss/progression state across multiple phases. No real-time 20-player synchronization requirement. Different builds should matter; raids must not collapse to summing everyone's DPS.

Possible contributions include raw damage, adds killed, statuses applied, armor broken and encounter objectives. These are design directions, not final scoring formulas. Shared state and rewards require authoritative, retry-safe settlement, building on the future backend rather than a separate random outcome system. Cooperative rewards should not create a runaway internal winner snowball.

## OPEN — raids

Concurrent attempt ordering, phase snapshots, overkill, contribution attribution, attempt budgets, participation eligibility, reward allocation and anti-exploit validation. No numeric contribution weights are decided.

## DECIDED / NOT IMPLEMENTED — live operations

Direction: rotating events, finite seasons, temporary rules, special bosses, invasions, rare encounters, remote config, reward tracks and leaderboards. Time windows and rules must remain versioned/replayable. No backend, scheduler or live event is implemented in this phase.

## OPEN — live operations

Event cadence, operational staffing, config approval/rollback and specific rewards. ROADMAP controls implementation order; this document preserves intent only.
