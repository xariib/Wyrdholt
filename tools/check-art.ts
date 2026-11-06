import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { productionAssets, environments } from "../apps/mobile/src/art/manifest";
import { validateArt, ART_BUDGET } from "../apps/mobile/src/art/types";

const errors = validateArt(productionAssets);
const pack = JSON.parse(readFileSync("docs/art/darkwood-production-v1/MANIFEST.json", "utf8")) as { approved_production_files: { path: string; sha256: string; bytes: number }[] };
if (pack.approved_production_files.length !== 187) errors.push("Darkwood must contain 187 approved files");
for (const file of pack.approved_production_files) {
  try {
    const bytes = readFileSync(resolve("apps/mobile/public/art/darkwood", file.path));
    if (bytes.length !== file.bytes || createHash("sha256").update(bytes).digest("hex") !== file.sha256) errors.push(`Darkwood byte identity: ${file.path}`);
  } catch { errors.push(`Missing Darkwood file: ${file.path}`); }
}
for (const a of productionAssets) {
  try {
    const png = readFileSync(resolve("apps/mobile/public", a.file));
    if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || png.toString("ascii", 12, 16) !== "IHDR") throw new Error("not a PNG");
    if (png.readUInt32BE(16) !== a.atlasWidth || png.readUInt32BE(20) !== a.atlasHeight) throw new Error("dimensions differ from manifest");
    // Require RGBA/gray-alpha exports. Actual silhouette transparency is inspected in the gallery.
    if (!a.id.startsWith("backgrounds/") && ![4, 6].includes(png[25]!)) throw new Error("sprite PNG needs alpha-capable color type 4 or 6");
  } catch (error) { errors.push(`${a.id}: ${String(error)}`); }
}
for (const [zone, layers] of Object.entries(environments)) {
  if (layers.length > ART_BUDGET.maxLayers) errors.push(`${zone}: too many environment layers`);
  for (const layer of layers) {
    if (!productionAssets.some(a => a.id === layer.asset && a.id.startsWith("backgrounds/"))) errors.push(`${zone}: missing background ${layer.asset}`);
    if (!Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1) errors.push(`${zone}: invalid layer opacity`);
  }
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log(`Art validation PASS: ${productionAssets.length} approved assets. Zero means placeholder-only, not approved production art.`);
