/** History events and the legacy hash probe must acknowledge an already mounted route. */
export function bindWorkspaceRoutes({ host = window, getRenderedRoute, isTransitioning = () => false, cancelTransition = () => {}, page, overlay, home }) {
  let handled = "", mounted = getRenderedRoute(), pending = null;
  const acknowledge = hash => { handled = hash; mounted = getRenderedRoute(); pending = null; };
  const route = event => {
    const hash = host.location.hash || "";
    if (pending === hash) { if (!isTransitioning()) acknowledge(hash); return; }
    if (!event && isTransitioning()) return;
    if (hash === handled && mounted === getRenderedRoute() && !isTransitioning()) return;
    const match = hash.match(/^#(page|ws)\/([a-z-]+)/);
    const target = match ? `${match[1]}/${match[2]}` : "";
    if (target === getRenderedRoute()) { if (isTransitioning()) cancelTransition(); acknowledge(hash); return; }
    pending = hash;
    if (match?.[1] === "page") page(match[2]);
    else if (match) overlay(match[2]);
    else home();
    if (!isTransitioning()) acknowledge(hash);
  };
  host.addEventListener("popstate", route);
  host.addEventListener("hashchange", route);
  const timer = host.setInterval(() => {
    const hash = host.location.hash || "";
    // Empty hashes also acknowledge internal Home navigation. Query-based
    // initial views may intentionally render a page without adding a hash.
    if (!hash && pending !== hash) acknowledge(hash);
    else if (/^#(?:page|ws)\//.test(hash) || pending === hash) route();
  }, 200);
  return () => { host.clearInterval(timer); host.removeEventListener("popstate", route); host.removeEventListener("hashchange", route); };
}

export function hasTransientWorkspaceWork(root) {
  if (root.querySelector("[data-business-editor], [data-cw-form], [data-preserve-workspace], form[aria-busy='true']")) return true;
  const focused = root.ownerDocument.activeElement;
  if (root.contains(focused) && focused.closest?.("form")) return true;
  return [...root.querySelectorAll("form input, form textarea, form select")].some(field => {
    if (field.disabled || ["hidden", "submit", "button", "reset"].includes(field.type)) return false;
    if (field.type === "file") return Boolean(field.files?.length);
    if (["checkbox", "radio"].includes(field.type)) return field.checked !== field.defaultChecked;
    if (field.tagName === "SELECT") {
      const options = [...field.options], defaults = options.map((option, index) => option.defaultSelected ? index : -1).filter(index => index >= 0);
      if (!defaults.length && !field.multiple && options.length) defaults.push(0);
      return options.some((option, index) => option.selected !== defaults.includes(index));
    }
    return field.value !== field.defaultValue;
  });
}

/** A background update can wait; a draft must never move into another business. */
export function createWorkspaceContinuity({ getRoot, getTenant, refreshChrome, render }) {
  let pending = null;
  const context = root => `${root.dataset.workspaceTenant}:${root.dataset.pageWs || root.dataset.consoleView || "dashboard"}`;
  const clear = () => {
    if (!pending) return;
    pending.observer.disconnect(); pending.root.removeEventListener("focusout", pending.check);
    pending.notice.remove(); pending = null;
  };
  function defer() {
    const root = getRoot();
    if (!root || root.dataset.workspaceTenant !== getTenant() || !hasTransientWorkspaceWork(root)) { clear(); return false; }
    if (pending && (pending.root !== root || pending.context !== context(root))) clear();
    if (!pending) {
      const notice = root.ownerDocument.createElement("div");
      notice.className = "business-notice"; notice.dataset.workspaceUpdatesPending = ""; notice.setAttribute("role", "status");
      notice.textContent = "Background updates are waiting. Your current work is preserved.";
      const entry = { root, context: context(root), notice, observer: null, check: null };
      entry.check = () => queueMicrotask(() => {
        if (pending !== entry) return;
        if (!root.isConnected || getRoot() !== root || root.dataset.workspaceTenant !== getTenant() || context(root) !== entry.context) { clear(); return; }
        if (!hasTransientWorkspaceWork(root)) { clear(); render(); }
      });
      entry.observer = new MutationObserver(entry.check);
      pending = entry;
      root.prepend(notice);
      entry.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-preserve-workspace", "aria-busy", "disabled"] });
      root.addEventListener("focusout", entry.check);
    }
    refreshChrome();
    return true;
  }
  return { defer, clear };
}
