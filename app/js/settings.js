/* PhantomForce admin settings.
   Local UI preferences only: no provider calls, sends, uploads, or billing. */

import { renderMediaSettings } from "./medialab.js?v=phantom-live-20260712-203";
import { renderCustomizationStudio } from "./customization.js?v=phantom-live-20260712-203";
import { loadPhantomLoop, savePhantomLoop, LOOP_PROVIDERS, modelDisplayLabel, workspaceStorageGetItem, workspaceStorageSetItem } from "./store.js?v=phantom-live-20260712-203";
import { DEFAULT_COMPANION_PREFS, clearCompanionSessionHide, loadCompanionPrefs, resetCompanionPrefs, saveCompanionPrefs } from "./companion-preferences.js?v=phantom-live-20260712-203";

const AI_SETTINGS_KEY = "pf.operator.settings.v1";
const SETTINGS_TAB_KEY = "pf.settings.tab.v1";

const SETTINGS_TABS = [
  { id: "model", label: "Model", category: "AI Brain" },
  { id: "loop", label: "Loop routing", category: "AI Brain" },
  { id: "chat", label: "Chat behavior", category: "AI Brain" },
  { id: "workspace", label: "Workspace Studio", category: "Workspace" },
  { id: "companion", label: "Companion", category: "Workspace" },
  { id: "media", label: "Media & social", category: "Media" },
];

const SETTINGS_CATEGORIES = ["AI Brain", "Workspace", "Media"];

function loadSettingsTab() {
  try {
    const saved = localStorage.getItem(SETTINGS_TAB_KEY);
    return SETTINGS_TABS.some((tab) => tab.id === saved) ? saved : SETTINGS_TABS[0].id;
  } catch {
    return SETTINGS_TABS[0].id;
  }
}

function saveSettingsTab(id) {
  try { localStorage.setItem(SETTINGS_TAB_KEY, id); } catch {}
}

/* Display-only lane names — the real backend/vendor identity behind each
   lane never surfaces outside the owner-only Developer page. The `id`
   values are stable storage keys, not shown to the user. */
const PROVIDERS = [
  {
    id: "claude",
    name: "Phantom Reasoning",
    role: "Strategy, copy, review",
    models: ["Fast", "Balanced", "Deep"],
  },
  {
    id: "codex",
    name: "Phantom Code",
    role: "Code, repo work, implementation",
    models: ["Fast", "Balanced", "Deep"],
  },
  {
    id: "openrouter",
    name: "Phantom Router",
    role: "Flexible cloud routing",
    models: ["Fast", "Balanced", "Deep"],
  },
  {
    id: "local",
    name: "Phantom Local",
    role: "Private, on-device lane",
    models: ["Fast", "Balanced", "Deep"],
  },
];

const DEFAULT_SETTINGS = {
  provider: "claude",
  brainMode: "api",
  models: {
    claude: "Balanced",
    codex: "Balanced",
    openrouter: "Balanced",
    local: "Balanced",
  },
  responseStyle: "operator",
  responseLength: "balanced",
  memoryMode: "business",
  contextDepth: "standard",
  autopilotScope: "safe_repeat",
  externalActionMode: "approval",
  receipts: true,
};

const esc = (value = "") => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function renderSettingsCategories(activeTab) {
  return `
    <nav class="set-category-nav" aria-label="Settings categories">
      ${SETTINGS_CATEGORIES.map((category) => {
        const items = SETTINGS_TABS.filter((item) => item.category === category);
        const hasActiveItem = items.some((item) => item.id === activeTab);
        return `
          <details class="set-category" ${hasActiveItem ? "open" : ""}>
            <summary>
              <span>${esc(category)}</span>
              <span>${items.length}</span>
            </summary>
            <div class="set-category-options">
              ${items.map((item) => `
                <button type="button" class="${item.id === activeTab ? "is-active" : ""}" role="tab" aria-selected="${item.id === activeTab}" data-set-tab="${esc(item.id)}">
                  ${esc(item.label)}
                </button>
              `).join("")}
            </div>
          </details>
        `;
      }).join("")}
    </nav>
  `;
}

