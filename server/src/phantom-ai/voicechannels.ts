// Voice Channels — text+voice channels ("mini Discord" inside PhantomForce)
// plus the shared signaling relay in-game party voice also rides on. See
// docs/superpowers/specs/2026-07-17-voice-channels-design.md for the full
// design rationale (transport choice, STUN-only mesh limitation, data model).
//
// Persistence follows the exact pattern already used by
// server/src/phantom-ai/phantomplay.ts and server/src/crm/crm-pipeline-store.ts:
// a local JSON file, written via a temp-file-then-rename so a crash mid-write
// never corrupts the store. This is a deliberate choice over extending the
// Prisma schema — flagged as a judgment call in docs/quality/QUALITY_BACKLOG.md
// Q-0021 for Jordan's review, matching how PhantomPlay's own rooms/profiles
// already live outside Postgres.
//
// Presence (who is currently connected to a voice session) is NEVER
// persisted to disk — it lives only in the in-memory maps below, so a
// server restart never resurrects a stale "connected" participant that
// isn't really there. See "Never fabricate presence" in the design spec.

import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { AccessSession } from "../access/session.js";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const storePath = process.env.PHANTOMFORCE_VOICECHANNELS_PATH || resolve(repoRoot, ".phantom", "voicechannels.json");
const retryableWriteCodes = new Set(["EPERM", "EACCES", "EBUSY"]);

const MAX_CHANNEL_NAME = 60;
const MAX_MESSAGE_LEN = 2000;
const MESSAGES_PER_CHANNEL = 200;

function now() {
  return new Date().toISOString();
}

function clean(value: unknown, maxLen: number): string {
  return String(value ?? "").trim().slice(0, maxLen);
}

export type VoiceChannelVisibility = "public" | "invite_only";

export type VoiceChannel = {
  id: string;
  tenantId: string;
  name: string;
  createdBy: string;
  createdByLabel: string;
  visibility: VoiceChannelVisibility;
  memberIds: string[];
  invitedIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type VoiceMessage = {
  id: string;
  channelId: string;
  authorId: string;
  authorLabel: string;
  text: string;
  createdAt: string;
};

type VoiceStore = {
  version: 1;
  channels: VoiceChannel[];
  messages: Record<string, VoiceMessage[]>;
};

let writes = Promise.resolve();

async function replaceStoreFile(temp: string, target: string) {
  try {
    await rename(temp, target);
    return;
  } catch (error) {
    if (!retryableWriteCodes.has((error as NodeJS.ErrnoException).code || "")) throw error;
  }
  // Windows can transiently hold a lock on the destination file (AV scan,
  // another reader) that makes rename() fail even though a copy+unlink
  // succeeds a moment later — same fallback phantomplay.ts already uses.
  await copyFile(temp, target);
  await unlink(temp).catch(() => undefined);
}

async function readStore(): Promise<VoiceStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<VoiceStore>;
    return {
      version: 1,
      channels: Array.isArray(parsed.channels) ? parsed.channels : [],
      messages: parsed.messages && typeof parsed.messages === "object" ? parsed.messages : {},
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, channels: [], messages: {} };
    throw error;
  }
}

