const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const INCOME_PATTERN = /\b(received|paid me|client paid|customer paid|income|deposit|got paid|payment from)\b/i;
const RECURRENCE_PATTERN = /\bevery\s+(day|other day|week|other week|two weeks|month|other month)\b|\b(biweekly|weekly|monthly|daily)\b/i;
const SINCE_MONTH_PATTERN = new RegExp(`\\bsince\\s+(${MONTH_NAMES.join("|")})\\b`, "i");
const RELATIVE_DAY_PATTERN = /\b(today|yesterday|tomorrow)\b/i;
const AMOUNT_PATTERN = /\$\s?([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)|([0-9]+(?:\.[0-9]{1,2})?)\s?(?:dollars|dollar|bucks)\b/i;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function relativeDate(word: string, now: Date): string {
  const d = new Date(now);
  if (word === "yesterday") d.setUTCDate(d.getUTCDate() - 1);
  if (word === "tomorrow") d.setUTCDate(d.getUTCDate() + 1);
  return isoDate(d);
}

function mostRecentMonthStart(monthName: string, now: Date): string {
  const monthIndex = MONTH_NAMES.indexOf(monthName.toLowerCase());
  const year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, monthIndex, 1));
  if (candidate.getTime() > now.getTime()) candidate.setUTCFullYear(year - 1);
  return isoDate(candidate);
}

function frequencyFromToken(token: string): { frequency: "weekly" | "biweekly" | "monthly" | "custom-days"; intervalDays: number | null } {
  const t = token.toLowerCase();
  if (t === "week" || t === "weekly") return { frequency: "weekly", intervalDays: null };
  if (t === "other week" || t === "two weeks" || t === "biweekly") return { frequency: "biweekly", intervalDays: null };
  if (t === "month" || t === "monthly") return { frequency: "monthly", intervalDays: null };
  if (t === "other month") return { frequency: "custom-days", intervalDays: 60 };
  if (t === "other day") return { frequency: "custom-days", intervalDays: 2 };
  return { frequency: "custom-days", intervalDays: 1 }; // "day" / "daily"
}

export type ExpenseTextDraft =
  | {
      kind: "transaction";
      description: string;
      amount: number;
      direction: "income" | "expense";
      categoryGuess: string;
      date: string;
      confidence: "high" | "medium" | "low";
    }
  | {
      kind: "recurring_rule";
      description: string;
      amount: number;
      direction: "income" | "expense";
      categoryGuess: string;
      frequency: "weekly" | "biweekly" | "monthly" | "custom-days";
      intervalDays: number | null;
      startDate: string;
      confidence: "high" | "medium" | "low";
    };

export function parseExpenseText(
  text: string,
  options: { now?: Date } = {},
): { ok: true; draft: ExpenseTextDraft } | { ok: false; error: string } {
  const now = options.now ?? new Date();
  const raw = String(text || "").trim();
  if (!raw) {
    return { ok: false, error: 'Enter a line like "$45 lunch with client yesterday" or "$500 every week since April."' };
  }

  const amountMatch = AMOUNT_PATTERN.exec(raw);
  if (!amountMatch) {
    return { ok: false, error: "Couldn't find a dollar amount in that line." };
  }
  const amountText = (amountMatch[1] || amountMatch[2] || "").replace(/,/g, "");
  const amount = Number(amountText);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: "Couldn't read a valid amount from that line." };
  }

  const direction: "income" | "expense" = INCOME_PATTERN.test(raw) ? "income" : "expense";

  const description = raw
    .replace(amountMatch[0], "")
    .replace(RECURRENCE_PATTERN, "")
    .replace(SINCE_MONTH_PATTERN, "")
    .replace(RELATIVE_DAY_PATTERN, "")
    .replace(/\s{2,}/g, " ")
    .trim() || "Expense";

  const recurrenceMatch = RECURRENCE_PATTERN.exec(raw);
  if (recurrenceMatch) {
    const token = (recurrenceMatch[1] || recurrenceMatch[2] || "").toLowerCase();
    const { frequency, intervalDays } = frequencyFromToken(token);
    const sinceMatch = SINCE_MONTH_PATTERN.exec(raw);
    const startDate = sinceMatch ? mostRecentMonthStart(sinceMatch[1], now) : isoDate(now);
    return {
      ok: true,
      draft: {
        kind: "recurring_rule",
        description,
        amount,
        direction,
        categoryGuess: "Uncategorized",
        frequency,
        intervalDays,
        startDate,
        confidence: "high",
      },
    };
  }

  const dateMatch = RELATIVE_DAY_PATTERN.exec(raw);
  const date = dateMatch ? relativeDate(dateMatch[1].toLowerCase(), now) : isoDate(now);

  return {
    ok: true,
    draft: {
      kind: "transaction",
      description,
      amount,
      direction,
      categoryGuess: "Uncategorized",
      date,
      confidence: "medium",
    },
  };
}

