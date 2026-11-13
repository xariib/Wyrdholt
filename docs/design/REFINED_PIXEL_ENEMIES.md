# Refined pixel enemies

All 16 live enemy sprite identities use original generated artwork matching the
heroes in `REFINED_PIXEL_CHARACTERS.md`: selective dark plum outlines, warm
highlights, cool shadows, expressive faces and detailed material clusters on the
same two-native-pixels-per-logical-pixel grid.

Greenfields includes slime, boar, wolf, thornback boar, Elder Root and sproutling.
Darkwood includes spider, wisp, brute, Thornwarden and Hollow Matron. Ashen includes
imp, hound, golem, Ember Warlord and Caldera Drake. These are distinct illustrations,
including distinct idle and attack bodies. Existing content still chooses enemy
identities, including shared spider artwork for Matron's Brood and shared warlord
artwork for other bosses.

The built-in image-generation tool created three transparent source atlases using
the existing hero poses as a style reference. Full prompts are saved in
`docs/art/refined-enemy-prompts.json`. Sources and compiled atlases are local PNGs
under `apps/mobile/public/art/refined-pixel/enemies`. The source Darkwood atlas also
contains a juvenile spider study; it does not introduce an additional gameplay type.

`node --import tsx tools/art/build-enemy-art.mjs` extracts complete connected
silhouettes, samples them onto the native grid, and builds one compact atlas per
enemy. Both illustrated poses share a single scale. Idle weight shifts, hit recoil,
whole-body falling and white hit flashes fill the existing animation contract.
The build tool uses browser canvas and writes its review sheet to ignored
`tools/smoke/out/enemy-art`.

The renderer shares one texture source across every enemy pose, releases scene
textures on disposal and retains simple silhouettes if art cannot load. Existing
wolf/spider contact timings and anchors are preserved. Other enemies use the same
presentation animation player. The deterministic combat log remains authoritative
for attacks, damage, rewards and outcomes; content, progression and saves are unchanged
by this art update. The original Darkwood pack remains intact for provenance.

Every enemy stands on the shared ground line, including the middle member of
three-enemy formations. There is no whole-sprite idle hover. Compact health bars
sit beneath each combatant on a stable footer line: green for the hero, red for
enemies, and amber at low health. Ward and status indicators stack above the bar.
Formation spacing keeps the bars separate on narrow screens.

Run the README's standard type, art, build and test checks, plus
`node --import tsx tools/visual/enemy-art-check.mjs`. The browser check verifies
all 240 native frames for transparency, clipping and distinct silhouettes, shared
texture ownership and disposal, and 576 combat compositions at 320, 390 and 768
CSS pixels wide with all four heroes and one-, two- and three-enemy formations.
Ground contact and non-overlapping health bars are checked for every formation. Reports and
screenshots remain in ignored `tools/smoke/out/enemy-art`.

Browser rendering checks and visual inspection do not constitute physical-device
validation or human playtesting.
