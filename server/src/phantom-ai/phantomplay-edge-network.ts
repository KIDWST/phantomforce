import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, "../../..");
const storePath = process.env.PHANTOMFORCE_EDGE_NETWORK_PATH || resolve(repoRoot, ".phantom", "phantomplay-edge-network.json");
const storageRoot = process.env.PHANTOMFORCE_EDGE_STORAGE_PATH || resolve(repoRoot, ".phantom", "phantomplay-edge-storage");
const heartbeatTtlMs = 120_000;
const leaseTtlMs = 10 * 60_000;
/* Chunks flow as base64 JSON bodies (matches the rest of this codebase's upload convention,
   see /orgs/:orgId/assets), so this stays well under Fastify's per-route bodyLimit. Managers
   re-chunk larger asset packs rather than this limit growing — see architecture doc. */
export const EDGE_CHUNK_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export type EdgeNetworkContext = {
  tenantId: string;
  actorId: string;
  canManage?: boolean;
};

type EdgeNodeStatus = "online" | "stale" | "paused" | "unenrolled";
type EdgeChunk = { sha256: string; bytes: number };
type EdgeManifest = {
  id: string;
  tenantId: string;
  gameId: string;
  version: string;
  totalBytes: number;
  chunks: EdgeChunk[];
  digest: string;
  signature: string;
  createdAt: string;
  createdBy: string;
};
type EdgeNode = {
  id: string;
  tenantId: string;
  actorId: string;
  installationHash: string;
  label: string;
  platform: string;
  architecture: string;
  runtimeVersion: string;
  contributions: ["asset_cache"];
  limits: {
    maxDiskGb: number;
    maxUploadMbps: number;
    maxCpuPercent: number;
    maxMemoryMb: number;
    allowMeteredNetwork: boolean;
  };
  availableDiskGb: number;
  paused: boolean;
  enrolled: boolean;
  consentVersion: "phantomplay-edge-v1";
  enrolledAt: string;
  updatedAt: string;
  lastHeartbeatAt: string;
};
type EdgeLease = {
  id: string;
  tenantId: string;
  manifestId: string;
  nodeId: string;
  requestedBy: string;
  kind: "asset_cache";
  chunkHashes: string[];
  status: "assigned" | "completed" | "expired" | "cancelled";
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
};
type EdgeStore = { version: 1; nodes: EdgeNode[]; manifests: EdgeManifest[]; leases: EdgeLease[] };

const emptyStore = (): EdgeStore => ({ version: 1, nodes: [], manifests: [], leases: [] });
let mutationQueue: Promise<void> = Promise.resolve();

function cleanText(value: unknown, fallback: string, max = 120) {
  const text = String(value ?? "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max);
  return text || fallback;
}

function finiteNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return Math.round(Math.min(max, Math.max(min, finiteNumber(value, fallback))) * 100) / 100;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function signingKey() {
  const configured = String(process.env.PHANTOMFORCE_EDGE_MANIFEST_SECRET || "").trim();
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("PHANTOMFORCE_EDGE_MANIFEST_SECRET is required in production.");
  return sha256(`phantomplay-edge-development:${storePath}`);
}

function manifestPayload(manifest: Pick<EdgeManifest, "tenantId" | "gameId" | "version" | "totalBytes" | "chunks">) {
  return JSON.stringify({
    tenantId: manifest.tenantId,
    gameId: manifest.gameId,
    version: manifest.version,
    totalBytes: manifest.totalBytes,
    chunks: manifest.chunks,
  });
}

function signManifest(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("hex");
}

function validSignature(manifest: EdgeManifest) {
  const expected = Buffer.from(signManifest(manifestPayload(manifest)), "hex");
  const actual = Buffer.from(manifest.signature, "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function loadStore(): Promise<EdgeStore> {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8")) as Partial<EdgeStore>;
    return {
      version: 1,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      manifests: Array.isArray(parsed.manifests) ? parsed.manifests : [],
      leases: Array.isArray(parsed.leases) ? parsed.leases : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw error;
  }
}

