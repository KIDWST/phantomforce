import { ctx, currentTenantId, session } from "./store.js?v=phantom-live-20261002-236";

// One request boundary covers legacy integrations as well as new modules.
// The header is a selection, never authority: the server checks membership.
export function installBusinessRequestBoundary(host = window) {
  if (host.__businessRequestBoundary || typeof host.fetch !== "function") return;
  const originalFetch = host.fetch.bind(host);
  const pending = new Set();
  let generation = 0;
  let switching = false;
  const invalidate = () => {
    generation += 1;
    switching = true;
    for (const controller of pending) controller.abort();
    pending.clear();
  };
  host.addEventListener("pf:business-switch-start", invalidate);
  host.addEventListener("pf:business-switch-failed", () => { switching = false; });
  host.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, host.location.href);
    const api = url.origin === host.location.origin
      && !/^\/(?:auth(?:\/|$)|session(?:s)?(?:\/|$)|app(?:\/|$)|assets(?:\/|$)|health(?:\/|$))/.test(url.pathname)
      && !/\.(?:html|js|mjs|css|png|jpe?g|webp|svg|ico|woff2?|mp4|webm|json)$/i.test(url.pathname);
    if (!api || !ctx.session) return originalFetch(input, options);
    if (switching) throw new DOMException("Business switch in progress", "AbortError");
    const scope = currentTenantId();
    const started = generation;
    const controller = new AbortController();
    const upstreamSignal = options.signal || (typeof input === "object" ? input.signal : null);
    const abort = () => controller.abort();
    if (upstreamSignal?.aborted) controller.abort();
    upstreamSignal?.addEventListener("abort", abort, { once: true });
    const headers = new Headers(options.headers || (typeof input === "object" ? input.headers : undefined));
    headers.set("x-phantomforce-business", scope);
    pending.add(controller);
    try {
      const response = await originalFetch(input, { ...options, headers, signal: controller.signal });
      if (started !== generation || scope !== currentTenantId()) throw new DOMException("Obsolete business response", "AbortError");
      return response;
    } finally {
      pending.delete(controller);
      upstreamSignal?.removeEventListener("abort", abort);
    }
  };
  host.__businessRequestBoundary = true;
}
