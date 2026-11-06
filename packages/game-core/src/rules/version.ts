/**
 * Rules version: bump whenever authoritative game-core behavior changes
 * (combat math, mechanic interpretation, run flow, loot, rewards).
 * Replays and golden hashes are only comparable within one rules version.
 */
// 0.3.0 (C1 retune): the Mastery foundation is applied in hundredths of attack.
export const RULES_VERSION = "emberbound-rules/0.3.0";

/** Save schema version for the fresh TypeScript save format (no Godot import). */
export const SAVE_SCHEMA_VERSION = 1;
