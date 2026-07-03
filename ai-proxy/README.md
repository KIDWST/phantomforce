# PhantomForce public AI proxy

Gives `phantomforce.online` a real brain without ever putting an API key in
the browser. The key lives only in the proxy's environment, and the public
page is **read-only by construction** — the proxy only ever returns text, so
there is nothing a visitor can make it *do*.

Current live path: **Codex** (OpenAI Responses API, `gpt-5.1-codex`) — set
`OPENAI_API_KEY` and `PF_PROVIDER=openai`. The same proxy also speaks native
Anthropic (`PF_PROVIDER=anthropic`) and OpenRouter (`PF_PROVIDER=openrouter`)
if you ever want to switch brains with one env var.

Two builds — use the one that matches your setup:
- **`server.mjs`** — self-hosted Node server, for **Pangolin** (recommended for you).
- **`worker.js`** — Cloudflare Worker (alternative, if you ever use Cloudflare).

## Limits (bot armor — your real visitors never feel them)
- 5 questions per visitor per day (override `PF_PER_USER_DAILY`)
- burst throttle: one question per ~2.5s per visitor (`PF_MIN_GAP_MS`)
- global daily cap (`PF_GLOBAL_DAILY_CAP`, default 1000)
- 220-token replies (`PF_MAX_TOKENS`)
- business-only, ≤3 sentences, no personal data, injection-resistant prompt

## Pangolin path (self-hosted) — what you do

On your always-on box (the one running PhantomForce / behind Pangolin):

```bash
# 1. put your key in ai-proxy/.env (gitignored — see .env.example), or export it:
export OPENAI_API_KEY="your-openai-key"
export PF_PROVIDER="openai"
# optional: PF_MODEL="gpt-5.1-codex-mini" to run cheaper (default gpt-5.1-codex)

# Claude alternative:
# export ANTHROPIC_API_KEY="your-anthropic-key"; export PF_PROVIDER="anthropic"

# 2. run the proxy (Node 18+). Keep it alive with pm2/systemd for 24/7.
node ai-proxy/server.mjs
#   -> listening on http://127.0.0.1:8788
#   test: curl http://127.0.0.1:8788/health
#   -> {"ok":true,"configured":true,"provider":"openai","model":"gpt-5.1-codex",...}
#   test a question:
#   curl -X POST http://127.0.0.1:8788/chat -H 'Content-Type: application/json' \
#        -d '{"message":"how do I stop losing leads?"}'

# 3. in Pangolin: make sure https://ai.phantomforce.online -> 127.0.0.1:8788
#    (already in place if the demo-signup email flow works)
```

The site is already wired: `void.js` posts to `https://ai.phantomforce.online/chat`.
As soon as the proxy restarts with a key, the homepage brain is live — no site
redeploy needed. Until then visitors silently get the built-in local responder.

Keep it alive 24/7 (recommended `pm2`):
```bash
npm i -g pm2
pm2 start ai-proxy/server.mjs --name phantomforce-ai
pm2 save
```

## Notes
- The active key is read from `OPENAI_API_KEY`, `OPENROUTER_API_KEY`,
  `ANTHROPIC_API_KEY`, or `CLAUDE_API_KEY` in the environment — never
  committed, never sent to the browser, never seen by anyone but your server +
  the selected provider.
- CORS is locked to the PhantomForce origins (`PF_ALLOWED_ORIGINS` to change).
- Real client IP for the per-user limit comes from `X-Forwarded-For` (Pangolin sets it).
- If the proxy is down, unreachable, or has no key, the site silently falls
  back to the built-in local responder — the page is never broken.
