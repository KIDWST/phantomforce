import { createHash } from "node:crypto";

export const PROMPT_INTEGRITY_PROTOCOL = "phantom.prompt.v1";
export const PROMPT_SEGMENT_MAX_BYTES = 16 * 1024;
export const MAX_PROMPT_CHARS = 200_000;
export const MAX_PROMPT_BYTES = 512 * 1024;

export type PromptIntegrityEnvelope = {
  message_id: string;
  conversation_id: string;
  protocol_version: typeof PROMPT_INTEGRITY_PROTOCOL;
  encoding: "utf-8";
  byte_length: number;
  character_length: number;
  line_count: number;
  full_sha256: string;
  segment_count: number;
  segment_hashes: string[];
  beginning_sentinel_sha256: string;
  middle_sentinel_sha256: string;
  end_sentinel_sha256: string;
  client_version: string;
  created_at: string;
};

export type PromptIntegrityVerification =
  | { ok: true; state: "complete"; envelope: PromptIntegrityEnvelope }
  | { ok: false; state: "incomplete" | "hash_mismatch" | "rejected"; error: string };

function sha256(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function utf8Segments(value: string, maxBytes = PROMPT_SEGMENT_MAX_BYTES) {
  const segments: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const codePoint of value) {
    const bytes = Buffer.byteLength(codePoint, "utf8");
    if (current && currentBytes + bytes > maxBytes) {
      segments.push(current);
      current = "";
      currentBytes = 0;
    }
    current += codePoint;
    currentBytes += bytes;
  }
  if (current || value === "") segments.push(current);
  return segments;
}

function sentinels(value: string) {
  const beginning = value.slice(0, 256);
  const middleStart = Math.max(0, Math.floor(value.length / 2) - 128);
  const middle = value.slice(middleStart, middleStart + 256);
  const end = value.slice(-512);
  return {
    beginning_sentinel_sha256: sha256(beginning),
    middle_sentinel_sha256: sha256(middle),
    end_sentinel_sha256: sha256(end),
  };
}

export function buildPromptIntegrityEnvelope(
  value: string,
  identity: {
    messageId: string;
    conversationId: string;
    clientVersion?: string;
    createdAt?: string;
  },
): PromptIntegrityEnvelope {
  const bytes = Buffer.from(value, "utf8");
  const segments = utf8Segments(value);
  return {
    message_id: identity.messageId,
    conversation_id: identity.conversationId,
    protocol_version: PROMPT_INTEGRITY_PROTOCOL,
    encoding: "utf-8",
    byte_length: bytes.byteLength,
    character_length: value.length,
    line_count: value === "" ? 0 : value.split(/\r\n|\r|\n/).length,
    full_sha256: sha256(bytes),
    segment_count: segments.length,
    segment_hashes: segments.map((segment) => sha256(Buffer.from(segment, "utf8"))),
    ...sentinels(value),
    client_version: identity.clientVersion ?? "phantomforce-server",
    created_at: identity.createdAt ?? new Date().toISOString(),
  };
}

function isEnvelope(value: unknown): value is PromptIntegrityEnvelope {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return row.protocol_version === PROMPT_INTEGRITY_PROTOCOL
    && row.encoding === "utf-8"
    && typeof row.message_id === "string"
    && typeof row.conversation_id === "string"
    && typeof row.byte_length === "number"
    && typeof row.character_length === "number"
    && typeof row.line_count === "number"
    && typeof row.full_sha256 === "string"
    && typeof row.segment_count === "number"
    && Array.isArray(row.segment_hashes)
    && typeof row.beginning_sentinel_sha256 === "string"
    && typeof row.middle_sentinel_sha256 === "string"
    && typeof row.end_sentinel_sha256 === "string";
}

export function verifyPromptIntegrity(
  value: string,
  suppliedEnvelope: unknown,
): PromptIntegrityVerification {
  const byteLength = Buffer.byteLength(value, "utf8");
  if (value.length > MAX_PROMPT_CHARS || byteLength > MAX_PROMPT_BYTES) {
    return {
      ok: false,
      state: "rejected",
      error: `Prompt exceeds the supported limit (${MAX_PROMPT_CHARS} characters or ${MAX_PROMPT_BYTES} UTF-8 bytes). Attach the material or split it into explicit parts.`,
    };
  }
  if (!isEnvelope(suppliedEnvelope)) {
    return {
      ok: false,
      state: "incomplete",
      error: "Prompt integrity metadata is missing or incompatible. Refresh PhantomForce and retry; the request was not processed.",
    };
  }
  const actual = buildPromptIntegrityEnvelope(value, {
    messageId: suppliedEnvelope.message_id,
    conversationId: suppliedEnvelope.conversation_id,
    clientVersion: suppliedEnvelope.client_version,
    createdAt: suppliedEnvelope.created_at,
  });
  const fields: Array<keyof PromptIntegrityEnvelope> = [
    "byte_length",
    "character_length",
    "line_count",
    "full_sha256",
    "segment_count",
    "beginning_sentinel_sha256",
    "middle_sentinel_sha256",
    "end_sentinel_sha256",
  ];
  const mismatch = fields.find((field) => actual[field] !== suppliedEnvelope[field])
    || (actual.segment_hashes.length !== suppliedEnvelope.segment_hashes.length
      ? "segment_hashes"
      : actual.segment_hashes.findIndex((hash, index) => hash !== suppliedEnvelope.segment_hashes[index]) >= 0
        ? "segment_hashes"
        : null);
  if (mismatch) {
    return {
      ok: false,
      state: "hash_mismatch",
      error: `Prompt integrity verification failed at ${String(mismatch)}. The request was not processed.`,
    };
  }
  return { ok: true, state: "complete", envelope: actual };
}
