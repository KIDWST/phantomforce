import { currentTenantId } from "./store.js?v=phantom-live-20260723-58";

const STORAGE_KEY = "pf.phantomLiveAgents.v1";
const esc = (value = "") => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const nowIso = () => new Date().toISOString();

const TEMPLATE_LIBRARY = [
  {
    id: "operator",
    name: "Business Operator",
    role: "Owner-side operator",
    audience: "Small business owner",
    prompt: "Keeps the business organized, prepares follow-ups, drafts work, and hands real actions to Hermes for approval.",
    voice: "calm, direct, low-drama",
    tools: ["phantom_chat", "memory", "approvals", "hermes_handoff"],
  },
  {
    id: "sales",
    name: "Sales Rep",
    role: "Lead qualifier",
    audience: "Prospects and warm leads",
    prompt: "Qualifies pain, budget, timing, and next step without promising delivery that has not been approved.",
    voice: "warm, concise, confident",
    tools: ["phantom_chat", "crm_preview", "proposal_draft", "approvals"],
  },
  {
    id: "guide",
    name: "Product Guide",
    role: "Onboarding guide",
    audience: "New users",
    prompt: "Explains what the workspace can do, points users to the right surface, and escalates broken setup to the owner.",
    voice: "friendly, plain-English, patient",
    tools: ["phantom_chat", "knowledge_card", "support_handoff"],
  },
];

const DEFAULT_AGENT = {
  id: "pla-business-operator",
  status: "draft",
  visibility: "private",
  name: "Phantom Live Operator",
  role: "Business operator",
  audience: "Jordan and invited workspace users",
  form: "hologram",
  voice: "calm, direct, low-drama",
  personality: {
    warmth: 70,
    directness: 82,
    caution: 88,
    initiative: 64,
    expressiveness: 48,
  },
  modelRoute: "hybrid",
  memoryScope: "session_plus_user",
  knowledge: ["Workspace profile", "Approved memories", "Current page context"],
  tools: ["phantom_chat", "memory", "approvals", "hermes_handoff"],
  permissions: {
    conversation: true,
    voice: true,
    memory: true,
    tools: false,
    externalActions: false,
    remoteChannels: false,
  },
  goals: ["Answer clearly", "Prepare approved work", "Never fake execution"],
  disclosure: "I am an AI agent in PhantomForce. I can talk and prepare work; real external actions require approval/autopilot policy.",
  lastTest: null,
  version: 1,
  createdAt: nowIso(),
  updatedAt: nowIso(),
};

const ui = {
  selectedId: DEFAULT_AGENT.id,
  tab: "creator",
  message: "",
  testInput: "Create a safe follow-up plan for a small business lead.",
  runtimeState: "ready",
};

