# PhantomForce public AI proxy

Lets `phantomforce.online` use **GLM 5.2 via OpenRouter** without ever putting
the API key in the browser. The key lives only as a Cloudflare Worker secret.

## Built-in limits (cost + abuse protection)
- **5 prompts per visitor per day** (by IP)
- **Global daily cap** (`GLOBAL_DAILY_CAP = 800`) so total spend is bounded
- **160-token replies** (tiny per-call cost)
- **Business-only**, ≤2 sentences, no personal/identifying data

## Deploy (one time, ~5 minutes)

You need a free Cloudflare account. From this `ai-proxy/` folder:

```bash
# 1. log in
npx wrangler login

# 2. create the rate-limit store, then paste the printed id into wrangler.toml (PF_KV id)
npx wrangler kv namespace create PF_KV

# 3. set your OpenRouter key as a secret (paste it when prompted — never goes in code)
npx wrangler secret put OPENROUTER_API_KEY

# 4. deploy
npx wrangler deploy
```

Wrangler prints a URL like `https://phantomforce-ai.<your-account>.workers.dev`.

## Turn it on
Open `../void.js`, set:

```js
const AI_ENDPOINT = "https://phantomforce-ai.<your-account>.workers.dev";
```

Commit + deploy the site. Done — typing in the void now talks to live GLM 5.2,
capped. Until `AI_ENDPOINT` is set, the void uses the built-in local responder
(free, always works), so the site is never broken.

## Tuning
Edit the constants at the top of `worker.js`:
`PER_USER_DAILY`, `GLOBAL_DAILY_CAP`, `MAX_TOKENS`, `MODEL`, `ALLOWED_ORIGINS`,
`SYSTEM_PROMPT`.

## Security
- The key is a Worker **secret** — never committed, never sent to the browser.
- CORS is locked to the PhantomForce origins.
- If the key is unset or the limit is hit, the site falls back gracefully.
