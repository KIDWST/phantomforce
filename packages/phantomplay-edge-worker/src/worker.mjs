/* PhantomPlay edge network data-plane worker.
   Downloads chunks the control plane has leased to this node, verifies each SHA-256 digest
   BEFORE it is admitted into the local cache, throttles usage against the node's own limits,
   and reports completion. This module never executes, imports, requires, or evals a cached
   file — see docs/architecture/PHANTOMPLAY_EDGE_NETWORK.md for the trust boundary this enforces.
   No subprocess spawning, no eval, no dynamic import of cached content: verified by
   scripts/test-worker.mjs, which scans this file for those patterns as a static guardrail. */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, access as fsAccess } from "node:fs/promises";
import { dirname, join } from "node:path";

export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyBytes(bytes, expectedHash) {
  return sha256Hex(bytes) === String(expectedHash || "").toLowerCase();
}

function authHeaders(bearerToken) {
  return { Authorization: `Bearer ${bearerToken}` };
}

async function apiRequest(fetchImpl, apiBase, path, { method = "GET", bearerToken, body } = {}) {
  const response = await fetchImpl(`${apiBase}${path}`, {
    method,
    headers: { ...authHeaders(bearerToken), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${method} ${path} failed: ${response.status} ${text.slice(0, 300)}`);
  }
  return response.json();
}

export async function enrollNode({ apiBase, bearerToken, installationId, label, platform, architecture, runtimeVersion, limits, availableDiskGb, fetchImpl = fetch }) {
  const result = await apiRequest(fetchImpl, apiBase, "/api/phantomplay/edge/nodes", {
    method: "POST",
    bearerToken,
    body: { consent: true, contributions: ["asset_cache"], installationId, label, platform, architecture, runtimeVersion, limits, availableDiskGb },
  });
  return result.node;
}

export async function heartbeat({ apiBase, bearerToken, nodeId, availableDiskGb, runtimeVersion, fetchImpl = fetch }) {
  const result = await apiRequest(fetchImpl, apiBase, `/api/phantomplay/edge/nodes/${encodeURIComponent(nodeId)}/heartbeat`, {
    method: "POST",
    bearerToken,
    body: { availableDiskGb, runtimeVersion },
  });
  return result;
}

export async function downloadChunk({ apiBase, bearerToken, leaseId, sha256, fetchImpl = fetch }) {
  const response = await fetchImpl(`${apiBase}/api/phantomplay/edge/leases/${encodeURIComponent(leaseId)}/chunks/${encodeURIComponent(sha256)}`, {
    headers: authHeaders(bearerToken),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`chunk download failed: ${response.status} ${text.slice(0, 300)}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function completeLease({ apiBase, bearerToken, leaseId, chunkHashes, fetchImpl = fetch }) {
  return apiRequest(fetchImpl, apiBase, `/api/phantomplay/edge/leases/${encodeURIComponent(leaseId)}/complete`, {
    method: "POST",
    bearerToken,
    body: { chunkHashes },
  });
}

function cachedChunkPath(cacheDir, manifestId, sha256) {
  return join(cacheDir, manifestId, sha256);
}

export async function isChunkCached(cacheDir, manifestId, sha256) {
  try {
    await fsAccess(cachedChunkPath(cacheDir, manifestId, sha256));
    return true;
  } catch {
    return false;
  }
}

/* Writes only after the caller has verified the hash; re-verifies once more here so a bug
   upstream can never admit tampered or truncated bytes into the cache. */
export async function admitChunkToCache(cacheDir, manifestId, sha256, bytes) {
  if (!verifyBytes(bytes, sha256)) throw new Error("Refusing to cache chunk: hash mismatch at admission time.");
  const target = cachedChunkPath(cacheDir, manifestId, sha256);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, target);
  return target;
}

/* Throttles to the node's own configured Mbps limit. There is no separate download-rate field
   yet (see architecture doc — serving/relay lanes are still disabled), so this reuses
   maxUploadMbps as the interim symmetric cap; a dedicated download limit is a natural
   fast-follow once serving is enabled. */
export function createThrottle(maxUploadMbps, { sleepImpl = (ms) => new Promise((r) => setTimeout(r, ms)), nowImpl = Date.now } = {}) {
  const bytesPerSecond = Math.max(1, (Number(maxUploadMbps) || 1) * 1_000_000 / 8);
  return async function throttle(byteCount, elapsedMs) {
    const budgetMs = (byteCount / bytesPerSecond) * 1000;
    const remaining = budgetMs - elapsedMs;
    if (remaining > 0) await sleepImpl(remaining);
  };
}

/* Downloads, verifies, and admits every chunk in a lease that isn't already cached, then
   reports the verified set back to the control plane. Chunks that fail verification are
   dropped (never admitted, never reported) rather than retried in this pass. */
export async function processLease({ apiBase, bearerToken, lease, cacheDir, throttle, fetchImpl = fetch, log = () => {} }) {
  const verifiedHashes = [];
  for (const sha256 of lease.chunkHashes) {
    if (await isChunkCached(cacheDir, lease.manifestId, sha256)) {
      verifiedHashes.push(sha256);
      continue;
    }
    const startedAt = Date.now();
    let bytes;
    try {
      bytes = await downloadChunk({ apiBase, bearerToken, leaseId: lease.id, sha256, fetchImpl });
    } catch (error) {
      log(`chunk ${sha256.slice(0, 12)} download failed: ${error.message}`);
      continue;
    }
    if (!verifyBytes(bytes, sha256)) {
      log(`chunk ${sha256.slice(0, 12)} failed hash verification, discarding.`);
      continue;
    }
    await admitChunkToCache(cacheDir, lease.manifestId, sha256, bytes);
    verifiedHashes.push(sha256);
    if (throttle) await throttle(bytes.length, Date.now() - startedAt);
  }
  if (verifiedHashes.length !== lease.chunkHashes.length) {
    log(`lease ${lease.id}: ${verifiedHashes.length}/${lease.chunkHashes.length} chunks verified; not reporting complete.`);
    return { leaseId: lease.id, complete: false, verifiedHashes };
  }
  const result = await completeLease({ apiBase, bearerToken, leaseId: lease.id, chunkHashes: verifiedHashes, fetchImpl });
  return { leaseId: lease.id, complete: true, verifiedHashes, result };
}

/* One heartbeat-and-process cycle. Returns what happened so a caller (daemon loop or test)
   can decide what to do next; does not sleep or loop itself. */
export async function runCycle({ apiBase, bearerToken, nodeId, cacheDir, availableDiskGb, runtimeVersion, maxUploadMbps, fetchImpl = fetch, log = () => {} }) {
  const { leases } = await heartbeat({ apiBase, bearerToken, nodeId, availableDiskGb, runtimeVersion, fetchImpl });
  const throttle = createThrottle(maxUploadMbps);
  const outcomes = [];
  for (const lease of leases || []) {
    outcomes.push(await processLease({ apiBase, bearerToken, lease, cacheDir, throttle, fetchImpl, log }));
  }
  return outcomes;
}
