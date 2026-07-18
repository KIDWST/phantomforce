import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AccessSession } from "../src/access/session.js";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-"));
process.env.PHANTOMFORCE_PHANTOMPLAY_PATH = join(root, "phantomplay.json");
process.env.PHANTOMFORCE_CUSTOMIZATION_DIR = join(root, "customization");
process.env.PHANTOMFORCE_SKIP_SERVER_DOTENV = "true";
process.env.NODE_ENV = "development";
process.env.PHANTOMFORCE_SERVER_LISTEN = "false";
process.env.PHANTOMFORCE_SERVER_LOGGER = "false";
process.env.PHANTOMFORCE_AUTH_PROVIDER = "demo";
process.env.PHANTOMFORCE_ENABLE_DEMO_AUTH = "true";

const owner: AccessSession = { id: "owner", userId: "owner-user", label: "Owner Studio", role: "admin", canManageAccess: true, orgId: "org-owner", orgRole: "owner", isSuperAdmin: true };
const playerA: AccessSession = { id: "player-a", userId: "player-a", label: "Player A", role: "client", canManageAccess: false, orgId: "org-a", orgRole: "member" };
const playerB: AccessSession = { id: "player-b", userId: "player-b", label: "Player B", role: "client", canManageAccess: false, orgId: "org-b", orgRole: "member" };
const classmateA: AccessSession = { id: "classmate-a", userId: "classmate-a", label: "Classmate A", role: "client", canManageAccess: false, orgId: "school-one", orgRole: "member" };
const classmateB: AccessSession = { id: "classmate-b", userId: "classmate-b", label: "Classmate B", role: "client", canManageAccess: false, orgId: "school-one", orgRole: "member" };
const outsider: AccessSession = { id: "outsider", userId: "outsider", label: "Outside Player", role: "client", canManageAccess: false, orgId: "outside-school", orgRole: "member" };