async function saveStore(store: EdgeStore) {
  await mkdir(dirname(storePath), { recursive: true });
  const temporary = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(temporary, storePath);
}

async function mutate<T>(operation: (store: EdgeStore) => T | Promise<T>): Promise<T> {
  let release = () => {};
  const previous = mutationQueue;
  mutationQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const store = await loadStore();
    expireLeases(store);
    const result = await operation(store);
    await saveStore(store);
    return result;
  } finally {
    release();
  }
}

function expireLeases(store: EdgeStore) {
  const now = Date.now();
  for (const lease of store.leases) {
    if (lease.status === "assigned" && Date.parse(lease.expiresAt) <= now) lease.status = "expired";
  }
}

function nodeStatus(node: EdgeNode, now = Date.now()): EdgeNodeStatus {
  if (!node.enrolled) return "unenrolled";
  if (node.paused) return "paused";
  return now - Date.parse(node.lastHeartbeatAt) <= heartbeatTtlMs ? "online" : "stale";
}

function publicNode(node: EdgeNode) {
  return {
    id: node.id,
    label: node.label,
    platform: node.platform,
    architecture: node.architecture,
    runtimeVersion: node.runtimeVersion,
    contributions: node.contributions,
    limits: node.limits,
    availableDiskGb: node.availableDiskGb,
    status: nodeStatus(node),
    enrolledAt: node.enrolledAt,
    updatedAt: node.updatedAt,
    lastHeartbeatAt: node.lastHeartbeatAt,
  };
}

function requireNode(store: EdgeStore, context: EdgeNetworkContext, nodeId: string) {
  const node = store.nodes.find((candidate) => candidate.id === nodeId && candidate.tenantId === context.tenantId);
  if (!node || (!context.canManage && node.actorId !== context.actorId)) throw new Error("Edge node was not found.");
  return node;
}

export async function enrollPhantomPlayEdgeNode(context: EdgeNetworkContext, input: Record<string, unknown>) {
  if (input.consent !== true) throw new Error("Explicit edge-network consent is required.");
  const contributions = Array.isArray(input.contributions) ? input.contributions.map(String) : ["asset_cache"];
  if (contributions.length !== 1 || contributions[0] !== "asset_cache") {
    throw new Error("Only the signed asset-cache contribution lane is enabled in this release.");
  }
  const installationId = cleanText(input.installationId, "", 200);
  if (installationId.length < 12) throw new Error("A valid desktop installation ID is required.");
  return mutate(async (store) => {
    const now = new Date().toISOString();
    const installationHash = sha256(`${context.tenantId}:${installationId}`);
    const existing = store.nodes.find((node) => node.tenantId === context.tenantId && node.installationHash === installationHash);
    const limits = (input.limits ?? {}) as Record<string, unknown>;
    const node: EdgeNode = existing ?? {
      id: randomUUID(), tenantId: context.tenantId, actorId: context.actorId, installationHash,
      label: "PhantomPlay Edge", platform: "unknown", architecture: "unknown", runtimeVersion: "unknown",
      contributions: ["asset_cache"], limits: { maxDiskGb: 25, maxUploadMbps: 10, maxCpuPercent: 20, maxMemoryMb: 1024, allowMeteredNetwork: false },
      availableDiskGb: 0, paused: false, enrolled: true, consentVersion: "phantomplay-edge-v1",
      enrolledAt: now, updatedAt: now, lastHeartbeatAt: now,
    };
    node.actorId = context.actorId;
    node.label = cleanText(input.label, node.label, 80);
    node.platform = cleanText(input.platform, node.platform, 40);
    node.architecture = cleanText(input.architecture, node.architecture, 30);
    node.runtimeVersion = cleanText(input.runtimeVersion, node.runtimeVersion, 40);
    node.limits = {
      maxDiskGb: clamp(limits.maxDiskGb, 1, 500, node.limits.maxDiskGb),
      maxUploadMbps: clamp(limits.maxUploadMbps, 1, 1_000, node.limits.maxUploadMbps),
      maxCpuPercent: clamp(limits.maxCpuPercent, 5, 75, node.limits.maxCpuPercent),
      maxMemoryMb: clamp(limits.maxMemoryMb, 256, 16_384, node.limits.maxMemoryMb),
      allowMeteredNetwork: limits.allowMeteredNetwork === true,
    };
    node.availableDiskGb = clamp(input.availableDiskGb, 0, node.limits.maxDiskGb, node.availableDiskGb);
    node.enrolled = true;
    node.paused = input.paused === true;
    node.updatedAt = now;
    node.lastHeartbeatAt = now;
    if (!existing) store.nodes.push(node);
    return { node: publicNode(node), consentRecorded: true };
  });
}

