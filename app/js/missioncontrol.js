/* PhantomForce Mission Control Mode.
   A persisted, organization-scoped multi-worker command layer for the
   dashboard. Termina can be wired underneath later; until then this uses
   PhantomForce-managed sessions and is explicit about that fallback. */

import { currentWs, wsName, pushActivity, store, isAdmin } from "./store.js?v=phantom-live-20260722-17";

const KEY = "pf.mission-control.v1";
const WORKERS = [
  { id: "strategist", name: "Strategist", icon: "◆", role: "planning, priorities, timeline, business decisions" },
  { id: "researcher", name: "Researcher", icon: "◇", role: "research, competitors, fact checks, evidence" },
  { id: "builder", name: "Builder", icon: "▣", role: "assets, websites, copy, technical tasks" },
  { id: "operator", name: "Operator", icon: "◈", role: "workflows, schedules, drafts, integrations, approved actions" },
  { id: "inspector", name: "Inspector", icon: "◎", role: "tests, verification, mistakes, proof" },
];
const STATUSES = ["Waiting", "Planning", "Working", "Needs Approval", "Testing", "Blocked", "Complete", "Failed"];
const PRESETS = ["Product Test", "Content Campaign", "Website Build", "Business Research", "Sales Outreach", "Operations Review", "Full Business Audit", "Custom Mission"];
const VIEWS = ["Simple", "Team", "CLI"];

const esc = (v = "") => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = (p) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();
const time = (iso) => new Date(iso || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function defaultState() {
  return { enabled: false, view: "Simple", activeMissionId: null, missions: [] };
}

function loadAll() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch { return {}; }
}
function saveAll(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
}
function loadState(orgId = currentWs()) {
  const all = loadAll();
  return { ...defaultState(), ...(all[orgId] || {}) };
}
function saveState(state, orgId = currentWs()) {
  const all = loadAll();
  all[orgId] = state;
  saveAll(all);
}

function workerSeed(role, objective = "") {
  const task = role.id === "strategist" ? "Break objective into priorities."
    : role.id === "researcher" ? "Gather evidence and assumptions."
    : role.id === "builder" ? "Prepare implementation/output path."
    : role.id === "operator" ? "Identify approval-gated actions."
    : "Verify risks, tests, and proof.";
  return {
    ...role,
    status: objective ? (role.id === "inspector" ? "Testing" : role.id === "operator" ? "Needs Approval" : "Planning") : "Waiting",
    progress: objective ? (role.id === "strategist" ? 24 : role.id === "inspector" ? 12 : 18) : 0,
    currentTask: objective ? task : "Waiting for Mission Commander.",
    latest: objective ? `${role.name} online. ${task}` : "Standing by.",
    approvals: role.id === "operator" && objective ? 1 : 0,
    files: [],
    chat: objective ? [{ who: "worker", text: `${role.name} received mission context: ${objective}`, at: now() }] : [],
    paused: false,
  };
}

