# Wyrdholt development roadmap

The milestone order comes from the original `docs/ROADMAP.md` in the Wyrdholt Mobile source archive. The status below tracks `main` in [xariib/Wyrdholt](https://github.com/xariib/Wyrdholt). Android 0.2.1 is the current [public release](https://github.com/xariib/Wyrdholt/releases/tag/android-v0.2.1-2). The signed C4 candidate is available for testing through the [Android build run](https://github.com/xariib/Wyrdholt/actions/runs/42523633779).

| Milestone | Scope | Status |
| --- | --- | --- |
| A | Deterministic combat, replay and cross-engine parity | Delivered |
| B | Mobile shell, saves, lifecycle and offline simulation | Delivered |
| C1 | Adventure zones, pacing, Push and Farm, offline progression and manual zone entry | Implemented. Human pacing retest open. |
| C2 | Four solo-capable classes, Mastery and Mage Ward | Implemented. Four-class human validation open. |
| C3 | Named gear effects, Forge, inventory review, locks and salvage | Implemented. Human economy and usability validation open. |
| C4 | Ashen King ladder, Artifact milestones, boss telemetry and challenge UX | Implemented. Signed candidate passed emulator upgrade testing. Physical-device and human balance checks open. |
| C5 | Promotion trials, finite seasons, Season Rules, Relics and seasonal rollover | Four promotion paths and two scheduled six-week seasons in the app. [Gameplay rules](design/C5_LONG_TERM.md) |
| C6 | Account and profile boundaries, authoritative commands, server replay validation and leaderboard submissions | Account-bound commands and a transactional journal in the local authority service. |
| C7 | Asynchronous three-character dungeons, versioned snapshots and friend or guild borrowing | Briar Vault supports consenting friends and guildmates with three individually simulated builds. |
| C8 | Guild membership, shared resources, projects and multi-phase raids | Dungeons earn guild marks for the Expedition Table. It opens Cinder Breach, a three-phase asynchronous raid. |
| C9 | Seasonal content loading, event definitions, remote configuration, reward tracks and leaderboards | The authority loads a versioned rotation manifest and serves events, season reward tracks and validated standings. |

## Milestone gates

Run typecheck, core purity, unit tests, cross-engine parity and relevant browser smoke tests. Update gameplay contracts, prepare browser and Android test builds, and record balance and UX risks. Human playtesting follows the integrated roadmap build. Record browser, emulator, physical-device and human results separately.

The [Android Ashen King playtest](design/C4_SOLO_BOSSES.md#android-playtest) and [earlier human checks](playtests/C3_OBSERVATIONS_DA.md) are queued for that playtest. Online play is available against the [local authority service](technical/ONLINE_AUTHORITY.md).

## Design boundaries

Keep one persistent character, with automatic combat and manual entry into new content. Preserve rewards earned before a failed Push. Game outcomes belong in the deterministic game core, with versioned content and replayable rules. React presents state and submits commands. PixiJS renders combat.

Only the Season Relic resets. The permanent character, classes, inventory and progression persist. [C5 rules](design/C5_LONG_TERM.md)
