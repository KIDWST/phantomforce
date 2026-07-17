import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export type AccountDeliveryKind = "username_reminder" | "password_reset";

export type AccountDeliveryMessage = {
  kind: AccountDeliveryKind;
  to: string;
  subject: string;
  text: string;
  actionUrl?: string;
  createdAt?: string;
};

const productionMode = (process.env.NODE_ENV ?? "development") === "production";

function publicAppUrl() {
  return (process.env.PHANTOMFORCE_PUBLIC_APP_URL ?? "http://127.0.0.1:5391").replace(/\/+$/, "");
}

export function resetPasswordUrl(token: string) {
  return `${publicAppUrl()}/?reset_token=${encodeURIComponent(token)}`;
}

async function writeDevOutbox(message: AccountDeliveryMessage) {
  const root = process.env.PHANTOMFORCE_AUTH_DELIVERY_DIR || join(process.cwd(), "data");
  await mkdir(root, { recursive: true });
  const file = join(root, "auth-delivery-outbox.jsonl");
  await appendFile(file, `${JSON.stringify({ ...message, createdAt: message.createdAt ?? new Date().toISOString(), channel: "dev_outbox" })}\n`, "utf8");
  return { queued: true as const, channel: "dev_outbox", outbox: file };
}

async function postWebhook(message: AccountDeliveryMessage, webhookUrl: string) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...message, createdAt: message.createdAt ?? new Date().toISOString() }),
  });
  if (!response.ok) {
    return { queued: false as const, channel: "webhook", error: `delivery_webhook_${response.status}` };
  }
  return { queued: true as const, channel: "webhook" };
}

export async function deliverAccountMessage(message: AccountDeliveryMessage) {
  const webhookUrl = process.env.PHANTOMFORCE_AUTH_DELIVERY_WEBHOOK_URL?.trim();
  if (webhookUrl) return postWebhook(message, webhookUrl);
  if (!productionMode) return writeDevOutbox(message);
  return { queued: false as const, channel: "disabled", error: "account_delivery_not_configured" };
}
