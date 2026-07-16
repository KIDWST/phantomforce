/*
 * paywall-guard.ts — the un-bypassable server-side enforcement of the paywall.
 *
 * Registered once as a Fastify preHandler (see index.ts):
 *     app.addHook("preHandler", paywallPreHandler);
 *
 * Every request passes through here. Views (GET/HEAD) are always free. Any
 * mutating request (POST/PUT/PATCH/DELETE) requires write entitlement UNLESS its
 * path is an explicit read-only endpoint (login, previews, dry-runs, schema
 * validation, conversational chat). This is FAIL CLOSED: a route that isn't on
 * the read-only allowlist needs write access by default, so a newly added write
 * endpoint can never silently be free. The browser cannot influence this — the
 * decision comes from the server-resolved session only.
 */

import type { FastifyReply, FastifyRequest } from "fastify";

import { canWrite, getPaywallDecision } from "./paywall.js";
import { resolveAccessSession } from "./session.js";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Does this method+path perform a write that requires paid entitlement? */
export function requiresWrite(method: string, url: string): boolean {
  const m = (method || "GET").toUpperCase();
  if (!MUTATING.has(m)) return false; // GET/HEAD/OPTIONS = view = always free

  const path = (url || "").split("?")[0];
  const seg = path.split("/").filter(Boolean).pop() || "";

  // --- endpoints exempt from the session paywall ---
  if (/^(session|owner|demo)-login$/.test(seg)) return false; // signing in
  if (path === "/auth/login" || path === "/auth/logout") return false; // database auth in/out
  if (path === "/auth/switch-org") return false; // changing active org is identity, not a paid write
  if (path === "/auth/invitations/accept") return false; // onboarding happens before entitlement exists
  if (path === "/billing/dev/select-plan") return false; // local fake checkout must let test users leave Free View
  if (path === "/billing/webhook") return false; // authenticated by its own signing secret, not a session
  if (/(^|-)(preview|dry-run|preflight|contract|validate)$/.test(seg)) return false; // read-only computes
  if (path === "/phantom-ai/chat") return false; // conversational; its side effects are separately gated

  return true; // fail closed: everything else that mutates needs write access
}

/**
 * Build the preHandler. Accepts an optional session resolver for testing; in
 * production it uses the real server-side session resolution.
 */
export function makePaywallPreHandler(resolve: (request: FastifyRequest) => unknown = resolveAccessSession) {
  return async function paywallPreHandler(request: FastifyRequest, reply: FastifyReply) {
    if (!requiresWrite(request.method, request.url)) return;

    const session = resolve(request) as Parameters<typeof canWrite>[0];
    if (!session) {
      reply.code(401).send({
        ok: false,
        error: "Missing or invalid Authorization bearer token.",
      });
      return reply;
    }

    if (canWrite(session)) return;

    const decision = getPaywallDecision(session);
    reply.code(403).send({
      ok: false,
      error: "read_only_plan",
      tier: decision.tier,
      canView: decision.canView,
      reason: decision.reason,
      upgrade: "This is a change action. Upgrade to a paid plan to make changes.",
    });
    return reply;
  };
}

export const paywallPreHandler = makePaywallPreHandler();
