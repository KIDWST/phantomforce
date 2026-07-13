import { currentTenantId, currentWs, session, wsName } from "./store.js?v=phantom-live-20260712-227";
import { esc } from "./workspaces.js?v=phantom-live-20260712-227";
import { renderOrganizationGraph } from "./orggraph.js?v=phantom-live-20260712-227";

const state = {
  loading: true,
  error: "",
  brain: null,
  memoryType: "all",
  previewMessage: "",
  preview: null,
  feedback: "",
  notice: "",
};

function tenantQuery(path) {
  const joiner = path.includes("?") ? "&" : "?";
  return path + joiner + "tenant_id=" + encodeURIComponent(currentTenantId());
}

function tenantPayload(payload = {}) {
  return { ...payload, tenant_id: currentTenantId() };
}

function syncBrainTenant() {
  const tenant = currentTenantId();
  if (state.tenant === tenant) return;
  state.tenant = tenant;
  state.loading = true;
  state.error = "";
  state.brain = null;
  state.preview = null;
  state.feedback = "";
  state.notice = "";
}

function authHeaders(extra = {}) {
  const token = session.token();
  return { ...extra, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function brainFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) throw new Error(data?.error || `Memory request failed (${response.status})`);
  return data;
}

async function loadBrain() {
  const data = await brainFetch(tenantQuery("/phantom-ai/brain/status"));
  state.brain = data.brain;
  state.loading = false;
  state.error = "";
}

function badge(value, tone = "") {
  return `<span class="brain-badge ${tone ? `is-${esc(tone)}` : ""}">${esc(value)}</span>`;
}

function stat(label, value, sub = "") {
  return `<article class="brain-stat"><span>${esc(label)}</span><b>${esc(value)}</b>${sub ? `<i>${esc(sub)}</i>` : ""}</article>`;
}

function memoryRows(memories) {
  const filter = state.memoryType;
  const items = (memories || []).filter((memory) => filter === "all" || memory.type === filter);
  return items.map((memory) => `
    <article class="brain-memory" data-memory-id="${esc(memory.id)}">
      <div>
        ${badge(memory.type)}
        <p>${esc(memory.text)}</p>
        <small>${Math.round((memory.confidence || 0) * 100)}% confidence · weight ${Math.round((memory.weight || 0) * 100)} · used ${memory.useCount || 0}x</small>
      </div>
      <div class="brain-memory-actions">
        <button class="btn btn-quiet" data-brain-edit="${esc(memory.id)}">Edit</button>
        <button class="btn btn-quiet" data-brain-forget="${esc(memory.id)}">Forget</button>
      </div>
    </article>`).join("") || `<div class="ws-empty">No active memories in this filter.</div>`;
}

function profileList(profile) {
  const rows = [
    ["Tone", profile?.tonePreference || "direct_human"],
    ["Detail", profile?.detailDepthPreference || "balanced"],
    ["Format", profile?.outputFormatPreference || "concise_operator_cards"],
    ["Approval", profile?.approvalStrictness || "approval_first"],
    ["Risk", profile?.riskTolerance || "low_for_external_actions"],
    ["Debugging", profile?.preferredDebuggingStyle || "exact_commands_then_interpretation"],
    ["Media", profile?.preferredMediaWorkflow || "manual_subscription_safe"],
  ];
  return rows.map(([key, value]) => `<div class="brain-kv"><span>${esc(key)}</span><b>${esc(value)}</b></div>`).join("");
}

/* Backend/vendor identity (Fastify, rembg's Python command, ai-proxy, n8n,
   Higgsfield) is owner-only surface area — it lives exclusively in the
   Developer tab (main.js buildDevPrograms). This tab only shows
   business-facing operational counts, never implementation identity. */
function healthRows(health) {
  const rows = [
    ["Hermes ledger", health?.hermesLedger?.exists ? "ready" : "empty"],
    ["Automation", `${health?.automation?.enabledCount || 0}/${health?.automation?.jobCount || 0} enabled`],
    ["Workers", health?.workerLedger ? `${health.workerLedger.totalWorkers} mapped` : "status shell"],
    ["Approvals", `${health?.approvals?.pendingCount || 0} pending`],
  ];
  return rows.map(([key, value]) => `<div class="brain-kv"><span>${esc(key)}</span><b>${esc(value)}</b></div>`).join("");
}

function recentEvents(events) {
  return (events || []).slice(0, 8).map((event) => `
    <article class="brain-event">
      ${badge(event.surface)}
      <b>${esc(event.summary)}</b>
      <small>${esc(event.type)} · ${esc(event.outcome || "recorded")} · ${new Date(event.timestamp).toLocaleString()}</small>
    </article>`).join("") || `<div class="ws-empty">No routing events yet.</div>`;
}

