# Refined pixel characters

The previous characters had coarse flat shapes, limited facial detail and repetitive
material rendering. The new artwork gives each class an expressive face, a distinct
silhouette, shaped fabric folds and illustrated equipment. The original code-drawn
characters remain a safe fallback while images load or if a source cannot load.

## Reference direction and provenance

- [Sea of Stars](https://seaofstarsgame.co/): controlled pixel clusters, readable faces,
  selective outlines and warm/cool shade separation. The official Valere sprite was
  inspected as a visual reference; it is not included in the game's assets.
- [Children of Morta](https://store.steampowered.com/app/330020/Children_of_Morta/):
  readable fantasy silhouettes, natural proportions and clearly separated materials.

The Wyrdholt designs are original generated artwork, created with the built-in
image-generation tool. They are not ripped game sprites or claimed to be manually
drawn pixel by pixel. Full prompts and reference credits are recorded in
`docs/art/refined-pixel-prompts.json`.

## Local sources

All project-bound images are under `apps/mobile/public/art/refined-pixel`:

- `lineup-v1.png`: the initial visual direction, including equipped examples.
- `poses-v1.png`: four starting-clothes characters and four separately illustrated
  attack poses. No equipment is baked into the bodies.
- `monk-gear-v1.png`, `warrior-gear-v1.png`, `mage-gear-v1.png`,
  `ranger-gear-v1.png`: 32 distinct equipment illustrations per class.

`refinedPixelSources.ts` maps each live named item to its exact atlas cell. No
rarity-based artwork selection or item-instance randomization is used. Different
copies of the same named item have the same appearance. All six slots mix freely.

## Rendering and animation

- Source cells are imported onto a deliberate native pixel grid with nearest
  sampling and opaque/transparent pixel edges. Each body is 96–104 native pixels
  tall within a 128 × 128 frame; there are two native pixels per logical pixel.
- Headpieces, garments, gloves, boots, rings and weapons use their own illustrations.
  Face and limb foreground masks preserve the character's anatomy and layering.
- Idle and attack have separately measured wrists, elbows, head and foot positions.
  Equipment is attached to those landmarks. Weapon grip positions are measured
  from the illustrated shaft or handle, with fingers drawn over the grip.
- Attacks use separately illustrated body poses. Tiny whole-body breathing and lean
  offsets fill the existing animation timings; limbs are never stretched to reach
  an attack position. Recoil and falling transform the composed character together.
- The same artwork composes combat, portraits and equipment icons. The loading
  promise is shared, failed requests can retry, and hung requests time out. Large
  source images are released after native cells are prepared; caches are bounded
  and their decoded memory is counted by the texture budget.
- Existing simulation rules, class/item identifiers, animation hit times, saves,
  equipment settlement boundaries and Android signing identity are preserved.

## Checks and acceptance

The gear browser check covers 56 outfits, 840 complete pose frames and 1,792
individual equipment attachment frames, plus distinct illustrated item/class
icons in grayscale, pixel alpha, clipping, portrait/combat agreement, actual equip
UI behavior, queued changes and reload persistence. Run the README's character
animation, unarmed combat and combat layout checks against the production build.

Automated checks establish behavior and measurable rendering constraints. Visual
review at game size is also required; physical-device testing and the user's
judgment of the art remain separate from browser validation.