try {
  const play = await import("../src/phantom-ai/phantomplay.js");
  const v2 = await import("../src/phantom-ai/phantomplay-v2.js");
  const flagship = await import("../src/phantom-ai/phantomplay-flagship.js");
  if (v2.phantomPlayV2Enabled()) v2.registerPhantomPlayV2Games();
  flagship.registerPhantomPlayFlagshipGames();

  const initial = await play.getPhantomPlaySnapshot(playerA, { entitled: true, dailyMinuteLimit: 30, canSubmitGames: false });
  assert(initial.catalog.length >= 28, "The full expanded built-in game catalog should ship.");
  assert(play.PHANTOMPLAY_ENGINE.version === "2.0-large-map" && play.PHANTOMPLAY_ENGINE.saveStateBytes >= 262_144, "PhantomPlay should expose a large-map-capable engine profile.");
  assert(initial.engine?.largeMap?.streaming === true, "Snapshots should publish large-map engine capabilities to the player shell.");
  const builtInIds = new Set(initial.catalog.map((game) => game.id));
  assert(builtInIds.size === initial.catalog.length, "Built-in game IDs should not duplicate after catalog registration.");
  for (const gameId of ["neon-drift", "signal-match", "focus-stack", "word-weld", "reflex-grid", "penalty-kick", "rift-frenzy", "serpent-surge", "color-rush", "tile-flow", "tower-tactics", "breath-pacer", "court-vision", "pixel-bloom", "circuit-serpent", "echo-sequence", "signal-sweeper", "neon-breaker", "type-storm", "logic-lights", "phantom-rumble", "sudoku-signal", "cubetown", "skyguard-arena", "crown-circuit", "keyboardist-on-tour", "tidefront-tactics", "kingdom-breakers"]) {
    assert(builtInIds.has(gameId), `${gameId} should ship as an owned built-in game.`);
  }
  assert(initial.catalog.every((game) => game.kind === "built_in"), "No fake community releases should be seeded.");
  assert(initial.catalog.find((game) => game.id === "neon-drift")?.version === "1.2.3", "Neon Drift should ship the faster arcade tuning.");
  assert(initial.access.canSubmitGames === false, "The snapshot should honor the plan submission decision.");

  await play.updatePhantomPlayProfile(playerA, { gameId: "neon-drift", favorite: true, preferences: { contentRating: "everyone", allowCommunityGames: true } });
  const isolated = await play.getPhantomPlaySnapshot(playerB, { entitled: true, dailyMinuteLimit: 30 });
  assert(isolated.favorites.length === 0, "Favorites must stay isolated by tenant and actor.");

  const started = await play.startPhantomPlaySession(playerA, { gameId: "neon-drift" }, { entitled: true, dailyMinuteLimit: 30 });
  const saved = await play.updatePhantomPlaySession(playerA, started.play.id, { secondsDelta: 75, score: 420, progress: 35, state: { lane: 2 } });
  assert(saved?.seconds === 75 && saved.score === 420 && saved.progress === 35, "Progress, score, duration, and state should save.");
  const largeState = Object.fromEntries(Array.from({ length: 120 }, (_, index) => [`chunk-${index}`, `tile-data-${index}`.repeat(80)]));
  const largeSaved = await play.updatePhantomPlaySession(playerA, started.play.id, { state: largeState });
  assert(Object.keys(largeSaved?.state || {}).length > 30, "Bigger games should be able to persist more than a tiny arcade state.");
  const afterPlay = await play.getPhantomPlaySnapshot(playerA, { entitled: true, dailyMinuteLimit: 30 });
  assert(afterPlay.history[0]?.canContinue === true, "An unfinished session should appear in Continue Playing.");
  assert(afterPlay.access.usedMinutesToday === 2, "Daily play usage should be derived from durable sessions.");
  const replay = await play.startPhantomPlaySession(playerA, { gameId: "neon-drift" }, { entitled: true, dailyMinuteLimit: 30 });
  await play.updatePhantomPlaySession(playerA, replay.play.id, { secondsDelta: 10, score: 20, progress: 100, ended: true });
  const afterReplay = await play.getPhantomPlaySnapshot(playerA, { entitled: true, dailyMinuteLimit: 30 });
  assert(afterReplay.history[0]?.score === 420 && afterReplay.history[0]?.seconds === 85, "History should keep the best score and total play time across sessions.");

  const privateRoom = await play.createPhantomPlayRoom(classmateA, { gameId: "neon-drift", mode: "classroom", maxPlayers: 4 }, { entitled: true });
  assert(privateRoom.room.code.length >= 6, "Private rooms should issue a short join code.");
  assert(privateRoom.room.mode === "classroom" && privateRoom.room.safety.contentPolicy === "everyone_rating_required", "Classroom rooms should enforce Everyone-rated games.");
  assert(privateRoom.room.safety.publicDiscovery === false && privateRoom.room.safety.inboundDevicePorts === false, "Private rooms must avoid public discovery and inbound device port exposure.");
  // Party voice (docs/superpowers/specs/2026-07-17-voice-channels-design.md)
  // deliberately flipped directPeerConnection/voice to true — this
  // invariant used to assert both were false; updated here rather than left
  // stale, and flagged in docs/quality/QUALITY_BACKLOG.md for review.
  assert(privateRoom.room.safety.directPeerConnection === true && privateRoom.room.safety.voice === true, "Private rooms should offer peer-to-peer party voice.");
  assert(privateRoom.room.safety.chat === false && privateRoom.room.safety.externalGameNetworking === false, "Private rooms must not add room text chat or game-side external networking.");
  const joinedRoom = await play.joinPhantomPlayRoom(classmateB, { code: privateRoom.room.code }, { entitled: true });
  assert(joinedRoom?.room.participantCount === 2, "A classmate in the same workspace should be able to join with a room code.");
  const privateSnapshot = await play.getPhantomPlaySnapshot(classmateB, { entitled: true, dailyMinuteLimit: 30 });
  assert(privateSnapshot.rooms.some((room) => room.code === privateRoom.room.code), "Joined private rooms should appear in the student's PhantomPlay snapshot.");
  const outsiderView = await play.getPhantomPlayRoom(outsider, { code: privateRoom.room.code });
  assert(outsiderView === null, "Room codes must not work across tenant boundaries.");
  await play.leavePhantomPlayRoom(classmateB, { code: privateRoom.room.code });

  let invalidRejected = false;
  try { await play.createPhantomPlaySubmission(owner, { title: "Bad", submit: true }); } catch { invalidRejected = true; }
  assert(invalidRejected, "Incomplete releases must be rejected at submission time.");
  let privateUrlRejected = false;
  try {
    await play.createPhantomPlaySubmission(owner, {
      title: "Private Probe", summary: "A complete-looking release that targets private infrastructure.",
      description: "This deliberately complete test submission proves that private and loopback game addresses cannot enter the review queue or player catalog.",
      launchUrl: "https://127.0.0.1:5190/internal", screenshots: ["https://localhost/private.png"], controls: "Keyboard", dataHandling: "None", submit: true,
    });
  } catch { privateUrlRejected = true; }
  assert(privateUrlRejected, "Loopback and private-network release URLs must be rejected.");

  const created = await play.createPhantomPlaySubmission(owner, {
    title: "Community Circuit",
    summary: "A responsive strategy circuit built for short intentional breaks.",
    description: "Community Circuit is a keyboard and touch strategy game with short private rounds. It stores no account data and communicates only through the PhantomPlay host contract.",
    category: "Strategy",
    contentRating: "everyone",
    launchUrl: "https://games.example.test/community-circuit/",
    screenshots: ["https://games.example.test/community-circuit/screenshot.png"],
    tags: ["strategy", "touch"],
    controls: "Keyboard arrows, Enter, and touch controls.",
    dataHandling: "No player data is read or stored by the game.",
    version: "1.0.0",
    releaseNotes: "Initial review build.",
    submit: true,
  });
  assert(created.submission.status === "submitted", "A complete release should enter review.");

  const updated = await play.updatePhantomPlaySubmission(owner, created.submission.id, { version: "1.1.0", releaseNotes: "Improved touch controls.", submit: true });
  assert(updated?.submission.versions.length === 2, "Updates should append version history to the same release.");

  let playerModerationBlocked = false;
  try { await play.moderatePhantomPlaySubmission(playerA, created.submission.id, { decision: "approved" }); } catch { playerModerationBlocked = true; }
  assert(playerModerationBlocked, "Non-admin players must not moderate releases.");

  await play.moderatePhantomPlaySubmission(owner, created.submission.id, { decision: "approved", featured: true, note: "Passed security and play review." });
  const approved = await play.getPhantomPlaySnapshot(playerA, { entitled: true, dailyMinuteLimit: 30 });
  assert(approved.catalog.some((game) => game.title === "Community Circuit" && game.kind === "community"), "Only an approved release should enter the player catalog.");

  const staleStock = await play.createPhantomPlaySubmission(owner, {
    title: "Word Weld",
    summary: "Weld letters into as many words as you can before time runs out.",
    description: "A stock PhantomPlay word game record that simulates an older catalog entry with a Phantom pose screenshot and old developer credit.",
    category: "Puzzle",
    contentRating: "everyone",
    developerName: "Phantom Labs",
    launchUrl: "https://games.example.test/word-weld/",
    screenshots: ["/app/assets/poses/mode-dark-ask.webp"],
    tags: ["word", "puzzle", "touch"],
    controls: "Keyboard and touch input.",
    dataHandling: "No player data is read or stored by the game.",
    version: "1.0.0",
    releaseNotes: "Legacy catalog normalization fixture.",
    submit: true,
  });
  await play.moderatePhantomPlaySubmission(owner, staleStock.submission.id, { decision: "approved", note: "Approved legacy stock fixture." });
  const normalizedStock = await play.getPhantomPlaySnapshot(playerA, { entitled: true, dailyMinuteLimit: 30 });
  const wordWeld = normalizedStock.catalog.find((game) => game.title === "Word Weld");
  assert(wordWeld?.developer === "Tak", "Stock PhantomPlay titles must show Tak, not stale Phantom Labs credit.");
  assert(wordWeld?.thumbnail.includes("word-weld-cover.webp") && !wordWeld.thumbnail.includes("/app/assets/poses/"), "Stock PhantomPlay titles must replace old Phantom pose thumbnails with game-specific art.");
  assert(wordWeld?.developerAvatar?.includes("tak-avatar.webp"), "Stock PhantomPlay titles must include Tak's avatar.");

  await play.moderatePhantomPlaySubmission(owner, created.submission.id, { decision: "disabled", note: "Disabled for release test." });
  const disabled = await play.getPhantomPlaySnapshot(playerA, { entitled: true, dailyMinuteLimit: 30 });
  assert(!disabled.catalog.some((game) => game.title === "Community Circuit"), "A disabled release must disappear from the catalog immediately.");

  let limitBlocked = false;
  try { await play.startPhantomPlaySession(playerA, { gameId: "signal-match" }, { entitled: true, dailyMinuteLimit: 1 }); } catch { limitBlocked = true; }
  assert(limitBlocked, "Daily plan time limits must block new sessions after use.");

  await play.updatePhantomPlayProfile(playerB, { gameId: "signal-match", favorite: true });
  const persisted = JSON.parse(await readFile(process.env.PHANTOMFORCE_PHANTOMPLAY_PATH, "utf8")) as { profiles: Record<string, unknown>; rooms: unknown[]; submissions: unknown[] };
  assert(Object.keys(persisted.profiles).length >= 2 && persisted.rooms.length >= 1 && persisted.submissions.length === 2, "Player, private room, and release state should be durable.");

  const { app } = await import("../src/index.js");
  const unauthenticated = await app.inject({ method: "GET", url: "/api/phantomplay" });
  assert(unauthenticated.statusCode === 401, "The catalog API must require a signed-in session.");
  const login = async (sessionId: string) => {
    const response = await app.inject({ method: "POST", url: "/auth/demo-login", payload: { sessionId } });
    assert(response.statusCode === 200, `${sessionId} should obtain a local test token.`);
    return (response.json() as { token: string }).token;
  };
  const ownerToken = await login("admin-jordan");
  const clientToken = await login("client-sports-demo");
  const ownerCatalog = await app.inject({ method: "GET", url: "/api/phantomplay", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(ownerCatalog.statusCode === 403 && ownerCatalog.json().reason === "module_disabled", "PhantomPlay should be disabled by default even for a new owner workspace.");
  const disabledClientCatalog = await app.inject({ method: "GET", url: "/api/phantomplay", headers: { Authorization: `Bearer ${clientToken}` } });
  assert(disabledClientCatalog.statusCode === 403 && disabledClientCatalog.json().reason === "module_disabled", "New client workspaces should not expose PhantomPlay until it is enabled.");
  const modulePatch = await app.inject({
    method: "PATCH",
    url: "/phantom-ai/customization/workspace-modules",
    headers: { Authorization: `Bearer ${ownerToken}` },
    payload: {
      tenant_id: "client-sports-demo",
      module_id: "phantomplay",
      enabled: true,
      accessMode: "entire_organization",
      allowedMemberIds: [],
      activityEnabled: true,
      challengesEnabled: true,
    },
  });
  assert(modulePatch.statusCode === 200 && modulePatch.json().organization_data_deleted === false && modulePatch.json().notifications_sent === false, "Enabling PhantomPlay should preserve org data and avoid notifications.");
  const moduleStatus = await app.inject({ method: "GET", url: "/phantom-ai/customization/workspace-modules?tenant_id=client-sports-demo", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(moduleStatus.statusCode === 200 && moduleStatus.json().modules?.[0]?.enabled === true && moduleStatus.json().modules?.[0]?.accessMode === "entire_organization", "Workspace module status should report the saved PhantomPlay access mode.");
  const ownerManagedCatalog = await app.inject({ method: "GET", url: "/api/phantomplay?tenant_id=client-sports-demo", headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(ownerManagedCatalog.statusCode === 200 && ownerManagedCatalog.json().access.canModerate === true, "Platform admin should receive moderation access after enabling the target workspace.");
  const clientCatalog = await app.inject({ method: "GET", url: "/api/phantomplay", headers: { Authorization: `Bearer ${clientToken}` } });
  assert(clientCatalog.statusCode === 200 && clientCatalog.json().access.canModerate === false, "Client accounts must not receive moderation access.");
  const clientPlay = await app.inject({ method: "POST", url: "/api/phantomplay/plays", headers: { Authorization: `Bearer ${clientToken}` }, payload: { gameId: "signal-match" } });
  assert(clientPlay.statusCode === 403 && clientPlay.json().error === "read_only_plan", "The existing free-plan write boundary must block a legacy read-only client.");
  const ownerRoom = await app.inject({ method: "POST", url: "/api/phantomplay/rooms", headers: { Authorization: `Bearer ${ownerToken}` }, payload: { tenantId: "client-sports-demo", gameId: "neon-drift", mode: "classroom", maxPlayers: 4 } });
  assert(ownerRoom.statusCode === 200 && ownerRoom.json().room.safety.publicDiscovery === false, "The private room API should create non-public rooms for privileged local operators.");
  const ownerRoomCode = ownerRoom.json().room.code;
  const ownerRoomFetch = await app.inject({ method: "GET", url: `/api/phantomplay/rooms/${ownerRoomCode}?tenant_id=client-sports-demo`, headers: { Authorization: `Bearer ${ownerToken}` } });
  assert(ownerRoomFetch.statusCode === 200 && ownerRoomFetch.json().room.code === ownerRoomCode, "The private room API should return joined/hosted room state only through authenticated routes.");
  const clientModeration = await app.inject({ method: "POST", url: `/api/phantomplay/submissions/${created.submission.id}/moderate`, headers: { Authorization: `Bearer ${clientToken}` }, payload: { decision: "approved" } });
  assert(clientModeration.statusCode === 403, "The moderation route must reject client sessions.");
  await app.close();

  console.log(JSON.stringify({ ok: true, builtInGames: initial.catalog.length, arenaBuiltIns: ["rift-frenzy", "serpent-surge"], savedScore: saved?.score, tenantIsolation: true, privateRooms: true, privateUrlRejected, versionCount: updated?.submission.versions.length, moderationBlocked: playerModerationBlocked, routeAuth: true, communityApproval: true, disabledRemoved: true, timeLimitBlocked: limitBlocked }));
} finally {
  await rm(root, { recursive: true, force: true });
}