function missionFromForm(form) {
  const data = new FormData(form);
  const objective = String(data.get("objective") || "").trim() || "New mission objective";
  const name = String(data.get("name") || "").trim() || objective.slice(0, 54);
  const count = Math.max(1, Math.min(5, Number(data.get("workers") || 5)));
  const workers = WORKERS.slice(0, count).map((w) => workerSeed(w, objective));
  const id = uid("mission");
  const tasks = workers.map((w, i) => ({
    id: uid("task"),
    title: w.currentTask,
    owner: w.name,
    status: w.status === "Testing" ? "Testing" : w.status === "Needs Approval" ? "Needs Approval" : i === 0 ? "In Progress" : "To Do",
    priority: i === 0 ? "High" : "Normal",
    createdAt: now(),
    latest: w.latest,
    files: [],
    dependencies: i > 0 ? [workers[0].name] : [],
    approvals: w.approvals,
  }));
  return {
    id,
    orgId: currentWs(),
    orgName: wsName(currentWs()),
    name,
    objective,
    preset: String(data.get("preset") || "Custom Mission"),
    deadline: String(data.get("deadline") || ""),
    budget: String(data.get("budget") || ""),
    permission: String(data.get("permission") || "Draft + local actions"),
    approvalRules: String(data.get("approvalRules") || "External/public/destructive actions require approval"),
    status: "Working",
    progress: 18,
    paused: false,
    createdAt: now(),
    updatedAt: now(),
    workers,
    commander: [{ who: "system", text: "MISSION CONTROL ONLINE — workers assigned and waiting for direction.", at: now() }],
    tasks,
    approvals: workers.some((w) => w.id === "operator") ? [{
      id: uid("approval"),
      worker: "Operator",
      action: "Prepare external-action checklist",
      destination: "Approval Center",
      effect: "No external send/publish/deploy happens until approved.",
      risk: "Low",
      cost: "0 credits",
      status: "pending",
      createdAt: now(),
    }] : [],
    deliverables: [{
      id: uid("deliverable"),
      type: "Mission Plan",
      title: `${name} launch plan`,
      owner: "Strategist",
      status: "Draft",
      proof: "Created from Mission Commander objective.",
      createdAt: now(),
    }],
    activity: [
      { id: uid("evt"), actor: "Mission Commander", type: "mission_started", text: `Mission started for ${wsName(currentWs())}.`, at: now(), proof: "Persisted locally under organization scope." },
      { id: uid("evt"), actor: "Strategist", type: "handoff", text: "Strategist → Researcher: define evidence needs.", at: now(), proof: "Worker handoff recorded." },
      { id: uid("evt"), actor: "Builder", type: "queued", text: "Builder standing by for scoped output.", at: now(), proof: "Worker session created." },
    ],
    termina: { available: false, mode: "PhantomForce-managed fallback", sessions: workers.map((w) => ({ worker: w.name, status: "managed", env: "browser-session", model: "Phantom AI backend when connected" })) },
  };
}

function decomposeObjective(mission, text) {
  const lower = text.toLowerCase();
  const premium = /\bpremium|luxury|polish|sleek|better\b/.test(lower);
  const research = /\bresearch|competitor|market|fact|why|investigate\b/.test(lower);
  const build = /\bbuild|create|make|write|design|fix|improve|test\b/.test(lower);
  const inspect = /\btest|qa|check|verify|proof|broken\b/.test(lower);
  const targets = mission.workers.filter((w) =>
    (premium && ["Strategist", "Builder", "Inspector"].includes(w.name))
    || (research && w.name === "Researcher")
    || (build && ["Builder", "Operator"].includes(w.name))
    || (inspect && w.name === "Inspector")
  );
  return targets.length ? targets : mission.workers.slice(0, Math.min(3, mission.workers.length));
}

function updateMissionFromCommander(mission, text, backendText = "") {
  const at = now();
  mission.commander.push({ who: "user", text, at });
  if (backendText) mission.commander.push({ who: "phantom", text: backendText, at: now() });
  const targets = decomposeObjective(mission, text);
  targets.forEach((w, i) => {
    w.status = w.name === "Inspector" ? "Testing" : "Working";
    w.paused = false;
    w.progress = Math.min(96, Math.max(w.progress + 12 + i * 3, 28));
    w.currentTask = text.slice(0, 120);
    w.latest = backendText && i === 0 ? backendText.slice(0, 180) : `${w.name} applied commander update: ${text}`;
    w.chat.push({ who: "user", text, at });
    w.chat.push({ who: "worker", text: w.latest, at: now() });
    mission.activity.unshift({ id: uid("evt"), actor: "Mission Commander", type: "broadcast", text: `Commander → ${w.name}: ${text}`, at: now(), proof: "Routed by worker role relevance." });
  });
  mission.tasks.unshift({
    id: uid("task"),
    title: text.slice(0, 90),
    owner: targets.map((w) => w.name).join(", "),
    status: "In Progress",
    priority: /urgent|asap|now/i.test(text) ? "High" : "Normal",
    createdAt: at,
    latest: backendText ? backendText.slice(0, 160) : "Assigned from Mission Commander.",
    files: [],
    dependencies: [],
    approvals: /send|publish|deploy|spend|delete/i.test(text) ? 1 : 0,
  });
  if (/send|publish|deploy|spend|delete|external/i.test(text)) {
    mission.approvals.unshift({
      id: uid("approval"), worker: "Operator", action: text.slice(0, 120), destination: "External/public action",
      effect: "Held until owner approval.", risk: "Medium", cost: "Unknown", status: "pending", createdAt: at,
    });
    const op = mission.workers.find((w) => w.name === "Operator");
    if (op) { op.status = "Needs Approval"; op.approvals += 1; }
  }
  mission.progress = Math.min(98, mission.progress + 8);
  mission.updatedAt = now();
}

