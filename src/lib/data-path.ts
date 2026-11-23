import { resolve } from "node:path";

export function dataPath(...parts: string[]) {
  return resolve(process.env.LYTTEROM_DATA_DIR || "data", ...parts);
}