async function writeStore(store: VoiceStore) {
  const nextWrite = writes.catch(() => undefined).then(async () => {
    await mkdir(dirname(storePath), { recursive: true });
    const temp = `${storePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(store, null, 2), "utf8");
    await replaceStoreFile(temp, storePath);
  });
  writes = nextWrite.catch(() => undefined);
  await nextWrite;
}

// Same identity convention as server/src/phantom-ai/phantomplay.ts
// (actorIdFor/actorLabelFor/tenantIdFor) — deliberately not a parallel user
// concept, just the same session-derived identity every other module uses.
function actorIdFor(session: AccessSession) {
  return clean(session.userId || session.id, 120) || "anonymous";
}

function actorLabelFor(session: AccessSession) {
  return clean(session.label || session.userId || session.id, 90) || "Player";
}

function tenantIdFor(session: AccessSession, requested?: unknown) {
  const own = session.orgId || session.clientId || session.id || "phantomforce";
  if (!session.canManageAccess) return clean(own, 100) || "phantomforce";
  return clean(requested, 100) || clean(own, 100) || "phantomforce";
}

function channelView(channel: VoiceChannel, presence: VoicePresenceEntry[]) {
  return { ...channel, presence };
}

function findChannel(store: VoiceStore, tenantId: string, channelId: string) {
  return store.channels.find((channel) => channel.tenantId === tenantId && channel.id === channelId);
}

function canSeeChannel(channel: VoiceChannel, actorId: string, session: AccessSession) {
  if (session.canManageAccess) return true;
  if (channel.visibility === "public") return true;
  return channel.memberIds.includes(actorId) || channel.invitedIds.includes(actorId);
}

function canJoinChannel(channel: VoiceChannel, actorId: string) {
  if (channel.visibility === "public") return true;
  return channel.memberIds.includes(actorId) || channel.invitedIds.includes(actorId);
}

export async function createChannel(session: AccessSession, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const name = clean(input.name, MAX_CHANNEL_NAME);
  if (!name) throw new Error("Channel name is required.");
  const visibility: VoiceChannelVisibility = input.visibility === "invite_only" ? "invite_only" : "public";
  const actorId = actorIdFor(session);
  const timestamp = now();
  const channel: VoiceChannel = {
    id: randomUUID(),
    tenantId,
    name,
    createdBy: actorId,
    createdByLabel: actorLabelFor(session),
    visibility,
    memberIds: [actorId],
    invitedIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const store = await readStore();
  store.channels.unshift(channel);
  await writeStore(store);
  return { channel: channelView(channel, presenceFor(sessionKeyForChannel(channel.id))) };
}

export async function listChannels(session: AccessSession, requestedTenantId?: unknown) {
  const tenantId = tenantIdFor(session, requestedTenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const channels = store.channels
    .filter((channel) => channel.tenantId === tenantId)
    .filter((channel) => canSeeChannel(channel, actorId, session))
    .map((channel) => channelView(channel, presenceFor(sessionKeyForChannel(channel.id))));
  return { channels };
}

export async function getChannel(session: AccessSession, channelId: string, requestedTenantId?: unknown) {
  const tenantId = tenantIdFor(session, requestedTenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const channel = findChannel(store, tenantId, channelId);
  if (!channel || !canSeeChannel(channel, actorId, session)) return null;
  return { channel: channelView(channel, presenceFor(sessionKeyForChannel(channel.id))), isMember: channel.memberIds.includes(actorId) };
}

export async function inviteToChannel(session: AccessSession, channelId: string, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const invitedId = clean(input.userId, 120);
  if (!invitedId) throw new Error("A user must be selected to invite.");
  const store = await readStore();
  const channel = findChannel(store, tenantId, channelId);
  if (!channel) throw new Error("Channel was not found.");
  if (!channel.memberIds.includes(actorId) && !session.canManageAccess) throw new Error("Only channel members can invite others.");
  if (!channel.memberIds.includes(invitedId) && !channel.invitedIds.includes(invitedId)) {
    channel.invitedIds.push(invitedId);
    channel.updatedAt = now();
    await writeStore(store);
  }
  return { channel: channelView(channel, presenceFor(sessionKeyForChannel(channel.id))) };
}

export async function joinChannel(session: AccessSession, channelId: string, input: Record<string, unknown> = {}) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const channel = findChannel(store, tenantId, channelId);
  if (!channel) throw new Error("Channel was not found.");
  if (!canJoinChannel(channel, actorId) && !session.canManageAccess) throw new Error("This channel is invite-only. Ask a member to invite you.");
  if (!channel.memberIds.includes(actorId)) {
    channel.memberIds.push(actorId);
    channel.invitedIds = channel.invitedIds.filter((id) => id !== actorId);
    channel.updatedAt = now();
    await writeStore(store);
  }
  return { channel: channelView(channel, presenceFor(sessionKeyForChannel(channel.id))) };
}

export async function leaveChannel(session: AccessSession, channelId: string, input: Record<string, unknown> = {}) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const channel = findChannel(store, tenantId, channelId);
  if (!channel) return { channel: null };
  channel.memberIds = channel.memberIds.filter((id) => id !== actorId);
  channel.updatedAt = now();
  await writeStore(store);
  leaveVoiceSession(session, sessionKeyForChannel(channelId));
  return { channel: channelView(channel, presenceFor(sessionKeyForChannel(channel.id))) };
}

export async function postMessage(session: AccessSession, channelId: string, input: Record<string, unknown>) {
  const tenantId = tenantIdFor(session, input.tenantId);
  const actorId = actorIdFor(session);
  const text = clean(input.text, MAX_MESSAGE_LEN);
  if (!text) throw new Error("Message text is required.");
  const store = await readStore();
  const channel = findChannel(store, tenantId, channelId);
  if (!channel) throw new Error("Channel was not found.");
  if (!channel.memberIds.includes(actorId) && !session.canManageAccess) throw new Error("Only channel members can post messages.");
  const message: VoiceMessage = { id: randomUUID(), channelId, authorId: actorId, authorLabel: actorLabelFor(session), text, createdAt: now() };
  const existing = store.messages[channelId] || [];
  store.messages[channelId] = [...existing, message].slice(-MESSAGES_PER_CHANNEL);
  await writeStore(store);
  return { message };
}

export async function listMessages(session: AccessSession, channelId: string, requestedTenantId?: unknown) {
  const tenantId = tenantIdFor(session, requestedTenantId);
  const actorId = actorIdFor(session);
  const store = await readStore();
  const channel = findChannel(store, tenantId, channelId);
  if (!channel || !canSeeChannel(channel, actorId, session)) return null;
  return { messages: store.messages[channelId] || [] };
}

/* ------------------------------------------------------------------------
   Voice session signaling relay. In-memory only — this is presence/routing
   state, not persisted data. Shared code path for both consumers:
   - Standalone channel voice: sessionKey = sessionKeyForChannel(channelId)
   - In-game party voice: sessionKey = sessionKeyForRoom(tenantId, roomCode)
   The server never inspects `payload` in relaySignal — it is opaque
   SDP/ICE JSON as far as this module is concerned; audio itself never
   flows through the server (peer-to-peer WebRTC).
   ------------------------------------------------------------------------ */

export type VoicePresenceEntry = { actorId: string; label: string; connectedAt: string; muted: boolean };
type VoiceSessionKind = "channel" | "game_room";
type VoiceSessionRecord = {
  id: string;
  kind: VoiceSessionKind;
  channelId?: string;
  sourceRoomCode?: string;
  participants: Map<string, VoicePresenceEntry>;
};
type SignalListener = (message: Record<string, unknown>) => void;

const voiceSessions = new Map<string, VoiceSessionRecord>();
const voiceSubscribers = new Map<string, Map<string, SignalListener>>();

export function sessionKeyForChannel(channelId: string): string {
  return `channel:${channelId}`;
}

export function sessionKeyForRoom(tenantId: string, roomCode: string): string {
  return `room:${tenantId}:${roomCode}`;
}

function presenceFor(sessionKey: string): VoicePresenceEntry[] {
  const record = voiceSessions.get(sessionKey);
  return record ? [...record.participants.values()] : [];
}

function ensureVoiceSession(sessionKey: string, kind: VoiceSessionKind, extra: { channelId?: string; sourceRoomCode?: string }): VoiceSessionRecord {
  let record = voiceSessions.get(sessionKey);
  if (!record) {
    record = { id: sessionKey, kind, channelId: extra.channelId, sourceRoomCode: extra.sourceRoomCode, participants: new Map() };
    voiceSessions.set(sessionKey, record);
  }
  return record;
}

function broadcastPresence(sessionKey: string) {
  const listeners = voiceSubscribers.get(sessionKey);
  if (!listeners || listeners.size === 0) return;
  const participants = presenceFor(sessionKey);
  for (const listener of listeners.values()) listener({ type: "presence", participants });
}

// Called when this participant joins a voice session — either explicitly
// (POST /api/voice/sessions for a standalone channel) or implicitly (the
// game-room path, called from the room-join route once the caller's
// PhantomPlay room membership is already verified by getPhantomPlayRoom).
export function joinVoiceSession(session: AccessSession, sessionKey: string, kind: VoiceSessionKind, extra: { channelId?: string; sourceRoomCode?: string }) {
  const record = ensureVoiceSession(sessionKey, kind, extra);
  const actorId = actorIdFor(session);
  if (!record.participants.has(actorId)) {
    record.participants.set(actorId, { actorId, label: actorLabelFor(session), connectedAt: now(), muted: false });
    broadcastPresence(sessionKey);
  }
  return { sessionId: sessionKey, kind: record.kind, actorId, participants: presenceFor(sessionKey) };
}

export function leaveVoiceSession(session: AccessSession, sessionKey: string) {
  const record = voiceSessions.get(sessionKey);
  if (!record) return;
  const actorId = actorIdFor(session);
  if (record.participants.delete(actorId)) {
    if (record.participants.size === 0) {
      voiceSessions.delete(sessionKey);
      voiceSubscribers.delete(sessionKey);
      return;
    }
    broadcastPresence(sessionKey);
  }
}

export function setVoiceMuted(session: AccessSession, sessionKey: string, muted: boolean) {
  const record = voiceSessions.get(sessionKey);
  if (!record) return;
  const actorId = actorIdFor(session);
  const entry = record.participants.get(actorId);
  if (!entry) return;
  entry.muted = Boolean(muted);
  broadcastPresence(sessionKey);
}

// Registers this participant's open NDJSON stream connection as the target
// for any signal addressed to them. Returns an unsubscribe function and
// does NOT itself add the caller to `participants` — joinVoiceSession is
// the explicit membership action; a client always calls
// POST /api/voice/sessions before opening the stream.
export function subscribeToVoiceSignal(sessionKey: string, actorId: string, listener: SignalListener): () => void {
  let subs = voiceSubscribers.get(sessionKey);
  if (!subs) {
    subs = new Map();
    voiceSubscribers.set(sessionKey, subs);
  }
  subs.set(actorId, listener);
  return () => {
    const current = voiceSubscribers.get(sessionKey);
    if (!current) return;
    current.delete(actorId);
    if (current.size === 0) voiceSubscribers.delete(sessionKey);
  };
}

// Pure relay: forwards `payload` verbatim to the addressed peer's open
// stream, if any. Never inspected/decoded — opaque SDP/ICE JSON to the
// server, exactly as the design spec requires.
export function relaySignal(session: AccessSession, sessionKey: string, input: Record<string, unknown>) {
  const record = voiceSessions.get(sessionKey);
  if (!record) throw new Error("Voice session was not found.");
  const fromActorId = actorIdFor(session);
  if (!record.participants.has(fromActorId)) throw new Error("You are not connected to this voice session.");
  const toActorId = clean(input.to, 120);
  const kind = clean(input.kind, 40);
  if (!toActorId || !kind) throw new Error("A signal requires a target participant and a kind.");
  const subs = voiceSubscribers.get(sessionKey);
  const listener = subs?.get(toActorId);
  if (listener) listener({ type: "signal", from: fromActorId, kind, payload: input.payload ?? null });
  return { ok: true };
}

export function voiceSessionSnapshot(sessionKey: string) {
  const record = voiceSessions.get(sessionKey);
  if (!record) return null;
  return { sessionId: sessionKey, kind: record.kind, channelId: record.channelId, sourceRoomCode: record.sourceRoomCode, participants: presenceFor(sessionKey) };
}
