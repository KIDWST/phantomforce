/* PhantomBot OS — persistent task-based AI workspace.
   The page owns one focused conversation surface, with Memory and Activity
   available as contextual views. Tasks are stored locally per organization;
   real assistant behavior still routes through the existing Phantom brain. */

import {
  currentWs,
  isOwnerOperator,
  rememberConversation,
  uid,
  wsName,
  workspaceStorageGetItem,
  workspaceStorageSetItem,
} from "./store.js?v=phantom-live-20260723-60";
import { mountAgentConsole } from "./agentops.js?v=phantom-live-20260723-60";
import { handleCommand, handleSmartCommand, handleInvoiceRequest } from "./command.js?v=phantom-live-20260723-60";
import { esc } from "./workspaces.js?v=phantom-live-20260723-60";
import { analyzeFile, humanSize } from "./docanalyzer.js?v=phantom-live-20260723-60";
import { openInvoicePrintable } from "./invoices.js?v=phantom-live-20260723-60";

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

/* Dropped/attached files staged for the next message, plus lookup maps for the
   invoice-card actions (drafts extracted from documents, and created invoices
   available to re-open as a printable). */
let pendingAttachments = [];
let attachSeq = 0;
const draftStore = new Map();
const invoiceStore = new Map();
function businessName() {
  try { return wsName(currentWs()) || "PhantomForce"; } catch { return "PhantomForce"; }
}
function attachIcon(kind) {
  return { image: "🖼️", pdf: "📄", text: "📝", doc: "📄", sheet: "📊", video: "🎬", other: "📎" }[kind] || "📎";
}
/* Attachments are kept full (with image data URLs + extracted text) in memory
   for rendering, but stripped to lightweight metadata before localStorage. */
function attachmentsForStorage(attachments = []) {
  return attachments.slice(0, 8).map((a) => ({ name: a.name, kind: a.kind, size: a.size, summary: a.summary, findings: a.findings || [] }));
}
function composeMessage(userText, attachments) {
  if (!attachments.length) return userText || "";
  const blocks = attachments.map((a) => {
    const lines = [`- ${a.name} (${a.kind}, ${humanSize(a.size)}): ${a.summary || ""}`];
    if (a.findings?.length) lines.push(`  · ${a.findings.join("; ")}`);
    if (a.text) lines.push(`  · Extracted text:\n${a.text.slice(0, 4000)}`);
    return lines.join("\n");
  }).join("\n");
  const ask = userText || "Analyze the attached file(s) and tell me what they are and what I can do with them.";
  return `${ask}\n\n[Attached files for analysis]\n${blocks}`;
}

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
    attachments: Array.isArray(message.attachments) ? message.attachments.slice(0, 8) : [],
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
        say: message.say,
        media: serializableMedia(message.media),
        attachments: attachmentsForStorage(message.attachments),
        pending: !!message.pending,
        error: !!message.error,
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

function cardActionHtml(action) {
  if (action.invoiceId) return `<button class="btn" data-invoice-open="${esc(action.invoiceId)}">${esc(action.label)}</button>`;
  if (action.invoiceDraftId) return `<button class="btn" data-invoice-create="${esc(action.invoiceDraftId)}">${esc(action.label)}</button>`;
  return `<button class="btn" data-open-ws="${esc(action.open)}">${esc(action.label)}</button>`;
}
function chatCardHtml(card, cardIndex, messageIndex) {
  if (card.invoice) invoiceStore.set(card.invoice.id, card.invoice);
  return `
    <article class="rcard${card.invoice ? " rcard-invoice" : ""}" data-card-index="${cardIndex}" data-message-index="${messageIndex}">
      <button class="rcard-x" data-card-remove data-card-index="${cardIndex}" data-message-index="${messageIndex}" aria-label="Remove card">×</button>
      <p class="rcard-kicker">${esc(card.kicker)}</p>
      <h4>${esc(card.title)}</h4>
      ${card.body ? `<p class="rcard-body">${esc(card.body)}</p>` : ""}
      ${card.meta ? `<p class="rcard-meta">${esc(card.meta)}</p>` : ""}
      ${card.actions?.length ? `<div class="rcard-actions">${card.actions.map(cardActionHtml).join("")}</div>` : ""}
    </article>`;
}

