/* PhantomBot OS — persistent task-based AI workspace.
   The page owns one focused conversation surface, with Memory and Activity
   available as contextual views. Tasks are stored locally per organization;
   real assistant behavior still routes through the existing Phantom brain. */

import {
  currentWs,
  currentTenantId,
  friendlyBackendError,
  isOwnerOperator,
  rememberConversation,
  uid,
  wsName,
  workspaceStorageGetItem,
  workspaceStorageSetItem,
  session,
} from "./store.js?v=phantom-live-20260729-86";
import { mountAgentConsole } from "./agentops.js?v=phantom-live-20260729-86";
import { renderAutomation } from "./brandops.js?v=phantom-live-20260729-86";
import { handleCommand, handleSmartCommand, handleInvoiceRequest } from "./command.js?v=phantom-live-20260729-86";
import { esc } from "./workspaces.js?v=phantom-live-20260729-86";
import { analyzeFile, humanSize } from "./docanalyzer.js?v=phantom-live-20260729-86";
import { openInvoicePrintable } from "./invoices.js?v=phantom-live-20260729-86";
import { getMediaRetentionDays, setMediaRetentionDays, MEDIA_RETENTION_OPTIONS, loadContentAssets, contentAssetDisplayUrl, registerContentAsset } from "./contenthub.js?v=phantom-live-20260729-86-creatorrestore1";
import { setCompanionState } from "./companion.js?v=phantom-live-20260729-86";
import { mountPhantomPresence } from "./phantom-presence.js?v=phantom-live-20260729-86";

const TABS = ["chat", "automations", "media", "memory", "activity"];
const TASKS_KEY = "pf.phantombot.tasks.v1";
const MAX_TASKS = 30;
const MAX_MESSAGES = 80;
const NEW_TASK_TITLE = "New session";
const INTERRUPTED_REPLY = "This response was interrupted before it finished. Retry the message when you are ready.";
const ACP_TERMINAL_STATES = new Set(["completed", "denied", "failed", "cancelled", "blocked"]);

let rootEl = null;
let taskState = { workspace: "", activeId: "", tasks: [] };
let chatBindings = null;
let runningRequest = null;
let keyboardBound = false;
let detailTab = "context";
let sessionStartedAt = Date.now();
let sessionClockTimer = 0;
let readRepliesAloud = false;
let dictationRecognition = null;

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
    operator: message.operator && typeof message.operator === "object" ? message.operator : null,
    pending: false,
    error: pending || !!message.error,
    createdAt: cleanText(message.createdAt || new Date().toISOString(), 60),
  };
}

function isEngineeringPrompt(prompt) {
  return /\b(?:build|code|coding|repo|repository|implement|fix|debug|refactor|patch|test|documentation|docs?|typescript|javascript|backend|frontend)\b/i.test(prompt);
}

async function operatorApi(path, options = {}) {
  const token = session.token();
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(friendlyBackendError(response.status, payload?.error, {
      authMessage: "Sign in with an admin account to run governed engineering work.",
      fallbackPrefix: "Hermes operator request failed",
    }));
  }
  return payload;
}

function operatorStatusText(operator) {
  const state = String(operator?.state || "connecting").replaceAll("_", " ");
  const summary = cleanText(operator?.summary || "", 280);
  if (operator?.state === "awaiting_approval") {
    return summary || "PhantomBot prepared a bounded plan. Review the exact scope before execution.";
  }
  if (operator?.state === "completed") {
    return summary || "The governed task passed verification and has a durable receipt.";
  }
  if (operator?.state === "denied") return "The proposed operation was denied. No approved change was executed.";
  if (operator?.state === "blocked") return summary || "Hermes could not produce an operation within the allowed first-slice policy.";
  if (operator?.state === "failed") return summary || "The governed operator failed closed. Check Activity for its recorded error.";
  if (operator?.state === "cancelled") return "The governed operator session was cancelled.";
  return `${state.charAt(0).toUpperCase()}${state.slice(1)}…`;
}

function operatorEventLabel(event) {
  const labels = {
    connecting: "Starting the workspace",
    connected: "Workspace connected",
    analyzing: "Analyzing request",
    context_inspection: "Inspecting workspace context",
    plan_created: "Plan created",
    message_delta: "Response prepared",
    approval_required: "Approval required",
    operation_started: "Approved operation started",
    operation_progress: "Operation progress",
    tool_result: "Tool result recorded",
    usage: "Usage recorded",
    completed: "Verification complete",
    blocked: "Blocked by policy",
    cancelled: "Cancelled",
    disconnected: "ACP disconnected",
    failed: "Failed closed",
  };
  return labels[event?.type] || String(event?.type || "Update").replaceAll("_", " ");
}

function operatorEventSummary(event) {
  const summary = cleanText(event?.summary || "", 500);
  if (event?.type !== "message_delta") return summary;
  const publicText = summary.split(/<phantom_(?:tool_intent|engineering_plan)>/iu, 1)[0].trim();
  return publicText || "PhantomBot prepared a governed operation proposal.";
}

function operatorPlanHtml(plan) {
  const operations = Array.isArray(plan?.operations) ? plan.operations : [];
  if (!operations.length) return "";
  return `<div><dt>Exact plan</dt><dd><ol class="phantombot-operator-plan">${operations.map((operation) => {
    const payload = JSON.stringify(operation, null, 2);
    return `<li><b>${esc(operation.id || "operation")} · ${esc(String(operation.kind || "").replaceAll("_", " "))}</b>
      <span>${esc(operation.summary || "")}</span>
      <details><summary>Review exact immutable payload</summary><pre>${esc(payload)}</pre></details>
    </li>`;
  }).join("")}</ol></dd></div>`;
}

