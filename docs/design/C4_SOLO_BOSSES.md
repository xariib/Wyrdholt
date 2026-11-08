# C4 Solo Bosses and Artifacts

C4 gives the persistent character a permanent challenge ladder. The Ashen King is the first ladder listed in Challenges. The player starts an attempt, combat resolves automatically, and cleared tiers remain recorded after defeat. Artifact milestones come from the ladder. [Gameplay systems](GAMEPLAY_SYSTEMS.md)

## Ladder and combat

The Ashen King unlocks after the first Ashen Mountains clear. Adventure and the offline clear summary link to the ladder. Challenges shows the requirement, cleared tiers, and next opponent. Each of the five tiers is one automatic fight at full HP. The boss reuses the Ember Warlord sprite.

Starting an attempt preserves the checkpoint of any unfinished Adventure Push and applies queued build changes before taking the snapshot. Changes made during the fight apply at its end. Defeat and timeout show remaining boss HP and allow retrying the same tier. A victory opens the next tier or completes the ladder. Safe Adventure farming resumes when the attempt ends.

The player can enable auto-push for an attempt. Online auto-push starts the next tier after a win and stops at defeat, timeout, or the final tier. Offline catch-up finishes the active fight, then uses the remaining time for Adventure farming. After a tier is cleared offline, the next tier waits for a manual start.

## Ashen Crown

The Ashen Crown is a permanent passive Artifact for both learned classes. Its rank is derived from the highest cleared tier, so retrying, reloading, or recovering an interrupted save cannot grant the same milestone twice. The current rank multiplies Attack after base stats, gear, and the Mastery foundation have been combined.

| Clear | Crown rank | Attack bonus |
| --- | --- | --- |
| Tier 1 | 1 | 3% |
| Tier 3 | 2 | 6% |
| Tier 5 | 3 | 9% |

## Saves and replay

The first attempt upgrades the profile to schema 4. Schemas 1 through 3 still load, and the upgrade retains existing Adventure, Forge, and item-lock data. The client uses guarded save readback before it shows a new attempt, a tier clear with its reward, or an auto-push transition. The saved attempt includes its encounter, seed, build, and elapsed time. If a content update makes an active fight incompatible, the attempt ends as interrupted and farming resumes. Cleared tiers are retained.

Boss attempts use their own seed stream and content hash. Both the game and the replay CLI use the same combat engine. Adventure records with an Ashen Crown bonus use fight-record format 2, which snapshots the bonus. The original Adventure records keep their format and hashes.

## Balance and validation

The budgets were checked with 48 deterministic ladders per class and build. Each cell lists clears for tiers 1 through 5 out of the 48 started ladders. The simulation includes the Crown upgrades earned along the way.

| Build | Warrior | Monk | Mage | Ranger |
| --- | --- | --- | --- | --- |
| Level 19, M14, Darkwood epic gear | 48 / 48 / 0 / 0 / 0 | 48 / 48 / 0 / 0 / 0 | 48 / 46 / 0 / 0 / 0 | 48 / 48 / 0 / 0 / 0 |
| Level 24, M18, same epic gear | 48 / 48 / 48 / 0 / 0 | 48 / 48 / 48 / 0 / 0 | 48 / 48 / 48 / 0 / 0 | 48 / 48 / 48 / 0 / 0 |
| Level 30, M20, Ashen legendary gear | 48 / 48 / 48 / 48 / 48 | 48 / 48 / 48 / 48 / 48 | 48 / 48 / 48 / 48 / 48 | 48 / 48 / 48 / 48 / 48 |

Median Tier 1 wins at the entry build took 42 to 46 seconds across classes. Median Tier 5 wins at the final build took 49 to 54 seconds. [Ashen Mountains entry build](../../tools/sim/expected-builds.ts)

Automated coverage includes the locked and unlocked Challenges screens, the link from an Ashen Mountains clear, online auto-push, offline settlement after reload, save recovery, and deterministic replay.

An Android 15 emulator running a debug build kept the same attempt through backgrounding. After a force-stop and relaunch, native storage recorded one Tier 1 clear, Rank 1 of the Crown, resumed farming, and manual entry for Tier 2. The first run saved the result but the test timed out waiting for the result button. Two repeat runs showed the button and verified the reward on screen.

On the Android 15 emulator, the signed `0.3.0-c4.1` candidate installed over the public `0.2.1` APK. Both APKs used the same package and release certificate. Relaunch showed the existing test character and class and continued its Greenfields Push. The emulator test used Android's package installer through ADB.

### Android playtest

Use a test character that has cleared Ashen Mountains. Record the device, Android version, app version, class, level, Mastery, and equipped gear.

1. Open Challenges and start Tier 1 with auto-push enabled. Switch apps mid-fight and return before it would finish. Check that the same tier resumes with progress from the time away.
2. On a test installation, close Wyrdholt during an attempt and relaunch after the fight would have ended. Check the offline result, resumed farming, and the next available tier. After an offline win, the next tier should wait for you to start it.
3. On the first win, check for Rank 1 and +3% Attack in Challenges and Character. Relaunch again and check that the rank is unchanged. On a loss, check the boss HP left and retry the same tier after a build change.

Record the build used for each tier, what changed between attempts, and whether the Crown made a noticeable difference. The physical-device checks and human balance assessment are pending. [Playtest observations](../playtests/C3_OBSERVATIONS_DA.md#c4--ashen-king)
