# Pixel characters and equipment

Characters, portraits and inventory icons share the same pixel artwork. Each of the
128 live class items has a named material and design, with a class-specific cut.
Rarity, item rolls, upgrade level and instance IDs do not choose the artwork.
Two copies of the same named item retain the same skin.

## Rendering contract

- `gearDesigns.ts` registers named materials. New families require an explicit entry;
  there is no generic rarity fallback. `pixelGear.ts` draws each family's shape and
  details, including the class-exclusive helmets, robes, gloves and boots.
- Classes retain distinct anatomy: the Monk's wrapped stance, broad Warrior,
  tall robed Mage and lean Ranger. Shared item families have class-specific cuts,
  proportions, bindings or ornament. Weapons are distinct per named class item.
- `gearArt.ts` composes only equipped slots. Any combination of head, chest,
  gloves, boots, ring and weapon is supported. Empty slots show the base body.
  Owning an item does not equip it. Queued equipment follows the existing fight
  boundary and save behavior.
- Clothing uses the torso transform, headpieces the skull, cuffs the forearm axis,
  boots the ankles, rings the fingers, and weapon grips the palms. Fingers draw over
  held grips. A drawn bowstring meets the Ranger's other hand. All layers share
  recoil and falling transforms.
- Joints are mapped before rasterization onto integer pixels. Character textures
  use one pixel per logical pixel, nearest sampling and pixelated presentation.
  No art loads are needed to draw a hero. Portraits and combat use identical layers.
- The existing frame sizes, anchors, combat timing, identifiers and save schemas
  are preserved. Equipment appearance never changes game outcomes or balance.

## Validation

The gear browser check exercises 56 outfits, all 128 named class items, all poses,
neutralized icon palettes, class-specific icon designs, connected equipment
components against posed anatomy, transparent/opaque pixels, clipped frame edges,
matching portraits, the actual equip UI, queued changes and reload persistence.
It retains review sheets and reports under ignored `tools/smoke/out/gear-skins`.

Also run the README's character animation, unarmed combat and combat layout checks,
the type checks, unit suite, art validation, core purity and production web build.
Browser checks establish rendering and interaction behavior. Physical-device
validation and the user's art review remain separate.
