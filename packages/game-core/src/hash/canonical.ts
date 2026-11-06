/**
 * Canonical JSON for hashing authoritative data.
 *
 * - Object keys are sorted (UTF-16 code unit order, as specified by ECMAScript).
 * - Only safe integers are allowed as numbers. A fractional or non-finite
 *   number throws: this enforces the integer discipline of the simulation.
 * - `undefined` object values are skipped.
 */

export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalValue[]
  | { readonly [key: string]: CanonicalValue | undefined };

export function canonicalJson(value: unknown, path = "$"): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isSafeInteger(value)) {
        throw new Error(`canonicalJson: non-integer number at ${path}: ${String(value)}`);
      }
      return Object.is(value, -0) ? "0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "object": {
      if (Array.isArray(value)) {
        const parts: string[] = [];
        for (let i = 0; i < value.length; i += 1) {
          parts.push(canonicalJson(value[i], `${path}[${i}]`));
        }
        return `[${parts.join(",")}]`;
      }
      const record = value as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      const parts: string[] = [];
      for (const key of keys) {
        const item = record[key];
        if (item === undefined) continue;
        parts.push(`${JSON.stringify(key)}:${canonicalJson(item, `${path}.${key}`)}`);
      }
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(`canonicalJson: unsupported ${typeof value} at ${path}`);
  }
}
