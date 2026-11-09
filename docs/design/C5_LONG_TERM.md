# Promotions and seasons

Both learned classes can promote independently after the character clears Ashen Mountains and reaches Level 25. The class entering the trial needs Mastery 20. Each trial is a single full-HP automatic fight. Victory awards the promotion and a permanent 10% Attack bonus to that class. Trial failure leaves the next attempt available. Adventure farming resumes when an attempt ends.

| Base class | Promotion |
| --- | --- |
| Warrior | Vanguard |
| Monk | Ascendant |
| Mage | Arcanist |
| Ranger | Warden |

The trial targets late-game gear. At Level 25 and Mastery 20, each class won all 48 seeded trials in a full Legendary set and lost all 48 in a full Epic set. The simulation used the same trial budget for all four classes. Human difficulty and reward perception are queued for playtesting.

Hollow Frost and Ember Wake are six-week seasons with three tiers. The first tier opens when the season starts. Tiers 2 and 3 open one and two weeks later. Clearing Ashen Mountains and the preceding tier gates entry. The season closes to new attempts at its UTC end time. Attempts already in progress settle against their original rules and build.

Each season applies one rule to its boss fights. A tier clear grants a permanent title in season history and ranks up the Season Relic. The Relic gives 3%, 6%, then 9% Attack in its own ladder. The next season starts with its own Rank 0 Relic. Character Level, Mastery, promotions, gear and the Ashen Crown persist. The authority service derives leaderboard tiers from its saved results.

## Saves and replay

The first promotion trial or seasonal attempt writes schema 5. Older saves load as before. Existing Adventure and Ashen King records retain their formats, rules, content hashes and results. Promoted Adventure records use format 3. Seasonal records pin the specific season, its rule and the Relic bonus available at entry. Adding a future season preserves older season and promotion hashes.
