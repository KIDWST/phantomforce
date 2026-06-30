# PhantomForce public AI proxy

Lets `phantomforce.online` use **GLM 5.2 via OpenRouter** without ever putting
the API key in the browser. The key lives only in the proxy's environment.

Two builds — use the one that matches your setup:
- **`server.mjs`** — self-hosted Node server, for **Pangolin** (recommended for you).
- **`worker.js`** — Cloudflare Worker (alternative, if you ever use Cloudflare).

## Limits (bot armor — your real visitors never feel them)
- 5 prompts per visitor per day (override `PF_PER_USER_DAILY`)
- global daily cap (`PF_GLOBAL_DAILY_CAP`, default 1000)
- 160-token replies (`PF_MAX_TOKENS`)
- business-only, ≤2 sentences, no personal data

## Pangolin path (self-hosted) — what you do

On your always-on box (the one running PhantomForce / behind Pangolin):

```bash
# 1. set your key in the environment (never in code)
export OPENROUTER_API_KEY="your-openrouter-key"        # or put it in your service's env

# 2. run the proxy (Node 18+). Keep it alive with pm2/systemd for 24/7.
node ai-proxy/server.mjs
#   -> listening on http://127.0.0.1:8788
#   test: curl http://127.0.0.1:8788/health   -> {"ok":true,"configured":true}

# 3. in Pangolin: add a resource/route exposing a public hostname
#    e.g.  https://ai.phantomforce.online   ->   127.0.0.1:8788
```

That's it on your side. **Send me the public URL** (e.g. `https://ai.phantomforce.online`)
and say **"wire it"** — I set `AI_ENDPOINT` in `void.js`, redeploy the site, and the
homepage phantom goes live on GLM 5.2.

Keep it alive 24/7 (recommended `pm2`):
```bash
npm i -g pm2
OPENROUTER_API_KEY="your-openrouter-key" pm2 start ai-proxy/server.mjs --name phantomforce-ai
pm2 save
```

## Notes
- The key is read from `OPENROUTER_API_KEY` in the environment — never committed,
  never sent to the browser, never seen by anyone but your server + OpenRouter.
- CORS is locked to the PhantomForce origins (`PF_ALLOWED_ORIGINS` to change).
- Real client IP for the per-user limit comes from `X-Forwarded-For` (Pangolin sets it).
- Until `AI_ENDPOINT` is set in `void.js`, the site uses the built-in local
  responder (free, always works) — so the site is never broken.
