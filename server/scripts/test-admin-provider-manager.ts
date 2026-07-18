import {
  adminProviderAttemptOrder,
  adminProviderManagerInternals,
  getAdminProviderManagerStatus,
  getPublicAdminProviderManagerStatus,
  recordAdminProviderFailure,
  recordAdminProviderSuccess,
} from "../src/phantom-ai/admin-provider-manager.js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

adminProviderManagerInternals.reset();
assert(adminProviderAttemptOrder("codex_cli")[0] === "codex_cli", "Preferred provider should lead before a failure.");

recordAdminProviderFailure("codex_cli", "Codex CLI failed at C:\\tools\\run-codex.ps1 with usage limit reached", 1200);
const fallbackOrder = adminProviderAttemptOrder("codex_cli");
assert(fallbackOrder[0] !== "codex_cli", "An offline provider must not be retried on the next prompt.");
assert(!fallbackOrder.includes("codex_cli"), "Offline providers must stay out of the request-driven attempt order.");

const offline = getAdminProviderManagerStatus().providers.find((provider) => provider.provider_id === "codex_cli");
assert(offline?.status === "offline", "Failed provider should be offline.");
assert(offline?.quota === "exhausted", "Usage failures should be classified as exhausted quota.");
const publicAfterFailure = getPublicAdminProviderManagerStatus();
assert(!/codex|codex_cli|run-codex|\.ps1/i.test(JSON.stringify(publicAfterFailure)), "Public provider monitor must redact internal private names and local CLI paths.");

recordAdminProviderFailure("local_ollama", "<urlopen error [WinError 10061] No connection could be made because the target machine actively refused it>", 42);
const localOffline = getAdminProviderManagerStatus().providers.find((provider) => provider.provider_id === "local_ollama");
assert(localOffline?.detail === "Local brain is offline. Start Ollama/local model service or switch Phantom to another brain lane.", "Local provider refusal should be converted to product-safe guidance.");
assert(!/urlopen|WinError|10061|actively refused/i.test(JSON.stringify(getAdminProviderManagerStatus())), "Provider monitor must not retain raw local transport refusal text.");

recordAdminProviderSuccess("codex_cli", 84);
assert(adminProviderAttemptOrder("codex_cli")[0] === "codex_cli", "Recovered preferred provider should resume automatically.");
const recovered = getAdminProviderManagerStatus().providers.find((provider) => provider.provider_id === "codex_cli");
assert(recovered?.status === "online", "Recovered provider should be online.");
assert(recovered?.latency_ms === 84, "Provider latency should be retained for diagnostics.");
const publicStatus = getPublicAdminProviderManagerStatus();
assert(publicStatus.active_provider_display_id === "private", "Public provider monitor should expose neutral private id.");
assert(publicStatus.providers.some((provider) => provider.display_id === "private" && provider.display_name === "Private"), "Public provider monitor should expose a private display row.");
assert(!/codex|codex_cli|run-codex|\.ps1/i.test(JSON.stringify(publicStatus)), "Public provider monitor must not expose internal private names or local CLI paths.");

adminProviderManagerInternals.reset();
console.log("provider manager state-machine checks passed");