function contextPreviewHtml(preview) {
  if (!preview) return `<div class="ws-empty">Type a message to see what Phantom would inject before answering. No LLM call happens here.</div>`;
  return `
    <div class="brain-preview-pack">
      <div class="brain-preview-head">
        ${badge(preview.suggestedIntent || "chat")}
        ${badge(preview.riskLevel || "low", preview.needsApproval ? "warn" : "ok")}
        ${preview.needsApproval ? badge("approval required", "warn") : badge("local/chat safe", "ok")}
      </div>
      <pre>${esc(preview.microPrompt || "")}</pre>
      <div class="brain-debug">
        ${(preview.relevantMemories || []).slice(0, 6).map((memory) => `<span>${esc(memory.type)} · ${esc(memory.text.slice(0, 80))}</span>`).join("")}
      </div>
    </div>`;
}

function renderShell(root) {
  const brain = state.brain || {};
  const status = brain.brainStatus || {};
  const memories = brain.memoryVault?.memories || [];
  const profile = brain.behavioralProfile || {};
  const health = brain.systemBrainHealth || {};
  const memoryTypes = ["all", "fact", "preference", "rule", "correction", "safety", "tool_state", "media_style", "workflow", "project"];

  root.innerHTML = `
    <div class="brain-shell">
      ${state.error ? `<div class="brain-alert">${esc(state.error)}</div>` : ""}
      ${state.notice ? `<div class="brain-notice">${esc(state.notice)}</div>` : ""}
      <section class="brain-hero">
        <div>
          <p class="overlay-kicker">Adaptive operator memory · ${esc(wsName(currentWs()))}</p>
          <h3>Memory & Routing</h3>
          <p>Real memory, context composition, feedback, health, proof logs, and approval impulse control. No fake model-weight claims.</p>
        </div>
        <button class="btn btn-primary" data-brain-refresh>Refresh</button>
      </section>

      <section class="brain-card brain-orggraph">
        <p class="overlay-kicker">Organization graph — what the brain can see</p>
        <div data-orggraph-mount></div>
      </section>

      <div class="brain-stat-grid">
        ${stat("Status", status.active ? "Active" : "Offline", status.mode || "application layer")}
        ${stat("Memories", status.memoryCount ?? memories.length, "active vault records")}
        ${stat("Events", status.brainEventCount ?? 0, "routing event log")}
        ${stat("Ledger", status.ledgerEventCount ?? 0, "Hermes proof entries")}
        ${stat("Profile", `${Math.round((status.profileConfidence || profile.confidence || 0) * 100)}%`, "confidence")}
        ${stat("Approval", status.approvalMode || "approval-first", "external actions gated")}
      </div>

      <section class="brain-grid">
        <article class="brain-card brain-card-large">
          <div class="brain-card-head">
            <div>
              <p class="overlay-kicker">Memory Vault</p>
              <h4>Edit what Phantom remembers</h4>
            </div>
            <select data-brain-filter>${memoryTypes.map((type) => `<option value="${type}" ${state.memoryType === type ? "selected" : ""}>${type.replace("_", " ")}</option>`).join("")}</select>
          </div>
          <form class="brain-add" data-brain-add>
            <select data-brain-new-type>
              ${memoryTypes.filter((type) => type !== "all").map((type) => `<option value="${type}">${type.replace("_", " ")}</option>`).join("")}
            </select>
            <input data-brain-new-text placeholder="Remember a durable preference, rule, tool fact, or correction..." />
            <button class="btn btn-primary" type="submit">Remember</button>
          </form>
          <div class="brain-memory-list">${memoryRows(memories)}</div>
        </article>

        <article class="brain-card">
          <p class="overlay-kicker">Behavioral Profile</p>
          <h4>How Phantom should work</h4>
          <div class="brain-list">${profileList(profile)}</div>
          <div class="brain-chipline">
            ${(profile.knownAvoidances || []).slice(0, 6).map((item) => badge(item)).join("") || badge("no avoidances yet")}
          </div>
        </article>

        <article class="brain-card">
          <p class="overlay-kicker">Context Preview</p>
          <h4>See what gets injected</h4>
          <form class="brain-preview-form" data-brain-preview>
            <textarea data-brain-preview-message rows="3" placeholder="Example: Help debug rembg again.">${esc(state.previewMessage)}</textarea>
            <button class="btn btn-primary" type="submit">Preview context</button>
          </form>
          ${contextPreviewHtml(state.preview)}
        </article>

        <article class="brain-card">
          <p class="overlay-kicker">Feedback Signals</p>
          <h4>Teach it without creepiness</h4>
          <form class="brain-preview-form" data-brain-feedback>
            <textarea data-brain-feedback-text rows="3" placeholder="Too robotic, make it more human. Or: never auto-create tasks from brainstorming.">${esc(state.feedback)}</textarea>
            <button class="btn" type="submit">Send feedback</button>
          </form>
          <div class="brain-events">${recentEvents(brain.feedbackSignals)}</div>
        </article>

        <article class="brain-card">
          <p class="overlay-kicker">Action Safety</p>
          <h4>Impulse control</h4>
          <div class="brain-safety">
            <b>Requires approval</b>
            ${(brain.actionSafety?.requiresApproval || []).map((item) => `<span>${esc(item)}</span>`).join("")}
            <b>Allowed locally</b>
            ${(brain.actionSafety?.allowedLocally || []).map((item) => `<span>${esc(item)}</span>`).join("")}
            <b>Manual only</b>
            ${(brain.actionSafety?.manualModeOnly || []).map((item) => `<span>${esc(item)}</span>`).join("") || `<span>none</span>`}
          </div>
        </article>

        <article class="brain-card">
          <p class="overlay-kicker">System Health</p>
          <h4>What is actually connected</h4>
          <div class="brain-list">${healthRows(health)}</div>
        </article>

        <article class="brain-card brain-card-large">
          <p class="overlay-kicker">Recent Learnings & Events</p>
          <h4>Proof trail</h4>
          <div class="brain-events">${recentEvents(brain.recentEvents)}</div>
        </article>
      </section>
    </div>`;
}

