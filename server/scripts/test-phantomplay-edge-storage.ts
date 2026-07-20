import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const root = await mkdtemp(join(tmpdir(), "phantomplay-edge-storage-"));
process.env.PHANTOMFORCE_EDGE_NETWORK_PATH = join(root, "edge-network.json");
process.env.PHANTOMFORCE_EDGE_STORAGE_PATH = join(root, "edge-storage");
process.env.PHANTOMFORCE_EDGE_MANIFEST_SECRET = "test-only-edge-manifest-secret-not-for-production";
process.env.NODE_ENV = "test";

const manager = { tenantId: "studio-one", actorId: "manager", canManage: true };
const owner = { tenantId: "studio-one", actorId: "node-owner" };
const outsider = { tenantId: "studio-two", actorId: "outsider", canManage: true };

try {
  const edge = await import("../src/phantom-ai/phantomplay-edge-network.js");

  const chunkBytes = Buffer.from("phantomplay-edge-network-test-chunk-payload");
  const chunkHash = createHash("sha256").update(chunkBytes).digest("hex");

  const manifestResult = await edge.registerPhantomPlayEdgeManifest(manager, {
    gameId: "phantom-metropolis",
    version: "0.1.0",
    chunks: [{ sha256: chunkHash, bytes: chunkBytes.length }],
  });
  const manifestId = manifestResult.manifest.id;

  let nonManagerBlocked = false;
  try { await edge.saveManifestChunkBytes(owner, manifestId, chunkHash, chunkBytes); }
  catch { nonManagerBlocked = true; }
  assert(nonManagerBlocked, "Only a workspace manager may upload trusted asset chunk bytes.");

  let unknownHashBlocked = false;
  try { await edge.saveManifestChunkBytes(manager, manifestId, "f".repeat(64), chunkBytes); }
  catch { unknownHashBlocked = true; }
  assert(unknownHashBlocked, "A chunk hash not present in the signed manifest must be rejected.");

  let tamperedBytesBlocked = false;
  try { await edge.saveManifestChunkBytes(manager, manifestId, chunkHash, Buffer.concat([chunkBytes, Buffer.from("x")])); }
  catch { tamperedBytesBlocked = true; }
  assert(tamperedBytesBlocked, "Uploaded bytes whose hash does not match the requested digest must be rejected.");

  const uploaded = await edge.saveManifestChunkBytes(manager, manifestId, chunkHash, chunkBytes);
  assert(uploaded.stored === true && uploaded.bytes === chunkBytes.length, "Correct chunk bytes should be stored once verified.");

  const enrollment = await edge.enrollPhantomPlayEdgeNode(owner, {
    consent: true,
    installationId: "desktop-installation-storage-001",
    label: "Storage test desktop",
    limits: { maxDiskGb: 40, maxUploadMbps: 20, maxCpuPercent: 15, maxMemoryMb: 2048, allowMeteredNetwork: false },
    availableDiskGb: 40,
  });

  const leaseResult = await edge.createPhantomPlayAssetLease(manager, { manifestId });
  assert(leaseResult.lease.nodeId === enrollment.node.id, "The lease should assign to the only eligible node.");
  const leaseId = leaseResult.lease.id;

  let wrongTenantBlocked = false;
  try { await edge.readLeasedChunkBytes(outsider, leaseId, chunkHash); }
  catch { wrongTenantBlocked = true; }
  assert(wrongTenantBlocked, "A different tenant must never read another tenant's leased chunk.");

  let wrongActorBlocked = false;
  try { await edge.readLeasedChunkBytes({ tenantId: "studio-one", actorId: "someone-else" }, leaseId, chunkHash); }
  catch { wrongActorBlocked = true; }
  assert(wrongActorBlocked, "Only the node's owning actor (or a manager) may read its leased chunks.");

  let hashNotInLeaseBlocked = false;
  try { await edge.readLeasedChunkBytes(owner, leaseId, "c".repeat(64)); }
  catch { hashNotInLeaseBlocked = true; }
  assert(hashNotInLeaseBlocked, "A hash outside the lease's chunk set must be rejected even if it exists in storage.");

  const download = await edge.readLeasedChunkBytes(owner, leaseId, chunkHash);
  assert(Buffer.compare(download.bytes, chunkBytes) === 0, "Downloaded bytes must match the originally uploaded chunk exactly.");

  await edge.completePhantomPlayAssetLease(owner, leaseId, { chunkHashes: [chunkHash] });
  let completedLeaseBlocked = false;
  try { await edge.readLeasedChunkBytes(owner, leaseId, chunkHash); }
  catch { completedLeaseBlocked = true; }
  assert(completedLeaseBlocked, "A completed lease must no longer serve chunk downloads.");

  const secondManifest = await edge.registerPhantomPlayEdgeManifest(manager, {
    gameId: "phantom-metropolis",
    version: "0.1.1",
    chunks: [{ sha256: "d".repeat(64), bytes: 10 }],
  });
  let missingBytesBlocked = false;
  try {
    const secondLease = await edge.createPhantomPlayAssetLease(manager, { manifestId: secondManifest.manifest.id });
    await edge.readLeasedChunkBytes(owner, secondLease.lease.id, "d".repeat(64));
  } catch { missingBytesBlocked = true; }
  assert(missingBytesBlocked, "A manifest with hash metadata but no uploaded bytes must fail cleanly, not serve garbage.");

  console.log("PASS phantomplay edge storage");
  console.log(JSON.stringify({
    uploadRequiresManager: true,
    uploadHashVerified: true,
    downloadTenantIsolated: true,
    downloadActorIsolated: true,
    downloadLeaseScoped: true,
    downloadBlockedAfterComplete: true,
    byteRoundTrip: true,
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
