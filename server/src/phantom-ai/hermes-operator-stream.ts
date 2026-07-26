import type { AccessSession } from "../access/session.js";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

import {
  getAgentRun,
  requestAgentRunCancel,
  serializeAgentRun,
  subscribeAgentRun,
} from "./agent-runs.js";
import {
  cancelHermesOperatorSession,
  getHermesOperatorSession,
  subscribeHermesOperatorSession,
} from "./hermes-acp-operator.js";

const AUTH_TIMEOUT_MS = 5_000;
const HEARTBEAT_MS = 15_000;
const MAX_CLIENT_MESSAGE_BYTES = 16_384;
const MAX_SERVER_FRAME_BYTES = 800_000;
const MAX_BUFFERED_BYTES = 1_000_000;
const TERMINAL_STATES = new Set(["completed", "denied", "failed", "cancelled", "blocked"]);

type AuthenticateMessage = {
  type?: unknown;
  token?: unknown;
  cursor?: unknown;
  workspace?: unknown;
};

type StreamRegistrationOptions = {
  resolveToken: (token: string) => Promise<AccessSession | null>;
};

function sendFrame(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== socket.OPEN) return false;
  if (socket.bufferedAmount > MAX_BUFFERED_BYTES) {
    socket.close(1013, "stream_backpressure");
    return false;
  }
  const serialized = JSON.stringify(payload);
  if (Buffer.byteLength(serialized) > MAX_SERVER_FRAME_BYTES) {
    socket.send(JSON.stringify({ type: "error", error: "stream_frame_too_large" }));
    socket.close(1009, "stream_frame_too_large");
    return false;
  }
  socket.send(serialized);
  return true;
}

export function registerHermesOperatorStream(
  app: FastifyInstance,
  options: StreamRegistrationOptions,
) {
  app.get(
    "/ws/phantom-ai/hermes-acp/sessions/:id",
    { websocket: true },
    (socket, request) => {
      const operatorId = String((request.params as { id?: string }).id || "").slice(0, 180);
      let accessSession: AccessSession | null = null;
      let cursor = 0;
      let closed = false;
      let updateScheduled = false;
      let activeRunId = "";
      let unsubscribeOperator: (() => void) | null = null;
      let unsubscribeRun: (() => void) | null = null;
      let heartbeat: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        unsubscribeOperator?.();
        unsubscribeRun?.();
      };

      const bindRun = (runId: string | null) => {
        const next = runId || "";
        if (next === activeRunId) return;
        unsubscribeRun?.();
        activeRunId = next;
        unsubscribeRun = next ? subscribeAgentRun(next, scheduleUpdate) : null;
      };

      const sendUpdate = async () => {
        updateScheduled = false;
        if (closed || !accessSession) return;
        const operatorSession = await getHermesOperatorSession(accessSession, operatorId);
        if (!operatorSession) {
          sendFrame(socket, { type: "error", error: "operator_session_not_found" });
          socket.close(1008, "operator_session_not_found");
          return;
        }
        bindRun(operatorSession.agentRunId);
        const highest = operatorSession.events.reduce(
          (value, event) => Math.max(value, Number(event.sequence) || 0),
          0,
        );
        if (cursor > highest) {
          sendFrame(socket, {
            type: "cursor_rejected",
            reason: "cursor_ahead_of_authoritative_state",
            authoritativeCursor: highest,
          });
          cursor = 0;
        }
        const events = operatorSession.events.filter((event) => event.sequence > cursor);
        const run = operatorSession.agentRunId ? getAgentRun(operatorSession.agentRunId) : null;
        const safeSession = {
          ...operatorSession,
          prompt: "",
          assistantText: "",
          events,
        };
        if (sendFrame(socket, {
          type: "operator_update",
          cursor: highest,
          terminal: TERMINAL_STATES.has(operatorSession.state),
          session: safeSession,
          run: run ? { ...serializeAgentRun(run), inputs: {} } : null,
        })) {
          cursor = highest;
        }
      };

      function scheduleUpdate() {
        if (closed || updateScheduled) return;
        updateScheduled = true;
        setTimeout(() => void sendUpdate(), 20);
      }

      const authTimer = setTimeout(() => {
        if (!accessSession && socket.readyState === socket.OPEN) {
          socket.close(1008, "authentication_timeout");
        }
      }, AUTH_TIMEOUT_MS);

      socket.once("message", async (raw: Buffer) => {
        if (raw.byteLength > MAX_CLIENT_MESSAGE_BYTES) {
          socket.close(1009, "client_message_too_large");
          return;
        }
        let message: AuthenticateMessage;
        try {
          message = JSON.parse(raw.toString()) as AuthenticateMessage;
        } catch {
          socket.close(1008, "authentication_message_invalid");
          return;
        }
        if (message.type !== "authenticate" || typeof message.token !== "string") {
          socket.close(1008, "authentication_required");
          return;
        }
        const resolved = await options.resolveToken(message.token);
        if (!resolved) {
          socket.close(1008, "authentication_failed");
          return;
        }
        const operatorSession = await getHermesOperatorSession(resolved, operatorId);
        if (!operatorSession) {
          socket.close(1008, "operator_session_not_found");
          return;
        }
        if (
          typeof message.workspace !== "string"
          || message.workspace !== operatorSession.workspace
        ) {
          socket.close(1008, "workspace_binding_failed");
          return;
        }
        accessSession = resolved;
        cursor = Number.isSafeInteger(message.cursor) && Number(message.cursor) >= 0
          ? Number(message.cursor)
          : 0;
        clearTimeout(authTimer);
        unsubscribeOperator = subscribeHermesOperatorSession(operatorId, scheduleUpdate);
        bindRun(operatorSession.agentRunId);
        heartbeat = setInterval(() => {
          sendFrame(socket, {
            type: "heartbeat",
            cursor,
            at: new Date().toISOString(),
          });
        }, HEARTBEAT_MS);
        socket.on("message", async (nextRaw: Buffer) => {
          if (nextRaw.byteLength > MAX_CLIENT_MESSAGE_BYTES || !accessSession) return;
          let next: { type?: unknown };
          try {
            next = JSON.parse(nextRaw.toString()) as { type?: unknown };
          } catch {
            return;
          }
          if (next.type !== "cancel") return;
          const cancelled = await cancelHermesOperatorSession(accessSession, operatorId);
          if (cancelled?.agentRunId) await requestAgentRunCancel(cancelled.agentRunId);
          scheduleUpdate();
        });
        await sendUpdate();
      });

      socket.on("close", cleanup);
      socket.on("error", cleanup);
    },
  );
}