function providerFor(id) {
  return PROVIDERS.find((provider) => provider.id === id) || PROVIDERS[0];
}

function normalizeSettings(value) {
  const input = value && typeof value === "object" ? value : {};
  const provider = PROVIDERS.some((item) => item.id === input.provider) ? input.provider : DEFAULT_SETTINGS.provider;
  const brainMode = ["local", "api", "subscription"].includes(input.brainMode) ? input.brainMode : DEFAULT_SETTINGS.brainMode;
  const models = { ...DEFAULT_SETTINGS.models, ...(input.models || {}) };
  for (const option of PROVIDERS) {
    if (!option.models.includes(models[option.id])) models[option.id] = option.models[0];
  }
  return {
    ...DEFAULT_SETTINGS,
    ...input,
    provider,
    brainMode,
    models,
  };
}

function loadOperatorSettings() {
  try {
    return normalizeSettings(JSON.parse(workspaceStorageGetItem(AI_SETTINGS_KEY) || "{}"));
  } catch {
    return normalizeSettings({});
  }
}

function saveOperatorSettings(settings) {
  try { workspaceStorageSetItem(AI_SETTINGS_KEY, JSON.stringify(normalizeSettings(settings))); } catch {}
}

export function getOperatorSettings() {
  return loadOperatorSettings();
}

function optionList(options, selected) {
  return options.map((option) => `<option value="${esc(option.id || option)}" ${(option.id || option) === selected ? "selected" : ""}>${esc(option.label || option)}</option>`).join("");
}

function renderProviderCards(settings) {
  return PROVIDERS.map((provider) => `
    <button class="set-model-card ${settings.provider === provider.id ? "is-active" : ""}" type="button" data-ai-provider="${esc(provider.id)}" aria-pressed="${settings.provider === provider.id ? "true" : "false"}">
      <span class="set-model-orb"></span>
      <b>${esc(provider.name)}</b>
      <i>${esc(provider.role)}</i>
    </button>`).join("");
}

function loopProviderName(id) {
  return LOOP_PROVIDERS.find((p) => p.id === id)?.name || id;
}

function renderSafetySummary(settings) {
  const loop = loadPhantomLoop();
  const externalLabel = {
    approval: "External actions ask first",
    blocked: "External actions blocked",
    owner_rules: "Use owner rules",
  }[settings.externalActionMode] || "External actions ask first";
  const routingLabel = {
    local: "Instant routing (no backend)",
    api: "Connected backend",
    subscription: "Subscription managed",
  }[settings.brainMode] || "Instant routing (no backend)";
  return `
    <div class="set-status-grid">
      <span><b>Loop</b><i>${loop.enabled ? esc(loopProviderName(loop.targetProvider)) : "Off"}</i></span>
      <span><b>Routing</b><i>${esc(routingLabel)} · ${esc(providerFor(settings.provider).name)}</i></span>
      <span><b>Autopilot</b><i>${settings.autopilotScope === "safe_repeat" ? "Safe repeat work only" : "Manual only"}</i></span>
      <span><b>Boundary</b><i>${esc(externalLabel)}</i></span>
    </div>`;
}

function saveMiniAndRender(el, opts, settings) {
  saveOperatorSettings(settings);
  if (typeof opts.onChange === "function") opts.onChange(normalizeSettings(settings));
  renderOperatorMiniSettings(el, opts);
  /* confirmation lives in the panel so nothing can overwrite it */
  const saved = el.querySelector("[data-mini-saved]");
  if (saved) {
    saved.hidden = false;
    setTimeout(() => { saved.hidden = true; }, 2400);
  }
}