function operatorTimelineHtml(operator) {
  if (!operator) return "";
  const events = Array.isArray(operator.events) ? operator.events.slice(-8) : [];
  const run = operator.run || null;
  const intent = operator.intent || null;
  const plan = intent?.operations ? intent : run?.inputs?.plan;
  const scope = operator.state === "awaiting_approval" && run
    ? `<dl class="phantombot-operator-scope">
        <div><dt>Project</dt><dd>${esc(operator.workspace || "")}</dd></div>
        <div><dt>Change</dt><dd>${esc(intent?.summary || run.expected_effect || "Bound engineering task")}</dd></div>
        ${operatorPlanHtml(plan)}
        ${plan ? "" : `<div><dt>File</dt><dd>${esc(intent?.relativePath || run.inputs?.relativePath || "")}</dd></div>
        <div><dt>Command</dt><dd>${esc(intent?.testCommand || run.inputs?.testCommand || "")}</dd></div>`}
        <div><dt>Scope</dt><dd>${esc(run.scope || "")}</dd></div>
        <div><dt>Risk</dt><dd>${esc(run.risk || "approval required")}</dd></div>
      </dl>`
    : "";
  const approval = operator.state === "awaiting_approval" && run?.id
    ? `<div class="phantombot-operator-actions">
        <button type="button" data-operator-approve="${esc(run.id)}">Approve exact immutable plan</button>
        <button type="button" data-operator-reject="${esc(run.id)}">Deny</button>
      </div>`
    : "";
  const receipt = operator.receiptId
    ? `<p class="phantombot-operator-receipt">${operator.receiptVerified === false ? "Failure" : "Verified"} receipt <code>${esc(operator.receiptId)}</code>${operator.memoryId ? " · memory saved" : ""}</p>`
    : "";
  return `<section class="phantombot-operator" data-operator-session="${esc(operator.id || "")}">
    <header><b>Execution</b><span data-state="${esc(operator.state || "connecting")}">${esc(String(operator.state || "connecting").replaceAll("_", " "))}</span></header>
    <ol>${events.map((event) => {
      const summary = operatorEventSummary(event);
      return `<li><i></i><span><b>${esc(operatorEventLabel(event))}</b>${summary ? `<small>${esc(summary)}</small>` : ""}</span></li>`;
    }).join("")}</ol>
    ${scope}${approval}${receipt}
  </section>`;
}

