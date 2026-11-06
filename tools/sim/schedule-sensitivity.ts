/**
 * C1 playtest investigation (21 Sep 2026): how much does the pacing depend on the model
 * player's habits? Same content and seeds, different check-in patterns and behaviors.
 *
 *   bun tools/sim/schedule-sensitivity.ts [--days=14] [--seeds=6] [--classes=monk,mage] [--out=c1-schedule-sensitivity]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { CONTENT } from "@emberbound/game-content";
import { ContentIndex } from "@emberbound/game-core";
import { runModelPlayer, type PlayerReport } from "./model-player";

const arg = (name: string, fallback: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const days = Number(arg("days", "14"));
const seeds = Number(arg("seeds", "6"));
const classes = arg("classes", "monk,mage").split(",");
const outName = arg("out", "c1-schedule-sensitivity");

const content = new ContentIndex(CONTENT);

interface Variant {
  id: string;
  text: string;
  schedule: string;
  leaveOnFailedPush?: boolean;
  noGearChanges?: boolean;
  farmPushZoneTrail?: boolean;
}
const VARIANTS: Variant[] = [
  { id: "model", text: "Model: 3 check-ins a day (10 + 10 + 20 min), Push on leaving", schedule: "model" },
  { id: "twice", text: "2 check-ins a day (08:00 10 min, 19:00 20 min)", schedule: "twice" },
  { id: "once", text: "1 check-in a day (19:00, 20 min)", schedule: "once" },
  { id: "model-trap", text: "Model schedule, but the evening ends on a failed foreground Push (app closed on the result screen)", schedule: "model", leaveOnFailedPush: true },
  { id: "twice-trap", text: "2 check-ins, evening ends on a failed foreground Push", schedule: "twice", leaveOnFailedPush: true },
  { id: "model-nogear", text: "Model schedule, never changes gear", schedule: "model", noGearChanges: true },
  { id: "model-trail", text: "Model schedule, but after a failed Push farms that zone's trail (\"Farm · Repeat stage 1 safely\") and leaves it running", schedule: "model", farmPushZoneTrail: true },
  { id: "twice-trail", text: "2 check-ins a day + trail farming (closest to the A40 save)", schedule: "twice", farmPushZoneTrail: true },
];

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)]! : NaN;
};
const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : "—");

const lines: string[] = [];
const out = (s = "") => lines.push(s);
out("# C1 pacing: sensitivity to player habits");
out("");
out(`Content \`${CONTENT.contentVersion}\` · hash \`${content.hash.slice(0, 12)}\` · ${days} days · ${seeds} seeds × ${classes.join("/")}`);
out("");
out("Same content, same seeds; only the player's check-in pattern or behavior changes.");
out("Simulated hours per day = offline (capped at 8 h per absence) + foreground minutes.");
const all: Record<string, PlayerReport[]> = {};
for (const v of VARIANTS) {
  const reports: PlayerReport[] = [];
  for (const classId of classes) {
    const alternate = classId === "monk" ? "mage" : "monk";
    for (let s = 0; s < seeds; s += 1) {
      reports.push(
        runModelPlayer(content, {
          classId,
          alternateClassId: alternate,
          seed: 1000 + s * 7919,
          days,
          schedule: v.schedule,
          ...(v.leaveOnFailedPush ? { leaveOnFailedPush: true } : {}),
          ...(v.noGearChanges ? { noGearChanges: true } : {}),
          ...(v.farmPushZoneTrail ? { farmPushZoneTrail: true } : {}),
        }),
      );
    }
  }
  all[v.id] = reports;
}

for (const classId of classes) {
  out("");
  out(`## ${classId}`);
  out("");
  out("| Player | Sim h/day | Greenfields clear day | Darkwood clear day (range) | Ashen clear day (range) | Level day 3 | Mastery day 3 | Level day 7 | Mastery day 7 |");
  out("|---|---|---|---|---|---|---|---|---|");
  for (const v of VARIANTS) {
    const rs = all[v.id]!.filter((r) => r.classId === classId);
    const clearDay = (z: string) => rs.map((r) => r.clears.find((c) => c.zoneId === z)?.day ?? Infinity);
    const rng = (xs: number[]) => {
      const f = xs.filter(Number.isFinite);
      const miss = xs.length - f.length;
      return f.length ? `${Math.min(...f)}–${Math.max(...f)}${miss ? `, ${miss} not cleared` : ""}` : "none cleared";
    };
    const atDay = (r: PlayerReport, d: number, key: "levels" | "mastery") => {
      let best = 1;
      for (const [k, at] of Object.entries(r[key])) if (at.day <= d) best = Math.max(best, Number(k));
      return best;
    };
    const dw = clearDay("darkwood");
    const ash = clearDay("ashen_mountains");
    out(
      `| ${v.text} | ${fmt(simHoursPerDay(v))} | ${fmt(median(clearDay("greenfields")))} | ${fmt(median(dw))} (${rng(dw)}) | ${fmt(median(ash))} (${rng(ash)}) | ` +
        `${median(rs.map((r) => atDay(r, 3, "levels")))} | ${median(rs.map((r) => atDay(r, 3, "mastery")))} | ${median(rs.map((r) => atDay(r, 7, "levels")))} | ${median(rs.map((r) => atDay(r, 7, "mastery")))} |`,
    );
  }
}

/** Simulated hours per full day for a schedule (offline capped at 8 h per absence). */
function simHoursPerDay(v: Variant): number {
  const daily: Record<string, { atHour: number; minutes: number }[]> = {
    model: [
      { atHour: 8, minutes: 10 },
      { atHour: 12.5, minutes: 10 },
      { atHour: 19, minutes: 20 },
    ],
    twice: [
      { atHour: 8, minutes: 10 },
      { atHour: 19, minutes: 20 },
    ],
    once: [{ atHour: 19, minutes: 20 }],
  };
  const s = daily[v.schedule]!;
  let total = 0;
  for (let i = 0; i < s.length; i += 1) {
    const cur = s[i]!;
    const next = s[(i + 1) % s.length]!;
    const end = cur.atHour + cur.minutes / 60;
    const gap = (next.atHour + (i + 1 === s.length ? 24 : 0) - end + 24) % 24 || 24;
    total += cur.minutes / 60 + Math.min(8, gap);
  }
  return total;
}

mkdirSync("tools/sim/out", { recursive: true });
writeFileSync(`tools/sim/out/${outName}.md`, lines.join("\n") + "\n");
console.log(lines.join("\n"));
