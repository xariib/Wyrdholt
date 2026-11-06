import { describe, expect, it } from "vitest";
import {
  DEFAULT_SAVE_PATHS as paths,
  MemorySaveFs,
  loadSaveSafely,
  parseSave,
  serializeSave,
  sha256Hex,
  type SaveEnvelope,
} from "@emberbound/game-core";
import { newProfile } from "./helpers";

// Default: master/schema 1. In a Forge scratch checkout run with
// QA_SAVE_SCHEMAS=1,2 to exercise both supported schemas explicitly.
const schemas = process.env.QA_SAVE_SCHEMAS === "1,2" ? [1, 2] : [1];
type Payload = Record<string, unknown>;
type Slot = keyof typeof paths;
const inventory = (p: Payload) => p.inventory as Record<string, unknown>;
const malformedCases: Array<[string, (p: Payload) => void]> = [
  ["missing inventory", (p) => { delete p.inventory; }],
  ["null inventory", (p) => { p.inventory = null; }],
  ["missing inventory.full", (p) => { delete inventory(p).full; }],
  ["null inventory.full", (p) => { inventory(p).full = null; }],
  ["object inventory.full", (p) => { inventory(p).full = {}; }],
  ["string inventory.full", (p) => { inventory(p).full = ""; }],
  ["null inventory.full entry", (p) => { inventory(p).full = [null]; }],
  ["missing inventory.groups", (p) => { delete inventory(p).groups; }],
  ["null inventory.groups", (p) => { inventory(p).groups = null; }],
  ["number inventory.groups", (p) => { inventory(p).groups = 42; }],
  ["array inventory.groups", (p) => { inventory(p).groups = []; }],
  ["null group tuple", (p) => { inventory(p).groups = { briar_edge: null }; }],
  ["null group ids", (p) => { inventory(p).groups = { briar_edge: [null, []] }; }],
  ["object group newIds", (p) => { inventory(p).groups = { briar_edge: [[], {}] }; }],
];

function validSave(schema: number, gold = 777, savedAt = 100): string {
  const profile = newProfile(4101);
  profile.gold = gold;
  if (schema === 2) Object.assign(profile, { schema: 2, forge: { version: 1, nextTransactionId: 1 } });
  const text = serializeSave(profile, savedAt);
  expect((JSON.parse(text) as SaveEnvelope).schema).toBe(schema);
  return text;
}

function malformedSave(schema: number, mutate: (p: Payload) => void): string {
  const envelope = JSON.parse(validSave(schema)) as SaveEnvelope;
  const payload = JSON.parse(envelope.payload) as Payload;
  mutate(payload);
  envelope.payload = JSON.stringify(payload);
  envelope.checksum = sha256Hex(envelope.payload);
  expect(envelope.checksum).toBe(sha256Hex(envelope.payload));
  return JSON.stringify(envelope);
}

function observeParse(text: string) {
  try { return { result: parseSave(text), error: undefined }; }
  catch (error) { return { result: undefined, error: String(error), stack: error instanceof Error ? error.stack : undefined }; }
}

async function observeLoad(fs: MemorySaveFs) {
  const before = [...fs.files];
  const reads: string[] = [];
  try {
    const result = await loadSaveSafely({
      read: async (path) => { reads.push(path); return fs.read(path); },
      write: fs.write.bind(fs), remove: fs.remove.bind(fs), rename: fs.rename.bind(fs),
    });
    return { result, error: undefined, reads };
  } catch (error) {
    return { result: undefined, error: String(error), stack: error instanceof Error ? error.stack : undefined, reads };
  } finally {
    // Checked even when load rejects: no save file may be modified/deleted.
    expect([...fs.files]).toEqual(before);
  }
}

