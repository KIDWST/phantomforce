import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(moduleDir, "..");

// Always let the server-local env win in real runtime. Startup watchers, Codex
// shells, or old Windows environment variables can carry stale owner-auth values
// after a restart; owner auth must come from this server folder every time
// Hermes boots. Tests may opt out before importing the server so they can create
// isolated demo-auth harnesses without reading local secrets.
if (process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV !== "true") {
  config({ path: resolve(serverDir, ".env"), override: true });
  config();
}