function attachmentHtml(att) {
  const thumb = att.kind === "image" && att.dataUrl
    ? `<img src="${esc(att.dataUrl)}" alt="${esc(att.name)}" class="phantomai-att-thumb" loading="lazy"/>`
    : `<span class="phantomai-att-icon">${attachIcon(att.kind)}</span>`;
  const findings = (att.findings || []).map((f) => `<li>${esc(f)}</li>`).join("");
  return `<figure class="phantomai-att">
    <div class="phantomai-att-head">${thumb}<div><b>${esc(att.name)}</b><span>${esc(att.summary || "")}</span></div></div>
    ${findings ? `<ul class="phantomai-att-findings">${findings}</ul>` : ""}
  </figure>`;
}
function pendingChipHtml(att) {
  const thumb = att.kind === "image" && att.dataUrl ? `<img src="${esc(att.dataUrl)}" alt=""/>` : `<span>${attachIcon(att.kind)}</span>`;
  return `<span class="phantomai-chip" data-att-id="${att.id}">${thumb}<b>${esc(att.name)}</b>${att.status === "reading" ? "<i>reading…</i>" : ""}<button data-att-remove="${att.id}" aria-label="Remove attachment">×</button></span>`;
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
          ${(message.attachments || []).map(attachmentHtml).join("")}
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

  const submitPrompt = async (rawPrompt, attachments = []) => {
    const prompt = cleanText(rawPrompt, 6000).trim();
    if ((!prompt && !attachments.length) || runningRequest) return;
    const displayQ = prompt || `Analyze ${attachments.length} file${attachments.length === 1 ? "" : "s"}`;
    const task = activeTask();
    const message = normalizedMessage({
      id: uid("pbmsg"),
      q: displayQ,
      say: "",
      attachments,
      pending: true,
      createdAt: new Date().toISOString(),
    });
    message.pending = true;
    message.say = "";
    task.messages.push(message);
    task.messages = task.messages.slice(-MAX_MESSAGES);
    if (task.title === NEW_TASK_TITLE) task.title = titleFromPrompt(displayQ);
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
      const outbound = composeMessage(prompt, attachments);
      const result = await handleSmartCommand(outbound).catch(() => handleCommand(outbound));
      const targetTask = taskState.tasks.find((item) => item.id === task.id);
      const targetMessage = targetTask?.messages.find((item) => item.id === message.id);
      if (!targetMessage || runningRequest?.id !== requestId) return;
      targetMessage.say = cleanText(result?.say || "I could not return a usable answer. Try that again.", 12000);
      targetMessage.cards = Array.isArray(result?.cards) ? [...result.cards] : [];
      targetMessage.media = Array.isArray(result?.media) ? result.media : [];
      // A dropped document that parsed into an invoice draft gets a one-tap card.
      for (const a of attachments) {
        if (a.invoiceDraft && (a.invoiceDraft.lineItems || []).length) {
          const draftId = `draft-${++attachSeq}`;
          draftStore.set(draftId, a.invoiceDraft);
          targetMessage.cards.push({
            kicker: "Ready to bill",
            title: `Turn “${a.name}” into an invoice`,
            body: `${a.invoiceDraft.lineItems.length} line item${a.invoiceDraft.lineItems.length === 1 ? "" : "s"}${a.invoiceDraft.clientName ? ` · ${a.invoiceDraft.clientName}` : ""}`,
            meta: "I'll create a draft invoice you can review, print, or send.",
            actions: [{ label: "Create invoice from this", invoiceDraftId: draftId }],
          });
        }
      }
      targetMessage.background = backgroundNoteFor(result);
      targetMessage.pending = false;
      targetMessage.error = !result?.say;
      targetTask.updatedAt = new Date().toISOString();
      rememberConversation({ prompt: displayQ, reply: targetMessage.say, mode: "phantombot-task", route: result?.open || "" });
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

  /* ---- attachments: drop zone + attach button + pending previews ---- */
  const pendingRow = document.createElement("div");
  pendingRow.className = "phantomai-pending";
  pendingRow.hidden = true;
  form.parentNode.insertBefore(pendingRow, form);

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.multiple = true;
  fileInput.accept = "image/*,application/pdf,text/*,.csv,.txt,.md,.json,.log";
  fileInput.hidden = true;
  form.appendChild(fileInput);
  const attachBtn = document.createElement("button");
  attachBtn.type = "button";
  attachBtn.className = "phantomai-attach";
  attachBtn.title = "Attach photos or documents";
  attachBtn.setAttribute("aria-label", "Attach photos or documents");
  attachBtn.textContent = "📎";
  form.insertBefore(attachBtn, form.firstChild);

  const overlay = document.createElement("div");
  overlay.className = "phantomai-drop-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `<div><b>Drop photos or documents</b><span>PhantomBot will read and analyze them</span></div>`;
  mount.appendChild(overlay);

  const paintPending = () => {
    pendingRow.hidden = pendingAttachments.length === 0;
    pendingRow.innerHTML = pendingAttachments.map(pendingChipHtml).join("");
    pendingRow.querySelectorAll("[data-att-remove]").forEach((b) => b.onclick = () => {
      pendingAttachments = pendingAttachments.filter((a) => a.id !== b.dataset.attRemove);
      paintPending();
    });
  };
  async function addFiles(fileList) {
    const files = Array.from(fileList || []).slice(0, 8);
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) continue;
      const id = `att-${++attachSeq}`;
      const placeholder = { id, name: file.name, kind: "other", size: file.size, status: "reading" };
      pendingAttachments.push(placeholder);
      paintPending();
      try {
        const analyzed = await analyzeFile(file);
        Object.assign(placeholder, analyzed, { id, status: "ready" });
      } catch {
        Object.assign(placeholder, { status: "ready", summary: "Could not read this file.", findings: [] });
      }
      paintPending();
    }
  }
  attachBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };

  let dragDepth = 0;
  mount.addEventListener("dragenter", (e) => { if (![...(e.dataTransfer?.types || [])].includes("Files")) return; e.preventDefault(); dragDepth++; overlay.hidden = false; });
  mount.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
  mount.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
  mount.addEventListener("drop", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    e.preventDefault(); dragDepth = 0; overlay.hidden = true;
    addFiles(e.dataTransfer.files);
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const atts = pendingAttachments.filter((a) => a.status !== "reading");
    pendingAttachments = [];
    paintPending();
    void submitPrompt(input.value, atts);
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
  import("./brain.js?v=phantom-live-20260723-60")
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
    if (button.dataset.invoiceOpen) {
      const invoice = invoiceStore.get(button.dataset.invoiceOpen);
      if (invoice) openInvoicePrintable(invoice, businessName());
      return;
    }
    if (button.dataset.invoiceCreate) {
      const draft = draftStore.get(button.dataset.invoiceCreate);
      if (!draft) return;
      button.disabled = true; button.textContent = "Creating…";
      const result = await handleInvoiceRequest(null, { ...draft, hasEnough: true });
      const task = activeTask();
      const message = normalizedMessage({
        id: uid("pbmsg"),
        q: "Create an invoice from the analyzed document",
        say: result?.say || "Invoice created.",
        cards: Array.isArray(result?.cards) ? result.cards : [],
        createdAt: new Date().toISOString(),
      });
      task.messages.push(message);
      task.messages = task.messages.slice(-MAX_MESSAGES);
      task.updatedAt = new Date().toISOString();
      persistTaskState();
      chatBindings?.paint(true);
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
  // Main-shell refreshes can remount this page while a response is still in
  // flight. Keep the live in-memory request instead of re-reading its
  // crash-recovery snapshot and incorrectly marking it interrupted.
  loadTaskState(false);

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