export async function heartbeatPhantomPlayEdgeNode(context: EdgeNetworkContext, nodeId: string, input: Record<string, unknown>) {
  return mutate(async (store) => {
    const node = requireNode(store, context, nodeId);
    if (!node.enrolled) throw new Error("Edge node is unenrolled.");
    const now = new Date().toISOString();
    node.availableDiskGb = clamp(input.availableDiskGb, 0, node.limits.maxDiskGb, node.availableDiskGb);
    if (typeof input.runtimeVersion === "string") node.runtimeVersion = cleanText(input.runtimeVersion, node.runtimeVersion, 40);
    node.lastHeartbeatAt = now;
    node.updatedAt = now;
    const leases = store.leases.filter((lease) => lease.nodeId === node.id && lease.status === "assigned");
    return { node: publicNode(node), leases };
  });
}

export async function updatePhantomPlayEdgeNode(context: EdgeNetworkContext, nodeId: string, input: Record<string, unknown>) {
  return mutate(async (store) => {
    const node = requireNode(store, context, nodeId);
    if (typeof input.paused === "boolean") node.paused = input.paused;
    if (input.unenroll === true) {
      node.enrolled = false;
      node.paused = true;
      for (const lease of store.leases) if (lease.nodeId === node.id && lease.status === "assigned") lease.status = "cancelled";
    }
    if (input.limits && typeof input.limits === "object") {
      const limits = input.limits as Record<string, unknown>;
      node.limits = {
        maxDiskGb: clamp(limits.maxDiskGb, 1, 500, node.limits.maxDiskGb),
        maxUploadMbps: clamp(limits.maxUploadMbps, 1, 1_000, node.limits.maxUploadMbps),
        maxCpuPercent: clamp(limits.maxCpuPercent, 5, 75, node.limits.maxCpuPercent),
        maxMemoryMb: clamp(limits.maxMemoryMb, 256, 16_384, node.limits.maxMemoryMb),
        allowMeteredNetwork: typeof limits.allowMeteredNetwork === "boolean" ? limits.allowMeteredNetwork : node.limits.allowMeteredNetwork,
      };
      node.availableDiskGb = Math.min(node.availableDiskGb, node.limits.maxDiskGb);
    }
    node.updatedAt = new Date().toISOString();
    return { node: publicNode(node) };
  });
}

export async function registerPhantomPlayEdgeManifest(context: EdgeNetworkContext, input: Record<string, unknown>) {
  if (!context.canManage) throw new Error("Only a workspace manager can register a trusted asset manifest.");
  const rawChunks = Array.isArray(input.chunks) ? input.chunks : [];
  if (!rawChunks.length || rawChunks.length > 100_000) throw new Error("A manifest needs 1 to 100000 chunks.");
  const chunks = rawChunks.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>;
    const hash = String(item.sha256 || "").toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Every asset chunk needs a SHA-256 hash.");
    return { sha256: hash, bytes: Math.round(clamp(item.bytes, 1, 2_147_483_648, 1)) };
  });
  const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  return mutate(async (store) => {
    const base = {
      tenantId: context.tenantId,
      gameId: cleanText(input.gameId, "", 180),
      version: cleanText(input.version, "", 60),
      totalBytes,
      chunks,
    };
    if (!base.gameId || !base.version) throw new Error("Game ID and version are required.");
    const payload = manifestPayload(base);
    const digest = sha256(payload);
    const signature = signManifest(payload);
    const existing = store.manifests.find((manifest) => manifest.tenantId === context.tenantId && manifest.digest === digest);
    if (existing) return { manifest: existing };
    const manifest: EdgeManifest = {
      id: randomUUID(), ...base, digest, signature,
      createdAt: new Date().toISOString(), createdBy: context.actorId,
    };
    store.manifests.push(manifest);
    return { manifest };
  });
}

