import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(moduleDir, "..");

// Always load the server-local env first. This keeps owner auth stable even
// when Hermes is launched from the repo root or a scheduled task.
config({ path: resolve(serverDir, ".env") });
config();
