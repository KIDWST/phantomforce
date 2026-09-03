import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requestPhantomPlayEngineCommand, type PhantomPlayEngineCommandInput, type PhantomPlayEngineCommandResult, type EngineAgentOptions } from "./phantomplay-engine-agent.js";

// Native requests have no browser origin. The custom header also prevents simple
// cross-site form/fetch requests; it is deliberately absent from the CORS allowlist.
export function engineLocalRequestAllowed(request: Pick<FastifyRequest, "ip" | "headers">) {
  const ip = request.ip.replace(/^::ffff:/u, "");
  const host = String(request.headers.host || "");
  return ["127.0.0.1", "::1"].includes(ip)
    && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/iu.test(host)
    && !request.headers.origin && !request.headers["sec-fetch-site"] && !request.headers["x-forwarded-for"]
    && request.headers["x-phantom-engine-client"] === "desktop-v1";
}

type Job = { runId: string; status: "running" | "finished"; phase: string; result?: PhantomPlayEngineCommandResult; controller: AbortController; requestKey: string; fingerprint: string };
export function registerPhantomPlayEngineRoutes(app: FastifyInstance, options: {
  localAllowed: (ip: string) => boolean;
  credential: () => Promise<string | null>;
  execute?: typeof requestPhantomPlayEngineCommand;
  agentOptions?: EngineAgentOptions;
}) {
  const jobs = new Map<string, Job>();
  const route = "/api/phantomplay/engine/commands";
  const guard = async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (!options.localAllowed(request.ip.replace(/^::ffff:/u, "")) || !engineLocalRequestAllowed(request)) {
      return reply.code(403).send({ ok: false, error: "Phantom Engine accepts only direct native requests on this PC.", code: "local_only" });
    }
  };
  app.post(route, { bodyLimit: 64 * 1024, preHandler: guard }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const provider = (value: unknown) => value === "codex" || value === "claude" || value === "openrouter" || value === "local" ? value : "auto";
    const input: PhantomPlayEngineCommandInput = {
      gameId: typeof body.gameId === "string" ? body.gameId.trim().slice(0, 180) : "",
      projectTitle: typeof body.projectTitle === "string" ? body.projectTitle.trim().slice(0, 240) : "",
      cwd: typeof body.cwd === "string" ? body.cwd.trim() : "",
      instruction: typeof body.instruction === "string" ? body.instruction : "",
      engine: typeof body.engine === "string" ? body.engine.slice(0, 120) : "",
      projectFiles: Array.isArray(body.projectFiles) ? body.projectFiles.filter((item): item is string => typeof item === "string").slice(0, 240) : [],
      provider: provider(body.provider), model: typeof body.model === "string" ? body.model.slice(0, 180) : "",
      fallbackProvider: provider(body.fallbackProvider), allowFallbacks: body.allowFallbacks !== false,
      timeoutMs: Math.min(Math.max(Number(body.timeoutMs) || 600_000, 30_000), 1_800_000),
    };
    if (!input.gameId || !input.cwd || !input.instruction.trim() || input.instruction.length > 12_000) return reply.code(400).send({ ok: false, error: "Select a project and enter a command of 1–12,000 characters." });
    const requestKey = String(request.headers["x-phantom-engine-request"] || "").slice(0, 120);
    const fingerprint = JSON.stringify(input);
    const previous = requestKey && [...jobs.values()].find(job => job.requestKey === requestKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) return reply.code(409).send({ ok: false, error: "This request ID already belongs to a different command." });
      return reply.code(202).send({ ok: true, runId: previous.runId, status: previous.status });
    }
    if ([...jobs.values()].filter(job => job.status === "running").length >= 4) return reply.code(429).send({ ok: false, error: "Four local workers are already running. Wait for one to finish." });
    if (jobs.size >= 100) for (const [id, job] of jobs) { if (job.status === "finished") { jobs.delete(id); break; } }
    const runId = `pe-${randomUUID()}`;
    const job: Job = { runId, status: "running", phase: "Preparing the local worker…", controller: new AbortController(), requestKey, fingerprint };
    jobs.set(runId, job);
    void (async () => {
      try {
        input.openRouterCredential = await options.credential().catch(() => null) || undefined;
        job.result = await (options.execute ?? requestPhantomPlayEngineCommand)(input, { ...options.agentOptions, runId, signal: job.controller.signal, onProgress: phase => { job.phase = phase; } });
      } catch { job.result = { ok: false, code: "execution_failed", error: "The local worker stopped unexpectedly. Inspect the project before retrying." }; }
      finally { job.status = "finished"; job.phase = job.result?.ok ? "Worker finished; review the evidence." : "Worker needs attention."; }
    })();
    return reply.code(202).send({ ok: true, runId, status: "running" });
  });
  app.get(`${route}/:runId`, { preHandler: guard }, async (request, reply) => {
    const job = jobs.get((request.params as { runId: string }).runId);
    if (!job) return reply.code(410).send({ ok: false, error: "This run is no longer tracked (the service may have restarted). Inspect .phantom/engine-runs and project changes before submitting again." });
    return { ok: true, runId: job.runId, status: job.status, phase: job.phase, result: job.result };
  });
  app.post(`${route}/:runId/cancel`, { preHandler: guard }, async (request, reply) => {
    const job = jobs.get((request.params as { runId: string }).runId);
    if (!job) return reply.code(410).send({ ok: false, error: "Run no longer tracked." });
    if (job.status === "running") { job.phase = "Stopping worker; recording partial changes…"; job.controller.abort(); }
    return { ok: true, runId: job.runId, status: job.status };
  });
  app.addHook("onClose", async () => { for (const job of jobs.values()) if (job.status === "running") job.controller.abort(); });
}
