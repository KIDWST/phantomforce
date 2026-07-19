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
  // NODE_ENV and DATABASE_URL define *which environment/database this process
  // talks to* — that decision belongs to whoever launches the process
  // (systemd unit, docker-compose, a test harness spinning up an isolated
  // Postgres container), never to this checked-in file. If the override
  // below were allowed to clobber them, an explicitly-configured test/staging
  // server would silently snap back to this folder's production database the
  // moment it booted. Everything else (owner-auth values, session secret)
  // keeps the original "server-local .env always wins over stale shell state"
  // behavior this override exists for.
  const preservedNodeEnv = process.env.NODE_ENV;
  const preservedDatabaseUrl = process.env.DATABASE_URL;
  config({ path: resolve(serverDir, ".env"), override: true });
  config();
  if (preservedNodeEnv !== undefined) process.env.NODE_ENV = preservedNodeEnv;
  if (preservedDatabaseUrl !== undefined) process.env.DATABASE_URL = preservedDatabaseUrl;
}