function safeIdSegment(value: string, label: string) {
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(value)) throw new Error(`Invalid ${label}.`);
  return value;
}

function chunkPath(manifestId: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid chunk hash.");
  return resolve(storageRoot, safeIdSegment(manifestId, "manifest id"), hash);
}

/* Approved game storage for the edge network: chunk bytes never touch the JSON control-plane
   store above, only their hash/size metadata does. A manager uploads bytes for a chunk that
   already exists (by hash) in a signed manifest; anything else is rejected before it reaches disk. */
export async function saveManifestChunkBytes(context: EdgeNetworkContext, manifestId: string, sha256Param: string, bytes: Buffer) {
  if (!context.canManage) throw new Error("Only a workspace manager can upload trusted asset chunks.");
  const hash = String(sha256Param || "").toLowerCase();
  const store = await loadStore();
  const manifest = store.manifests.find((candidate) => candidate.id === manifestId && candidate.tenantId === context.tenantId);
  if (!manifest || !validSignature(manifest)) throw new Error("Trusted asset manifest was not found or failed signature verification.");
  const chunk = manifest.chunks.find((candidate) => candidate.sha256 === hash);
  if (!chunk) throw new Error("Chunk hash is not part of this manifest.");
  if (bytes.length > EDGE_CHUNK_MAX_UPLOAD_BYTES) {
    throw new Error(`Chunk exceeds the ${EDGE_CHUNK_MAX_UPLOAD_BYTES}-byte upload limit; re-chunk the asset pack smaller.`);
  }
  if (bytes.length !== chunk.bytes) throw new Error("Uploaded chunk size does not match the signed manifest.");
  if (createHash("sha256").update(bytes).digest("hex") !== hash) {
    throw new Error("Uploaded chunk bytes do not match the declared SHA-256 hash.");
  }
  const target = chunkPath(manifest.id, hash);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  return { manifestId: manifest.id, sha256: hash, bytes: bytes.length, stored: true };
}

/* Serves chunk bytes only to the node actually holding an active (non-expired, non-completed)
   lease naming that exact hash, re-verifies the hash server-side on every read (defense in depth
   against on-disk tampering/bit-rot), and never interprets the bytes as anything but opaque data. */
export async function readLeasedChunkBytes(context: EdgeNetworkContext, leaseId: string, sha256Param: string) {
  const hash = String(sha256Param || "").toLowerCase();
  await mutationQueue;
  const store = await loadStore();
  expireLeases(store);
  const lease = store.leases.find((candidate) => candidate.id === leaseId && candidate.tenantId === context.tenantId);
  if (!lease) throw new Error("Asset lease was not found.");
  requireNode(store, context, lease.nodeId);
  if (lease.status !== "assigned") throw new Error(`Asset lease is ${lease.status}.`);
  if (!lease.chunkHashes.includes(hash)) throw new Error("Chunk hash is not part of this lease.");
  const manifest = store.manifests.find((candidate) => candidate.id === lease.manifestId);
  if (!manifest) throw new Error("Trusted asset manifest was not found.");
  let bytes: Buffer;
  try {
    bytes = await readFile(chunkPath(manifest.id, hash));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error("Chunk is not yet available from storage.");
    throw error;
  }
  if (createHash("sha256").update(bytes).digest("hex") !== hash) throw new Error("Stored chunk failed integrity verification.");
  return { bytes, sha256: hash };
}