function safeId(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || `agent-${Date.now()}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const agents = Array.isArray(parsed.agents) && parsed.agents.length ? parsed.agents : [clone(DEFAULT_AGENT)];
    return { agents, selectedId: parsed.selectedId || agents[0].id };
  } catch {
    return { agents: [clone(DEFAULT_AGENT)], selectedId: DEFAULT_AGENT.id };
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, updatedAt: nowIso(), tenantId: currentTenantId() }));
}

function activeAgent(state) {
  return state.agents.find((agent) => agent.id === ui.selectedId) || state.agents[0] || clone(DEFAULT_AGENT);
}

function updateAgent(mutator) {
  const state = loadState();
  const agent = activeAgent(state);
  mutator(agent);
  agent.updatedAt = nowIso();
  saveState({ ...state, selectedId: agent.id });
}

function setField(agent, field, value) {
  if (field.includes(".")) {
    const [group, key] = field.split(".");
    agent[group] = { ...(agent[group] || {}), [key]: value };
    return;
  }
  agent[field] = value;
}

function readiness(agent) {
  const checks = [
    ["Identity", Boolean(agent.name && agent.role && agent.audience)],
    ["Behavior", Boolean(agent.voice && agent.disclosure && agent.goals?.length)],
    ["Memory boundary", Boolean(agent.memoryScope && agent.knowledge?.length)],
    ["Safety", agent.permissions?.externalActions === false && agent.permissions?.remoteChannels === false],
    ["Tested", Boolean(agent.lastTest)],
  ];
  const passed = checks.filter(([, ok]) => ok).length;
  return { checks, passed, total: checks.length, label: passed >= 4 ? "ready to test" : "needs setup" };
}

function runtimeLabel(agent) {
  if (agent.status === "active") return "Live locally";
  if (agent.status === "paused") return "Paused";
  if (agent.status === "testing") return "Testing";
  if (agent.status === "archived") return "Archived";
  return "Draft";
}

function canSpeak() {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function speak(text) {
  if (!canSpeak()) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 420));
  utterance.rate = 0.94;
  utterance.pitch = 0.92;
  window.speechSynthesis.speak(utterance);
  return true;
}

function deterministicReply(agent, input) {
  const prompt = String(input || "").trim();
  const goal = agent.goals?.[0] || "answer clearly";
  return `${agent.name}: I can help with "${prompt || "this request"}." First I will ${goal.toLowerCase()}. If this needs tools, sending, posting, uploading, payments, or access changes, I will hand it to Hermes for approval/autopilot instead of pretending I did it.`;
}

function templateButton(template) {
  return `<button type="button" class="pla-template" data-pla-template="${esc(template.id)}">
    <b>${esc(template.name)}</b>
    <span>${esc(template.role)}</span>
    <i>${esc(template.prompt)}</i>
  </button>`;
}

function field(label, fieldName, value, type = "text") {
  return `<label class="pla-field"><span>${esc(label)}</span><input type="${type}" value="${esc(value)}" data-pla-field="${esc(fieldName)}" /></label>`;
}

function range(label, fieldName, value) {
  return `<label class="pla-range"><span>${esc(label)} <b>${Number(value || 0)}</b></span><input type="range" min="0" max="100" value="${Number(value || 0)}" data-pla-range="${esc(fieldName)}" /></label>`;
}

function permission(label, key, enabled, risk) {
  return `<label class="pla-permission ${enabled ? "is-on" : ""}">
    <input type="checkbox" data-pla-permission="${esc(key)}" ${enabled ? "checked" : ""} />
    <span><b>${esc(label)}</b><i>${esc(risk)}</i></span>
  </label>`;
}

function creatorTab(agent) {
  return `<div class="pla-grid">
    <section class="pla-panel pla-builder">
      <header><p>Agent Creator</p><h3>Build a living AI worker</h3><span>Local deterministic draft · no external actions</span></header>
      <div class="pla-templates">${TEMPLATE_LIBRARY.map(templateButton).join("")}</div>
      <div class="pla-form">
        ${field("Display name", "name", agent.name)}
        ${field("Role", "role", agent.role)}
        ${field("Audience", "audience", agent.audience)}
        ${field("Visual form", "form", agent.form)}
        ${field("Voice style", "voice", agent.voice)}
        <label class="pla-field pla-wide"><span>Disclosure</span><textarea data-pla-textarea="disclosure">${esc(agent.disclosure)}</textarea></label>
      </div>
      <div class="pla-ranges">
        ${range("Warmth", "personality.warmth", agent.personality?.warmth)}
        ${range("Directness", "personality.directness", agent.personality?.directness)}
        ${range("Caution", "personality.caution", agent.personality?.caution)}
        ${range("Initiative", "personality.initiative", agent.personality?.initiative)}
      </div>
    </section>
    <section class="pla-panel">
      <header><p>Permissions</p><h3>Conversation is not action</h3><span>Consequential work stays gated</span></header>
      <div class="pla-permissions">
        ${permission("Text conversation", "conversation", agent.permissions?.conversation, "low risk")}
        ${permission("Local browser voice", "voice", agent.permissions?.voice, "device only")}
        ${permission("Workspace memory", "memory", agent.permissions?.memory, "scoped")}
        ${permission("Approved tools", "tools", agent.permissions?.tools, "requires Hermes")}
        ${permission("External actions", "externalActions", agent.permissions?.externalActions, "locked off by default")}
        ${permission("Remote channels", "remoteChannels", agent.permissions?.remoteChannels, "locked off by default")}
      </div>
      <div class="pla-boundary">
        <b>Hard boundary</b>
        <span>This slice does not send email, post, upload, charge, scan, access microphones silently, or connect public users to private memory.</span>
      </div>
    </section>
  </div>`;
}

function runtimeTab(agent) {
  const status = readiness(agent);
  const agentJson = JSON.stringify(agent, null, 2);
  return `<div class="pla-grid">
    <section class="pla-panel pla-presence">
      <div class="pla-avatar pla-avatar-${esc(agent.form || "hologram")}" aria-hidden="true">
        <span></span><i></i><b>${esc((agent.name || "PL").slice(0, 2).toUpperCase())}</b>
      </div>
      <header><p>Live Presence</p><h3>${esc(agent.name)}</h3><span>${esc(runtimeLabel(agent))} · ${esc(ui.runtimeState)}</span></header>
      <p>${esc(agent.role)} for ${esc(agent.audience)}.</p>
      <div class="pla-actions">
        <button type="button" data-pla-status="testing">Test</button>
        <button type="button" data-pla-status="active">Activate locally</button>
        <button type="button" data-pla-status="paused">Pause</button>
        <button type="button" data-pla-speak>Speak intro</button>
      </div>
      <div class="pla-readiness">
        <b>${status.passed}/${status.total}</b>
        <span>${esc(status.label)}</span>
      </div>
    </section>
    <section class="pla-panel">
      <header><p>Runtime Contract</p><h3>Inspectable configuration</h3><span>Version ${Number(agent.version || 1)}</span></header>
      <pre class="pla-json">${esc(agentJson)}</pre>
    </section>
  </div>`;
}

function sandboxTab(agent) {
  const reply = agent.lastTest?.reply || "Run a test turn to see the agent answer from its current configuration.";
  return `<div class="pla-grid">
    <section class="pla-panel pla-sandbox">
      <header><p>Test Sandbox</p><h3>Try a safe turn</h3><span>No tools run during sandbox tests</span></header>
      <textarea data-pla-test-input>${esc(ui.testInput)}</textarea>
      <div class="pla-actions">
        <button type="button" data-pla-run-test>Run test turn</button>
        <button type="button" data-pla-speak-test ${canSpeak() ? "" : "disabled"}>Speak result</button>
      </div>
      <article class="pla-transcript">
        <b>${esc(agent.name)}</b>
        <p>${esc(reply)}</p>
      </article>
    </section>
    <section class="pla-panel">
      <header><p>Safety Tests</p><h3>Publish blockers</h3><span>Critical checks must stay visible</span></header>
      <div class="pla-checks">
        ${readiness(agent).checks.map(([label, ok]) => `<span class="${ok ? "is-pass" : "is-warn"}"><b>${ok ? "PASS" : "TODO"}</b>${esc(label)}</span>`).join("")}
        <span class="is-pass"><b>PASS</b>No public private-memory access</span>
        <span class="is-pass"><b>PASS</b>No external actions from sandbox</span>
        <span class="${canSpeak() ? "is-pass" : "is-warn"}"><b>${canSpeak() ? "PASS" : "WARN"}</b>Browser speech support</span>
      </div>
    </section>
  </div>`;
}

function marketplaceTab(agent) {
  return `<div class="pla-grid">
    <section class="pla-panel">
      <header><p>Store / Arsenal</p><h3>Package this agent later</h3><span>Private draft only</span></header>
      <div class="pla-package">
        <span><b>Product</b><i>Phantom Live Agent</i></span>
        <span><b>Template</b><i>${esc(agent.role)}</i></span>
        <span><b>Permissions</b><i>${agent.permissions?.tools ? "Tools need approval" : "Conversation only"}</i></span>
        <span><b>Distribution</b><i>Private / organization-only by default</i></span>
      </div>
      <p class="pla-note">Marketplace packaging will require publisher, version, compatibility, privacy disclosure, permission manifest, tests, support, and review. This button is intentionally not a public publish button.</p>
    </section>
    <section class="pla-panel">
      <header><p>Remote Channels</p><h3>Not connected yet</h3><span>Truthful degraded state</span></header>
      <div class="pla-channel-list">
        ${["PhantomChat", "Website widget", "Discord", "Email", "Phone", "Game overlay"].map((name) => `<span><b>${esc(name)}</b><i>Requires channel setup and approval policy</i></span>`).join("")}
      </div>
    </section>
  </div>`;
}

function render(root) {
  const state = loadState();
  ui.selectedId = ui.selectedId || state.selectedId;
  const agent = activeAgent(state);
  const tabs = [
    ["creator", "Creator"],
    ["runtime", "Runtime"],
    ["sandbox", "Sandbox"],
    ["marketplace", "Store / Arsenal"],
  ];
  root.innerHTML = `<section class="pla-shell">
    <header class="pla-hero">
      <div>
        <p>PHANTOM LIVE AGENT</p>
        <h2>Build your own living AI employee.</h2>
        <span>Create identity, voice, memory boundaries, model routing, permissions, runtime state, and approval-safe handoff from one platform surface.</span>
      </div>
      <div class="pla-hero-card">
        <b>${esc(runtimeLabel(agent))}</b>
        <span>${esc(agent.name)} · ${esc(agent.role)}</span>
        <i>${state.agents.length} local draft${state.agents.length === 1 ? "" : "s"}</i>
      </div>
    </header>
    <nav class="pla-tabs" aria-label="Phantom Live Agent sections">
      ${tabs.map(([id, label]) => `<button type="button" class="${ui.tab === id ? "is-active" : ""}" data-pla-tab="${id}">${label}</button>`).join("")}
      <button type="button" data-pla-new>New agent</button>
      <select data-pla-select>${state.agents.map((item) => `<option value="${esc(item.id)}" ${item.id === agent.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
    </nav>
    ${ui.message ? `<div class="pla-message">${esc(ui.message)}</div>` : ""}
    ${ui.tab === "runtime" ? runtimeTab(agent) : ui.tab === "sandbox" ? sandboxTab(agent) : ui.tab === "marketplace" ? marketplaceTab(agent) : creatorTab(agent)}
  </section>`;
}

function bind(root) {
  root.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("[data-pla-field], [data-pla-textarea]")) {
      updateAgent((agent) => setField(agent, target.dataset.plaField || target.dataset.plaTextarea, target.value));
      render(root);
    }
    if (target.matches("[data-pla-range]")) {
      updateAgent((agent) => setField(agent, target.dataset.plaRange, Number(target.value)));
      render(root);
    }
    if (target.matches("[data-pla-permission]")) {
      updateAgent((agent) => {
        agent.permissions = { ...(agent.permissions || {}), [target.dataset.plaPermission]: target.checked };
        if (target.dataset.plaPermission === "externalActions" && target.checked) {
          agent.permissions.externalActions = false;
          ui.message = "External actions stay locked in this slice. Use Hermes approval/autopilot policy for hands-on work.";
        }
      });
      render(root);
    }
    if (target.matches("[data-pla-test-input]")) ui.testInput = target.value;
  });
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target instanceof HTMLSelectElement && target.matches("[data-pla-select]")) {
      ui.selectedId = target.value;
      const state = loadState();
      saveState({ ...state, selectedId: ui.selectedId });
      render(root);
    }
  });
  root.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-pla-tab], [data-pla-template], [data-pla-status], [data-pla-speak], [data-pla-run-test], [data-pla-speak-test], [data-pla-new]") : null;
    if (!target) return;
    if (target.matches("[data-pla-tab]")) {
      ui.tab = target.dataset.plaTab || "creator";
      render(root);
      return;
    }
    if (target.matches("[data-pla-new]")) {
      const state = loadState();
      const next = { ...clone(DEFAULT_AGENT), id: `pla-${Date.now()}`, name: "New Live Agent", status: "draft", createdAt: nowIso(), updatedAt: nowIso() };
      state.agents.unshift(next);
      ui.selectedId = next.id;
      ui.tab = "creator";
      saveState({ ...state, selectedId: next.id });
      render(root);
      return;
    }
    if (target.matches("[data-pla-template]")) {
      const template = TEMPLATE_LIBRARY.find((item) => item.id === target.dataset.plaTemplate);
      if (template) {
        updateAgent((agent) => {
          agent.id = agent.id || safeId(template.name);
          agent.name = template.name;
          agent.role = template.role;
          agent.audience = template.audience;
          agent.voice = template.voice;
          agent.goals = [template.prompt];
          agent.tools = template.tools;
          agent.version = Number(agent.version || 1) + 1;
        });
        ui.message = `${template.name} template applied. Review permissions before activation.`;
      }
      render(root);
      return;
    }
    if (target.matches("[data-pla-status]")) {
      updateAgent((agent) => {
        agent.status = target.dataset.plaStatus || "draft";
        if (agent.status === "testing") agent.lastTest = { at: nowIso(), reply: deterministicReply(agent, ui.testInput) };
      });
      ui.runtimeState = target.dataset.plaStatus || "ready";
      render(root);
      return;
    }
    if (target.matches("[data-pla-run-test]")) {
      updateAgent((agent) => {
        agent.status = "testing";
        agent.lastTest = { at: nowIso(), input: ui.testInput, reply: deterministicReply(agent, ui.testInput) };
      });
      ui.tab = "sandbox";
      ui.runtimeState = "thinking";
      render(root);
      return;
    }
    if (target.matches("[data-pla-speak], [data-pla-speak-test]")) {
      const agent = activeAgent(loadState());
      const text = target.matches("[data-pla-speak-test]") ? agent.lastTest?.reply : `${agent.name} online. ${agent.disclosure}`;
      ui.message = speak(text || "") ? "Local device speech started." : "Browser speech is unavailable on this device.";
      render(root);
    }
  });
}

export function renderPhantomLiveAgent(root) {
  if (!root) return;
  if (!root.dataset.plaBound) {
    root.dataset.plaBound = "1";
    bind(root);
  }
  render(root);
}
