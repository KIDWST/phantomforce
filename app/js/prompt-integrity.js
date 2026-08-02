export const PROMPT_INTEGRITY_PROTOCOL = "phantom.prompt.v1";
export const PROMPT_SEGMENT_MAX_BYTES = 16 * 1024;
export const MAX_PROMPT_CHARS = 200_000;
export const MAX_PROMPT_BYTES = 512 * 1024;

const encoder = new TextEncoder();

async function sha256(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function utf8Segments(value) {
  const segments = [];
  let current = "";
  let currentBytes = 0;
  for (const codePoint of value) {
    const bytes = encoder.encode(codePoint).byteLength;
    if (current && currentBytes + bytes > PROMPT_SEGMENT_MAX_BYTES) {
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

export function promptSizeError(value) {
  const byteLength = encoder.encode(value).byteLength;
  if (value.length <= MAX_PROMPT_CHARS && byteLength <= MAX_PROMPT_BYTES) return "";
  return `This message is too large for a verified send. Limit: ${MAX_PROMPT_CHARS.toLocaleString()} characters or ${MAX_PROMPT_BYTES.toLocaleString()} UTF-8 bytes. Attach the material or split it into explicit parts.`;
}

export async function buildPromptIntegrityEnvelope(
  value,
  { messageId, conversationId, clientVersion = "phantom-live-20260801-141", createdAt = new Date().toISOString() },
) {
  const sizeError = promptSizeError(value);
  if (sizeError) throw new Error(sizeError);
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure prompt verification is unavailable in this browser. Refresh over localhost or HTTPS.");
  }
  const bytes = encoder.encode(value);
  const segments = utf8Segments(value);
  const middleStart = Math.max(0, Math.floor(value.length / 2) - 128);
  return {
    message_id: messageId,
    conversation_id: conversationId,
    protocol_version: PROMPT_INTEGRITY_PROTOCOL,
    encoding: "utf-8",
    byte_length: bytes.byteLength,
    character_length: value.length,
    line_count: value === "" ? 0 : value.split(/\r\n|\r|\n/).length,
    full_sha256: await sha256(bytes),
    segment_count: segments.length,
    segment_hashes: await Promise.all(segments.map((segment) => sha256(segment))),
    beginning_sentinel_sha256: await sha256(value.slice(0, 256)),
    middle_sentinel_sha256: await sha256(value.slice(middleStart, middleStart + 256)),
    end_sentinel_sha256: await sha256(value.slice(-512)),
    client_version: clientVersion,
    created_at: createdAt,
  };
}