export type ReceiptDraft = {
  vendor: string;
  amount: number;
  direction: "income" | "expense";
  date: string;
  categoryGuess: string;
  confidence: "high" | "medium" | "low";
};

const RECEIPT_MODEL_ID = "z-ai/glm-5.2";
const RECEIPT_EXTRACTION_PROMPT =
  'Read this receipt image and return ONLY a JSON object (no prose, no markdown fences) with exactly these keys: ' +
  '{"vendor": string, "amount": number, "direction": "income" or "expense", "date": "YYYY-MM-DD", "categoryGuess": string, "confidence": "high" or "medium" or "low"}. ' +
  'Use "expense" unless the receipt is clearly a refund or payment received. If you cannot read a field confidently, make your best guess and set confidence to "low".';

function liveProvidersEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.PHANTOM_LIVE_PROVIDERS_ENABLED === "true" && env.PHANTOM_OPENROUTER_TRANSPORT_ENABLED === "true";
}

function parseReceiptModelOutput(content: string): ReceiptDraft | null {
  try {
    const parsed = JSON.parse(content.trim().replace(/^```json\s*|```$/g, ""));
    const amount = Number(parsed.amount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    return {
      vendor: String(parsed.vendor || "Unknown vendor").slice(0, 160),
      amount,
      direction: parsed.direction === "income" ? "income" : "expense",
      date: /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : new Date().toISOString().slice(0, 10),
      categoryGuess: String(parsed.categoryGuess || "Uncategorized").slice(0, 80),
      confidence: parsed.confidence === "high" || parsed.confidence === "low" ? parsed.confidence : "medium",
    };
  } catch {
    return null;
  }
}

export async function parseReceiptImage(
  dataUrl: string,
  options: { fetcher?: typeof fetch; env?: NodeJS.ProcessEnv } = {},
): Promise<{ available: true; draft: ReceiptDraft } | { available: false; reason: string }> {
  const env = options.env ?? process.env;
  if (!liveProvidersEnabled(env)) {
    return { available: false, reason: "AI parsing isn't enabled yet. Fill in the details manually below." };
  }
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return { available: false, reason: "AI parsing isn't configured yet. Fill in the details manually below." };
  }

  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: RECEIPT_MODEL_ID,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: RECEIPT_EXTRACTION_PROMPT },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 300,
        temperature: 0,
      }),
    });
    if (!response.ok) {
      return { available: false, reason: `The AI provider returned an error (HTTP ${response.status}). Fill in the details manually below.` };
    }
    const payload = await response.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      return { available: false, reason: "The AI provider returned an empty response. Fill in the details manually below." };
    }
    const draft = parseReceiptModelOutput(content);
    if (!draft) {
      return { available: false, reason: "Couldn't read structured data from that receipt. Fill in the details manually below." };
    }
    return { available: true, draft };
  } catch {
    return { available: false, reason: "Couldn't reach the AI provider. Fill in the details manually below." };
  }
}
