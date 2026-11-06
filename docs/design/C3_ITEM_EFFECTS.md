# C3 item effects — provisional playtest delivery

User selected this feature on 8 October 2026; requirements and acceptance:
ITEM-EFFECTS-006.
Content: `emberbound-content/0.5.0-c3-items-test`. Combat rules remain `0.3.0`:
all effects use existing, deterministic mechanic interpretations.

Each effect works for all four classes; existing item stats, Stormcall/Poison Touch,
class kits, zone budgets, XP/loot and Forge economy are unchanged. These additions
change combat/progression when equipped. Values are playtest tuning, not accepted
balance. Existing copies gain their catalog effect, retaining their instance ID.

| Item | Named effect | Behavior |
| --- | --- | --- |
| Crown of Thorns | Thornbound | Enemy basic attack that damages health: 10% chance to retaliate for 30% attack, 2s cooldown; no class DoT propagation. |
| Cinderweave | Cinder Guard | Every fifth attack adds 1% attack as ward, cap 3% max health. |
| Pilgrim's Pace | Second Wind | Every sixth hit heals 3% attack, capped by max health, 8s cooldown. |
| Moonlit Loop | Moon Echo | 8% on-hit chance for a magic strike of 35% attack. |
| Venomstring | Venom Thread | 25% on-hit chance for Poison: 15% attack per 1s tick, 5s duration, two stacks. |
| Cinder Crown | Cinder Nova | Every sixth attack hits every living enemy for 35% attack as magic. |
| Last-light Vest | Last Light | Start each fight with ward of 5% max health; every sixth attack adds 5% attack, cap 10% max health. |
| Hands of the Dawn | Dawn Strike | Every fourth hit adds a physical strike of 50% attack. |
| Ghostwalk | Ghost Step | Every fifth hit grants 20% attack speed for 3s. |
| Oath of Embers | Ember Oath | Direct hits gain 20% damage against enemies at/below 25% health. |

Ward uses the existing shared pool: initial amounts add, the highest cap wins;
ward is lost between fights. Carried health is not refilled. Item Poison owns its
own status line alongside Ranger Poison/Venom Burst and Venom Grips. Item effects
do not rewrite class mechanics. Owned but unequipped items confer no effects;
queued equipment still waits for the existing safe boundary.

## Validation boundaries

Old schema 1/2 saves remain readable without reset or migration. Their saved
content label is preserved as provenance; new fights record the current content
version/hash. Old fight records require their matching content snapshot. The
frozen C2 snapshot and all 18 C2 goldens are preserved; new goldens deliberately
cover current content plus nine full/mixed C3 loadouts.

The paired study compares the same stats, seeds and encounters before/after.
The small natural-pacing probe uses the existing model-player gear policy, natural
drops and no DEV grants/Forge; it is not the full historical calibration or human
acceptance. Initial overly strong defensive values were reduced using those
measurements. Raw reports and limitations belong to the task evidence.

Remaining C3 scope: salvage/player locks and human loot/Forge economy/UX acceptance.
This feature does not close C3 or open Solo Boss/Artifacts.
