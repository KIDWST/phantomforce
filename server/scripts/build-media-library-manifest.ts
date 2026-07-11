import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { readMediaLabLibrary } from "../src/media-lab/effects-library.js";

const outputPath = path.resolve(
  process.cwd(),
  process.argv[2] ?? "data/media-lab/effects-library.manifest.json",
);

const catalog = await readMediaLabLibrary();

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  `${JSON.stringify(
    {
      ok: true,
      generatedBy: "phantomforce-media-lab-manifest",
      ...catalog,
    },
    null,
    2,
  )}\n`,
);

console.log(`Wrote ${catalog.effects.length} media assets to ${outputPath}`);
