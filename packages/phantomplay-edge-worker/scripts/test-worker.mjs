import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  admitChunkToCache,
  completeLease,
  createThrottle,
  downloadChunk,
  isChunkCached,
  processLease,
  sha256Hex,
  verifyBytes,
} from "../src/worker.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/* Static guardrail: this worker must never gain a code-execution path. If any of these
   patterns show up in src/ or bin/, that's a design regression worth failing loudly on. */
async function assertNoExecutionPrimitives() {
  const dangerous = [/\bchild_process\b/, /\beval\s*\(/, /new\s+Function\s*\(/, /\bimport\s*\(/, /\brequire\s*\(/, /vm\.(Script|createContext)/];
  for (const dir of ["src", "bin"]) {
    for (const file of await readdir(join(packageRoot, dir))) {
      const source = await readFile(join(packageRoot, dir, file), "utf8");
      for (const pattern of dangerous) {
        assert(!pattern.test(source), `${dir}/${file} matched forbidden execution pattern ${pattern}: the worker must stay data-only.`);
      }
    }
  }
}

async function run() {
  await assertNoExecutionPrimitives();

  const payload = Buffer.from("phantomplay edge worker test chunk bytes");
  const hash = sha256Hex(payload);
  assert(verifyBytes(payload, hash), "verifyBytes must accept correctly hashed bytes.");
  assert(!verifyBytes(payload, "0".repeat(64)), "verifyBytes must reject a mismatched hash.");

  const root = await mkdtemp(join(tmpdir(), "phantomplay-edge-worker-"));
  try {
    const manifestId = "manifest-1";
    assert(!(await isChunkCached(root, manifestId, hash)), "A chunk should not report cached before admission.");
    const target = await admitChunkToCache(root, manifestId, hash, payload);
    assert(await isChunkCached(root, manifestId, hash), "A chunk should report cached after admission.");
    assert(Buffer.compare(await readFile(target), payload) === 0, "Cached bytes must round-trip exactly.");

    let tamperRejected = false;
    try { await admitChunkToCache(root, manifestId, hash, Buffer.concat([payload, Buffer.from("x")])); }
    catch { tamperRejected = true; }
    assert(tamperRejected, "admitChunkToCache must refuse bytes that do not match the claimed hash.");

    /* Mock fetch: simulate the real server routes closely enough to exercise processLease end to end. */
    const served = new Map([[hash, payload]]);
    const completedLeases = [];
    const fetchImpl = async (url, options = {}) => {
      const u = new URL(url);
      if (options.method === "POST" && /\/leases\/[^/]+\/complete$/.test(u.pathname)) {
        const body = JSON.parse(options.body);
        completedLeases.push({ leaseId: u.pathname.split("/")[4], chunkHashes: body.chunkHashes });
        return { ok: true, json: async () => ({ ok: true, lease: { status: "completed" }, verified: true }) };
      }
      const chunkMatch = u.pathname.match(/\/leases\/([^/]+)\/chunks\/([a-f0-9]{64})$/);
      if (chunkMatch) {
        const requestedHash = chunkMatch[2];
        const bytes = served.get(requestedHash);
        if (!bytes) return { ok: false, status: 404, text: async () => "not found" };
        return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      }
      return { ok: false, status: 404, text: async () => "unhandled" };
    };

    const lease = { id: "lease-1", manifestId: "manifest-2", chunkHashes: [hash] };
    const outcome = await processLease({ apiBase: "http://mock", bearerToken: "test-token", lease, cacheDir: root, fetchImpl });
    assert(outcome.complete === true, "A lease whose chunks all verify should be reported complete.");
    assert(completedLeases.length === 1 && completedLeases[0].chunkHashes[0] === hash, "The worker must report exactly the verified hashes back to the control plane.");
    assert(await isChunkCached(root, "manifest-2", hash), "A processed lease's chunk should end up in the cache.");

    /* Re-processing the same lease must not re-download (already cached) and must still complete. */
    let secondDownloadAttempted = false;
    const fetchImplCountingDownloads = async (url, options) => {
      if (/\/chunks\//.test(new URL(url).pathname) && (!options || options.method !== "POST")) secondDownloadAttempted = true;
      return fetchImpl(url, options);
    };
    const secondOutcome = await processLease({ apiBase: "http://mock", bearerToken: "test-token", lease, cacheDir: root, fetchImpl: fetchImplCountingDownloads });
    assert(secondOutcome.complete === true, "Re-processing an already-cached lease should still complete cleanly.");
    assert(!secondDownloadAttempted, "Already-cached chunks must not be re-downloaded.");

    /* Tampered-on-the-wire chunk must be discarded, never admitted, and the lease must not be marked complete. */
    const tamperedServed = new Map([[hash, Buffer.concat([payload, Buffer.from("corruption")])]]);
    const tamperFetch = async (url, options) => {
      const u = new URL(url);
      const chunkMatch = u.pathname.match(/\/leases\/([^/]+)\/chunks\/([a-f0-9]{64})$/);
      if (chunkMatch) {
        const bytes = tamperedServed.get(chunkMatch[2]);
        return { ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
      }
      throw new Error("complete should not be called for a failed lease");
    };
    const tamperLease = { id: "lease-tampered", manifestId: "manifest-3", chunkHashes: [hash] };
    const tamperOutcome = await processLease({ apiBase: "http://mock", bearerToken: "test-token", lease: tamperLease, cacheDir: root, fetchImpl: tamperFetch });
    assert(tamperOutcome.complete === false, "A lease with a corrupted chunk must never be reported complete.");
    assert(!(await isChunkCached(root, "manifest-3", hash)), "A corrupted chunk must never be admitted into the cache.");

    /* Throttle sanity: a throttle configured for a tiny rate should request a real sleep for a large chunk. */
    let sleptMs = 0;
    const throttle = createThrottle(1, { sleepImpl: async (ms) => { sleptMs = ms; }, nowImpl: () => 0 });
    await throttle(1_000_000, 0);
    assert(sleptMs > 0, "A slow throttle limit should introduce a pacing delay for a large chunk downloaded instantly.");

    /* completeLease talks to the exact documented endpoint shape. */
    let completeCalledPath = "";
    await completeLease({
      apiBase: "http://mock", bearerToken: "t", leaseId: "lease-x", chunkHashes: [hash],
      fetchImpl: async (url, options) => { completeCalledPath = new URL(url).pathname; return { ok: true, json: async () => ({ ok: true }) }; },
    });
    assert(completeCalledPath === "/api/phantomplay/edge/leases/lease-x/complete", "completeLease must call the documented lease-complete route.");

    /* downloadChunk surfaces non-OK responses as errors rather than silently returning empty bytes. */
    let downloadErrorSeen = false;
    try {
      await downloadChunk({ apiBase: "http://mock", bearerToken: "t", leaseId: "lease-x", sha256: hash, fetchImpl: async () => ({ ok: false, status: 403, text: async () => "nope" }) });
    } catch { downloadErrorSeen = true; }
    assert(downloadErrorSeen, "A non-OK chunk download response must throw, not resolve with partial/empty data.");

    console.log("PASS phantomplay-edge-worker");
    console.log(JSON.stringify({
      noExecutionPrimitives: true,
      hashVerifiedBeforeAdmission: true,
      tamperedChunksDiscarded: true,
      alreadyCachedChunksNotRedownloaded: true,
      throttlePaces: true,
      completionReportsVerifiedHashesOnly: true,
    }, null, 2));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
