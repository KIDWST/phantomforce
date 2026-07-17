import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-stream-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.NODE_ENV = "development";

const play = await import("../src/phantom-ai/phantomplay.js");

assert(play.roomSubscriberCount("NOPE00") === 0, "Unknown room codes start with zero subscribers.");

let received: unknown[] = [];
const unsubscribe = play.subscribeToRoom("TEST01", (room) => { received.push(room); });
assert(play.roomSubscriberCount("TEST01") === 1, "Subscribing should register exactly one listener.");

unsubscribe();
assert(play.roomSubscriberCount("TEST01") === 0, "Unsubscribing should remove the listener.");
assert(received.length === 0, "No room was ever broadcast in this test, so the listener should never have fired.");

console.log("PASS: room subscriber registry");
