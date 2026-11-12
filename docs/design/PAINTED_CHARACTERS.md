# Painted fantasy characters

The approved painted 2D lineup replaces the code-drawn pixel heroes in character
selection, the header, equipment portraits and combat. The four identities are a
shaved-headed Monk, a bearded Warrior, an older white-haired Mage and an auburn-haired
Ranger. The world and enemies continue to use their existing art.

## Runtime contract

- Local transparent PNGs live in `apps/mobile/public/art/painted`.
- Each outfit sheet is 384 × 256: two 192 × 256 cells, plain on the left and
  equipped on the right. Head and ground positions are aligned at import.
- The plain outfit has no weapon, headpiece, gloves or boots. Chest, glove and
  boot masks compose only the currently equipped slots. Equipment queued during
  a fight continues to become visible at the existing fight boundary.
- Weapons and headpieces are separate painted sheets. Named item materials use
  stable presentation-only variations. Inventory icons share the same layers.
- Atlases use four raster pixels per logical pixel and linear sampling. Pixi
  renders at two screen pixels per logical pixel; actor coordinates, anchors,
  hit times and clip durations retain the existing animation contract.
- Breathing, strikes, recoil and falling use cutout deformation. These are
  animated painted cutouts, not individually hand-painted animation frames.
- The loader validates dimensions, times out failed requests, and shares six
  bounded source images. Outfit and equipment caches are bounded. Texture banks
  count their physical pixels and shared painted resources against the existing
  decoded-memory budget, and do not publish into disposed scenes.
- Failed art loads retain the prior equipped drawing. Character art cannot block
  play. No profile, inventory, progression, combat or save-schema rules change.

## Source and review

The bitmap sources were generated with the built-in image generation tool from
the user-approved 2D fantasy reference. Exporting only aligned, resized source
cells preserves their generated transparency. No runtime network calls are needed.
The exact source prompts are recorded in `docs/art/painted-character-prompts.json`.

Run the README's gear appearance, character animation, unarmed combat and combat
layout browser checks after building. The gear check inspects physical atlas
pixels at 4×, including clipped frame edges, empty slots, distinct named items,
portrait agreement, queued equipment and reload. Browser evidence is kept in
ignored `tools/smoke/out`. Physical-device validation and human art acceptance
remain separate from automated browser checks.
