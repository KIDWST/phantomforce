// Loads hand-curated regression fixtures (not live training captures — those
// live under training/captures/ and get promoted into these files once
// verified representative).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadFixtures(name) {
  const file = path.join(here, "fixtures", name);
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
