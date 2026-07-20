import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-edge-"));
process.env.PHANTOMFORCE_EDGE_NETWORK_PATH = join(root, "edge-network.json");
process.env.PHANTOMFORCE_EDGE_MANIFEST_SECRET = "test-only-edge-manifest-secret-not-for-production";
process.env.NODE_ENV = "test";

const owner = { tenantId: "studio-one", actorId: "owner", canManage: true };
const player = { tenantId: "studio-one", actorId: "player" };
const outsider = { tenantId: "studio-two", actorId: "outsider", canManage: true };

try {
  const edge = await import("../src/phantom-ai/phantomplay-edge-network.js");

  let consentBlocked = false;
  try { await edge.enrollPhantomPlayEdgeNode(player, { installationId: "desktop-installation-001" }); }
  catch { consentBlocked = true; }
  assert(consentBlocked, "A desktop must never become an edge node without explicit consent.");

  let unsafeLaneBlocked = false;
  try {
    await edge.enrollPhantomPlayEdgeNode(player, {
      consent: true,
      installationId: "desktop-installation-001",
      contributions: ["match_host"],
    });
  } catch { unsafeLaneBlocked = true; }
  assert(unsafeLaneBlocked, "Unimplemented compute and relay lanes must stay disabled.");

  const enrollment = await edge.enrollPhantomPlayEdgeNode(player, {
    consent: true,
    installationId: "desktop-installation-001",
    label: "Jordan desktop cache",
    platform: "windows",
    architecture: "x64",
    runtimeVersion: "2.2.0",
    contributions: ["asset_cache"],
    availableDiskGb: 80,
    limits: { maxDiskGb: 60, maxUploadMbps: 30, maxCpuPercent: 15, maxMemoryMb: 2048, allowMeteredNetwork: false },
  });
  assert(enrollment.node.status === "online", "A newly enrolled desktop should be online.");
  assert(enrollment.node.availableDiskGb === 60, "Reported capacity must be capped by the user's disk limit.");

  const firstHash = "a".repeat(64);
  const secondHash = "b".repeat(64);
  const manifestResult = await edge.registerPhantomPlayEdgeManifest(owner, {
    gameId: "phantom-metropolis",
    version: "0.1.0",
    chunks: [{ sha256: firstHash, bytes: 1_000_000_000 }, { sha256: secondHash, bytes: 500_000_000 }],
  });
  assert(manifestResult.manifest.totalBytes === 1_500_000_000, "The control plane should derive total bytes from trusted chunks.");
  assert(manifestResult.manifest.signature.length === 64, "Trusted manifests should be signed by the control plane.");

  const leaseResult = await edge.createPhantomPlayAssetLease(owner, { manifestId: manifestResult.manifest.id });
  assert(leaseResult.lease.nodeId === enrollment.node.id, "A signed manifest should be assigned to an eligible opted-in node.");
  assert(leaseResult.lease.chunkHashes.length === 2, "The lease must contain only content-addressed chunk hashes.");

  let wrongChunksBlocked = false;
  try { await edge.completePhantomPlayAssetLease(player, leaseResult.lease.id, { chunkHashes: [firstHash] }); }
  catch { wrongChunksBlocked = true; }
  assert(wrongChunksBlocked, "A node must not complete a lease with missing or altered chunks.");

  const completed = await edge.completePhantomPlayAssetLease(player, leaseResult.lease.id, { chunkHashes: [secondHash, firstHash] });
  assert(completed.verified === true && completed.lease.status === "completed", "Exact manifest chunks should complete a verified lease.");

  const heartbeat = await edge.heartbeatPhantomPlayEdgeNode(player, enrollment.node.id, { availableDiskGb: 55, runtimeVersion: "2.2.1" });
  assert(heartbeat.node.runtimeVersion === "2.2.1" && heartbeat.node.availableDiskGb === 55, "Heartbeats should refresh capability and capacity data.");

  await edge.updatePhantomPlayEdgeNode(player, enrollment.node.id, { paused: true });
  let pausedNodeBlocked = false;
  try { await edge.createPhantomPlayAssetLease(owner, { manifestId: manifestResult.manifest.id }); }
  catch { pausedNodeBlocked = true; }
  assert(pausedNodeBlocked, "Paused nodes must never receive new work.");

  const playerSnapshot = await edge.getPhantomPlayEdgeNetworkSnapshot(player);
  const outsiderSnapshot = await edge.getPhantomPlayEdgeNetworkSnapshot(outsider);
  assert(playerSnapshot.status === "foundation_active", "The actual edge foundation should report active, not planned.");
  assert(playerSnapshot.cloudStreamingFromJordan === false && playerSnapshot.inboundDevicePortsDefault === false, "The network must not depend on Jordan's PC or inbound user ports.");
  assert(playerSnapshot.nodes.length === 1 && outsiderSnapshot.nodes.length === 0, "Node state must remain tenant isolated.");
  assert(!JSON.stringify(playerSnapshot).includes("installationHash"), "Installation identifiers must not leak through snapshots.");

  const persisted = JSON.parse(await readFile(process.env.PHANTOMFORCE_EDGE_NETWORK_PATH, "utf8")) as { nodes: unknown[]; manifests: unknown[]; leases: unknown[] };
  assert(persisted.nodes.length === 1 && persisted.manifests.length === 1 && persisted.leases.length === 1, "Nodes, manifests, and leases should persist durably.");

  await edge.updatePhantomPlayEdgeNode(player, enrollment.node.id, { unenroll: true });
  const afterUnenroll = await edge.getPhantomPlayEdgeNetworkSnapshot(player);
  assert(afterUnenroll.nodes[0]?.status === "unenrolled", "Users must be able to fully unenroll their desktop.");

  console.log("PASS phantomplay edge network");
  console.log(JSON.stringify({
    consent: "required",
    activeLane: "asset_cache",
    manifest: "signed_sha256",
    lease: "verified",
    tenantIsolation: true,
    cloudStreamingFromJordan: false,
    inboundPorts: false,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}

