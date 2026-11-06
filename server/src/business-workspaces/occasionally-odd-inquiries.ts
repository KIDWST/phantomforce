import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { createBusinessRecordOnce } from "./business-records.js";
import { inquiryCatalog } from "./occasionally-odd-inquiry-catalog.js";

const schema = z.object({
  idempotency_key: z.string().uuid(), name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254), message: z.string().trim().max(2000).default(""),
  website: z.string().max(200).default(""), started_at: z.number().int().positive(),
  items: z.array(z.object({ product_id: z.string().max(100), option: z.string().max(120), quantity: z.number().int().min(1).max(25) }).strict()).min(1).max(12),
}).strict();
const optionNames: Record<string,string> = { product: "Product", "paint-pack": "Paint pack", "paint-basket": "Paint basket" };

export function registerOccasionallyOddInquiries(app: FastifyInstance, options: { recordsRoot?: string; now?: () => number } = {}) {
  const rates = new Map<string, { at: number; n: number }>();
  const now = options.now || Date.now;
  app.post("/api/public/occasionally-odd/inquiries", { bodyLimit: 16_384 }, async (request, reply) => {
    reply.header("cache-control", "no-store");
    if (!["https://occasionallyodd.com", "https://www.occasionallyodd.com"].includes(String(request.headers.origin || ""))) {
      return reply.code(403).send({ ok: false, error: "Please send your inquiry from Occasionally Odd's website." });
    }
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, error: "Please check your name, email, and bag items." });
    const input = parsed.data;
    if (input.website) return reply.code(202).send({ ok: true, received: true });
    const elapsed = now() - input.started_at;
    if (elapsed < 1500 || elapsed > 86_400_000) return reply.code(400).send({ ok: false, error: "Please reopen the inquiry form and try again." });
    const lines = input.items.map((item) => {
      const product = inquiryCatalog.find((row) => row.id === item.product_id);
      if (!product || !(product.options as readonly string[]).includes(item.option)) return null;
      return { ...item, name: product.name };
    });
    if (lines.some((line) => !line) || new Set(lines.map((line) => `${line?.product_id}:${line?.option}`)).size !== lines.length) {
      return reply.code(400).send({ ok: false, error: "A bag item changed. Please refresh the shop and review your bag." });
    }
    const timestamp = now(), key = request.ip;
    for (const [ip, rate] of rates) if (rate.at < timestamp - 3_600_000) rates.delete(ip);
    const rate = rates.get(key);
    if ((rate?.n || 0) >= 6 || (!rate && rates.size >= 10_000)) return reply.code(429).send({ ok: false, error: "Too many attempts. Please try later or contact the shop on Instagram." });
    rates.set(key, { at: rate?.at || timestamp, n: (rate?.n || 0) + 1 });
    try {
      const { record, created } = await createBusinessRecordOnce("occasionally-odd", {
        kind: "order", status: "draft", title: `Website inquiry: ${lines[0]!.name}`,
        customer: input.name,
        notes: ["WEBSITE INQUIRY — not a confirmed order or payment.", `Email: ${input.email}`,
          ...lines.map((line) => `${line!.quantity} × ${line!.name} — ${optionNames[line!.option]}`),
          "", input.message, "", "Review the request, availability, rights, final pricing, delivery and payment before confirming."].join("\n"),
        metadata: { channel: "storefront", quantity: lines.reduce((sum, line) => sum + line!.quantity, 0), rightsStatus: "unconfirmed" },
      }, "occasionallyodd.com", input.idempotency_key, options.recordsRoot);
      return reply.code(created ? 201 : 200).send({ ok: true, received: true, inquiry_id: record.id });
    } catch {
      return reply.code(503).send({ ok: false, error: "We couldn't save your inquiry. Your bag is still here; retry or contact the shop on Instagram." });
    }
  });
}