for (const schema of schemas) {
  describe(`QA-001 schema ${schema}: validation and recovery`, () => {
    it("roundtrips a valid synthetic profile", () => {
      expect(parseSave(validSave(schema))).toMatchObject({ ok: true, profile: { gold: 777 } });
    });

    it.each(malformedCases)("rejects %s without throwing", (name, mutate) => {
      const observed = observeParse(malformedSave(schema, mutate));
      console.info("QA001 parse", { schema, name, ...observed });
      expect(observed.error).toBeUndefined();
      expect(observed.result).toMatchObject({ ok: false });
    });

    it.each(malformedCases)("recovers valid backup after %s in main", async (name, mutate) => {
      const fs = new MemorySaveFs();
      fs.files.set(paths.main, malformedSave(schema, mutate));
      fs.files.set(paths.backup, validSave(schema));
      const observed = await observeLoad(fs);
      console.info("QA001 backup", { schema, name, ...observed });
      expect(observed.error).toBeUndefined();
      expect(observed.result).toMatchObject({ status: "loaded", source: "backup", result: { profile: { gold: 777 } } });
      expect(observed.result?.problems.join()).toContain("main");
    });

    const recoveryCases: Array<[string, Array<[Slot, "bad" | number]>, Slot | null]> = [
      ["bad main + good backup", [["main", "bad"], ["backup", 100]], "backup"],
      ["bad temp + good backup", [["temp", "bad"], ["backup", 100]], "backup"],
      ["good main + bad backup", [["main", 100], ["backup", "bad"]], "main"],
      ["bad main + newer temp + backup", [["main", "bad"], ["temp", 200], ["backup", 100]], "temp"],
      ["all candidates bad", [["main", "bad"], ["temp", "bad"], ["backup", "bad"]], null],
    ];
    for (const [name, entries, source] of recoveryCases) {
      it.each([1, 2, 3])(`${name}, repetition %i`, async (repeat) => {
        const fs = new MemorySaveFs();
        for (const [slot, value] of entries) fs.files.set(paths[slot], value === "bad"
          ? malformedSave(schema, (p) => { delete p.inventory; }) : validSave(schema, value, value));
        const observed = await observeLoad(fs);
        console.info("QA001 recovery", { schema, name, repeat, ...observed });
        expect(observed.error).toBeUndefined();
        expect(observed.result).toMatchObject(source ? { status: "loaded", source } : { status: "corrupt" });
        if (source) {
          const timestamp = entries.find(([slot]) => slot === source)![1];
          expect(observed.result).toMatchObject({ result: { profile: { gold: timestamp }, envelope: { savedAtWallMs: timestamp } } });
        }
      });
    }

    it.each(["main", "temp", "backup"] as const)("chooses %s when it has the greatest valid timestamp", async (winner) => {
      const fs = new MemorySaveFs();
      for (const slot of ["main", "temp", "backup"] as const) fs.files.set(paths[slot], validSave(schema, slot === winner ? 999 : 111, slot === winner ? 200 : 100));
      const observed = await observeLoad(fs);
      expect(observed.error).toBeUndefined();
      expect(observed.result).toMatchObject({ status: "loaded", source: winner, result: { profile: { gold: 999 }, envelope: { savedAtWallMs: 200 } } });
    });

    // Equal timestamps retain candidate order: main, temp, backup.
    it.each([
      [["main", "temp"], "main"], [["main", "backup"], "main"],
      [["temp", "backup"], "temp"], [["main", "temp", "backup"], "main"],
    ] as Array<[Slot[], Slot]>)("preserves tied candidates %j -> %s", async (slots, winner) => {
      const fs = new MemorySaveFs();
      for (const slot of slots) fs.files.set(paths[slot], validSave(schema, 100 + ["main", "temp", "backup"].indexOf(slot), 100));
      const observed = await observeLoad(fs);
      expect(observed.error).toBeUndefined();
      expect(observed.result).toMatchObject({ status: "loaded", source: winner, result: { profile: { gold: 100 + ["main", "temp", "backup"].indexOf(winner) } } });
    });

    it("reports empty storage without writing", async () => {
      expect((await observeLoad(new MemorySaveFs())).result).toMatchObject({ status: "empty" });
    });

    it("rejects a payload mutation without a new checksum", () => {
      const envelope = JSON.parse(validSave(schema)) as SaveEnvelope;
      envelope.payload += " ";
      expect(parseSave(JSON.stringify(envelope))).toEqual({ ok: false, reason: "checksum-mismatch" });
    });

    it("recovers backup after a main read error", async () => {
      const fs = new MemorySaveFs();
      fs.files.set(paths.backup, validSave(schema));
      const read = fs.read.bind(fs);
      fs.read = async (path) => { if (path === paths.main) throw new Error("synthetic read failure"); return read(path); };
      const observed = await observeLoad(fs);
      expect(observed.error).toBeUndefined();
      expect(observed.result).toMatchObject({ status: "loaded", source: "backup" });
      expect(observed.result?.problems.join()).toContain("main: read failed");
    });

    it("records related missing fields for triage without assuming their rejection contract", () => {
      for (const field of ["clock", "adventure", "stats"]) {
        const observed = observeParse(malformedSave(schema, (p) => { delete p[field]; }));
        console.info("QA001 triage", { schema, field, status: observed.error ? "threw" : observed.result?.ok ? "accepted" : "rejected", error: observed.error });
      }
    });
  });
}
