import {
  adminProviderAttemptOrder,
  adminProviderManagerInternals,
  getAdminProviderManagerStatus,
  recordAdminProviderFailure,
  recordAdminProviderSuccess,
} from "../src/phantom-ai/admin-provider-manager.js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

adminProviderManagerInternals.reset();
assert(adminProviderAttemptOrder("codex_cli")[0] === "codex_cli", "Preferred provider should lead before a failure.");

recordAdminProviderFailure("codex_cli", "usage limit reached", 1200);
const fallbackOrder = adminProviderAttemptOrder("codex_cli");
assert(fallbackOrder[0] !== "codex_cli", "An offline provider must not be retried on the next prompt.");
assert(!fallbackOrder.includes("codex_cli"), "Offline providers must stay out of the request-driven attempt order.");

const offline = getAdminProviderManagerStatus().providers.find((provider) => provider.provider_id === "codex_cli");
assert(offline?.status === "offline", "Failed provider should be offline.");
assert(offline?.quota === "exhausted", "Usage failures should be classified as exhausted quota.");

recordAdminProviderSuccess("codex_cli", 84);
assert(adminProviderAttemptOrder("codex_cli")[0] === "codex_cli", "Recovered preferred provider should resume automatically.");
const recovered = getAdminProviderManagerStatus().providers.find((provider) => provider.provider_id === "codex_cli");
assert(recovered?.status === "online", "Recovered provider should be online.");
assert(recovered?.latency_ms === 84, "Provider latency should be retained for diagnostics.");

adminProviderManagerInternals.reset();
console.log("provider manager state-machine checks passed");
