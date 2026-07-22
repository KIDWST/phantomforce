/* One-off operational fix, not a test: the phantomplay module was persisted
   with enabled=false for tenant "phantomforce-owner" — the tenant the
   platform owner's own session resolves to by default. That fails the very
   first gate in moduleAccessForSession() (server/src/index.ts), before
   Dev Mode / game-submission gating is ever reached, so the whole
   PhantomPlay surface reads as unavailable for the owner's own account.

   Goes through the same publishConfigurationChange() path the admin UI's
   "Organization Settings" module toggle uses, so it gets the same
   validation, version bump, and audit trail as a normal admin action —
   not a raw document overwrite.

   Usage: tsx scripts/enable-phantomplay-owner-module.ts [tenantId] */
import "../src/load-env.js";
import { getOrganizationConfiguration, publishConfigurationChange } from "../src/customization/customization-service.js";

async function main() {
  const tenantId = process.argv[2] || "phantomforce-owner";
  const actor = "ops:enable-phantomplay-owner-module";
  const entitlements = { internalPhantomForce: true, coBranded: true, whiteLabel: true };

  const state = await getOrganizationConfiguration(tenantId, actor);
  const module = state.configuration.modules.find((m) => m.id === "phantomplay");
  if (!module) {
    console.error(`No phantomplay module found in tenant ${tenantId}'s configuration.`);
    process.exit(1);
  }
  console.log(`tenant=${tenantId} configVersion=${state.configuration.version} phantomplay.enabled currently: ${module.enabled}`);

  if (module.enabled) {
    console.log("Already enabled. No change needed.");
    process.exit(0);
  }

  const patch = { modules: state.configuration.modules.map((m) => (m.id === "phantomplay" ? { ...m, enabled: true } : m)) };
  const result = await publishConfigurationChange({
    tenantId,
    actor,
    patch,
    summary: "Enable PhantomPlay module for the owner's own tenant (was persisted disabled, blocking Dev Mode/submissions for the owner)",
    expectedVersion: state.configuration.version,
    entitlements,
  });

  const updatedModule = result.configuration.modules.find((m) => m.id === "phantomplay");
  console.log(`Published. New configVersion=${result.configuration.version}. phantomplay.enabled is now: ${updatedModule?.enabled}`);
}

main()
  .catch((error) => {
    console.error("Failed:", error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
