# Hunts

Status: implemented for browser playtesting. Human enjoyment, repeat-session retention,
physical-device behaviour and economy acceptance remain open. This is a first return loop,
not a claim that long-term retention has been solved.

## Player loop

Clear a zone, farm it, discover a Hunt, choose a gear slot, follow its tracks,
choose a route, and challenge its boss. Combat is automatic. The one persistent
character enters every encounter manually. Each encounter can finish offline;
the next decision waits while safe Adventure farming resumes.

The first millisecond of farming cleared territory grants an introductory Hunt.
Thereafter four hours of settled farming earns another. The board holds three,
including a Hunt already started. Discoveries never expire. Discovery progress
pauses at capacity; farming rewards and the existing 24-hour offline cap continue.
Trail farming, Push and challenge time do not earn discoveries. Farming a different
cleared zone changes the source of the next discovery and preserves accumulated time.

Initial content: the Rootbound Elder in Greenfields, Briar Matriarch in Darkwood,
and Cindermaw in Ashen Mountains. Encounter compositions reuse approved enemy art.

## Routes and rewards

Choose any of the six gear slots at entry; it is fixed for that discovery. The
approach pays the source zone's cache Gold once. After it, choose one route:

| Route | Encounters after approach | Reward and consequence |
| --- | --- | --- |
| Follow the tracks | Boss | One guaranteed item in the chosen slot |
| Raid the nest | Detour, then boss | Detour grants an extra targeted item; HP carries into the boss |
| Find its weakness | Guardian detour, then boss | Boss deals 60% less raw damage; one targeted boss item |

HP carries between successful Hunt encounters, without interstage healing. Build
changes queue during combat and apply at its end. A retry starts the failed
encounter at full HP with the current build and the same encounter seed. No retry
fee or consumable is required. Completed steps cannot be replayed for rewards;
defeat retains their Gold and gear. Only one discovery can be started at a time.

Targeted items use the source zone's cache rarity weights, hard rarity ceiling,
and Hunt boss encounter-level eligibility. Gear is compatible with the class
that fought that encounter. Rewards are ordinary owned items, eligible for the
existing gear, Forge, lock and salvage flows. No new currency, XP curve,
permanent power multiplier, energy system or daily reset is introduced.

## Separate tuning decision

Hunt tuning lives in `packages/game-content/src/hunts.ts`. Adventure tables are
unchanged. Initial approach/detour/boss HP budgets are 200% / 200% / 160% of the
source zone's elite / ninth / final stages. Their raw damage budgets are 30% /
50% / 35%. The weakness route applies a further 40% multiplier to boss damage.
These are provisional playtest values, independent of Adventure and Forge tuning.

`node --import tsx tools/sim/hunts-report.ts` runs 48 seeds per class, zone and
route using existing first-clear build anchors (1,728 attempts). Direct and
weakness routes currently win 48/48 for every class in every zone. Raid results
range from 0/48 to 48/48: early Warrior/Ranger builds carry meaningful risk.
Successful near-entry runs take roughly 1.5–2.5 minutes of combat, plus decisions.
Stronger builds finish faster. These observations do not establish human balance.

## Separate save and replay decision

Schema 6 adds only the Hunt domain: accumulated farming time, monotonic discovery
IDs, a bounded queue, completed count, active pinned fight and last result. Saves
with no Hunt progress retain schemas 1–5. Older saves load without rewriting
their previous domains; first cleared farming enables the new schema. Older app
versions correctly refuse schema 6 rather than silently dropping Hunt state.

Fight record format 4 and `emberbound-rules/0.5.0-hunts` pin Hunt content separately.
Existing Adventure, boss, promotion, season and social content hashes are retained.
Historical self-test fixtures use their pre-Hunt content domain; three additional
route fixtures cover Hunt fights, rewards and offline discovery. Changed Hunt
content interrupts an active encounter without paying it or consuming the discovery;
the player can retry against the new content. Keep published Hunt IDs available.

The client saves entry and encounter settlement through the existing guarded
write/readback flow before showing success. Authority journals include the Hunt
content hash; historical journals replay against the content domain they recorded.

## Validation and playtest

Verified on 2026-11-11: 1,566 unit/integration tests in the isolated release checkout; TypeScript, core purity,
approved-art and Chrome/WebView 97 compatibility checks; production web build;
all 34 golden cases in Node, Chromium and WebKit; three Hunt routes at 320, 360
and 390-pixel phone widths; existing browser save, boss, promotion, season,
Forge, lock and salvage regression flows. The 31 historical golden hashes are
unchanged. Physical Android validation and human playtesting are still pending.

Automated checks cover deterministic discovery, bounded capacity, all classes and
bosses, slot/rarity eligibility, retries retaining rewards, route effects, save
round-trips, malformed state, offline idempotence, and failures during temp write
and main-file readback. Browser flow: `node --import tsx tools/smoke/hunts-check.mjs`.
Screenshots and reports go under ignored `tools/smoke/out/hunts`.

On a physical Android phone, test background/resume during each encounter, force
stop and reopen, route choice persistence, small-screen readability, and an upgrade
from a real older-schema test save. Keep raw player saves out of the repository.

For a one-week human pilot, record (with participant consent) whether a second
session happens, what prompted it, whether a route/build choice felt meaningful,
and whether the reward helped a chosen gear or Forge goal. Ask once-a-day players
whether the waiting board feels useful or burdensome. Measure enjoyment and
voluntary returns before adding more timers or changing the four-hour cadence.
