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
