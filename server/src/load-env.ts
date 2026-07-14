import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config } from "dotenv";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(moduleDir, "..");

// Always let the server-local env win. Startup watchers, Codex shells, or old
// Windows environment variables can carry stale owner-auth values after a
// restart; owner auth must come from this server folder every time Hermes boots.
config({ path: resolve(serverDir, ".env"), override: true });
config();