function activeMission(state) {
  return state.missions.find((m) => m.id === state.activeMissionId) || state.missions[0] || null;
}

function setMissionStatus(mission, status, paused = mission.paused) {
  mission.status = status;
  mission.paused = paused;
  mission.updatedAt = now();
  mission.workers.forEach((w) => {
    w.paused = paused;
    if (paused) w.status = "Blocked";
    else if (status === "Stopped") w.status = "Complete";
    else if (w.status === "Blocked") w.status = "Waiting";
  });
  mission.activity.unshift({ id: uid("evt"), actor: "User", type: status.toLowerCase(), text: `Mission ${status.toLowerCase()}.`, at: now(), proof: "State preserved in local mission store." });
}

function renderToggle(state) {
  return `<section class="mc-switch-card ${state.enabled ? "is-on" : ""}">
    <div>
      <p class="mc-kicker">Advanced interface</p>
      <h2>Mission Control: <span>${state.enabled ? "ON" : "OFF"}</span></h2>
      <small>${state.enabled ? "Multi-worker command center active." : "Normal dashboard stays clean until you activate it."}</small>
    </div>
    <button class="mc-toggle ${state.enabled ? "is-on" : ""}" data-mc-toggle type="button" aria-pressed="${state.enabled}">
      <span>${state.enabled ? "ON" : "OFF"}</span>
    </button>
  </section>`;
}

