// Build alias for the isolated computer-practice bundle, never the Node server.
import { sha256 } from "@noble/hashes/sha2.js";
export function createHash(algorithm) {
  if (algorithm !== "sha256") throw Error("Unsupported practice digest");
  const state = sha256.create();
  return { update(value) { state.update(new TextEncoder().encode(value)); return this; }, digest(format) {
    if (format !== "hex") throw Error("Unsupported practice digest format");
    return Array.from(state.digest(), b => b.toString(16).padStart(2, "0")).join("");
  } };
}
export function randomInt(max) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 2 ** 32) throw Error("Invalid random bound");
  const limit = Math.floor(2 ** 32 / max) * max;
  const value = new Uint32Array(1);
  do { crypto.getRandomValues(value); } while (value[0] >= limit);
  return value[0] % max;
}
export function randomBytes(length) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return { toString(format) {
    if (format !== "base64url") throw Error("Unsupported practice ID format");
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } };
}