export function renderOperatorMiniSettings(el, opts = {}) {
  if (!el) return;
  const settings = loadOperatorSettings();
  const activeProvider = providerFor(settings.provider);
  const activeModel = settings.models[activeProvider.id] || activeProvider.models[0];
  const loop = loadPhantomLoop();
  const brainLabel = {
    local: "Instant",
    api: "Connected",
    subscription: "Subscription",
  }[settings.brainMode] || "Instant";
  const loopModel = LOOP_PROVIDERS.find((p) => p.id === loop.targetProvider) || LOOP_PROVIDERS[0];

  el.innerHTML = `
    <div class="chat-mini-settings">
      <div class="chat-mini-heading">
        <b>Chat settings</b>
        <span>Operator brain</span>
        <em class="chat-mini-saved" data-mini-saved hidden>Saved — applies to the next message</em>
      </div>
      <div class="chat-mini-summary">
        <span><b>${esc(brainLabel)}</b><i>${esc(activeProvider.name)} · ${esc(activeModel)}</i></span>
        <span><b>${loop.enabled ? "Loop on" : "Loop off"}</b><i>${loop.enabled ? esc(loopProviderName(loop.targetProvider)) : "Replies stay with Phantom"}</i></span>
      </div>
      <div class="chat-mini-fields">
        <label class="chat-mini-field"><span>Backend</span>
          <select data-mini-brain>${optionList([
            { id: "local", label: "Instant (no backend)" },
            { id: "api", label: "Connected" },
            { id: "subscription", label: "Subscription" },
          ], settings.brainMode)}</select>
        </label>
        <label class="chat-mini-field"><span>Model</span>
          <select data-mini-provider>${PROVIDERS.map((provider) => `<option value="${esc(provider.id)}" ${provider.id === settings.provider ? "selected" : ""}>${esc(provider.name)}</option>`).join("")}</select>
        </label>
        <label class="chat-mini-field chat-mini-wide"><span>Default model</span>
          <select data-mini-model>${activeProvider.models.map((model) => `<option value="${esc(model)}" ${model === activeModel ? "selected" : ""}>${esc(model)}</option>`).join("")}</select>
        </label>
      </div>
      <div class="chat-mini-loop">
        <label class="chat-mini-switch">
          <input type="checkbox" data-mini-loop-toggle ${loop.enabled ? "checked" : ""}/>
          <span><b>Phantom Loop</b><i>Route this reply through another model, then bring the answer back.</i></span>
        </label>
        ${loop.enabled ? `
        <div class="chat-mini-fields">
          <label class="chat-mini-field"><span>Loop through</span>
            <select data-mini-loop-provider>${LOOP_PROVIDERS.map((p) => `<option value="${esc(p.id)}" ${p.id === loop.targetProvider ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select>
          </label>
          <label class="chat-mini-field"><span>Model</span>
            <select data-mini-loop-model>${loopModel.models.map((m) => `<option value="${esc(m)}" ${m === loop.targetModel ? "selected" : ""}>${esc(modelDisplayLabel(m))}</option>`).join("")}</select>
          </label>
          <label class="chat-mini-field"><span>Depth</span>
            <select data-mini-loop-depth>${optionList([
              { id: "one_pass", label: "1 pass" },
              { id: "two_pass", label: "2 passes" },
              { id: "auto", label: "Auto" },
            ], loop.depth)}</select>
          </label>
          <label class="chat-mini-field"><span>Approval</span>
            <select data-mini-loop-approval>${optionList([
              { id: "safe_auto", label: "Auto for safe reads" },
              { id: "ask_external", label: "Ask before external calls" },
              { id: "manual", label: "Manual every time" },
            ], loop.approvalMode)}</select>
          </label>
        </div>` : ""}
      </div>
      <div class="chat-mini-actions">
        <button class="chat-mini-full" type="button" data-mini-full-settings>Advanced loop routing</button>
      </div>
    </div>`;

  const providerSelect = el.querySelector("[data-mini-provider]");
  if (providerSelect) providerSelect.onchange = () => {
    settings.provider = providerSelect.value;
    saveMiniAndRender(el, opts, settings);
  };

  const brainSelect = el.querySelector("[data-mini-brain]");
  if (brainSelect) brainSelect.onchange = () => {
    settings.brainMode = brainSelect.value;
    saveMiniAndRender(el, opts, settings);
  };

  const modelSelect = el.querySelector("[data-mini-model]");
  if (modelSelect) modelSelect.onchange = () => {
    settings.models[settings.provider] = modelSelect.value;
    saveMiniAndRender(el, opts, settings);
  };

  const saveLoop = (patch) => {
    savePhantomLoop({ ...loop, ...patch });
    renderOperatorMiniSettings(el, opts);
    if (typeof opts.onLoopChange === "function") opts.onLoopChange(loadPhantomLoop());
  };

  const loopToggle = el.querySelector("[data-mini-loop-toggle]");
  if (loopToggle) loopToggle.onchange = () => saveLoop({ enabled: loopToggle.checked });

  const loopProviderSelect = el.querySelector("[data-mini-loop-provider]");
  if (loopProviderSelect) loopProviderSelect.onchange = () => {
    const next = LOOP_PROVIDERS.find((p) => p.id === loopProviderSelect.value) || LOOP_PROVIDERS[0];
    saveLoop({ targetProvider: next.id, targetModel: next.models[0] });
  };

  const loopModelSelect = el.querySelector("[data-mini-loop-model]");
  if (loopModelSelect) loopModelSelect.onchange = () => saveLoop({ targetModel: loopModelSelect.value });

  const loopDepthSelect = el.querySelector("[data-mini-loop-depth]");
  if (loopDepthSelect) loopDepthSelect.onchange = () => saveLoop({ depth: loopDepthSelect.value });

  const loopApprovalSelect = el.querySelector("[data-mini-loop-approval]");
  if (loopApprovalSelect) loopApprovalSelect.onchange = () => saveLoop({ approvalMode: loopApprovalSelect.value });

  const full = el.querySelector("[data-mini-full-settings]");
  if (full) full.onclick = () => {
    if (typeof opts.openSettings === "function") opts.openSettings();
  };
}

const ROUTING_MODES = [
  { id: "phantom_to_external_to_phantom", label: "Phantom → external model → Phantom" },
  { id: "phantom_to_a_to_b_to_phantom", label: "Phantom → model A → model B → Phantom" },
  { id: "multi_model_compare", label: "Multi-model compare" },
  { id: "critic_refiner", label: "Critic / refiner loop" },
];

function renderLoopAdvancedSection() {
  const loop = loadPhantomLoop();
  const adv = loop.advanced;
  return `
    <div class="set-section">
      <div class="set-sec-head">
        <div>
          <h3>Phantom Loop — advanced routing</h3>
          <p class="set-note">Route a chat reply through another model, then bring the answer back to Phantom. This is chat-only — it never creates a task, build plan, or Site Studio action on its own.</p>
        </div>
        <label class="set-switch set-switch-large">
          <input type="checkbox" data-loop-toggle ${loop.enabled ? "checked" : ""}/><span></span>
        </label>
      </div>
      <div class="set-control-grid">
        <label class="set-control"><span>Default loop provider</span>
          <select data-loop-field="targetProvider">${optionList(LOOP_PROVIDERS.map((p) => ({ id: p.id, label: p.name })), loop.targetProvider)}</select>
        </label>
        <label class="set-control"><span>Routing mode</span>
          <select data-loop-adv-field="routingMode">${optionList(ROUTING_MODES, adv.routingMode)}</select>
        </label>
        <label class="set-control"><span>Max loop passes</span>
          <select data-loop-adv-field="maxPasses">${optionList([1, 2, 3, 4].map((n) => ({ id: String(n), label: `${n}` })), String(adv.maxPasses))}</select>
        </label>
        <label class="set-control"><span>Timeout</span>
          <select data-loop-adv-field="timeoutMs">${optionList([
            { id: "10000", label: "10 seconds" },
            { id: "20000", label: "20 seconds" },
            { id: "45000", label: "45 seconds" },
            { id: "90000", label: "90 seconds" },
          ], String(adv.timeoutMs))}</select>
        </label>
        <label class="set-control"><span>Max cost per loop</span>
          <select data-loop-cost>${optionList([
            { id: "", label: "No cap set" },
            { id: "0.25", label: "$0.25" },
            { id: "1", label: "$1.00" },
            { id: "5", label: "$5.00" },
          ], loop.maxCostPerResponse == null ? "" : String(loop.maxCostPerResponse))}</select>
        </label>
      </div>
      <p class="set-note" style="margin-top:10px">Allowed providers</p>
      <div class="set-check-grid">
        ${LOOP_PROVIDERS.map((p) => `<label class="set-inline set-inline-tight"><input type="checkbox" data-loop-allowed="${p.id}" ${adv.allowedProviders.includes(p.id) ? "checked" : ""}/> ${esc(p.name)}</label>`).join("")}
      </div>
      <label class="set-inline set-inline-tight"><input type="checkbox" data-loop-adv-toggle="sharePrivateContext" ${adv.sharePrivateContext ? "checked" : ""}/> Let external models see private business context</label>
      <label class="set-inline set-inline-tight"><input type="checkbox" data-loop-adv-toggle="allowToolCalls" ${adv.allowToolCalls ? "checked" : ""}/> Allow tool calls inside the loop</label>
      <label class="set-inline set-inline-tight"><input type="checkbox" data-loop-adv-toggle="proofLogging" ${adv.proofLogging ? "checked" : ""}/> Keep audit/proof logs for loop routing</label>
      <div class="set-rule-list">
        <span>External API calls, sends, publishes, and file/setting changes still always require approval</span>
        <span>Loop never bypasses the existing approval queue</span>
      </div>
    </div>`;
}

function renderModelTab(settings, activeProvider, activeModel) {
  return `
      <div class="set-section">
        <div class="set-sec-head">
          <div>
            <h3>Model</h3>
            <p class="set-note">Pick the brain lane Phantom should prefer when a task needs reasoning, code, provider routing, or private local work.</p>
          </div>
        </div>
        <div class="set-model-grid">${renderProviderCards(settings)}</div>
        <div class="set-control-grid">
          <label class="set-control"><span>Chat backend</span>
            <select data-ai-field="brainMode">${optionList([
              { id: "local", label: "Instant - answers now, no backend" },
              { id: "api", label: "Connected - backend brain" },
              { id: "subscription", label: "Subscription - managed brain" },
            ], settings.brainMode)}</select>
          </label>
          <label class="set-control"><span>Default model</span>
            <select data-ai-model>${activeProvider.models.map((model) => `<option value="${esc(model)}" ${model === activeModel ? "selected" : ""}>${esc(model)}</option>`).join("")}</select>
          </label>
          <label class="set-control"><span>Response style</span>
            <select data-ai-field="responseStyle">${optionList([
              { id: "operator", label: "Operator - direct and decisive" },
              { id: "coach", label: "Coach - explain the move" },
              { id: "technical", label: "Technical - implementation detail" },
              { id: "sales", label: "Growth - revenue-aware" },
            ], settings.responseStyle)}</select>
          </label>
          <label class="set-control"><span>Response length</span>
            <select data-ai-field="responseLength">${optionList([
              { id: "short", label: "Short" },
              { id: "balanced", label: "Balanced" },
              { id: "deep", label: "Deep" },
            ], settings.responseLength)}</select>
          </label>
        </div>
      </div>`;
}

function renderChatBehaviorTab(settings) {
  return `
      <div class="set-section">
        <div class="set-sec-head">
          <div>
            <h3>Chat behavior</h3>
            <p class="set-note">Basic chatbot controls for memory, context depth, and how much Phantom should carry between commands.</p>
          </div>
        </div>
        <div class="set-control-grid">
          <label class="set-control"><span>Memory</span>
            <select data-ai-field="memoryMode">${optionList([
              { id: "session", label: "This session only" },
              { id: "business", label: "Business memory" },
              { id: "pinned", label: "Pinned facts first" },
            ], settings.memoryMode)}</select>
          </label>
          <label class="set-control"><span>Context depth</span>
            <select data-ai-field="contextDepth">${optionList([
              { id: "light", label: "Light" },
              { id: "standard", label: "Standard" },
              { id: "deep", label: "Deep" },
            ], settings.contextDepth)}</select>
          </label>
          <label class="set-control"><span>External actions</span>
            <select data-ai-field="externalActionMode">${optionList([
              { id: "approval", label: "Ask before external actions" },
              { id: "blocked", label: "Block external actions" },
              { id: "owner_rules", label: "Use owner rules" },
            ], settings.externalActionMode)}</select>
          </label>
          <label class="set-control"><span>Autopilot scope</span>
            <select data-ai-field="autopilotScope">${optionList([
              { id: "safe_repeat", label: "Safe repeat work only" },
              { id: "manual_only", label: "Manual until approved" },
            ], settings.autopilotScope)}</select>
          </label>
        </div>
        <label class="set-inline set-inline-tight"><input type="checkbox" data-ai-toggle="receipts" ${settings.receipts ? "checked" : ""}/> Keep receipts for important actions</label>
        <div class="set-rule-list">
          <span>No public demo sends</span>
          <span>No uploads without a configured lane</span>
          <span>No charges without owner rules</span>
          <span>Autopilot is for safe repeat work</span>
        </div>
        <div class="record-actions">
          <button class="btn btn-quiet" type="button" data-ai-reset>Reset safe defaults</button>
        </div>
      </div>`;
}

function renderCompanionTab() {
  const companion = loadCompanionPrefs();
  return `
    <div class="set-section">
      <div class="set-section-head">
        <div>
          <p class="set-eyebrow">Living Phantom</p>
          <h3>Companion controls</h3>
          <p class="set-note">The Phantom starts docked, stays out of controls, and only reacts to real assistant states. These settings are local UI preferences.</p>
        </div>
        <button class="btn btn-quiet" type="button" data-companion-reset>Reset companion</button>
      </div>
      <div class="set-grid set-grid-two">
        <label class="set-inline"><input type="checkbox" data-companion-toggle="enabled" ${companion.enabled ? "checked" : ""}/> Enable companion</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="visible" ${companion.visible ? "checked" : ""}/> Visible</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="startDocked" ${companion.startDocked ? "checked" : ""}/> Start docked</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="speechEnabled" ${companion.speechEnabled ? "checked" : ""}/> Speech bubbles</label>
        <label class="set-inline"><input type="checkbox" data-companion-toggle="notificationReactions" ${companion.notificationReactions ? "checked" : ""}/> Notification reactions</label>
        <label class="set-field">
          <span>Motion</span>
          <select data-companion-field="motionLevel">${optionList([
            { id: "full", label: "Full motion" },
            { id: "subtle", label: "Subtle motion" },
            { id: "reduced", label: "Reduced motion" },
            { id: "none", label: "No idle motion" },
          ], companion.motionLevel)}</select>
        </label>
        <label class="set-field">
          <span>Size</span>
          <select data-companion-field="size">${optionList([
            { id: "compact", label: "Compact" },
            { id: "standard", label: "Standard" },
            { id: "large", label: "Large" },
          ], companion.size)}</select>
        </label>
        <label class="set-field">
          <span>Home dock</span>
          <select data-companion-field="dockLocation">${optionList([
            { id: "sidebar", label: "Sidebar" },
          ], companion.dockLocation)}</select>
        </label>
        <label class="set-field">
          <span>Personality</span>
          <select data-companion-field="personality">${optionList([
            { id: "professional", label: "Professional" },
            { id: "friendly", label: "Friendly" },
            { id: "playful", label: "Playful" },
            { id: "quiet", label: "Quiet" },
          ], companion.personality)}</select>
        </label>
        <label class="set-field">
          <span>Idle frequency</span>
          <select data-companion-field="idleFrequency">${optionList([
            { id: "low", label: "Low" },
            { id: "normal", label: "Normal" },
            { id: "off", label: "Off" },
          ], companion.idleFrequency)}</select>
        </label>
        <label class="set-field">
          <span>Greeting</span>
          <select data-companion-field="greetingFrequency">${optionList([
            { id: "session", label: "Once per session" },
            { id: "daily", label: "Once per day" },
            { id: "off", label: "Off" },
          ], companion.greetingFrequency)}</select>
        </label>
      </div>
      <div class="set-actions-row">
        <button class="btn btn-quiet" type="button" data-companion-clear-hide>Show again this session</button>
        <button class="btn btn-quiet" type="button" data-companion-quiet>Quiet docked mode</button>
        <button class="btn btn-quiet" type="button" data-companion-disable>Disable companion</button>
      </div>
      <p class="set-note">Essential notifications still stay in the normal notification menu if the companion is hidden or disabled.</p>
    </div>`;
}

export function renderOperatorSettings(el, opts = {}) {
  const settings = loadOperatorSettings();
  const activeProvider = providerFor(settings.provider);
  const activeModel = settings.models[activeProvider.id] || activeProvider.models[0];
  const mediaMountId = `media-settings-${Math.random().toString(36).slice(2)}`;
  const workspaceMountId = `workspace-studio-${Math.random().toString(36).slice(2)}`;
  const initialTab = opts.initialTab && SETTINGS_TABS.some((tab) => tab.id === opts.initialTab) ? opts.initialTab : null;
  const activeTab = initialTab || loadSettingsTab();
  if (initialTab) saveSettingsTab(initialTab);

  const TAB_CONTENT = {
    model: () => renderModelTab(settings, activeProvider, activeModel),
    loop: () => renderLoopAdvancedSection(),
    chat: () => renderChatBehaviorTab(settings),
    workspace: () => `<div id="${workspaceMountId}" class="set-workspace-mount"></div>`,
    companion: () => renderCompanionTab(),
    media: () => `<div id="${mediaMountId}"></div>`,
  };

  el.innerHTML = `
    <div class="settings settings-operator">
      <div class="set-section set-ai-hero">
        <div>
          <p class="set-eyebrow">Operator brain</p>
          <h3>Phantom AI settings</h3>
          <p class="set-note">Choose the default brain, loop behavior, memory depth, and autopilot boundary for the Business Manager. These are local owner settings; the public demo chat still cannot send, upload, charge, or touch private systems.</p>
        </div>
        ${renderSafetySummary(settings)}
      </div>

      <div class="set-settings-layout">
        ${renderSettingsCategories(activeTab)}
        <div class="set-tab-panel" data-set-panel role="tabpanel">
          ${(TAB_CONTENT[activeTab] || TAB_CONTENT.model)()}
        </div>
      </div>
    </div>`;

  el.querySelectorAll("[data-set-tab]").forEach((button) => {
    button.onclick = () => {
      saveSettingsTab(button.dataset.setTab);
      renderOperatorSettings(el, opts);
    };
  });

  const saveAndRender = () => {
    saveOperatorSettings(settings);
    renderOperatorSettings(el, opts);
  };

  el.querySelectorAll("[data-ai-provider]").forEach((button) => {
    button.onclick = () => {
      settings.provider = button.dataset.aiProvider || DEFAULT_SETTINGS.provider;
      saveAndRender();
    };
  });

  const modelSelect = el.querySelector("[data-ai-model]");
  if (modelSelect) modelSelect.onchange = () => {
    settings.models[settings.provider] = modelSelect.value;
    saveAndRender();
  };

  el.querySelectorAll("[data-ai-field]").forEach((field) => {
    field.onchange = () => {
      settings[field.dataset.aiField] = field.value;
      saveAndRender();
    };
  });

  el.querySelectorAll("[data-ai-toggle]").forEach((input) => {
    input.onchange = () => {
      settings[input.dataset.aiToggle] = input.checked;
      saveAndRender();
    };
  });

  const reset = el.querySelector("[data-ai-reset]");
  if (reset) reset.onclick = () => {
    saveOperatorSettings(DEFAULT_SETTINGS);
    renderOperatorSettings(el, opts);
  };

  const saveCompanionAndRender = (patch) => {
    saveCompanionPrefs({ ...DEFAULT_COMPANION_PREFS, ...loadCompanionPrefs(), ...(patch || {}) });
    renderOperatorSettings(el, opts);
  };

  el.querySelectorAll("[data-companion-toggle]").forEach((input) => {
    input.onchange = () => saveCompanionAndRender({ [input.dataset.companionToggle]: input.checked });
  });

  el.querySelectorAll("[data-companion-field]").forEach((field) => {
    field.onchange = () => saveCompanionAndRender({ [field.dataset.companionField]: field.value });
  });

  const companionReset = el.querySelector("[data-companion-reset]");
  if (companionReset) companionReset.onclick = () => {
    resetCompanionPrefs();
    renderOperatorSettings(el, opts);
  };
  const companionClearHide = el.querySelector("[data-companion-clear-hide]");
  if (companionClearHide) companionClearHide.onclick = () => {
    clearCompanionSessionHide();
    renderOperatorSettings(el, opts);
  };
  const companionQuiet = el.querySelector("[data-companion-quiet]");
  if (companionQuiet) companionQuiet.onclick = () => saveCompanionAndRender({
    enabled: true,
    visible: true,
    startDocked: true,
    roamingEnabled: false,
    dockLocation: "sidebar",
    motionLevel: "reduced",
    personality: "quiet",
    speechEnabled: false,
    idleFrequency: "off",
  });
  const companionDisable = el.querySelector("[data-companion-disable]");
  if (companionDisable) companionDisable.onclick = () => saveCompanionAndRender({ enabled: false });

  const loop = loadPhantomLoop();
  const saveLoopAndRender = (patch, advPatch) => {
    savePhantomLoop({ ...loop, ...patch, advanced: { ...loop.advanced, ...(advPatch || {}) } });
    renderOperatorSettings(el, opts);
  };

  const loopToggle = el.querySelector("[data-loop-toggle]");
  if (loopToggle) loopToggle.onchange = () => saveLoopAndRender({ enabled: loopToggle.checked });

  el.querySelectorAll("[data-loop-field]").forEach((field) => {
    field.onchange = () => saveLoopAndRender({ [field.dataset.loopField]: field.value });
  });

  const costSelect = el.querySelector("[data-loop-cost]");
  if (costSelect) costSelect.onchange = () => saveLoopAndRender({ maxCostPerResponse: costSelect.value ? Number(costSelect.value) : null });

  el.querySelectorAll("[data-loop-adv-field]").forEach((field) => {
    field.onchange = () => {
      const key = field.dataset.loopAdvField;
      const value = key === "maxPasses" || key === "timeoutMs" ? Number(field.value) : field.value;
      saveLoopAndRender(null, { [key]: value });
    };
  });

  el.querySelectorAll("[data-loop-adv-toggle]").forEach((input) => {
    input.onchange = () => saveLoopAndRender(null, { [input.dataset.loopAdvToggle]: input.checked });
  });

  el.querySelectorAll("[data-loop-allowed]").forEach((input) => {
    input.onchange = () => {
      const id = input.dataset.loopAllowed;
      const set = new Set(loop.advanced.allowedProviders);
      if (input.checked) set.add(id); else set.delete(id);
      saveLoopAndRender(null, { allowedProviders: [...set] });
    };
  });

  const mediaMount = el.querySelector(`#${mediaMountId}`);
  if (mediaMount) renderMediaSettings(mediaMount, opts);

  const workspaceMount = el.querySelector(`#${workspaceMountId}`);
  if (workspaceMount) {
    renderCustomizationStudio(workspaceMount, {
      ...opts,
      onApplied: (config) => {
        if (typeof opts.onWorkspaceApplied === "function") {
          opts.onWorkspaceApplied(config);
        }
      },
    });
  }
}
