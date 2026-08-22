import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decideAllSafeWorkActions,
  decideWorkAction,
  getWorkGraphDocument,
  getWorkGraphHeartbeat,
  proposeWorkAction,
} from "../src/workforce/work-graph.js";

const root = await mkdtemp(join(tmpdir(), "phantomforce-work-graph-"));
const tenantId = "tenant-alpha";
const actor = "owner-alpha";

try {
  const task = await proposeWorkAction({
    tenantId,
    actor,
    root,
    idempotencyKey: "task:follow-up:alpha",
    correlationId: "decision:alpha",
    action: {
      type: "task.create",
      proposedBy: "ai",
      rationale: "The client follow-up is due tomorrow.",
      policy: { surface: "internal", reversible: true, requiresApproval: false },
      payload: { title: "Follow up with Alpha", priority: "high", project: "Client Care" },
    },
  });
  assert.equal(task.result.action.status, "verified_complete");
  assert.equal(task.result.action.receipt?.artifactType, "task");
  assert.ok(task.result.action.receipt?.verifiedAt);

  const replay = await proposeWorkAction({
    tenantId,
    actor,
    root,
    idempotencyKey: "task:follow-up:alpha",
    correlationId: "different-correlation-does-not-duplicate",
    action: {
      type: "task.create",
      proposedBy: "ai",
      rationale: "Duplicate delivery attempt.",
      policy: { surface: "internal", reversible: true, requiresApproval: false },
      payload: { title: "Follow up with Alpha", priority: "high", project: "Client Care" },
    },
  });
  assert.equal(replay.result.replayed, true);
  assert.equal(replay.result.action.id, task.result.action.id);

  const draft = await proposeWorkAction({
    tenantId,
    actor: "phantom-ai",
    root,
    idempotencyKey: "draft:alpha:1",
    action: {
      type: "email.draft",
      proposedBy: "ai",
      rationale: "Prepare the requested follow-up without sending it.",
      policy: { surface: "internal", reversible: true, requiresApproval: true },
      payload: { to: ["client@example.com"], subject: "Next steps", body: "Here are the agreed next steps." },
    },
  });
  assert.equal(draft.result.action.status, "awaiting_approval");
  assert.equal(draft.result.action.receipt, null);

  const draftDecision = await decideWorkAction({
    tenantId,
    actionId: draft.result.action.id,
    actor,
    decision: "approve",
    root,
  });
  assert.equal(draftDecision.result.action.status, "verified_complete");
  assert.equal(draftDecision.result.action.receipt?.artifactType, "email_draft");

  const send = await proposeWorkAction({
    tenantId,
    actor: "phantom-ai",
    root,
    idempotencyKey: "send:alpha:1",
    action: {
      type: "email.send",
      proposedBy: "ai",
      rationale: "Send the approved message.",
      policy: { surface: "external", reversible: false, requiresApproval: true },
      payload: { to: ["client@example.com"], subject: "Next steps", body: "Here are the agreed next steps." },
    },
  });
  const sendDecision = await decideWorkAction({ tenantId, actionId: send.result.action.id, actor, decision: "approve", root });
  assert.equal(sendDecision.result.action.status, "blocked");
  assert.match(sendDecision.result.action.receipt?.blockedReason || "", /No verified email delivery connector/i);
  assert.match(sendDecision.result.action.receipt?.remediation || "", /Connect and verify Gmail or Outlook/i);

  const calendar = await proposeWorkAction({
    tenantId,
    actor: "phantom-ai",
    root,
    idempotencyKey: "calendar:alpha:1",
    action: {
      type: "calendar.event.propose",
      proposedBy: "ai",
      rationale: "Prepare the kickoff event for owner review.",
      policy: { surface: "internal", reversible: true, requiresApproval: true },
      payload: {
        title: "Alpha kickoff",
        start: "2026-08-24T15:00:00.000Z",
        end: "2026-08-24T16:00:00.000Z",
        attendees: ["client@example.com"],
      },
    },
  });
  assert.equal(calendar.result.action.status, "awaiting_approval");
  const bulk = await decideAllSafeWorkActions({ tenantId, actor, root });
  assert.equal(bulk.result.completed.length, 1);
  assert.equal(bulk.result.completed[0]?.status, "verified_complete");
  assert.equal(bulk.result.skippedExternal, 0);

  const document = await getWorkGraphDocument(tenantId, actor, root);
  assert.equal(document.tasks.length, 1, "idempotency must prevent duplicate tasks");
  assert.equal(document.drafts.length, 2, "approved email and calendar preparations must persist");
  assert.ok(document.audit.length >= 12, "every lifecycle transition must be audited");
  for (let index = 0; index < document.audit.length; index += 1) {
    const event = document.audit[index]!;
    assert.equal(event.prevHash, index ? document.audit[index - 1]!.hash : null, "audit chain must link to the previous event");
    const { id: _id, hash: _hash, ...body } = event;
    assert.equal(event.hash, createHash("sha256").update(JSON.stringify(body)).digest("hex"), "audit event hash must verify");
  }

  const heartbeat = await getWorkGraphHeartbeat(tenantId, actor, root);
  assert.equal(heartbeat.needsYou.length, 0);
  assert.equal(heartbeat.verified.length, 3);
  assert.equal(heartbeat.blocked.length, 1);
  assert.equal(heartbeat.nothingSlips.openTaskCount, 1);

  const isolated = await getWorkGraphHeartbeat("tenant-beta", "owner-beta", root);
  assert.equal(isolated.verified.length, 0, "another tenant must not see Alpha actions");
  assert.equal(isolated.blocked.length, 0, "another tenant must not see Alpha failures");

  console.log(JSON.stringify({
    ok: true,
    lifecycle: ["propose", "approve", "execute", "verify", "audit"],
    verifiedActions: heartbeat.verified.length,
    blockedWithReason: heartbeat.blocked.length,
    tenantIsolation: true,
    idempotency: true,
    hashChain: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
