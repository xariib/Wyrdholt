import { describe, expect, it } from "vitest";
import { parseSave, serializeSave, sha256Hex } from "@emberbound/game-core";
import { newProfile } from "./helpers";

describe("untrusted character data in saves", () => {
  const invalid: [string, unknown][] = [
    ["name", {}], ["name", null], ["name", ["broken"]],
    ["alternateClassId", {}], ["activeClassId", null],
    ["xp", -1], ["xp", 1.5], ["xp", "100"],
    ["level", 0], ["level", -1], ["level", 1.5],
    ["masteryXp", null], ["masteryXp", []],
    ["masteryXp", { monk: -1 }], ["masteryXp", { monk: "100" }],
    ["masteryXp", { monk: 1.5 }],
  ];
  it.each(invalid)("refuses malformed %s even with a valid checksum (%j)", (field, value) => {
    const envelope = JSON.parse(serializeSave(newProfile(), 0));
    const encoded = JSON.parse(envelope.payload);
    encoded.character[field] = value;
    envelope.payload = JSON.stringify(encoded);
    envelope.checksum = sha256Hex(envelope.payload);
    expect(parseSave(JSON.stringify(envelope))).toMatchObject({ ok: false });
  });

  it("preserves valid characters and unknown mastery tracks", () => {
    const profile = newProfile();
    profile.character.masteryXp.future_track = 20;
    const parsed = parseSave(serializeSave(profile, 0));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.profile.character).toEqual(profile.character);
  });
});