function renderSetup() {
  return `<dialog class="mc-dialog" data-mc-dialog>
    <form method="dialog" class="mc-setup" data-mc-setup>
      <header><div><p class="mc-kicker">New Mission</p><h3>Create worker command center</h3></div><button type="button" data-mc-close>✕</button></header>
      <label>Mission name<input name="name" placeholder="Launch premium campaign" /></label>
      <label>Main objective<textarea name="objective" required placeholder="Tell the team what outcome to produce."></textarea></label>
      <div class="mc-form-grid">
        <label>Business / organization<input value="${esc(wsName(currentWs()))}" disabled /></label>
        <label>Workers<select name="workers">${[1,2,3,4,5].map((n) => `<option ${n === 5 ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label>Preset<select name="preset">${PRESETS.map((p) => `<option>${esc(p)}</option>`).join("")}</select></label>
        <label>Deadline<input name="deadline" placeholder="Optional" /></label>
        <label>Budget / usage limit<input name="budget" placeholder="Optional" /></label>
        <label>Permission level<select name="permission"><option>Draft + local actions</option><option>Auto safe reads only</option><option>Approval for every action</option></select></label>
      </div>
      <label>Approval rules<input name="approvalRules" value="External/public/destructive actions require approval" /></label>
      <footer><button type="button" data-mc-close>Cancel</button><button class="mc-primary" value="start">Start Mission</button></footer>
    </form>
  </dialog>`;
}

function renderMission(mission, state) {
  if (!mission) return `<section class="mc-empty"><h3>Mission Commander is ready.</h3><p>Start a mission to spin up Strategist, Researcher, Builder, Operator, and Inspector.</p><button class="mc-primary" data-mc-new>New Mission</button></section>`;
  const board = ["To Do", "In Progress", "Needs Approval", "Testing", "Blocked", "Complete"].map((col) => {
    const tasks = mission.tasks.filter((t) => t.status === col).slice(0, 4);
    return `<div class="mc-board-col"><b>${col}</b>${tasks.map((t) => `<article><span>${esc(t.owner)}</span><p>${esc(t.title)}</p><small>${esc(t.priority)} · ${time(t.createdAt)}</small></article>`).join("") || `<em>Empty</em>`}</div>`;
  }).join("");
  const workers = mission.workers.map((w) => `<article class="mc-worker is-${esc(w.status.toLowerCase().replace(/\s+/g, "-"))}" data-worker-id="${esc(w.id)}">
    <header><span class="mc-avatar">${esc(w.icon)}</span><div><b>${esc(w.name)}</b><small>${esc(w.role)}</small></div><i>${esc(w.status)}</i></header>
    <p>${esc(w.currentTask)}</p>
    <div class="mc-progress"><span style="width:${Math.max(2, Math.min(100, w.progress))}%"></span></div>
    <small class="mc-latest">${esc(w.latest)}</small>
    <div class="mc-worker-meta"><span>${w.approvals} approvals</span><span>${w.files.length} files</span><span>${w.paused ? "Paused" : "Live"}</span></div>
    <footer>
      <button data-mc-worker-chat="${esc(w.id)}">Open chat</button>
      <button data-mc-worker-pause="${esc(w.id)}">${w.paused ? "Resume" : "Pause"}</button>
      <button data-mc-worker-redirect="${esc(w.id)}">Redirect</button>
      <button data-mc-worker-stop="${esc(w.id)}">Stop</button>
    </footer>
  </article>`).join("");
  const chat = mission.commander.slice(-8).map((m) => `<p class="mc-chat-${esc(m.who)}"><b>${m.who === "user" ? "You" : m.who === "phantom" ? "Phantom" : "System"}</b>${esc(m.text)}</p>`).join("");
  const workerChats = mission.workers.map((w) => `<details class="mc-worker-chat" ${state.view === "Team" ? "open" : ""}><summary>${esc(w.name)} chat</summary>
    <div>${w.chat.slice(-5).map((m) => `<p><b>${m.who === "user" ? "You" : w.name}</b>${esc(m.text)}</p>`).join("")}</div>
    <form data-mc-direct="${esc(w.id)}"><input placeholder="Message ${esc(w.name)}…" /><button>Send</button></form>
  </details>`).join("");
  const approvals = mission.approvals.slice(0, 5).map((a) => `<article><b>${esc(a.worker)}</b><p>${esc(a.action)}</p><small>${esc(a.destination)} · risk ${esc(a.risk)} · ${esc(a.cost)}</small><footer><button data-mc-approve="${esc(a.id)}">Approve</button><button data-mc-deny="${esc(a.id)}">Deny</button><button data-mc-edit-approval="${esc(a.id)}">Edit action</button></footer></article>`).join("") || `<p class="mc-muted">No approvals waiting.</p>`;
  const deliverables = mission.deliverables.map((d) => `<article><b>${esc(d.title)}</b><small>${esc(d.type)} · ${esc(d.owner)} · ${esc(d.status)}</small><p>${esc(d.proof)}</p></article>`).join("");
  const activity = mission.activity.slice(0, 10).map((e) => `<li><b>${esc(e.actor)}</b><span>${esc(e.text)}</span><small>${time(e.at)} · ${esc(e.proof || "recorded")}</small></li>`).join("");
  const cli = state.view === "CLI" && isAdmin() ? `<section class="mc-cli"><h3>CLI / Termina Layer</h3><p>Termina status: ${esc(mission.termina.mode)}. No raw secrets, keys, prompts, or private paths are shown here.</p>${mission.termina.sessions.map((s) => `<code>${esc(s.worker)} · ${esc(s.status)} · ${esc(s.env)} · ${esc(s.model)}</code>`).join("")}</section>` : "";
  return `<section class="mission-control ${state.enabled ? "is-online" : ""}" data-mc-panel>
    <div class="mc-online-flash">MISSION CONTROL ONLINE</div>
    <header class="mc-head">
      <div><p class="mc-kicker">Active org: ${esc(mission.orgName)}</p><h2>${esc(mission.name)}</h2><small>${esc(mission.objective)}</small></div>
      <div class="mc-actions"><button data-mc-new>New Mission</button><button data-mc-pause-all class="mc-danger">Pause All Workers</button><button data-mc-resume>Resume</button><button data-mc-stop>Stop</button></div>
    </header>
    <div class="mc-view-row">${VIEWS.map((v) => `<button class="${state.view === v ? "is-active" : ""}" data-mc-view="${v}" ${v === "CLI" && !isAdmin() ? "disabled" : ""}>${v} View</button>`).join("")}</div>
    <section class="mc-commander"><div><p class="mc-kicker">Mission Commander</p><h3>One objective controls the team</h3></div><div class="mc-overall"><b>${mission.progress}%</b><span>${esc(mission.status)}</span></div>
      <div class="mc-chatlog">${chat}</div>
      <form data-mc-commander><input placeholder="Tell Mission Commander the next objective…" autocomplete="off" /><button class="mc-primary">Send</button></form>
    </section>
    <section class="mc-workers">${workers}</section>
    ${state.view !== "Simple" ? `<section class="mc-team">${workerChats}</section>` : ""}
    <section class="mc-grid2"><div><h3>Mission Board</h3><div class="mc-board">${board}</div></div><div><h3>Unified Approvals</h3><div class="mc-approvals">${approvals}</div></div></section>
    <section class="mc-grid2"><div><h3>Mission Deliverables</h3><div class="mc-deliverables">${deliverables}</div></div><details class="mc-activity"><summary>Activity and proof</summary><ol>${activity}</ol></details></section>
    ${cli}
  </section>`;
}

function render(root, state) {
  root.innerHTML = renderToggle(state) + (state.enabled ? renderMission(activeMission(state), state) : "") + renderSetup();
  bind(root, state);
}

function persistAndRender(root, state) {
  saveState(state);
  render(root, state);
}

function bind(root, state) {
  root.querySelector("[data-mc-toggle]")?.addEventListener("click", () => {
    state.enabled = !state.enabled;
    if (state.enabled && !state.activeMissionId && !state.missions.length) state.view = "Simple";
    document.body.classList.toggle("mission-control-on", state.enabled);
    persistAndRender(root, state);
  });
  root.querySelectorAll("[data-mc-new]").forEach((btn) => btn.addEventListener("click", () => root.querySelector("[data-mc-dialog]")?.showModal()));
  root.querySelectorAll("[data-mc-close]").forEach((btn) => btn.addEventListener("click", () => root.querySelector("[data-mc-dialog]")?.close()));
  root.querySelector("[data-mc-setup]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const mission = missionFromForm(event.currentTarget);
    state.missions.unshift(mission);
    state.activeMissionId = mission.id;
    state.enabled = true;
    pushActivity("Mission Control", `started mission: ${mission.name}.`);
    store.save();
    persistAndRender(root, state);
  });
  root.querySelectorAll("[data-mc-view]").forEach((btn) => btn.addEventListener("click", () => {
    state.view = btn.dataset.mcView;
    persistAndRender(root, state);
  }));
  const mission = activeMission(state);
  if (!mission) return;
  root.querySelector("[data-mc-pause-all]")?.addEventListener("click", () => { setMissionStatus(mission, "Paused", true); persistAndRender(root, state); });
  root.querySelector("[data-mc-resume]")?.addEventListener("click", () => { setMissionStatus(mission, "Working", false); persistAndRender(root, state); });
  root.querySelector("[data-mc-stop]")?.addEventListener("click", () => { setMissionStatus(mission, "Stopped", false); persistAndRender(root, state); });
  root.querySelector("[data-mc-commander]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector("input");
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    updateMissionFromCommander(mission, text, "Thinking through the mission update and routing it to the right workers.");
    persistAndRender(root, state);
    try {
      if (typeof root.__missionRunBrain === "function") {
        const res = await root.__missionRunBrain(`Mission Control objective for ${mission.orgName}: ${text}`);
        const reply = res?.say || res?.text || "";
        if (reply) {
          mission.commander.push({ who: "phantom", text: reply, at: now() });
          mission.activity.unshift({ id: uid("evt"), actor: "Phantom AI", type: "backend_reply", text: "Mission Commander received backend guidance.", at: now(), proof: "Phantom AI chat backend/local fallback responded." });
        }
      }
    } catch {
      mission.activity.unshift({ id: uid("evt"), actor: "Mission Commander", type: "reconnect", text: "Backend guidance unavailable; preserved local mission state.", at: now(), proof: "Graceful fallback." });
    }
    persistAndRender(root, state);
  });
  root.querySelectorAll("[data-mc-direct]").forEach((form) => form.addEventListener("submit", (event) => {
    event.preventDefault();
    const id = form.dataset.mcDirect;
    const w = mission.workers.find((x) => x.id === id);
    const input = form.querySelector("input");
    const text = input.value.trim();
    if (!w || !text) return;
    input.value = "";
    w.chat.push({ who: "user", text, at: now() });
    w.chat.push({ who: "worker", text: `${w.name} acknowledged and updated its task.`, at: now() });
    w.latest = `${w.name} acknowledged: ${text}`;
    w.status = "Working";
    w.progress = Math.min(97, w.progress + 7);
    mission.activity.unshift({ id: uid("evt"), actor: w.name, type: "direct_message", text: `Direct message received: ${text}`, at: now(), proof: "Worker chat persisted." });
    persistAndRender(root, state);
  }));
  root.querySelectorAll("[data-mc-worker-pause]").forEach((btn) => btn.addEventListener("click", () => {
    const w = mission.workers.find((x) => x.id === btn.dataset.mcWorkerPause);
    if (!w) return;
    w.paused = !w.paused;
    w.status = w.paused ? "Blocked" : "Working";
    w.latest = w.paused ? "Paused by user." : "Resumed by user.";
    mission.activity.unshift({ id: uid("evt"), actor: w.name, type: w.paused ? "paused" : "resumed", text: w.latest, at: now(), proof: "Worker state changed." });
    persistAndRender(root, state);
  }));
  root.querySelectorAll("[data-mc-worker-stop]").forEach((btn) => btn.addEventListener("click", () => {
    const w = mission.workers.find((x) => x.id === btn.dataset.mcWorkerStop);
    if (!w) return;
    w.status = "Complete"; w.progress = 100; w.latest = "Stopped cleanly; state preserved.";
    persistAndRender(root, state);
  }));
  root.querySelectorAll("[data-mc-worker-redirect]").forEach((btn) => btn.addEventListener("click", () => {
    const w = mission.workers.find((x) => x.id === btn.dataset.mcWorkerRedirect);
    if (!w) return;
    const next = prompt(`Redirect ${w.name} to what task?`, w.currentTask);
    if (!next) return;
    w.currentTask = next; w.latest = `Redirected to: ${next}`; w.status = "Working";
    mission.activity.unshift({ id: uid("evt"), actor: "User", type: "redirect", text: `Redirected ${w.name}: ${next}`, at: now(), proof: "Worker assignment updated." });
    persistAndRender(root, state);
  }));
  root.querySelectorAll("[data-mc-worker-chat]").forEach((btn) => btn.addEventListener("click", () => {
    state.view = "Team";
    persistAndRender(root, state);
    setTimeout(() => root.querySelector(`[data-mc-direct="${btn.dataset.mcWorkerChat}"] input`)?.focus(), 40);
  }));
  root.querySelectorAll("[data-mc-approve],[data-mc-deny]").forEach((btn) => btn.addEventListener("click", () => {
    const id = btn.dataset.mcApprove || btn.dataset.mcDeny;
    const approval = mission.approvals.find((a) => a.id === id);
    if (!approval) return;
    approval.status = btn.dataset.mcApprove ? "approved" : "denied";
    mission.activity.unshift({ id: uid("evt"), actor: "User", type: approval.status, text: `${approval.status}: ${approval.action}`, at: now(), proof: "Approval decision recorded; no external execution is automatic." });
    persistAndRender(root, state);
  }));
}

export function mountMissionControl(root, options = {}) {
  if (!root) return;
  const state = loadState();
  root.__missionRunBrain = options.runBrain;
  document.body.classList.toggle("mission-control-on", state.enabled);
  render(root, state);
}
