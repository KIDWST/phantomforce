/* PhantomBot OS — persistent task-based AI workspace.
   The page owns one focused conversation surface, with Memory and Activity
   available as contextual views. Tasks are stored locally per organization;
   real assistant behavior still routes through the existing Phantom brain. */

import {
  currentWs,
  isOwnerOperator,
  rememberConversation,
  uid,
  workspaceStorageGetItem,
  workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260723-56";
import { mountAgentConsole } from "./agentops.js?v=phantom-live-20260723-56";
import { handleCommand, handleSmartCommand } from "./command.js?v=phantom-live-20260723-56";
import { esc } from "./workspaces.js?v=phantom-live-20260723-56";

const TABS = ["chat", "memory", "activity"];
const TASKS_KEY = "pf.phantombot.tasks.v1";
const MAX_TASKS = 30;
const MAX_MESSAGES = 80;
const NEW_TASK_TITLE = "New task";
const INTERRUPTED_REPLY = "This response was interrupted before it finished. Retry the message when you are ready.";

let rootEl = null;
let taskState = { workspace: "", activeId: "", tasks: [] };
let chatBindings = null;
let runningRequest = null;
let keyboardBound = false;

function cleanText(value, max = 12000) {
  return String(value || "").replace(/\u0000/g, "").slice(0, max);
}

function normalizedMessage(message = {}) {
  const pending = !!message.pending && !message.say;
  return {
    id: cleanText(message.id || uid("pbmsg"), 80),
    q: cleanText(message.q, 6000),
    say: cleanText(pending ? INTERRUPTED_REPLY : message.say, 12000),
    cards: Array.isArray(message.cards) ? message.cards.slice(0, 12) : [],
    media: Array.isArray(message.media) ? message.media.slice(0, 8) : [],
    background: !!message.background,
    pending: false,
    error: pending || !!message.error,
    createdAt: cleanText(message.createdAt || new Date().toISOString(), 60),
  };
}

function normalizedTask(task = {}) {
  const messages = Array.isArray(task.messages)
    ? task.messages.map(normalizedMessage).filter((message) => message.q).slice(-MAX_MESSAGES)
    : [];
  return {
    id: cleanText(task.id || uid("pbtask"), 80),
    title: cleanText(task.title || NEW_TASK_TITLE, 72),
    createdAt: cleanText(task.createdAt || new Date().toISOString(), 60),
    updatedAt: cleanText(task.updatedAt || task.createdAt || new Date().toISOString(), 60),
    messages,
  };
}

function createTask() {
  const now = new Date().toISOString();
  return normalizedTask({
    id: uid("pbtask"),
    title: NEW_TASK_TITLE,
    createdAt: now,
    updatedAt: now,
    messages: [],
  });
}

function loadTaskState(force = false) {
  const workspace = currentWs();
  if (!force && taskState.workspace === workspace && taskState.tasks.length) return;
  let parsed = null;
  try {
    parsed = JSON.parse(workspaceStorageGetItem(TASKS_KEY, { migrateGlobal: false }) || "null");
  } catch {
    parsed = null;
  }
  const tasks = Array.isArray(parsed?.tasks)
    ? parsed.tasks.map(normalizedTask).filter((task) => task.id).slice(0, MAX_TASKS)
    : [];
  if (!tasks.length) tasks.push(createTask());
  const activeId = tasks.some((task) => task.id === parsed?.activeId) ? parsed.activeId : tasks[0].id;
  taskState = { workspace, activeId, tasks };
  persistTaskState();
}

function serializableMedia(media = []) {
  return media.filter((item) => {
    const url = String(item?.url || "");
    return url && !/^(?:blob:|data:)/i.test(url);
  }).slice(0, 8);
}

function persistTaskState() {
  const payload = {
    version: 1,
    activeId: taskState.activeId,
    tasks: taskState.tasks.slice(0, MAX_TASKS).map((task) => ({
      ...task,
      messages: task.messages.slice(-MAX_MESSAGES).map((message) => ({
        ...message,
        say: message.pending && !message.say ? INTERRUPTED_REPLY : message.say,
        media: serializableMedia(message.media),
        pending: false,
        error: message.pending || !!message.error,
      })),
    })),
  };
  workspaceStorageSetItem(TASKS_KEY, JSON.stringify(payload));
}

function activeTask() {
  let task = taskState.tasks.find((item) => item.id === taskState.activeId);
  if (!task) {
    task = createTask();
    taskState.tasks.unshift(task);
    taskState.activeId = task.id;
    persistTaskState();
  }
  return task;
}

function titleFromPrompt(prompt) {
  const title = cleanText(prompt, 160).replace(/\s+/g, " ").trim();
  if (!title) return NEW_TASK_TITLE;
  return title.length > 52 ? `${title.slice(0, 49).trimEnd()}…` : title;
}

function relativeTaskTime(value) {
  const stamp = new Date(value).getTime();
  if (!Number.isFinite(stamp)) return "";
  const minutes = Math.max(0, Math.round((Date.now() - stamp) / 60000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function pane(tab) {
  return rootEl?.querySelector(`[data-phantomai-pane="${tab}"]`) || null;
}

function paintTaskRail() {
  if (!rootEl) return;
  const list = rootEl.querySelector("[data-phantombot-task-list]");
  if (list) {
    list.innerHTML = taskState.tasks.slice(0, 14).map((task) => `
      <button type="button" class="phantombot-task ${task.id === taskState.activeId ? "is-active" : ""}" data-phantombot-task="${esc(task.id)}">
        <span>${esc(task.title || NEW_TASK_TITLE)}</span>
        <small>${esc(relativeTaskTime(task.updatedAt))}</small>
      </button>`).join("");
  }
  const title = activeTask().title || NEW_TASK_TITLE;
  rootEl.querySelectorAll("[data-phantombot-current-title]").forEach((node) => {
    node.textContent = title;
  });
}

function startNewTask() {
  const task = createTask();
  taskState.tasks.unshift(task);
  taskState.tasks = taskState.tasks.slice(0, MAX_TASKS);
  taskState.activeId = task.id;
  persistTaskState();
  activatePhantomAiTab("chat");
  paintTaskRail();
  chatBindings?.paint(true);
  if (chatBindings?.input) {
    chatBindings.input.value = "";
    chatBindings.resize();
    chatBindings.input.focus();
  }
}

function activateTask(id) {
  if (!taskState.tasks.some((task) => task.id === id)) return;
  taskState.activeId = id;
  persistTaskState();
  activatePhantomAiTab("chat");
  paintTaskRail();
  chatBindings?.paint(true);
  rootEl?.classList.remove("is-rail-open");
  rootEl?.querySelector("[data-phantombot-rail-toggle]")?.setAttribute("aria-expanded", "false");
}

function chatCardHtml(card, cardIndex, messageIndex) {
  return `
    <article class="rcard" data-card-index="${cardIndex}" data-message-index="${messageIndex}">
      <button class="rcard-x" data-card-remove data-card-index="${cardIndex}" data-message-index="${messageIndex}" aria-label="Remove card">×</button>
      <p class="rcard-kicker">${esc(card.kicker)}</p>
      <h4>${esc(card.title)}</h4>
      ${card.body ? `<p class="rcard-body">${esc(card.body)}</p>` : ""}
      ${card.meta ? `<p class="rcard-meta">${esc(card.meta)}</p>` : ""}
      ${card.actions?.length ? `<div class="rcard-actions">${card.actions.map((action) => `<button class="btn" data-open-ws="${esc(action.open)}">${esc(action.label)}</button>`).join("")}</div>` : ""}
    </article>`;
}

function backgroundNoteFor(result) {
  const hermes = result?.hermes;
  if (!hermes || typeof hermes !== "object") return false;
  return !!(hermes.mission_id || hermes.missionId || hermes.background || hermes.running_in_background || hermes.route_tier === "mission");
}

function chatMediaHtml(media = {}) {
  const url = String(media.url || "");
  const safeUrl = /^(?:data:(?:image|video)\/(?:png|jpe?g|webp|gif|mp4|webm);base64,|https?:\/\/|\/|blob:)/i.test(url) ? url : "";
  if (!safeUrl) return "";
  const title = esc(String(media.title || "Generated media"));
  const status = esc(String(media.status || "saved"));
  const type = media.type === "video" ? "video" : "image";
  const preview = type === "video"
    ? `<video src="${esc(safeUrl)}" controls playsinline preload="metadata" aria-label="${title}"></video>`
    : `<img src="${esc(safeUrl)}" alt="${title}" loading="lazy"/>`;
  return `<figure class="chat-media chat-media-${type}" data-chat-media-status="${status}">
    <div class="chat-media-frame">${preview}</div>
    <figcaption><span>${title}</span><b>${status === "saved" ? "Saved to Media Pool" : status === "queued" ? "Queued preview" : "Preview — not saved"}</b></figcaption>
  </figure>`;
}

function emptyStateHtml() {
  const suggestions = [
    "Build or fix code in this project",
    "Review what changed recently",
    "Plan a feature from start to finish",
    "Explain this workspace",
  ];
  return `
    <section class="phantombot-empty">
      <div class="phantombot-empty-mark" aria-hidden="true">
        <img src="/app/assets/brand-phantom.png" alt="" />
      </div>
      <p>PHANTOMBOT</p>
      <h1>What do you want to work on?</h1>
      <span>Ask a question, build something, inspect the workspace, or turn an idea into a finished task.</span>
      <div class="phantombot-starters">
        ${suggestions.map((prompt) => `<button type="button" data-phantombot-prompt="${esc(prompt)}">${esc(prompt)}<i>↗</i></button>`).join("")}
      </div>
    </section>`;
}

function assistantTurnHtml(message, messageIndex) {
  if (message.pending) {
    return `
      <article class="phantombot-turn is-assistant is-thinking" aria-label="PhantomBot is thinking">
        <div class="phantombot-avatar"><img src="/app/assets/brand-phantom-favicon.png" alt="" /></div>
        <div class="phantombot-turn-content">
          <header><b>PhantomBot</b><span>Thinking</span></header>
          <div class="phantombot-thinking"><i></i><i></i><i></i></div>
        </div>
      </article>`;
  }
  return `
    <article class="phantombot-turn is-assistant ${message.error ? "is-error" : ""}">
      <div class="phantombot-avatar"><img src="/app/assets/brand-phantom-favicon.png" alt="" /></div>
      <div class="phantombot-turn-content">
        <header><b>PhantomBot</b>${message.background ? "<span>Working in background</span>" : ""}</header>
        <p class="phantomai-chat-reply">${esc(message.say)}</p>
        ${message.background ? `<p class="phantomai-chat-status">The task is still running. Results will stay attached to this workspace.</p>` : ""}
        ${(message.media || []).map(chatMediaHtml).join("")}
        ${(message.cards || []).map((card, cardIndex) => chatCardHtml(card, cardIndex, messageIndex)).join("")}
        <footer class="phantombot-turn-actions">
          <button type="button" data-phantombot-copy="${messageIndex}">Copy</button>
          <button type="button" data-phantombot-retry="${messageIndex}">Retry</button>
        </footer>
      </div>
    </article>`;
}

function exchangeHtml(message, messageIndex) {
  return `
    <section class="phantombot-exchange" data-message-id="${esc(message.id)}">
      <article class="phantombot-turn is-user">
        <div class="phantombot-turn-content">
          <header><b>You</b></header>
          <p class="phantomai-chat-user">${esc(message.q)}</p>
        </div>
      </article>
      ${assistantTurnHtml(message, messageIndex)}
    </section>`;
}

function setBusy(busy) {
  if (!rootEl) return;
  rootEl.toggleAttribute("data-busy", busy);
  const send = rootEl.querySelector(".phantombot-send");
  if (send) {
    send.type = busy ? "button" : "submit";
    send.toggleAttribute("data-phantombot-stop", busy);
    send.setAttribute("aria-label", busy ? "Stop response" : "Send message");
    send.querySelector("span").textContent = busy ? "■" : "↑";
  }
  const ready = rootEl.querySelector(".phantombot-ready");
  if (ready) {
    const label = ready.querySelector("span") || document.createElement("span");
    label.textContent = busy ? "Thinking" : "Ready";
    if (!label.parentElement) ready.append(label);
    Array.from(ready.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) node.remove();
    });
  }
}

function stopRunningRequest() {
  if (!runningRequest) return;
  const request = runningRequest;
  runningRequest = null;
  const task = taskState.tasks.find((item) => item.id === request.taskId);
  const message = task?.messages.find((item) => item.id === request.messageId);
  if (message?.pending) {
    message.pending = false;
    message.error = true;
    message.say = "Stopped before the response finished.";
    task.updatedAt = new Date().toISOString();
  }
  setBusy(false);
  persistTaskState();
  if (taskState.activeId === request.taskId) chatBindings?.paint(true);
}

function mountChatTab() {
  const mount = pane("chat")?.querySelector("[data-phantomai-chat-mount]");
  if (!mount || mount.dataset.mounted) {
    chatBindings?.paint();
    return;
  }
  mount.dataset.mounted = "1";
  const log = mount.querySelector("[data-phantomai-chat-log]");
  const form = mount.querySelector("[data-phantomai-chat-form]");
  const input = mount.querySelector("[data-phantomai-chat-input]");
  const jump = mount.querySelector("[data-phantombot-jump]");
  if (!log || !form || !input || !jump) return;

  let stickToBottom = true;
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 92;
  const resize = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(Math.max(input.scrollHeight, 28), 168)}px`;
  };

  const paint = (forceBottom = false) => {
    const task = activeTask();
    const shouldScroll = forceBottom || stickToBottom || nearBottom();
    log.innerHTML = task.messages.length
      ? task.messages.map(exchangeHtml).join("")
      : emptyStateHtml();
    paintTaskRail();
    if (shouldScroll) {
      requestAnimationFrame(() => {
        log.scrollTop = log.scrollHeight;
        stickToBottom = true;
        jump.hidden = true;
      });
    } else {
      jump.hidden = false;
    }
  };

  const submitPrompt = async (rawPrompt) => {
    const prompt = cleanText(rawPrompt, 6000).trim();
    if (!prompt || runningRequest) return;
    const task = activeTask();
    const message = normalizedMessage({
      id: uid("pbmsg"),
      q: prompt,
      say: "",
      pending: true,
      createdAt: new Date().toISOString(),
    });
    message.pending = true;
    message.say = "";
    task.messages.push(message);
    task.messages = task.messages.slice(-MAX_MESSAGES);
    if (task.title === NEW_TASK_TITLE) task.title = titleFromPrompt(prompt);
    task.updatedAt = new Date().toISOString();
    taskState.tasks = [task, ...taskState.tasks.filter((item) => item.id !== task.id)].slice(0, MAX_TASKS);
    persistTaskState();
    input.value = "";
    resize();
    stickToBottom = true;
    paint(true);

    const requestId = uid("pbrequest");
    runningRequest = { id: requestId, taskId: task.id, messageId: message.id };
    setBusy(true);
    try {
      const result = await handleSmartCommand(prompt).catch(() => handleCommand(prompt));
      const targetTask = taskState.tasks.find((item) => item.id === task.id);
      const targetMessage = targetTask?.messages.find((item) => item.id === message.id);
      if (!targetMessage || runningRequest?.id !== requestId) return;
      targetMessage.say = cleanText(result?.say || "I could not return a usable answer. Try that again.", 12000);
      targetMessage.cards = Array.isArray(result?.cards) ? result.cards : [];
      targetMessage.media = Array.isArray(result?.media) ? result.media : [];
      targetMessage.background = backgroundNoteFor(result);
      targetMessage.pending = false;
      targetMessage.error = !result?.say;
      targetTask.updatedAt = new Date().toISOString();
      rememberConversation({ prompt, reply: targetMessage.say, mode: "phantombot-task", route: result?.open || "" });
    } catch (error) {
      const targetTask = taskState.tasks.find((item) => item.id === task.id);
      const targetMessage = targetTask?.messages.find((item) => item.id === message.id);
      if (targetMessage) {
        targetMessage.say = `PhantomBot could not complete that request: ${cleanText(error?.message || "the AI service did not respond", 260)}`;
        targetMessage.pending = false;
        targetMessage.error = true;
      }
    } finally {
      if (runningRequest?.id === requestId) runningRequest = null;
      setBusy(false);
      persistTaskState();
      if (taskState.activeId === task.id) paint(true);
    }
  };

  log.addEventListener("scroll", () => {
    stickToBottom = nearBottom();
    jump.hidden = stickToBottom;
  }, { passive: true });

  jump.addEventListener("click", () => {
    log.scrollTop = log.scrollHeight;
    stickToBottom = true;
    jump.hidden = true;
  });

  input.addEventListener("input", resize);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitPrompt(input.value);
  });

  chatBindings = { input, paint, resize, submitPrompt };
  resize();
  paint(true);
  setTimeout(() => {
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
  }, 60);
}

function mountMemoryTab() {
  const mount = pane("memory")?.querySelector("[data-phantomai-memory-mount]");
  if (!mount || mount.dataset.mounted) return;
  mount.dataset.mounted = "1";
  import("./brain.js?v=phantom-live-20260723-56")
    .then((module) => { if (mount.isConnected) module.renderPhantomBrain(mount); })
    .catch(() => { mount.innerHTML = `<p class="ws-note">Memory could not load. Try again in a moment.</p>`; });
}

function mountActivityTab() {
  const mount = pane("activity")?.querySelector("[data-phantomai-activity-mount]");
  if (mount && !mount.dataset.mounted) {
    mount.dataset.mounted = "1";
    mountAgentConsole(mount);
  }
}

export function activatePhantomAiTab(tab) {
  if (!rootEl || !TABS.includes(tab)) return;
  if (tab === "memory" && !isOwnerOperator()) tab = "chat";
  rootEl.dataset.phantombotView = tab;
  TABS.forEach((name) => {
    const target = pane(name);
    if (target) target.hidden = name !== tab;
  });
  rootEl.querySelectorAll("[data-phantomai-tab]").forEach((button) => {
    const active = button.dataset.phantomaiTab === tab;
    button.classList.toggle("is-active", active);
    if (button.getAttribute("role") === "tab") button.setAttribute("aria-selected", active ? "true" : "false");
  });
  if (tab === "chat") mountChatTab();
  if (tab === "memory") mountMemoryTab();
  if (tab === "activity") mountActivityTab();
}

function bindRootActions(root) {
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || !root.contains(button)) return;

    if (button.matches("[data-phantombot-new-task]")) {
      startNewTask();
      return;
    }
    if (button.matches("[data-phantombot-stop]")) {
      stopRunningRequest();
      return;
    }
    if (button.dataset.phantombotTask) {
      activateTask(button.dataset.phantombotTask);
      return;
    }
    if (button.dataset.phantombotPrompt) {
      activatePhantomAiTab("chat");
      if (chatBindings?.input) {
        chatBindings.input.value = button.dataset.phantombotPrompt;
        chatBindings.resize();
        chatBindings.input.focus();
      }
      return;
    }
    if (button.dataset.phantombotCopy !== undefined) {
      const message = activeTask().messages[Number(button.dataset.phantombotCopy)];
      if (!message?.say) return;
      try {
        await navigator.clipboard.writeText(message.say);
        button.textContent = "Copied";
        setTimeout(() => { if (button.isConnected) button.textContent = "Copy"; }, 1200);
      } catch {
        button.textContent = "Copy failed";
      }
      return;
    }
    if (button.dataset.phantombotRetry !== undefined) {
      const message = activeTask().messages[Number(button.dataset.phantombotRetry)];
      if (message?.q) void chatBindings?.submitPrompt(message.q);
      return;
    }
    if (button.matches("[data-card-remove]")) {
      const message = activeTask().messages[Number(button.dataset.messageIndex)];
      const cardIndex = Number(button.dataset.cardIndex);
      if (message?.cards && Number.isInteger(cardIndex)) {
        message.cards.splice(cardIndex, 1);
        persistTaskState();
        chatBindings?.paint();
      }
      return;
    }
    if (button.matches("[data-phantombot-rail-toggle]")) {
      const open = !root.classList.contains("is-rail-open");
      root.classList.toggle("is-rail-open", open);
      button.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }
    if (button.dataset.phantomaiTab) activatePhantomAiTab(button.dataset.phantomaiTab);
  });
}

function bindKeyboardShortcuts() {
  if (keyboardBound) return;
  keyboardBound = true;
  window.addEventListener("keydown", (event) => {
    if (!rootEl?.isConnected) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      startNewTask();
    }
    if (event.key === "Escape" && rootEl.classList.contains("is-rail-open")) {
      rootEl.classList.remove("is-rail-open");
      rootEl.querySelector("[data-phantombot-rail-toggle]")?.setAttribute("aria-expanded", "false");
    }
  });
}

export function mountPhantomAI(root) {
  if (!root || root.dataset.phantomaiMounted) return;
  root.dataset.phantomaiMounted = "1";
  rootEl = root;
  loadTaskState(true);

  const memoryTab = root.querySelector('[data-phantomai-tab="memory"]');
  if (memoryTab && !isOwnerOperator()) memoryTab.hidden = true;

  bindRootActions(root);
  bindKeyboardShortcuts();
  paintTaskRail();
  activatePhantomAiTab("chat");

  const ticker = document.querySelector("[data-phantomwire]");
  if (ticker && !ticker.dataset.phantomaiWired) {
    ticker.dataset.phantomaiWired = "1";
    ticker.style.cursor = "pointer";
    ticker.title = "Open PhantomBot activity";
    ticker.addEventListener("click", () => {
      activatePhantomAiTab("activity");
      rootEl?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }
}
