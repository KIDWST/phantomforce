import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "voicechannels-"));
process.env.PHANTOMFORCE_VOICECHANNELS_PATH = join(root, "voicechannels.json");
process.env.NODE_ENV = "development";

const owner: AccessSession = { id: "owner", userId: "owner-user", label: "Owner Studio", role: "admin", canManageAccess: true, orgId: "org-owner", orgRole: "owner", isSuperAdmin: true };
const classmateA: AccessSession = { id: "classmate-a", userId: "classmate-a", label: "Classmate A", role: "client", canManageAccess: false, orgId: "school-one", orgRole: "member" };
const classmateB: AccessSession = { id: "classmate-b", userId: "classmate-b", label: "Classmate B", role: "client", canManageAccess: false, orgId: "school-one", orgRole: "member" };
const outsider: AccessSession = { id: "outsider", userId: "outsider", label: "Outside Player", role: "client", canManageAccess: false, orgId: "outside-school", orgRole: "member" };

try {
  const vc = await import("../src/phantom-ai/voicechannels.js");

  // ---- Channel creation + tenant isolation ----
  const ownerChannel = await vc.createChannel(owner, { name: "Owner Lounge", visibility: "public" });
  assert(ownerChannel.channel.memberIds.includes("owner-user"), "Channel creator should be an initial member.");
  const outsiderList = await vc.listChannels(outsider);
  assert(!outsiderList.channels.some((channel) => channel.id === ownerChannel.channel.id), "Channels must stay isolated by tenant.");

  // ---- Invite-only visibility and membership gating ----
  const privateChannel = await vc.createChannel(classmateA, { name: "Study Group", visibility: "invite_only" });
  const bVisibilityBefore = await vc.listChannels(classmateB);
  assert(!bVisibilityBefore.channels.some((channel) => channel.id === privateChannel.channel.id), "A non-member/non-invitee must not see an invite-only channel.");
  let joinRejected = false;
  try { await vc.joinChannel(classmateB, privateChannel.channel.id); } catch { joinRejected = true; }
  assert(joinRejected, "Joining an invite-only channel without an invite must be rejected.");

  await vc.inviteToChannel(classmateA, privateChannel.channel.id, { userId: "classmate-b" });
  const bVisibilityAfter = await vc.listChannels(classmateB);
  assert(bVisibilityAfter.channels.some((channel) => channel.id === privateChannel.channel.id), "An invited user should see the invite-only channel.");
  const joined = await vc.joinChannel(classmateB, privateChannel.channel.id);
  assert(joined.channel.memberIds.includes("classmate-b"), "Joining after an invite should add the user as a member.");

  // ---- Text chat: membership required, messages persist, recent-N cap ----
  let outsiderPostRejected = false;
  try { await vc.postMessage(outsider, privateChannel.channel.id, { text: "hi" }); } catch { outsiderPostRejected = true; }
  assert(outsiderPostRejected, "Only members should be able to post to a channel.");
  await vc.postMessage(classmateA, privateChannel.channel.id, { text: "Welcome to the group." });
  await vc.postMessage(classmateB, privateChannel.channel.id, { text: "Thanks!" });
  const messages = await vc.listMessages(classmateB, privateChannel.channel.id);
  assert(messages?.messages.length === 2, "Posted messages should be listable by a member.");
  assert(messages?.messages[0].authorLabel === "Classmate A", "Messages should carry the real account's display label.");
  const outsiderMessages = await vc.listMessages(outsider, privateChannel.channel.id);
  assert(outsiderMessages === null, "A non-member must not be able to read channel messages.");

  // ---- Voice session presence + signaling relay (shared code path for both
  //      standalone channels and in-game party voice — see the design spec) ----
  const sessionKey = vc.sessionKeyForChannel(privateChannel.channel.id);
  const joinResultA = vc.joinVoiceSession(classmateA, sessionKey, "channel", { channelId: privateChannel.channel.id });
  assert(joinResultA.participants.length === 1 && joinResultA.actorId === "classmate-a", "The first participant to join a voice session should see themselves as the sole participant.");
  const joinResultB = vc.joinVoiceSession(classmateB, sessionKey, "channel", { channelId: privateChannel.channel.id });
  assert(joinResultB.participants.length === 2, "A second joiner should see both participants present.");

  const received: Array<Record<string, unknown>> = [];
  const unsubscribe = vc.subscribeToVoiceSignal(sessionKey, "classmate-b", (message) => received.push(message));
  vc.relaySignal(classmateA, sessionKey, { to: "classmate-b", kind: "offer", payload: { sdp: "fake-sdp" } });
  assert(received.length === 1 && received[0].kind === "offer" && received[0].from === "classmate-a", "A signal sent to a specific participant should be relayed verbatim, addressed correctly.");
  assert((received[0].payload as { sdp: string }).sdp === "fake-sdp", "Signal payloads must be relayed opaquely, unmodified.");

  let outsiderSignalRejected = false;
  try { vc.relaySignal(outsider, sessionKey, { to: "classmate-b", kind: "offer", payload: {} }); } catch { outsiderSignalRejected = true; }
  assert(outsiderSignalRejected, "A participant not connected to a voice session must not be able to send signals into it.");

  vc.setVoiceMuted(classmateA, sessionKey, true);
  const snapshotAfterMute = vc.voiceSessionSnapshot(sessionKey);
  assert(snapshotAfterMute?.participants.find((p) => p.actorId === "classmate-a")?.muted === true, "Muting should be reflected in the live presence snapshot.");

  unsubscribe();
  vc.leaveVoiceSession(classmateB, sessionKey);
  const snapshotAfterLeave = vc.voiceSessionSnapshot(sessionKey);
  assert(snapshotAfterLeave?.participants.length === 1, "Leaving a voice session should remove that participant from presence.");
  vc.leaveVoiceSession(classmateA, sessionKey);
  const snapshotAfterAllLeave = vc.voiceSessionSnapshot(sessionKey);
  assert(snapshotAfterAllLeave === null, "An empty voice session should be cleaned up entirely (never fabricate stale presence).");

  // ---- Game-room-kind voice session key derivation (shared code path with
  //      in-game party voice — the channel/game_room split is only in how
  //      the sessionKey and membership are derived, not in the signaling
  //      relay itself, which is identical either way). ----
  const roomSessionKey = vc.sessionKeyForRoom("school-one", "ABC123");
  assert(roomSessionKey === "room:school-one:ABC123", "Game-room voice sessions should key on tenant + room code.");
  const roomJoin = vc.joinVoiceSession(classmateA, roomSessionKey, "game_room", { sourceRoomCode: "ABC123" });
  assert(roomJoin.kind === "game_room" && roomJoin.participants.length === 1, "A game-room voice session should track kind and participants identically to a channel session.");
  vc.leaveVoiceSession(classmateA, roomSessionKey);

  console.log(JSON.stringify({ ok: true, channelsCreated: 2, tenantIsolation: true, inviteGating: true, chatMembershipGated: true, presenceAccurate: true, signalRelayed: true, staleParticipantsNeverFabricated: true }));
} finally {
  await rm(root, { recursive: true, force: true });
}
