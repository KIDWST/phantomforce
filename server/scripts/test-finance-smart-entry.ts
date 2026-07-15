const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};

const { parseExpenseText } = await import("../src/connectors/finance-smart-entry.js");

// No dollar amount at all
{
  const result = parseExpenseText("just a note with no money in it");
  assert(result.ok === false, "text with no dollar amount must fail to parse");
}

// Simple one-off expense with a relative date
{
  const now = new Date("2026-07-15T12:00:00Z");
  const result = parseExpenseText("$45 lunch with client yesterday", { now });
  assert(result.ok === true, "a simple one-off line must parse");
  if (result.ok) {
    assert(result.draft.kind === "transaction", "a non-recurring line must produce a transaction draft");
    assert(result.draft.amount === 45, "amount must be extracted correctly");
    assert(result.draft.direction === "expense", "direction must default to expense");
    if (result.draft.kind === "transaction") assert(result.draft.date === "2026-07-14", "\"yesterday\" must resolve relative to now");
  }
}

// Income keyword flips direction
{
  const result = parseExpenseText("received $1200 from a client");
  assert(result.ok === true);
  if (result.ok && result.draft.kind === "transaction") assert(result.draft.direction === "income", "an income keyword must set direction to income");
}

// Weekly recurrence with an explicit "since <month>" backfill start
{
  const now = new Date("2026-07-15T12:00:00Z");
  const result = parseExpenseText("$500 every week since April", { now });
  assert(result.ok === true, "a recurring line must parse");
  if (result.ok) {
    assert(result.draft.kind === "recurring_rule", "\"every week\" must produce a recurring rule draft");
    if (result.draft.kind === "recurring_rule") {
      assert(result.draft.frequency === "weekly");
      assert(result.draft.amount === 500);
      assert(result.draft.startDate === "2026-04-01", "\"since April\" must resolve to the most recent April 1st");
    }
  }
}

// Monthly recurrence with no explicit start defaults to today (no invented history)
{
  const now = new Date("2026-07-15T12:00:00Z");
  const result = parseExpenseText("$1200 rent every month", { now });
  assert(result.ok === true);
  if (result.ok && result.draft.kind === "recurring_rule") {
    assert(result.draft.frequency === "monthly");
    assert(result.draft.startDate === "2026-07-15", "with no \"since\", startDate must default to today, not an invented history");
  }
}

// "every other week" maps to biweekly
{
  const result = parseExpenseText("$80 every other week for cleaning");
  assert(result.ok === true);
  if (result.ok && result.draft.kind === "recurring_rule") assert(result.draft.frequency === "biweekly");
}

console.log(JSON.stringify({ ok: true, suite: "finance-smart-entry-text" }));
