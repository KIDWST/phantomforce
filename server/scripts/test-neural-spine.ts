import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { strict as assert } from "node:assert";

import type { AccessSession } from "../src/access/session.js";
import {
  composeBrainContext,
  createBrainMemory,
  forgetBrainMemory,
  listBrainMemories,
  recordBrainFeedback,
  updateBrainMemory,
} from "../src/phantom-ai/neural-spine.js";

const session: AccessSession = {
  id: "admin-jordan-test",
  label: "Jordan Test",
  role: "admin",
  canManageAccess: true,
  subscriptionActive: true,
};

const dir = await mkdtemp(join(tmpdir(), "phantom-brain-test-"));
const options = {
  memoryPath: join(dir, "brain-memory.jsonl"),
  eventsPath: join(dir, "brain-events.jsonl"),
};

try {
  const created = await createBrainMemory(session, {
    text: "Remember that Higgsfield is subscription/manual mode for me.",
    type: "tool_state",
    confidence: 0.9,
    weight: 0.9,
    source: "test",
  }, options);
  assert.equal(created.active, true);

  const edited = await updateBrainMemory(session, created.id, {
    text: "Higgsfield is subscription/manual mode unless a real server API key exists.",
    confidence: 0.95,
  }, options);
  assert.equal(edited.text.includes("server API key"), true);

  const memories = await listBrainMemories(session, options);
  assert.ok(memories.memories.some((memory) => memory.id === created.id));

  const rembgContext = await composeBrainContext(session, {
    message: "Help debug rembg again.",
    surface: "chat",
    logEvent: false,
  }, options);
  assert.match(rembgContext.microPrompt, /rembg|Fastify|Python|py/i);
  assert.equal(rembgContext.needsApproval, false);

  const externalContext = await composeBrainContext(session, {
    message: "Send this email and spend credits on a render.",
    surface: "chat",
    logEvent: false,
  }, options);
  assert.equal(externalContext.needsApproval, true);
  assert.match(externalContext.microPrompt, /approval/i);

  const feedback = await recordBrainFeedback(session, {
    kind: "correction",
    text: "Too robotic, make it more human.",
    surface: "chat",
  }, options);
  assert.equal(feedback.suggestedMemory, null, "one-off feedback stays in the event ledger instead of durable memory");
  assert.equal(feedback.event.safeForMemory, false);

  const durableFeedback = await recordBrainFeedback(session, {
    kind: "correction",
    text: "From now on, always use direct human wording.",
    surface: "chat",
  }, options);
  assert.ok(durableFeedback.suggestedMemory);
  assert.equal(durableFeedback.event.safeForMemory, true);

  const forgotten = await forgetBrainMemory(session, created.id, options);
  assert.equal(forgotten.active, false);

  const activeMemories = await listBrainMemories(session, options);
  assert.equal(activeMemories.memories.some((memory) => memory.id === created.id), false);

  console.log("test-neural-spine passed");
} finally {
  await rm(dir, { recursive: true, force: true });
}