async function rerender(root) {
  try {
    await loadBrain();
  } catch (error) {
    state.loading = false;
    state.error = error?.message || "Could not load memory and routing.";
  }
  renderShell(root);
  bind(root);
}

async function saveMemory(root, payload) {
  await brainFetch("/phantom-ai/brain/memories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tenantPayload(payload)),
  });
  state.notice = "Memory saved.";
  await rerender(root);
}

async function editMemory(root, id, currentText) {
  const next = prompt("Edit memory:", currentText);
  if (!next || !next.trim()) return;
  await brainFetch(`/phantom-ai/brain/memories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tenantPayload({ text: next.trim() })),
  });
  state.notice = "Memory updated.";
  await rerender(root);
}

async function forgetMemory(root, id) {
  if (!confirm("Forget this memory?")) return;
  await brainFetch(tenantQuery(`/phantom-ai/brain/memories/${encodeURIComponent(id)}`), { method: "DELETE" });
  state.notice = "Memory forgotten.";
  await rerender(root);
}

function bind(root) {
  const graphMount = root.querySelector("[data-orggraph-mount]");
  if (graphMount) renderOrganizationGraph(graphMount);
  root.querySelector("[data-brain-refresh]")?.addEventListener("click", () => rerender(root));
  root.querySelector("[data-brain-filter]")?.addEventListener("change", (event) => {
    state.memoryType = event.target.value || "all";
    renderShell(root);
    bind(root);
  });
  root.querySelector("[data-brain-add]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = root.querySelector("[data-brain-new-text]")?.value?.trim();
    const type = root.querySelector("[data-brain-new-type]")?.value || "fact";
    if (!text) return;
    await saveMemory(root, { text, type, source: "owner_brain_ui", confidence: 0.86, weight: 0.82 });
  });
  root.querySelectorAll("[data-brain-edit]").forEach((button) => button.addEventListener("click", async () => {
    const id = button.dataset.brainEdit;
    const current = state.brain?.memoryVault?.memories?.find((memory) => memory.id === id);
    if (id && current) await editMemory(root, id, current.text);
  }));
  root.querySelectorAll("[data-brain-forget]").forEach((button) => button.addEventListener("click", async () => {
    if (button.dataset.brainForget) await forgetMemory(root, button.dataset.brainForget);
  }));
  root.querySelector("[data-brain-preview]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.previewMessage = root.querySelector("[data-brain-preview-message]")?.value || "";
    const data = await brainFetch("/phantom-ai/brain/context-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tenantPayload({ message: state.previewMessage, surface: "brain" })),
    });
    state.preview = data.context;
    renderShell(root);
    bind(root);
  });
  root.querySelector("[data-brain-feedback]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    state.feedback = root.querySelector("[data-brain-feedback-text]")?.value || "";
    if (!state.feedback.trim()) return;
    await brainFetch("/phantom-ai/brain/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tenantPayload({ kind: "correction", text: state.feedback, surface: "brain" })),
    });
    state.feedback = "";
    state.notice = "Feedback recorded.";
    await rerender(root);
  });
}

export function renderPhantomBrain(root) {
  state.loading = true;
  root.innerHTML = `<div class="brain-shell"><div class="ws-empty">Loading memory and routing...</div></div>`;
  rerender(root);
}