export async function createPhantomPlayAssetLease(context: EdgeNetworkContext, input: Record<string, unknown>) {
  return mutate(async (store) => {
    const manifestId = cleanText(input.manifestId, "", 180);
    const manifest = store.manifests.find((candidate) => candidate.id === manifestId && candidate.tenantId === context.tenantId);
    if (!manifest || !validSignature(manifest)) throw new Error("Trusted asset manifest was not found or failed signature verification.");
    const requiredGb = manifest.totalBytes / 1_000_000_000;
    const activeByNode = new Map<string, number>();
    for (const lease of store.leases) if (lease.status === "assigned") activeByNode.set(lease.nodeId, (activeByNode.get(lease.nodeId) || 0) + 1);
    const candidates = store.nodes
      .filter((node) => node.tenantId === context.tenantId && nodeStatus(node) === "online" && node.availableDiskGb >= requiredGb)
      .sort((a, b) => (activeByNode.get(a.id) || 0) - (activeByNode.get(b.id) || 0) || b.availableDiskGb - a.availableDiskGb || a.id.localeCompare(b.id));
    const node = candidates[0];
    if (!node) throw new Error("No opted-in edge node currently has enough available capacity.");
    const now = Date.now();
    const lease: EdgeLease = {
      id: randomUUID(), tenantId: context.tenantId, manifestId: manifest.id, nodeId: node.id,
      requestedBy: context.actorId, kind: "asset_cache", chunkHashes: manifest.chunks.map((chunk) => chunk.sha256),
      status: "assigned", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + leaseTtlMs).toISOString(), completedAt: null,
    };
    store.leases.push(lease);
    return { lease, node: publicNode(node), manifest: { id: manifest.id, gameId: manifest.gameId, version: manifest.version, totalBytes: manifest.totalBytes, digest: manifest.digest } };
  });
}

export async function completePhantomPlayAssetLease(context: EdgeNetworkContext, leaseId: string, input: Record<string, unknown>) {
  return mutate(async (store) => {
    const lease = store.leases.find((candidate) => candidate.id === leaseId && candidate.tenantId === context.tenantId);
    if (!lease) throw new Error("Asset lease was not found.");
    const node = requireNode(store, context, lease.nodeId);
    if (lease.status !== "assigned") throw new Error(`Asset lease is ${lease.status}.`);
    const reported = Array.isArray(input.chunkHashes) ? input.chunkHashes.map((hash) => String(hash).toLowerCase()).sort() : [];
    const expected = [...lease.chunkHashes].sort();
    if (reported.length !== expected.length || reported.some((hash, index) => hash !== expected[index])) {
      throw new Error("Cached chunks did not match the signed manifest.");
    }
    lease.status = "completed";
    lease.completedAt = new Date().toISOString();
    node.updatedAt = lease.completedAt;
    return { lease, verified: true };
  });
}

export async function getPhantomPlayEdgeNetworkSnapshot(context: EdgeNetworkContext) {
  await mutationQueue;
  const store = await loadStore();
  expireLeases(store);
  const nodes = store.nodes.filter((node) => node.tenantId === context.tenantId && (context.canManage || node.actorId === context.actorId));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  return {
    protocol: "phantomplay.edge.v1",
    status: "foundation_active",
    controlPlaneOnly: true,
    cloudStreamingFromJordan: false,
    directPeerConnectionDefault: false,
    inboundDevicePortsDefault: false,
    contributionLanes: { asset_cache: "active", room_relay: "disabled", match_host: "disabled" },
    consentRequired: true,
    nodes: nodes.map(publicNode),
    leases: store.leases.filter((lease) => lease.tenantId === context.tenantId && visibleNodeIds.has(lease.nodeId)),
    manifestCount: context.canManage ? store.manifests.filter((manifest) => manifest.tenantId === context.tenantId).length : undefined,
  };
}

