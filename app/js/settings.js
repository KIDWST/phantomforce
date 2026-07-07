/* PhantomForce admin settings.
   Local UI preferences only: no provider calls, sends, uploads, or billing. */

import { renderMediaSettings } from "./medialab.js?v=phantom-live-20260707-54";

const AI_SETTINGS_KEY = "pf.operator.settings.v1";

const PROVIDERS = [
  {
    id: "claude",
    name: "Claude",
    role: "Strategy, copy, review",
    models: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-fast"],
  },
  {
    id: "codex",
    name: "Codex",
    role: "Code, repo work, implementation",
    models: ["gpt-5-codex", "codex-local", "codex-review"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    role: "Flexible cloud routing",
    models: ["openrouter/auto", "anthropic/claude-sonnet", "openai/gpt-4.1"],
  },
  {
    id: "local",
    name: "Local",
    role: "Private Ollama/local lane",
    models: ["ollama/llama3.1", "ollama/qwen-coder", "ollama/mistral"],
  },
];

const DEFAULT_SETTINGS = {
  phantomLoop: true,
  loopMode: "approval_or_autopilot",
  loopCadence: "on_demand",
  provider: "claude",
  brainMode: "local",
  models: {
    claude: "claude-sonnet-5",
    codex: "gpt-5-codex",
    openrouter: "openrouter/auto",
    local: "ollama/llama3.1",
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
    return normalizeSettings(JSON.parse(localStorage.getItem(AI_SETTINGS_KEY) || "{}"));
  } catch {
    return normalizeSettings({});
  }
}

function saveOperatorSettings(settings) {
  try { localStorage.setItem(AI_SETTINGS_KEY, JSON.stringify(normalizeSettings(settings))); } catch {}
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

function renderSafetySummary(settings) {
  const loopLabel = {
    approval_or_autopilot: "Approval or autopilot",
    approval_first: "Approval checkpoints",
    draft_only: "Draft only",
  }[settings.loopMode] || "Approval or autopilot";
  const externalLabel = {
    approval: "External actions ask first",
    blocked: "External actions blocked",
    owner_rules: "Use owner rules",
  }[settings.externalActionMode] || "External actions ask first";
  const brainLabel = {
    local: "Instant brain (no backend)",
    api: "Hermes backend/API",
    subscription: "Subscription managed",
  }[settings.brainMode] || "Instant brain (no backend)";
  return `
    <div class="set-status-grid">
      <span><b>Loop</b><i>${esc(settings.phantomLoop ? loopLabel : "Off")}</i></span>
      <span><b>Brain</b><i>${esc(brainLabel)} · ${esc(providerFor(settings.provider).name)}</i></span>
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
  const loopLabel = {
    approval_or_autopilot: "Approval/autopilot",
    approval_first: "Approval",
    draft_only: "Draft",
  }[settings.loopMode] || "Approval/autopilot";
  const brainLabel = {
    local: "Instant",
    api: "Hermes/API",
    subscription: "Subscription",
  }[settings.brainMode] || "Instant";

  el.innerHTML = `
    <div class="chat-mini-settings">
      <div class="chat-mini-heading">
        <b>Chat settings</b>
        <span>Operator brain</span>
        <em class="chat-mini-saved" data-mini-saved hidden>Saved — applies to the next message</em>
      </div>
      <div class="chat-mini-summary">
        <span><b>${esc(brainLabel)}</b><i>${esc(activeProvider.name)} · ${esc(activeModel)}</i></span>
        <span><b>${settings.phantomLoop ? "Loop ready" : "Loop off"}</b><i>${settings.phantomLoop ? esc(loopLabel) : "Manual chat only"}</i></span>
      </div>
      <div class="chat-mini-fields">
        <label class="chat-mini-field"><span>Backend</span>
          <select data-mini-brain>${optionList([
            { id: "local", label: "Instant (no backend)" },
            { id: "api", label: "Hermes/API" },
            { id: "subscription", label: "Subscription" },
          ], settings.brainMode)}</select>
        </label>
        <label class="chat-mini-field"><span>Model</span>
          <select data-mini-provider>${PROVIDERS.map((provider) => `<option value="${esc(provider.id)}" ${provider.id === settings.provider ? "selected" : ""}>${esc(provider.name)}</option>`).join("")}</select>
        </label>
        <label class="chat-mini-field chat-mini-wide"><span>Default model</span>
          <select data-mini-model>${activeProvider.models.map((model) => `<option value="${esc(model)}" ${model === activeModel ? "selected" : ""}>${esc(model)}</option>`).join("")}</select>
        </label>
        <label class="chat-mini-field chat-mini-wide"><span>Loop mode</span>
          <select data-mini-loop>${optionList([
            { id: "approval_or_autopilot", label: "Approval or autopilot" },
            { id: "approval_first", label: "Approval checkpoints" },
            { id: "draft_only", label: "Draft only" },
          ], settings.loopMode)}</select>
        </label>
      </div>
      <div class="chat-mini-actions">
        <label class="chat-mini-switch">
          <input type="checkbox" data-mini-loop-toggle ${settings.phantomLoop ? "checked" : ""}/>
          <span><b>Phantom Loop</b><i>Arm guarded build packets from chat.</i></span>
        </label>
        <button class="chat-mini-full" type="button" data-mini-full-settings>Full settings</button>
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

  const loopSelect = el.querySelector("[data-mini-loop]");
  if (loopSelect) loopSelect.onchange = () => {
    settings.loopMode = loopSelect.value;
    saveMiniAndRender(el, opts, settings);
  };

  const loopToggle = el.querySelector("[data-mini-loop-toggle]");
  if (loopToggle) loopToggle.onchange = () => {
    settings.phantomLoop = loopToggle.checked;
    saveMiniAndRender(el, opts, settings);
  };

  const full = el.querySelector("[data-mini-full-settings]");
  if (full) full.onclick = () => {
    if (typeof opts.openSettings === "function") opts.openSettings();
  };
}

export function renderOperatorSettings(el, opts = {}) {
  const settings = loadOperatorSettings();
  const activeProvider = providerFor(settings.provider);
  const activeModel = settings.models[activeProvider.id] || activeProvider.models[0];
  const mediaMountId = `media-settings-${Math.random().toString(36).slice(2)}`;

  el.innerHTML = `
    <div class="settings settings-operator">
      <div class="set-section set-ai-hero">
        <div>
          <p class="set-eyebrow">Operator brain</p>
          <h3>Phantom AI settings</h3>
          <p class="set-note">Choose the default brain, loop behavior, memory depth, and autopilot boundary for the admin console. These are local owner settings; the public demo chat still cannot send, upload, charge, or touch private systems.</p>
        </div>
        ${renderSafetySummary(settings)}
      </div>

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
              { id: "api", label: "Hermes/API - backend brain" },
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
              { id: "sales", label: "Sales - money-focused" },
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
      </div>

      <div class="set-section">
        <div class="set-sec-head">
          <div>
            <h3>Phantom Loop</h3>
            <p class="set-note">Turn on the loop that turns a request into a plan, worker handoff, review point, and next action.</p>
          </div>
          <label class="set-switch set-switch-large">
            <input type="checkbox" data-ai-toggle="phantomLoop" ${settings.phantomLoop ? "checked" : ""}/><span></span>
          </label>
        </div>
        <div class="set-control-grid">
          <label class="set-control"><span>Loop mode</span>
            <select data-ai-field="loopMode">${optionList([
              { id: "approval_or_autopilot", label: "Approval or autopilot" },
              { id: "approval_first", label: "Approval checkpoints" },
              { id: "draft_only", label: "Draft only" },
            ], settings.loopMode)}</select>
          </label>
          <label class="set-control"><span>Cadence</span>
            <select data-ai-field="loopCadence">${optionList([
              { id: "on_demand", label: "On demand" },
              { id: "daily", label: "Daily operator brief" },
              { id: "after_commands", label: "After each command" },
            ], settings.loopCadence)}</select>
          </label>
          <label class="set-control"><span>Autopilot scope</span>
            <select data-ai-field="autopilotScope">${optionList([
              { id: "safe_repeat", label: "Safe repeat work only" },
              { id: "manual_only", label: "Manual until approved" },
            ], settings.autopilotScope)}</select>
          </label>
        </div>
      </div>

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
      </div>

      <div id="${mediaMountId}"></div>
    </div>`;

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

  const mediaMount = el.querySelector(`#${mediaMountId}`);
  if (mediaMount) renderMediaSettings(mediaMount, opts);
}
