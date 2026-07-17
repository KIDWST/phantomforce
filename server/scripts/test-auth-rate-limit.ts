import { consumeRateLimit, resetRateLimit, _clearAllRateLimits } from "../src/access/rate-limit.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

_clearAllRateLimits();

/* Allows attempts up to the max, then blocks. */
const key = "auth:id:203.0.113.5:victim@example.com";
let now = 1_000_000;
for (let i = 1; i <= 10; i++) {
  const result = consumeRateLimit(key, 10, 5 * 60 * 1000, now);
  assert(result.limited === false, `attempt ${i} of 10 should be allowed`);
}
const eleventh = consumeRateLimit(key, 10, 5 * 60 * 1000, now);
assert(eleventh.limited === true, "11th attempt within the window must be blocked");
assert(eleventh.retryAfterMs > 0, "a blocked attempt must report a positive retry-after");

/* A different identifier from the same IP is not affected (per-identifier isolation). */
const otherIdentifierKey = "auth:id:203.0.113.5:someone-else@example.com";
const otherIdentifier = consumeRateLimit(otherIdentifierKey, 10, 5 * 60 * 1000, now);
assert(otherIdentifier.limited === false, "a different identifier from the same IP must not be throttled by another account's attempts");

/* After the window elapses, the bucket resets. */
const afterWindow = consumeRateLimit(key, 10, 5 * 60 * 1000, now + 5 * 60 * 1000 + 1);
assert(afterWindow.limited === false, "a new window must reset the attempt count");

/* resetRateLimit clears a specific key without affecting others. */
const resetKey = "auth:id:198.51.100.1:reset-me@example.com";
for (let i = 0; i < 10; i++) consumeRateLimit(resetKey, 10, 5 * 60 * 1000, now);
assert(consumeRateLimit(resetKey, 10, 5 * 60 * 1000, now).limited === true, "should be limited before reset");
resetRateLimit(resetKey);
assert(consumeRateLimit(resetKey, 10, 5 * 60 * 1000, now).limited === false, "should be allowed again immediately after reset");

console.log(JSON.stringify({ ok: true, checks: "auth rate limiter throttles per-identifier, isolates identifiers, resets on window expiry" }));
