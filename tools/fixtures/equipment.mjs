import { createInstance } from '@emberbound/game-core';

/** Explicit owned loadout for equipment tests; real characters start empty. */
export function equipCommonGear(profile, content) {
  for (const slot of ['weapon', 'head', 'chest', 'gloves', 'boots', 'ring']) {
    const item = content.snapshot.items.find(i => i.classId === profile.character.activeClassId && i.slot === slot && i.rarity === 'common');
    if (!item) throw Error(`No common ${slot} fixture for ${profile.character.activeClassId}`);
    profile.equipment[slot] = createInstance(profile, item.id, { isNew: false, provenance: { source: 'browser-fixture' } }).id;
  }
  return profile;
}
