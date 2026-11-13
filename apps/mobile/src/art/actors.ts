import { actorPack as originalActors } from "./darkwood";
import { refinedEnemyActors } from "./refinedEnemies";
import type { ArtId } from "./types";

/** Animation timing is presentation only; the prepared log still owns combat. */
export const actorPack = { ...originalActors, ...refinedEnemyActors };
export const productionActorId = (name: string): ArtId => `${refinedEnemyActors[name] ? "enemies" : "characters"}/${name}`;
