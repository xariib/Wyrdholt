import type { Profile } from "./types";

/**
 * Deep copy of a profile. The profile is plain JSON data by design (integers,
 * strings, booleans, null, arrays, plain objects), so a JSON round-trip is exact.
 *
 * Used instead of `structuredClone`, which needs Chrome/WebView 98+; the Samsung
 * A40 test phone runs WebView 97 (device finding F5).
 */
export function cloneProfile(profile: Profile): Profile {
  return JSON.parse(JSON.stringify(profile)) as Profile;
}