function normalizedTask(task = {}) {
  const messages = Array.isArray(task.messages)
    ? task.messages.map(normalizedMessage).filter((message) => message.q).slice(-MAX_MESSAGES)
    : [];
  const savedTitle = cleanText(task.title || NEW_TASK_TITLE, 72);
  return {
    id: cleanText(task.id || uid("pbtask"), 80),
    title: savedTitle === "New task" ? NEW_TASK_TITLE : savedTitle,
    createdAt: cleanText(task.createdAt || new Date().toISOString(), 60),
    updatedAt: cleanText(task.updatedAt || task.createdAt || new Date().toISOString(), 60),
    pinned: !!task.pinned,
    archived: !!task.archived,
    effort: ["instant", "thinking", "deep"].includes(task.effort) ? task.effort : "instant",
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

function taskRowHtml(task) {
  return `<div class="phantombot-task-row ${task.id === taskState.activeId ? "is-active" : ""}">
    <button type="button" class="phantombot-task" data-phantombot-task="${esc(task.id)}">
      <span>${esc(task.title || NEW_TASK_TITLE)}</span>
      <small>${esc(relativeTaskTime(task.updatedAt))}</small>
    </button>
    <button type="button" class="phantombot-task-pin" data-phantombot-pin="${esc(task.id)}" aria-pressed="${task.pinned ? "true" : "false"}" aria-label="${task.pinned ? "Unpin" : "Pin"} ${esc(task.title || NEW_TASK_TITLE)}" title="${task.pinned ? "Unpin" : "Pin"}">${task.pinned ? "◆" : "◇"}</button>
  </div>`;
}

function paintTaskRail() {
  if (!rootEl) return;
  const search = cleanText(rootEl.querySelector("[data-phantombot-session-search]")?.value || "", 120).toLowerCase().trim();
  const visibleTasks = taskState.tasks.filter((task) => !task.archived && (!search || task.title.toLowerCase().includes(search)));
  const pinned = visibleTasks.filter((task) => task.pinned);
  const recent = visibleTasks.filter((task) => !task.pinned);
  const pinnedList = rootEl.querySelector("[data-phantombot-pinned-list]");
  if (pinnedList) pinnedList.innerHTML = pinned.map(taskRowHtml).join("");
  const list = rootEl.querySelector("[data-phantombot-task-list]");
  if (list) list.innerHTML = recent.slice(0, 30).map(taskRowHtml).join("");
  const pinHint = rootEl.querySelector("[data-phantombot-pin-hint]");
  if (pinHint) pinHint.hidden = pinned.length > 0 || !!search;
  const pinnedCount = rootEl.querySelector("[data-phantombot-pinned-count]");
  if (pinnedCount) pinnedCount.textContent = String(pinned.length);
  const sessionCount = rootEl.querySelector("[data-phantombot-session-count]");
  if (sessionCount) sessionCount.textContent = String(visibleTasks.length);
  const title = activeTask().title || NEW_TASK_TITLE;
  rootEl.querySelectorAll("[data-phantombot-current-title]").forEach((node) => {
    node.textContent = title;
  });
  const contextTitle = rootEl.querySelector("[data-phantombot-context-title]");
  if (contextTitle) contextTitle.textContent = title;
  const effort = rootEl.querySelector("[data-phantombot-effort]");
  if (effort) effort.value = activeTask().effort || "instant";
  paintDetailDrawer();
}

function taskArtifacts(task) {
  const artifacts = [];
  task.messages.forEach((message, messageIndex) => {
    (message.media || []).forEach((item) => artifacts.push({
      kind: item.type === "video" ? "Video" : "Image",
      title: item.title || "Generated media",
      detail: item.status || "saved",
      messageIndex,
    }));
    (message.cards || []).forEach((item) => artifacts.push({
      kind: item.kicker || "Artifact",
      title: item.title || "Workspace item",
      detail: item.meta || item.body || "",
      messageIndex,
    }));
    (message.attachments || []).forEach((item) => artifacts.push({
      kind: item.kind || "File",
      title: item.name || "Attachment",
      detail: item.summary || "",
      messageIndex,
    }));
  });
  return artifacts.slice(-24).reverse();
}

function latestOperator(task) {
  return [...task.messages].reverse().find((message) => message.operator)?.operator || null;
}

function detailEmpty(title, copy) {
  return `<div class="phantombot-detail-empty"><span>◇</span><b>${esc(title)}</b><p>${esc(copy)}</p></div>`;
}

function paintDetailDrawer() {
  if (!rootEl) return;
  const body = rootEl.querySelector("[data-phantombot-detail-body]");
  if (!body) return;
  const task = activeTask();
  const operator = latestOperator(task);
  const artifacts = taskArtifacts(task);
  rootEl.querySelectorAll("[data-phantombot-detail-tab]").forEach((button) => {
    const active = button.dataset.phantombotDetailTab === detailTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (detailTab === "timeline") {
    const entries = task.messages.map((message, index) => ({ message, index })).reverse();
    body.innerHTML = entries.length ? `<ol class="phantombot-detail-timeline">${entries.map(({ message, index }) => `
      <li><button type="button" data-phantombot-timeline-index="${index}">
        <i></i><span><b>${esc(titleFromPrompt(message.q))}</b><small>${esc(relativeTaskTime(message.createdAt))}</small></span>
      </button></li>`).join("")}</ol>` : detailEmpty("No turns yet", "Conversation turns will appear here.");
    return;
  }
  if (detailTab === "steps") {
    const events = Array.isArray(operator?.events) ? operator.events : [];
    body.innerHTML = events.length ? `<ol class="phantombot-detail-steps">${events.map((event) => `
      <li data-state="${esc(event.type || "update")}"><i></i><span><b>${esc(operatorEventLabel(event))}</b><small>${esc(operatorEventSummary(event))}</small></span></li>`).join("")}</ol>` : detailEmpty("No active plan", "Real execution steps appear here when PhantomBot uses tools.");
    return;
  }
  if (detailTab === "artifacts") {
    body.innerHTML = artifacts.length ? `<div class="phantombot-detail-artifacts">${artifacts.map((artifact) => `
      <button type="button" data-phantombot-timeline-index="${artifact.messageIndex}">
        <span>${esc(String(artifact.kind).slice(0, 1).toUpperCase())}</span>
        <b>${esc(artifact.title)}</b><small>${esc(artifact.detail)}</small>
      </button>`).join("")}</div>` : detailEmpty("No outputs yet", "Files, images, reports, and workspace items stay attached to this session.");
    return;
  }

  const attachmentCount = task.messages.reduce((total, message) => total + (message.attachments?.length || 0), 0);
  const approval = operator?.state === "awaiting_approval";
  body.innerHTML = `<dl class="phantombot-context-list">
    <div><dt>Workspace</dt><dd>${esc(wsName(currentWs()) || "PhantomForce")}</dd></div>
    <div><dt>Session</dt><dd>${esc(task.title || NEW_TASK_TITLE)}</dd></div>
    <div><dt>Model</dt><dd>Phantom V1:Latest</dd></div>
    <div><dt>Effort</dt><dd>${esc((task.effort || "instant").replace(/^./, (c) => c.toUpperCase()))}</dd></div>
    <div><dt>Attachments</dt><dd>${attachmentCount}</dd></div>
    <div><dt>Artifacts</dt><dd>${artifacts.length}</dd></div>
    <div><dt>Memory</dt><dd>Workspace scoped</dd></div>
    <div><dt>Approval</dt><dd class="${approval ? "is-waiting" : ""}">${approval ? "Waiting for you" : "No decision pending"}</dd></div>
  </dl>`;
}

function openDetailDrawer(tab = "context") {
  if (!rootEl) return;
  detailTab = ["context", "timeline", "steps", "artifacts"].includes(tab) ? tab : "context";
  const drawer = rootEl.querySelector("[data-phantombot-context-drawer]");
  if (drawer) drawer.hidden = false;
  rootEl.classList.add("is-context-open");
  paintDetailDrawer();
}

function closeDetailDrawer() {
  if (!rootEl) return;
  const drawer = rootEl.querySelector("[data-phantombot-context-drawer]");
  if (drawer) drawer.hidden = true;
  rootEl.classList.remove("is-context-open");
}

function startNewTask() {
  const task = createTask();
  taskState.tasks.unshift(task);
  taskState.tasks = taskState.tasks.slice(0, MAX_TASKS);
  taskState.activeId = task.id;
  sessionStartedAt = Date.now();
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
  sessionStartedAt = Date.now();
  rootEl?.classList.remove("is-rail-open");
  rootEl?.querySelector("[data-phantombot-rail-toggle]")?.setAttribute("aria-expanded", "false");
}

function toggleTaskPin(id) {
  const task = taskState.tasks.find((item) => item.id === id);
  if (!task) return;
  task.pinned = !task.pinned;
  task.updatedAt = new Date().toISOString();
  persistTaskState();
  paintTaskRail();
}

function branchTaskAt(messageIndex) {
  const source = activeTask();
  const index = Math.max(0, Math.min(source.messages.length - 1, Number(messageIndex)));
  const now = new Date().toISOString();
  const branched = normalizedTask({
    ...source,
    id: uid("pbtask"),
    title: `${source.title} · branch`,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    messages: source.messages.slice(0, index + 1),
  });
  taskState.tasks.unshift(branched);
  taskState.tasks = taskState.tasks.slice(0, MAX_TASKS);
  taskState.activeId = branched.id;
  sessionStartedAt = Date.now();
  persistTaskState();
  paintTaskRail();
  chatBindings?.paint(true);
}

function restoreTaskAt(messageIndex) {
  const task = activeTask();
  const index = Math.max(0, Math.min(task.messages.length - 1, Number(messageIndex)));
  const prompt = task.messages[index]?.q || "";
  task.messages = task.messages.slice(0, index);
  task.updatedAt = new Date().toISOString();
  persistTaskState();
  paintTaskRail();
  chatBindings?.paint(true);
  if (chatBindings?.input) {
    chatBindings.input.value = prompt;
    chatBindings.resize();
    chatBindings.input.focus();
  }
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
  const assetId = esc(String(media.assetId || media.id || ""));
  const type = media.type === "video" ? "video" : "image";
  const preview = type === "video"
    ? `<video src="${esc(safeUrl)}" controls playsinline preload="metadata" aria-label="${title}"></video>`
    : `<img src="${esc(safeUrl)}" alt="${title}" loading="lazy"/>`;
  return `<figure class="chat-media chat-media-${type}" data-chat-media-status="${status}">
    <div class="chat-media-frame">${preview}</div>
    <figcaption>
      <span>${title}</span>
      <b>${status === "saved" ? "Saved to Media Pool" : status === "queued" ? "Queued preview" : "Preview - not saved"}</b>
      <button type="button" data-phantombot-edit-media="${assetId}">Edit in PhantomCut</button>
    </figcaption>
  </figure>`;
}

function emptyStateHtml() {
  const suggestions = [
    "Research my market and show the opportunity",
    "Build and publish a website",
    "Create a campaign image",
    "Review today’s numbers and act on them",
  ];
  return `
    <section class="phantombot-empty">
      <div class="phantombot-presence" data-phantombot-presence>
        <span class="phantombot-presence-live"><i aria-hidden="true"></i>Live</span>
        <canvas class="phantombot-presence-canvas" data-phantombot-presence-canvas role="img"
          aria-label="PhantomBot animated character"></canvas>
        <span class="phantombot-presence-ring" aria-hidden="true"></span>
      </div>
      <h1>What are we working on?</h1>
      <div class="phantombot-starters">
        ${suggestions.map((prompt) => `<button type="button" data-phantombot-prompt="${esc(prompt)}">${esc(prompt)}<i>↗</i></button>`).join("")}
      </div>
    </section>`;
}

function inlineRichText(value) {
  return esc(String(value || ""))
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function richTextHtml(value) {
  const source = String(value || "").replace(/\r\n?/g, "\n");
  const blocks = [];
  const fenced = source.split(/```/);
  fenced.forEach((chunk, index) => {
    if (index % 2 === 1) {
      const firstBreak = chunk.indexOf("\n");
      const language = firstBreak >= 0 ? chunk.slice(0, firstBreak).trim() : "";
      const code = firstBreak >= 0 ? chunk.slice(firstBreak + 1) : chunk;
      blocks.push(`<div class="phantombot-code"><header><span>${esc(language || "code")}</span><button type="button" data-copy-code="${esc(code)}">Copy</button></header><pre><code>${esc(code)}</code></pre></div>`);
      return;
    }
    let listOpen = false;
    const lines = chunk.split("\n");
    lines.forEach((line) => {
      const trimmed = line.trim();
      const listMatch = /^[-*]\s+(.+)/.exec(trimmed);
      if (listMatch) {
        if (!listOpen) {
          blocks.push("<ul>");
          listOpen = true;
        }
        blocks.push(`<li>${inlineRichText(listMatch[1])}</li>`);
        return;
      }
      if (listOpen) {
        blocks.push("</ul>");
        listOpen = false;
      }
      const heading = /^(#{1,3})\s+(.+)/.exec(trimmed);
      if (heading) {
        const level = Math.min(4, heading[1].length + 1);
        blocks.push(`<h${level}>${inlineRichText(heading[2])}</h${level}>`);
      } else if (trimmed) {
        blocks.push(`<p>${inlineRichText(trimmed)}</p>`);
      }
    });
    if (listOpen) blocks.push("</ul>");
  });
  return blocks.join("");
}

function assistantTurnHtml(message, messageIndex) {
  if (message.pending) {
    return `
      <article class="phantombot-turn is-assistant is-thinking" aria-label="PhantomBot is thinking">
        <div class="phantombot-avatar"><img src="/app/assets/brand-phantom-favicon.png" alt="" /></div>
        <div class="phantombot-turn-content">
          <header><b>PhantomBot</b><span>${message.operator ? "Working" : "Thinking"}</span></header>
          ${message.operator ? operatorTimelineHtml(message.operator) : `<div class="phantombot-thinking"><i></i><i></i><i></i></div>`}
        </div>
      </article>`;
  }
  const accountLimit = message.error && /usage limit|quota|rate limit|too many requests|429|subscription limit/i.test(String(message.say || ""));
  return `
    <article class="phantombot-turn is-assistant ${message.error ? "is-error" : ""}">
      <div class="phantombot-avatar"><img src="/app/assets/brand-phantom-favicon.png" alt="" /></div>
      <div class="phantombot-turn-content">
        <header><b>PhantomBot</b>${message.background ? "<span>Working in background</span>" : ""}</header>
        <div class="phantomai-chat-reply phantomai-rich-text">${richTextHtml(message.say)}</div>
        ${operatorTimelineHtml(message.operator)}
        ${message.background ? `<p class="phantomai-chat-status">The task is still running. Results will stay attached to this workspace.</p>` : ""}
        ${accountLimit ? `<div class="record-actions"><button class="btn" type="button" data-phantombot-chatgpt-account data-open-ws="settings">Switch ChatGPT account</button></div>` : ""}
        ${(message.media || []).map(chatMediaHtml).join("")}
        ${(message.cards || []).map((card, cardIndex) => chatCardHtml(card, cardIndex, messageIndex)).join("")}
        <footer class="phantombot-turn-actions">
          <span>${esc(relativeTaskTime(message.createdAt))}</span>
          <button type="button" data-phantombot-branch="${messageIndex}" aria-label="Branch in new session" title="Branch in new session">⑂</button>
          <button type="button" data-phantombot-copy="${messageIndex}" aria-label="Copy response" title="Copy">□</button>
          <button type="button" data-phantombot-read="${messageIndex}" aria-label="Read response aloud" title="Read aloud">◒</button>
          <button type="button" data-phantombot-retry="${messageIndex}" aria-label="Retry response" title="Retry">↻</button>
        </footer>
      </div>
    </article>`;
}

async function pollOperatorMessage(task, message, paint) {
  const operatorId = message.operator?.id;
  if (!operatorId) throw new Error("Hermes operator session was not created.");
  while (true) {
    const payload = await operatorApi(`/phantom-ai/hermes-acp/sessions/${encodeURIComponent(operatorId)}`);
    message.operator = { ...payload.session, run: payload.run || null };
    message.say = operatorStatusText(message.operator);
    const settled = message.operator.state === "awaiting_approval" || ACP_TERMINAL_STATES.has(message.operator.state);
    message.pending = !settled;
    message.error = ["failed", "blocked"].includes(message.operator.state);
    task.updatedAt = new Date().toISOString();
    persistTaskState();
    if (taskState.activeId === task.id) paint(true);
    if (settled) return payload;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 700));
  }
}

function applyOperatorUpdate(task, message, payload, paint) {
  const priorEvents = Array.isArray(message.operator?.events) ? message.operator.events : [];
  const nextEvents = Array.isArray(payload.session?.events) ? payload.session.events : [];
  const bySequence = new Map();
  [...priorEvents, ...nextEvents].forEach((event) => {
    const sequence = Number(event?.sequence);
    if (Number.isSafeInteger(sequence) && sequence > 0) bySequence.set(sequence, event);
  });
  const events = [...bySequence.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .slice(-500);
  message.operator = {
    ...(message.operator || {}),
    ...(payload.session || {}),
    events,
    run: payload.run || null,
    streamCursor: Number(payload.cursor) || message.operator?.streamCursor || 0,
  };
  message.say = operatorStatusText(message.operator);
  const settled = message.operator.state === "awaiting_approval" || ACP_TERMINAL_STATES.has(message.operator.state);
  message.pending = !settled;
  message.error = ["failed", "blocked"].includes(message.operator.state);
  task.updatedAt = new Date().toISOString();
  persistTaskState();
  if (taskState.activeId === task.id) paint(true);
  return settled;
}

async function streamOperatorMessage(task, message, paint, stream = null) {
  if (typeof WebSocket !== "function") throw new Error("websocket_unavailable");
  const operatorId = message.operator?.id;
  const token = session.token();
  if (!operatorId || !token) throw new Error("operator_stream_auth_unavailable");
  const configuredPath = cleanText(stream?.url || "", 500);
  const path = configuredPath || `/ws/phantom-ai/hermes-acp/sessions/${encodeURIComponent(operatorId)}`;
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(path, `${scheme}//${window.location.host}`).toString();
  let cursor = Math.max(
    Number(message.operator?.streamCursor) || 0,
    ...(message.operator?.events || []).map((event) => Number(event.sequence) || 0),
  );
  let lastError = new Error("operator_stream_disconnected");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await new Promise((resolvePromise, rejectPromise) => {
        const socket = new WebSocket(url);
        let settled = false;
        let received = false;
        let livenessTimer = null;
        const armLiveness = () => {
          clearTimeout(livenessTimer);
          livenessTimer = setTimeout(() => {
            socket.close(4000, "heartbeat_timeout");
          }, 35_000);
        };
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(livenessTimer);
          try { socket.close(1000, "client_settled"); } catch {}
          resolvePromise(value);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(livenessTimer);
          rejectPromise(error);
        };
        socket.addEventListener("open", () => {
          socket.send(JSON.stringify({
            type: "authenticate",
            token,
            cursor,
            workspace: message.operator.workspace,
          }));
          armLiveness();
        });
        socket.addEventListener("message", (event) => {
          received = true;
          armLiveness();
          let payload;
          try { payload = JSON.parse(String(event.data || "")); } catch { return; }
          if (payload.type === "heartbeat") return;
          if (payload.type === "cursor_rejected") {
            cursor = 0;
            return;
          }
          if (payload.type === "error") {
            fail(new Error(cleanText(payload.error || "operator_stream_error", 180)));
            return;
          }
          if (payload.type !== "operator_update") return;
          cursor = Math.max(cursor, Number(payload.cursor) || 0);
          if (applyOperatorUpdate(task, message, payload, paint)) finish(payload);
        });
        socket.addEventListener("error", () => {
          lastError = new Error("operator_stream_socket_error");
        });
        socket.addEventListener("close", (event) => {
          if (settled) return;
          fail(new Error(`operator_stream_closed:${event.code}:${received ? "after_data" : "before_data"}`));
        });
      });
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 300 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

async function watchOperatorMessage(task, message, paint, stream = null) {
  try {
    return await streamOperatorMessage(task, message, paint, stream);
  } catch {
    message.operator = { ...(message.operator || {}), streamFallback: "polling" };
    return pollOperatorMessage(task, message, paint);
  }
}

function exchangeHtml(message, messageIndex) {
  return `
    <section class="phantombot-exchange" data-message-id="${esc(message.id)}">
      <article class="phantombot-turn is-user">
        <div class="phantombot-turn-content">
          <header><b>You</b><span>${esc(relativeTaskTime(message.createdAt))}</span></header>
          <div class="phantomai-chat-user">${richTextHtml(message.q)}</div>
          ${(message.attachments || []).map(attachmentHtml).join("")}
          <footer class="phantombot-turn-actions is-user-actions">
            <button type="button" data-phantombot-restore="${messageIndex}" aria-label="Restore checkpoint" title="Restore checkpoint">↶</button>
            <button type="button" data-phantombot-branch="${messageIndex}" aria-label="Branch in new session" title="Branch in new session">⑂</button>
          </footer>
        </div>
      </article>
      ${assistantTurnHtml(message, messageIndex)}
    </section>`;
}

function setBusy(busy) {
  if (!rootEl) return;
  setCompanionState(busy ? "thinking" : "idle");
  rootEl.toggleAttribute("data-busy", busy);
  const send = rootEl.querySelector(".phantombot-send");
  if (send) {
    send.type = busy ? "button" : "submit";
    send.toggleAttribute("data-phantombot-stop", busy);
    send.setAttribute("aria-label", busy ? "Stop response" : "Send message");
    send.querySelector("span").textContent = busy ? "■" : "↑";
  }
  const runtime = rootEl.querySelector("[data-phantombot-runtime]");
  if (runtime) runtime.querySelector("span").textContent = busy ? "Working" : "Ready";
  const companion = rootEl.querySelector("[data-phantombot-companion] span");
  if (companion) companion.textContent = busy ? "PhantomBot working" : "PhantomBot connected";
  const status = rootEl.querySelector("[data-phantombot-composer-status]");
  if (status) {
    status.hidden = !busy;
    status.textContent = busy ? "PhantomBot is working…" : "";
  }
}

function setComposerStatus(message, tone = "info", timeoutMs = 2400) {
  const status = rootEl?.querySelector("[data-phantombot-composer-status]");
  if (!status) return;
  status.hidden = !message;
  status.dataset.tone = tone;
  status.textContent = cleanText(message, 180);
  clearTimeout(Number(status.dataset.timer || 0));
  if (message && timeoutMs > 0) {
    status.dataset.timer = String(setTimeout(() => {
      if (!runningRequest && status.isConnected) {
        status.hidden = true;
        status.textContent = "";
      }
    }, timeoutMs));
  }
}

function speakText(value) {
  const text = cleanText(value, 6000).replace(/[`*_#]/g, "").trim();
  if (!text || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
  return true;
}

function toggleReadReplies(button) {
  readRepliesAloud = !readRepliesAloud;
  button?.setAttribute("aria-pressed", readRepliesAloud ? "true" : "false");
  button?.classList.toggle("is-active", readRepliesAloud);
  if (!readRepliesAloud && "speechSynthesis" in window) window.speechSynthesis.cancel();
  setComposerStatus(readRepliesAloud ? "Reply audio is on" : "Reply audio is off");
}

function startDictation(button) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    setComposerStatus("Voice dictation is unavailable in this browser", "error", 3200);
    return;
  }
  if (dictationRecognition) {
    dictationRecognition.stop();
    return;
  }
  const recognition = new Recognition();
  dictationRecognition = recognition;
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";
  const original = chatBindings?.input?.value || "";
  button?.setAttribute("aria-pressed", "true");
  button?.classList.add("is-active");
  setComposerStatus("Listening…", "live", 0);
  recognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results).map((result) => result[0]?.transcript || "").join(" ").trim();
    if (!chatBindings?.input) return;
    chatBindings.input.value = `${original}${original && transcript ? " " : ""}${transcript}`;
    chatBindings.resize();
  });
  recognition.addEventListener("error", () => {
    setComposerStatus("Dictation stopped", "error");
  });
  recognition.addEventListener("end", () => {
    dictationRecognition = null;
    button?.setAttribute("aria-pressed", "false");
    button?.classList.remove("is-active");
    if (!runningRequest) setComposerStatus("", "info", 0);
    chatBindings?.input?.focus();
  });
  recognition.start();
}

function updateSessionClock() {
  const target = rootEl?.querySelector("[data-phantombot-session-clock]");
  if (!target) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - sessionStartedAt) / 1000));
  const minutes = Math.floor(elapsed / 60);
  const seconds = String(elapsed % 60).padStart(2, "0");
  target.textContent = `Session ${minutes}:${seconds}`;
}

function stopRunningRequest() {
  if (!runningRequest) return;
  const request = runningRequest;
  runningRequest = null;
  const task = taskState.tasks.find((item) => item.id === request.taskId);
  const message = task?.messages.find((item) => item.id === request.messageId);
  if (message?.pending) {
    if (message.operator?.id) {
      void operatorApi(`/phantom-ai/hermes-acp/sessions/${encodeURIComponent(message.operator.id)}/cancel`, {
        method: "POST",
      }).catch(() => {});
    }
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
    mountPhantomPresence(log.querySelector("[data-phantombot-presence-canvas]"), {
      small: false,
      state: runningRequest ? "thinking" : "idle",
    });
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
      if (isEngineeringPrompt(prompt) && session.token()) {
        const started = await operatorApi("/phantom-ai/hermes-acp/sessions", {
          method: "POST",
          body: JSON.stringify({
            prompt: outbound,
            workspace: currentTenantId() || currentWs(),
          }),
        });
        message.operator = { ...started.session, run: null };
        message.say = operatorStatusText(message.operator);
        persistTaskState();
        paint(true);
        await watchOperatorMessage(task, message, paint, started.streaming);
        rememberConversation({
          prompt: displayQ,
          reply: message.say,
          mode: "phantombot-hermes-acp",
          route: `/phantom-ai/hermes-acp/sessions/${message.operator.id}`,
        });
        if (readRepliesAloud && !message.error) speakText(message.say);
        return;
      }
      const result = await handleSmartCommand(outbound, { effort: task.effort || "instant" })
        .catch(() => handleCommand(outbound));
      const targetTask = taskState.tasks.find((item) => item.id === task.id);
      const targetMessage = targetTask?.messages.find((item) => item.id === message.id);
      if (!targetMessage || runningRequest?.id !== requestId) return;
      targetMessage.say = cleanText(result?.say || "I could not return a usable answer. Try that again.", 12000);
      targetMessage.cards = Array.isArray(result?.cards) ? [...result.cards] : [];
      targetMessage.media = (Array.isArray(result?.media) ? result.media : []).map((item) => {
        const registered = registerContentAsset({ ...item, source: item.source || "PhantomBot" });
        return { ...item, assetId: registered?.asset?.id || item.assetId || item.id || "" };
      });
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
      if (readRepliesAloud && !targetMessage.error) speakText(targetMessage.say);
    } catch {
      const targetTask = taskState.tasks.find((item) => item.id === task.id);
      const targetMessage = targetTask?.messages.find((item) => item.id === message.id);
      if (targetMessage) {
        targetMessage.say = "PhantomBot could not complete that request. Nothing was sent or changed. Try again in a moment.";
        targetMessage.pending = false;
        targetMessage.error = true;
      }
    } finally {
      if (runningRequest?.id === requestId) runningRequest = null;
      setBusy(false);
      const finished = taskState.tasks
        .find((item) => item.id === task.id)?.messages
        .find((item) => item.id === message.id);
      setCompanionState(finished?.error ? "error" : "success");
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
  import("./brain.js?v=phantom-live-20260729-86")
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

function mountAutomationsTab() {
  const mount = pane("automations")?.querySelector("[data-phantombot-automations-mount]");
  if (!mount) return;
  renderAutomation(mount);
}

function mountMediaTab() {
  const mount = pane("media")?.querySelector("[data-phantombot-media-mount]");
  if (!mount) return;
  const assets = loadContentAssets();
  mount.innerHTML = `<header class="phantombot-panel-head"><div><span>Library</span><h2>Media</h2></div><button type="button" data-phantombot-open-media>Open Media Lab</button></header><p class="ws-note">Generated images and videos stay on this PC and expire according to your retention setting.</p><label class="settings-field"><span>Keep generated media</span><select data-phantombot-retention>${MEDIA_RETENTION_OPTIONS.map((option) => `<option value="${option.days}" ${option.days === getMediaRetentionDays() ? "selected" : ""}>${option.label}</option>`).join("")}</select></label><div class="ml-pool-grid">${assets.slice(0, 12).map((asset) => { const url = contentAssetDisplayUrl(asset); const preview = asset.type === "video" ? `<video src="${esc(url)}" muted playsinline preload="metadata"></video>` : (url ? `<img src="${esc(url)}" alt="${esc(asset.title)}" loading="lazy">` : `<span>${esc(asset.type.toUpperCase())}</span>`); return `<article class="ml-pool-thumb">${preview}<b>${esc(asset.title)}</b><i>${esc(asset.provider || asset.source || "Media")}</i><div class="phantombot-media-actions"><button type="button" data-phantombot-edit-media="${esc(asset.id)}">Edit in PhantomCut</button><button type="button" data-phantombot-publish-media="${esc(asset.id)}">Publish</button></div></article>`; }).join("") || `<div class="ml-idle"><h3>No generated media yet.</h3><p>Ask PhantomBot to create an image or video and it will appear here.</p></div>`}</div>`;
  mount.querySelector("[data-phantombot-retention]")?.addEventListener("change", (event) => { setMediaRetentionDays(event.target.value); mountMediaTab(); });
}

function openPhantomCutAsset(assetId, mediaElement = null) {
  const assets = loadContentAssets();
  let asset = assets.find((item) => item.id === assetId);
  if (!asset && mediaElement) {
    const preview = mediaElement.querySelector("img,video");
    const url = preview?.getAttribute("src") || "";
    if (url) {
      asset = registerContentAsset({
        type: preview.tagName === "VIDEO" ? "video" : "image",
        title: mediaElement.querySelector("figcaption > span")?.textContent || "PhantomBot media",
        url,
        source: "PhantomBot",
        saved: true,
      })?.asset;
    }
  }
  const url = asset && contentAssetDisplayUrl(asset);
  if (!asset || !url) return;
  workspaceStorageSetItem("pf.medialab.editIntent.v1", JSON.stringify({
    id: asset.id,
    type: asset.type === "video" ? "video" : "image",
    title: asset.title || "PhantomBot media",
    url,
    source: "PhantomBot",
  }));
  window.location.hash = "#page/media";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function openContentHubAsset(assetId) {
  if (!assetId) return;
  workspaceStorageSetItem("pf.contenthub.openTab.v1", "publish");
  workspaceStorageSetItem("pf.contenthub.openAsset.v1", assetId);
  window.location.hash = "#page/content";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
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
  if (tab === "automations") mountAutomationsTab();
  if (tab === "media") mountMediaTab();
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
    if (button.dataset.phantombotPin) {
      toggleTaskPin(button.dataset.phantombotPin);
      return;
    }
    if (button.matches("[data-phantombot-stop]")) {
      stopRunningRequest();
      return;
    }
    if (button.matches("[data-phantombot-chatgpt-account]")) {
      try { localStorage.setItem("pf.settings.tab.v1", "bridge"); } catch {}
      window.location.hash = "#page/settings";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    if (button.matches("[data-phantombot-open-media]")) {
      window.location.hash = "#page/media";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      return;
    }
    if (button.matches("[data-phantombot-edit-media]")) {
      openPhantomCutAsset(button.dataset.phantombotEditMedia, button.closest(".chat-media"));
      return;
    }
    if (button.matches("[data-phantombot-publish-media]")) {
      openContentHubAsset(button.dataset.phantombotPublishMedia);
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
    if (button.dataset.copyCode !== undefined) {
      try {
        await navigator.clipboard.writeText(button.dataset.copyCode);
        button.textContent = "Copied";
        setTimeout(() => { if (button.isConnected) button.textContent = "Copy"; }, 1200);
      } catch {
        setComposerStatus("Code could not be copied", "error");
      }
      return;
    }
    if (button.dataset.phantombotRead !== undefined) {
      const message = activeTask().messages[Number(button.dataset.phantombotRead)];
      if (message?.say && !speakText(message.say)) setComposerStatus("Reply audio is unavailable", "error");
      return;
    }
    if (button.dataset.phantombotBranch !== undefined) {
      branchTaskAt(button.dataset.phantombotBranch);
      return;
    }
    if (button.dataset.phantombotRestore !== undefined) {
      restoreTaskAt(button.dataset.phantombotRestore);
      return;
    }
    if (button.dataset.phantombotRetry !== undefined) {
      const message = activeTask().messages[Number(button.dataset.phantombotRetry)];
      if (message?.q) void chatBindings?.submitPrompt(message.q);
      return;
    }
    if (button.dataset.operatorApprove || button.dataset.operatorReject) {
      const runId = button.dataset.operatorApprove || button.dataset.operatorReject;
      const task = activeTask();
      const message = task.messages.find((item) => item.operator?.run?.id === runId);
      if (!message || runningRequest) return;
      const action = button.dataset.operatorApprove ? "approve" : "reject";
      button.disabled = true;
      setBusy(true);
      try {
        await operatorApi(`/phantom-ai/runs/${encodeURIComponent(runId)}/${action}`, {
          method: "POST",
          ...(action === "reject" ? { body: JSON.stringify({ reason: "Denied from PhantomBot task timeline." }) } : {}),
        });
        message.pending = action === "approve";
        message.say = action === "approve"
          ? "Approval recorded. Executing only the exact reviewed operation…"
          : "The operation was denied. No approved change was executed.";
        persistTaskState();
        chatBindings?.paint(true);
        await watchOperatorMessage(task, message, chatBindings.paint);
      } catch (error) {
        message.pending = false;
        message.error = true;
        message.say = "The approval decision could not be recorded. No operation was executed.";
      } finally {
        setBusy(false);
        persistTaskState();
        chatBindings?.paint(true);
      }
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
      const compact = window.matchMedia("(max-width: 1100px)").matches;
      if (compact) {
        const open = !root.classList.contains("is-rail-open");
        root.classList.toggle("is-rail-open", open);
        button.setAttribute("aria-expanded", open ? "true" : "false");
      } else {
        root.classList.toggle("is-rail-collapsed");
      }
      return;
    }
    if (button.matches("[data-phantombot-swap-rail]")) {
      root.classList.toggle("is-rail-right");
      return;
    }
    if (button.matches("[data-phantombot-open-context], [data-phantombot-runtime], [data-phantombot-companion]")) {
      openDetailDrawer("context");
      return;
    }
    if (button.matches("[data-phantombot-open-timeline]")) {
      openDetailDrawer("timeline");
      return;
    }
    if (button.matches("[data-phantombot-close-context]")) {
      closeDetailDrawer();
      return;
    }
    if (button.dataset.phantombotDetailTab) {
      detailTab = button.dataset.phantombotDetailTab;
      paintDetailDrawer();
      return;
    }
    if (button.dataset.phantombotTimelineIndex !== undefined) {
      const exchange = root.querySelectorAll(".phantombot-exchange")[Number(button.dataset.phantombotTimelineIndex)];
      closeDetailDrawer();
      exchange?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (button.matches("[data-phantombot-model]")) {
      const menu = root.querySelector("[data-phantombot-model-menu]");
      if (!menu) return;
      const open = menu.hidden;
      menu.hidden = !open;
      button.setAttribute("aria-expanded", open ? "true" : "false");
      return;
    }
    if (button.matches("[data-phantombot-dictation]")) {
      startDictation(button);
      return;
    }
    if (button.matches("[data-phantombot-read-aloud]")) {
      toggleReadReplies(button);
      return;
    }
    if (button.matches("[data-phantombot-section='messaging']")) {
      activatePhantomAiTab("chat");
      if (chatBindings?.input) {
        chatBindings.input.value = "Show my messaging connections and anything that needs attention";
        chatBindings.resize();
        chatBindings.input.focus();
      }
      return;
    }
    if (button.dataset.phantomaiTab) activatePhantomAiTab(button.dataset.phantomaiTab);
  });

  root.addEventListener("input", (event) => {
    if (event.target.matches("[data-phantombot-session-search]")) paintTaskRail();
  });
  root.addEventListener("change", (event) => {
    if (!event.target.matches("[data-phantombot-effort]")) return;
    const effort = ["instant", "thinking", "deep"].includes(event.target.value) ? event.target.value : "instant";
    const task = activeTask();
    task.effort = effort;
    task.updatedAt = new Date().toISOString();
    persistTaskState();
    paintDetailDrawer();
    setComposerStatus(`${effort.replace(/^./, (value) => value.toUpperCase())} effort selected`);
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
    if (event.key === "Escape") {
      closeDetailDrawer();
      rootEl.classList.remove("is-rail-open");
      rootEl.querySelectorAll("[data-phantombot-rail-toggle]").forEach((button) => button.setAttribute("aria-expanded", "false"));
      const menu = rootEl.querySelector("[data-phantombot-model-menu]");
      if (menu) menu.hidden = true;
      rootEl.querySelector("[data-phantombot-model]")?.setAttribute("aria-expanded", "false");
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
  updateSessionClock();
  clearInterval(sessionClockTimer);
  sessionClockTimer = window.setInterval(updateSessionClock, 1000);

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
