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

const { parseReceiptImage } = await import("../src/connectors/finance-smart-entry.js");

// AI parsing disabled (flags off) must degrade gracefully AND must never
// attempt a network call -- a spy fetcher proves this, not just the result shape.
{
  let fetchCalled = false;
  const spyFetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch must not be called when live providers are disabled");
  }) as typeof fetch;
  const result = await parseReceiptImage("data:image/png;base64,AAAA", {
    fetcher: spyFetch,
    env: { PHANTOM_LIVE_PROVIDERS_ENABLED: "false", PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true", OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
  });
  assert(result.available === false, "receipt parsing must report unavailable when live providers are disabled");
  assert(fetchCalled === false, "receipt parsing must not attempt a network call at all when live providers are disabled");
}

// AI parsing enabled: a mocked OpenRouter response must produce a structured draft
{
  const mockFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    assert(url === "https://openrouter.ai/api/v1/chat/completions", "must call the OpenRouter chat completions endpoint");
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ vendor: "Home Depot", amount: 84.12, direction: "expense", date: "2026-07-14", categoryGuess: "Equipment", confidence: "high" }) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const result = await parseReceiptImage("data:image/png;base64,AAAA", {
    fetcher: mockFetch,
    env: { PHANTOM_LIVE_PROVIDERS_ENABLED: "true", PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true", OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
  });
  assert(result.available === true, "receipt parsing must succeed with providers enabled and a valid mock response");
  if (result.available) {
    assert(result.draft.vendor === "Home Depot");
    assert(result.draft.amount === 84.12);
  }
}

// A malformed provider response must degrade to unavailable, not throw
{
  const brokenFetch = (async () => new Response("not json", { status: 200 })) as typeof fetch;
  const result = await parseReceiptImage("data:image/png;base64,AAAA", {
    fetcher: brokenFetch,
    env: { PHANTOM_LIVE_PROVIDERS_ENABLED: "true", PHANTOM_OPENROUTER_TRANSPORT_ENABLED: "true", OPENROUTER_API_KEY: "test-key" } as NodeJS.ProcessEnv,
  });
  assert(result.available === false, "a malformed provider response must degrade to unavailable rather than throw");
}

console.log(JSON.stringify({ ok: true, suite: "finance-smart-entry" }));
