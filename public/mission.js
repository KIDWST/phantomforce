/* Mission Mode — decompose one objective into distinct Claude CLI worker
   assignments, dispatch them to real terminals on the wall, and track their
   progress. Shares globals from app.js (api, cards, addCard, openTerminal,
   escapeHtml, providerIcon, renderStatus, renderRuntime, emptyStatus). */

// Mission Mode is not Claude-only — any agent CLI Termina knows how to run
// in audit vs write mode is assignable per worker. Mirrors mission/adapters.js.
const AGENT_PROVIDERS = ["claude", "codex"];

let missionView = "list"; // "list" | "create" | "detail"
let missionDetailId = null;
let missionCreateState = null; // { objective, workerCount, workspaceRoot, launchMode, roles, name }
let missionListCache = [];
let missionRefreshTimer = null;

function openMissionModal() {
  document.getElementById("mission-modal").classList.remove("hidden");
  renderMissionView();
}

function closeMissionModal() {
  document.getElementById("mission-modal").classList.add("hidden");
  clearInterval(missionRefreshTimer);
  missionRefreshTimer = null;
}

window.openMissionCenter = (missionId) => {
  missionView = "detail";
  missionDetailId = missionId;
  openMissionModal();
};

window.onMissionActivity = (card) => {
  if (missionView === "detail" && card.role && card.role.missionId === missionDetailId) renderMissionView();
};

document.getElementById("missions-btn").addEventListener("click", () => {
  missionView = "list";
  openMissionModal();
});
document.getElementById("mission-close").addEventListener("click", closeMissionModal);
document.getElementById("mission-modal").addEventListener("click", (e) => {
  if (e.target.id === "mission-modal") closeMissionModal();
});

// ---- view dispatch -----------------------------------------------------------

async function renderMissionView() {
  const title = document.getElementById("mission-title");
  const body = document.getElementById("mission-body");
  if (missionView === "list") {
    title.textContent = "Missions";
    body.innerHTML = `<p class="mission-loading">Loading missions…</p>`;
    const res = await api("/api/missions").then((r) => r.json()).catch(() => ({ ok: false }));
    missionListCache = res.ok ? res.missions : [];
    renderMissionList();
  } else if (missionView === "create") {
    title.textContent = "New Mission";
    renderMissionCreate();
  } else if (missionView === "detail") {
    title.textContent = "Mission";
    await renderMissionDetail();
  }
}

// ---- list view ----------------------------------------------------------------

function renderMissionList() {
  const body = document.getElementById("mission-body");
  body.innerHTML = "";

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "primary mission-new-btn";
  newBtn.textContent = "+ New Mission";
  newBtn.addEventListener("click", () => {
    missionCreateState = null;
    missionView = "create";
    renderMissionView();
  });
  body.appendChild(newBtn);

  if (!missionListCache.length) {
    const empty = document.createElement("p");
    empty.className = "mission-empty";
    empty.textContent = "No missions yet. Enter one objective and Termina will decompose it into worker assignments.";
    body.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "mission-list";
  for (const m of missionListCache) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "mission-row";
    const workerCount = m.workers?.length ?? 0;
    row.innerHTML =
      `<span class="mission-row-name">${escapeHtml(m.name)}</span>` +
      `<span class="mission-row-meta">${workerCount} worker${workerCount === 1 ? "" : "s"} · ${escapeHtml(m.launchMode)} · ${escapeHtml(m.status)}</span>`;
    row.addEventListener("click", () => {
      missionView = "detail";
      missionDetailId = m.id;
      renderMissionView();
    });
    list.appendChild(row);
  }
  body.appendChild(list);
}

// ---- create wizard --------------------------------------------------------------

function renderMissionCreate() {
  const body = document.getElementById("mission-body");
  body.innerHTML = "";

  if (!missionCreateState || !missionCreateState.roles) {
    renderMissionCreateStepObjective(body);
  } else {
    renderMissionCreateStepRoles(body);
  }
}

// Remembered so the workspace path only ever needs typing once, not per
// mission. Falls back to wherever the "claude" profile already launches
// into today, so a brand-new install still has a sane zero-config default.
const MISSION_WORKSPACE_KEY = "termina.mission.workspaceRoot";

function defaultWorkspaceRoot() {
  try {
    const saved = localStorage.getItem(MISSION_WORKSPACE_KEY);
    if (saved) return saved;
  } catch {
    /* storage unavailable */
  }
  return profiles.find((p) => p.id === "claude")?.cwd || "";
}

const MISSION_WORKSPACE_HISTORY_KEY = "termina.mission.workspaceHistory";

function workspaceHistory() {
  try {
    const raw = localStorage.getItem(MISSION_WORKSPACE_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function rememberWorkspaceRoot(root) {
  try {
    localStorage.setItem(MISSION_WORKSPACE_KEY, root);
    const history = workspaceHistory().filter((p) => p !== root);
    history.unshift(root);
    localStorage.setItem(MISSION_WORKSPACE_HISTORY_KEY, JSON.stringify(history.slice(0, 10)));
  } catch {
    /* storage unavailable */
  }
}

function forgetWorkspaceRoot(root) {
  try {
    localStorage.setItem(MISSION_WORKSPACE_HISTORY_KEY, JSON.stringify(workspaceHistory().filter((p) => p !== root)));
    if (localStorage.getItem(MISSION_WORKSPACE_KEY) === root) localStorage.removeItem(MISSION_WORKSPACE_KEY);
  } catch {
    /* storage unavailable */
  }
}

// Renders the removable "recently used" chip row — the saved preset list
// the user asked to be able to edit/remove, not just accumulate forever.
function renderRecentChips() {
  const row = document.getElementById("mf-recent-chips");
  if (!row) return;
  const history = workspaceHistory();
  if (!history.length) {
    row.innerHTML = "";
    return;
  }
  row.innerHTML =
    `<span class="mission-chip-label">Recent:</span>` +
    history
      .map(
        (p) =>
          `<span class="mission-chip" data-path="${escapeHtml(p)}" title="${escapeHtml(p)}">` +
          `<button type="button" class="mission-chip-pick">${escapeHtml(p.split(/[\\/]/).pop() || p)}</button>` +
          `<button type="button" class="mission-chip-remove" aria-label="Remove ${escapeHtml(p)} from recent">×</button>` +
          `</span>`,
      )
      .join("");
  row.querySelectorAll(".mission-chip-pick").forEach((btn) => {
    btn.addEventListener("click", () => {
      const path = btn.closest(".mission-chip").dataset.path;
      const input = document.getElementById("mf-workspace");
      if (input) input.value = path;
    });
  });
  row.querySelectorAll(".mission-chip-remove").forEach((btn) => {
    btn.addEventListener("click", () => {
      forgetWorkspaceRoot(btn.closest(".mission-chip").dataset.path);
      renderRecentChips();
    });
  });
}

// Real git repos found on this machine, fetched once and cached — used to
// build a pick-list instead of making someone hand-type a path.
let repoScanPromise = null;
function scanRepos() {
  if (!repoScanPromise) {
    repoScanPromise = api("/api/repos")
      .then((r) => r.json())
      .then((d) => (d.ok ? d.repos : []))
      .catch(() => []);
  }
  return repoScanPromise;
}

// Plain-English messages for the server's error codes — never show a raw
// snake_case code to the user.
const FRIENDLY_ERRORS = {
  objective_required: "Please describe the objective first.",
  workspace_root_invalid: "That folder doesn't exist. Pick or enter a valid path.",
  objective_and_roles_required: "Something went wrong preparing the mission — please try again.",
  mission_not_found: "That mission could not be found.",
  worker_not_found: "That worker could not be found.",
};

// Builds the combined, deduped option list for the workspace picker:
// previously-used folders first (most recent first), then repos discovered
// nearby. Not gated on git existing — CLIs run fine in any real folder;
// git just gets you real per-worker isolation in Approval/Auto mode.
async function workspaceOptions() {
  const seen = new Set();
  const options = [];
  for (const p of workspaceHistory()) {
    if (seen.has(p)) continue;
    seen.add(p);
    options.push({ path: p, label: `${p} (recently used)` });
  }
  for (const r of await scanRepos()) {
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    options.push({ path: r.path, label: `${r.name} — ${r.path}` });
  }
  return options;
}

function friendlyError(code) {
  if (FRIENDLY_ERRORS[code]) return FRIENDLY_ERRORS[code];
  if (typeof code === "string" && /^[a-z_]+$/.test(code)) return "Something went wrong. Please try again.";
  return String(code || "Something went wrong. Please try again.");
}

// The only truly required input is the objective — everything else
// (mission name, worker count, provider per role) is inferred, and the
// default path goes straight from "type the objective" to a running
// mission with no intermediate review screen. Advanced controls (workspace
// override, forced worker count, worktrees mode, reviewing roles before
// launch) are available but collapsed, not required.
const LAUNCH_MODE_LABELS = {
  plan: "Plan — read-only, safest",
  approval: "Approval — can edit, asks before risky actions",
  auto: "Auto — can edit, fully unattended (no approval stops)",
};

function renderMissionCreateStepObjective(body) {
  const state = missionCreateState || {
    objective: "",
    workspaceRoot: defaultWorkspaceRoot(),
    launchMode: "approval",
  };

  const form = document.createElement("div");
  form.className = "mission-form";
  form.innerHTML = `
    <label>What's the objective?<textarea id="mf-objective" rows="3" placeholder="Prepare PhantomForce for launch. Audit the frontend, backend, security, tests, and deployment readiness.">${escapeHtml(state.objective)}</textarea></label>
    <div class="mission-enhance-row">
      <button type="button" id="mf-enhance" class="ghost">✨ Enhance</button>
      <span id="mf-enhance-note" class="mission-enhance-note"></span>
    </div>
    <label>How should it launch?
      <select id="mf-launchmode">
        ${Object.entries(LAUNCH_MODE_LABELS)
          .map(([v, label]) => `<option value="${v}" ${state.launchMode === v ? "selected" : ""}>${escapeHtml(label)}</option>`)
          .join("")}
      </select>
    </label>
    <label>Workspace
      <select id="mf-workspace-select"><option value="">Loading recent + nearby folders…</option></select>
    </label>
    <input id="mf-workspace" type="text" value="${escapeHtml(state.workspaceRoot)}" placeholder="or type a full path" />
    <div id="mf-recent-chips" class="mission-chip-row"></div>
    <details class="mission-advanced">
      <summary>Advanced</summary>
      <label>Mission name (auto if blank)<input id="mf-name" type="text" placeholder="auto-generated from the objective" /></label>
      <label>Workers (blank = let it decide)<input id="mf-count" type="number" min="2" max="10" placeholder="auto" /></label>
      <label class="mission-checkbox"><input type="checkbox" id="mf-review" /> Review generated roles before launching</label>
    </details>
    <div class="mission-form-actions">
      <button type="button" id="mf-cancel" class="ghost">Cancel</button>
      <button type="button" id="mf-go" class="primary">Launch Mission →</button>
    </div>
    <p id="mf-error" class="mission-error hidden"></p>
  `;
  body.appendChild(form);
  renderRecentChips();

  workspaceOptions().then((options) => {
    const select = document.getElementById("mf-workspace-select");
    if (!select) return; // form may have been replaced already
    const current = document.getElementById("mf-workspace")?.value ?? "";
    select.innerHTML =
      `<option value="">Choose a recent or nearby folder…</option>` +
      options.map((o) => `<option value="${escapeHtml(o.path)}" ${o.path === current ? "selected" : ""}>${escapeHtml(o.label)}</option>`).join("");
  });
  document.getElementById("mf-workspace-select").addEventListener("change", (e) => {
    if (e.target.value) document.getElementById("mf-workspace").value = e.target.value;
  });

  document.getElementById("mf-enhance").addEventListener("click", async () => {
    const textarea = document.getElementById("mf-objective");
    const workspaceRoot = document.getElementById("mf-workspace").value.trim();
    const objective = textarea.value.trim();
    const errorEl = document.getElementById("mf-error");
    const noteEl = document.getElementById("mf-enhance-note");
    errorEl.classList.add("hidden");

    if (!objective || !workspaceRoot) {
      errorEl.textContent = "Type an objective and choose a workspace first.";
      errorEl.classList.remove("hidden");
      return;
    }

    const btn = document.getElementById("mf-enhance");
    const original = objective;
    btn.disabled = true;
    btn.textContent = "Enhancing…";
    try {
      const res = await api("/api/missions/enhance", {
        method: "POST",
        body: JSON.stringify({ objective, workspaceRoot }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "enhancement failed");
      textarea.value = res.enhancedObjective;
      noteEl.innerHTML = `${escapeHtml(res.whatChanged)} <button type="button" id="mf-enhance-revert" class="ghost">Revert to original</button>`;
      document.getElementById("mf-enhance-revert").addEventListener("click", () => {
        textarea.value = original;
        noteEl.textContent = "";
      });
    } catch (err) {
      errorEl.textContent = `Couldn't enhance the objective: ${friendlyError(err.message)}`;
      errorEl.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.textContent = "✨ Enhance";
    }
  });

  document.getElementById("mf-cancel").addEventListener("click", () => {
    missionCreateState = null;
    missionView = "list";
    renderMissionView();
  });

  document.getElementById("mf-go").addEventListener("click", async () => {
    const objective = document.getElementById("mf-objective").value.trim();
    const workspaceRoot = document.getElementById("mf-workspace").value.trim();
    const name = document.getElementById("mf-name").value.trim();
    const countRaw = document.getElementById("mf-count").value.trim();
    const workerCount = countRaw ? Math.max(2, Math.min(10, parseInt(countRaw, 10) || 0)) : undefined;
    const launchMode = document.getElementById("mf-launchmode").value;
    const reviewFirst = document.getElementById("mf-review").checked;
    const errorEl = document.getElementById("mf-error");
    errorEl.classList.add("hidden");

    if (!objective || !workspaceRoot) {
      errorEl.textContent = "Please describe the objective and choose a workspace folder.";
      errorEl.classList.remove("hidden");
      return;
    }

    const btn = document.getElementById("mf-go");
    btn.disabled = true;
    btn.textContent = "Analyzing your objective…";

    try {
      const classifyRes = await api("/api/prompter/classify", {
        method: "POST",
        body: JSON.stringify({ objective, workspaceRoot }),
      }).then((r) => r.json());
      if (!classifyRes.ok) throw new Error(classifyRes.error || "classification failed");

      if (classifyRes.kind === "direct") {
        closeMissionModal();
        for (const tile of classifyRes.tiles) {
          const card = addCard({ name: tile.name, profileId: tile.profileId }, { start: true });
          if (tile.startupCommand) {
            setTimeout(() => {
              if (card.ws && card.ws.readyState === WebSocket.OPEN) {
                card.ws.send(JSON.stringify({ type: "input", data: tile.startupCommand + "\r" }));
              }
            }, 700);
          }
        }
        return;
      }

      const res = await api("/api/missions/decompose", {
        method: "POST",
        body: JSON.stringify({ objective, workerCount, workspaceRoot }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "decomposition failed");
      rememberWorkspaceRoot(workspaceRoot);

      const nextState = {
        name: name || res.missionName,
        objective,
        workspaceRoot,
        launchMode,
        roles: res.roles,
        decomposeCostUsd: res.costUsd,
      };

      if (reviewFirst) {
        missionCreateState = nextState;
        renderMissionView();
        return;
      }

      btn.textContent = `Launching ${nextState.roles.length} workers…`;
      await launchMissionNow(nextState);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Launch Mission →";
      errorEl.textContent = friendlyError(err.message);
      errorEl.classList.remove("hidden");
    }
  });
}

// Shared by both the fast (auto-launch) path and the "review roles first"
// path — actually creates the mission's workers, attaches wall tiles to the
// sessions the server just started, and immediately closes the modal so you
// land on the wall watching your CLIs work instead of stuck behind a dialog.
// Reopen the roster/synthesis view any time via the "Missions" button or a
// worker tile's "▤ Worker N" badge.
async function launchMissionNow(state) {
  const res = await api("/api/missions", {
    method: "POST",
    body: JSON.stringify({
      name: state.name,
      objective: state.objective,
      workspaceRoot: state.workspaceRoot,
      launchMode: state.launchMode,
      roles: state.roles,
    }),
  }).then((r) => r.json());
  if (!res.ok) throw new Error(res.error || "mission launch failed");
  attachMissionWorkerTiles(res.mission);
  missionCreateState = null;
  missionDetailId = res.mission.id;
  closeMissionModal();
}

function renderMissionCreateStepRoles(body) {
  const state = missionCreateState;
  const wrap = document.createElement("div");
  wrap.className = "mission-form";

  const cost = document.createElement("p");
  cost.className = "mission-hint";
  cost.textContent = `Generated ${state.roles.length} roles${state.decomposeCostUsd != null ? ` (decomposition cost: $${state.decomposeCostUsd.toFixed(4)})` : ""}. Review or edit before launch.`;
  wrap.appendChild(cost);

  const roleList = document.createElement("div");
  roleList.className = "mission-role-list";
  state.roles.forEach((role, i) => {
    if (!role.provider) role.provider = "claude";
    const card = document.createElement("div");
    card.className = "mission-role-card";
    card.innerHTML = `
      <label>Role name<input class="mr-name" type="text" value="${escapeHtml(role.name)}" /></label>
      <label>Agent
        <select class="mr-provider">
          ${AGENT_PROVIDERS.map((p) => `<option value="${p}" ${role.provider === p ? "selected" : ""}>${escapeHtml(profileLabel(p) || p)}</option>`).join("")}
        </select>
      </label>
      <label>Scope<textarea class="mr-scope" rows="2">${escapeHtml(role.scope)}</textarea></label>
      <label>Deliverables<textarea class="mr-deliverables" rows="2">${escapeHtml(role.deliverables || "")}</textarea></label>
      <label>Prohibited<textarea class="mr-prohibited" rows="2">${escapeHtml(role.prohibited || "")}</textarea></label>
    `;
    card.querySelector(".mr-name").addEventListener("input", (e) => (role.name = e.target.value));
    card.querySelector(".mr-provider").addEventListener("change", (e) => (role.provider = e.target.value));
    card.querySelector(".mr-scope").addEventListener("input", (e) => (role.scope = e.target.value));
    card.querySelector(".mr-deliverables").addEventListener("input", (e) => (role.deliverables = e.target.value));
    card.querySelector(".mr-prohibited").addEventListener("input", (e) => (role.prohibited = e.target.value));
    roleList.appendChild(card);
    void i;
  });
  wrap.appendChild(roleList);

  const actions = document.createElement("div");
  actions.className = "mission-form-actions";
  actions.innerHTML = `
    <button type="button" id="mf-back" class="ghost">← Back</button>
    <button type="button" id="mf-launch" class="primary">Launch Mission (${state.roles.length} workers)</button>
  `;
  wrap.appendChild(actions);

  const errorEl = document.createElement("p");
  errorEl.className = "mission-error hidden";
  errorEl.id = "mf-launch-error";
  wrap.appendChild(errorEl);

  body.appendChild(wrap);

  document.getElementById("mf-back").addEventListener("click", () => {
    missionCreateState.roles = null;
    renderMissionView();
  });

  document.getElementById("mf-launch").addEventListener("click", async () => {
    const btn = document.getElementById("mf-launch");
    btn.disabled = true;
    btn.textContent = "Launching…";
    try {
      await launchMissionNow(state);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = `Launch Mission (${state.roles.length} workers)`;
      const el = document.getElementById("mf-launch-error");
      el.textContent = friendlyError(err.message);
      el.classList.remove("hidden");
    }
  });
}

// Creates a wall tile per worker and attaches it to the session the server
// already started — mirrors openTerminal's existing "attach to a live
// session" path rather than re-starting anything.
function attachMissionWorkerTiles(mission) {
  for (const worker of mission.workers) {
    const card = addCard(
      {
        name: worker.name,
        mission: worker.name,
        profileId: worker.provider,
        role: { missionId: mission.id, workerId: worker.id, index: worker.index, name: worker.name, provider: worker.provider },
      },
      { save: false, start: false },
    );
    card.startedAt = Date.now();
    card.status = emptyStatus();
    renderStatus(card);
    renderRuntime(card);
    openTerminal(card, worker.sessionId);
  }
}

// ---- detail / command center view ----------------------------------------------

async function renderMissionDetail() {
  const body = document.getElementById("mission-body");
  const res = await api(`/api/missions/${missionDetailId}`).then((r) => r.json()).catch(() => ({ ok: false }));
  if (!res.ok) {
    body.innerHTML = `<p class="mission-error">Could not load mission.</p>`;
    return;
  }
  const { mission, ledger } = res;
  document.getElementById("mission-title").textContent = mission.name;

  const lastEventByWorker = new Map();
  for (const e of ledger) lastEventByWorker.set(e.workerId, e);

  body.innerHTML = "";

  const head = document.createElement("div");
  head.className = "mission-detail-head";
  head.innerHTML = `
    <p class="mission-objective"><b>Objective:</b> ${escapeHtml(mission.objective)}</p>
    <p class="mission-hint">${escapeHtml(mission.launchMode)} · ${escapeHtml(mission.workspaceRoot)}</p>
  `;
  body.appendChild(head);

  const table = document.createElement("div");
  table.className = "mission-roster";
  for (const worker of mission.workers) {
    const card = cards.find((c) => c.role?.missionId === mission.id && c.role?.workerId === worker.id);
    const liveState = card?.status?.state;
    const stateLabel = liveState ? (STATUS_META[liveState] || STATUS_META.unknown).label : worker.status;
    const lastEvent = lastEventByWorker.get(worker.id);

    const row = document.createElement("div");
    row.className = "mission-worker-row";
    row.innerHTML = `
      <div class="mw-name">Worker ${worker.index} — ${escapeHtml(worker.name)} <span class="mw-provider">${escapeHtml(profileLabel(worker.provider) || worker.provider)}</span></div>
      <div class="mw-status">${escapeHtml(stateLabel)}</div>
      <div class="mw-activity">${lastEvent ? escapeHtml(`${lastEvent.type}${lastEvent.detail ? ": " + lastEvent.detail : ""}`) : "—"}</div>
      <div class="mw-workspace">${escapeHtml(worker.branch || worker.cwd)}</div>
      <div class="mw-runtime">${card?.startedAt ? formatElapsed(Date.now() - card.startedAt) : ""}</div>
      <div class="mw-actions"></div>
    `;
    const actions = row.querySelector(".mw-actions");
    actions.appendChild(smallMissionBtn("Open", () => {
      closeMissionModal();
      if (card) card.term?.focus();
    }));
    actions.appendChild(smallMissionBtn("Stop", async () => {
      await api(`/api/missions/${mission.id}/workers/${worker.id}/stop`, { method: "POST" });
      renderMissionView();
    }));
    actions.appendChild(smallMissionBtn("Retry", async () => {
      const r = await api(`/api/missions/${mission.id}/workers/${worker.id}/retry`, { method: "POST" }).then((x) => x.json());
      if (r.ok && card) {
        card.startedAt = Date.now();
        card.status = emptyStatus();
        renderStatus(card);
        openTerminal(card, r.worker.sessionId);
      }
      renderMissionView();
    }));
    table.appendChild(row);
  }
  body.appendChild(table);

  const timelineToggle = document.createElement("button");
  timelineToggle.type = "button";
  timelineToggle.className = "mw-btn timeline-toggle-btn";
  timelineToggle.textContent = "Show Timeline (Mission DVR)";
  const timelineContainer = document.createElement("div");
  timelineContainer.className = "timeline-container hidden";
  timelineToggle.addEventListener("click", async () => {
    const showing = !timelineContainer.classList.contains("hidden");
    if (showing) {
      timelineContainer.classList.add("hidden");
      timelineToggle.textContent = "Show Timeline (Mission DVR)";
      return;
    }
    timelineContainer.classList.remove("hidden");
    timelineToggle.textContent = "Hide Timeline";
    await mountTimeline(timelineContainer, mission.id);
  });
  body.appendChild(timelineToggle);
  body.appendChild(timelineContainer);

  const footer = document.createElement("div");
  footer.className = "mission-detail-footer";
  const synthBtn = document.createElement("button");
  synthBtn.type = "button";
  synthBtn.className = "primary";
  synthBtn.textContent = "Trigger Final Synthesis";
  synthBtn.addEventListener("click", async () => {
    synthBtn.disabled = true;
    synthBtn.textContent = "Writing the final report… this can take a couple minutes";
    try {
      const r = await api(`/api/missions/${mission.id}/synthesize`, { method: "POST" }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      renderMissionReport(body, mission.id, r);
      synthBtn.textContent = "Trigger Final Synthesis";
      synthBtn.disabled = false;
    } catch (err) {
      synthBtn.textContent = `Couldn't write the report: ${friendlyError(err.message)}`;
    }
  });
  footer.appendChild(synthBtn);
  body.appendChild(footer);

  const reportRes = await api(`/api/missions/${mission.id}/report`).then((r) => r.json()).catch(() => ({ ok: false }));
  if (reportRes.ok) renderMissionReport(body, mission.id, reportRes);

  clearInterval(missionRefreshTimer);
  missionRefreshTimer = setInterval(() => {
    if (missionView === "detail" && missionDetailId === mission.id && !document.getElementById("mission-modal").classList.contains("hidden")) {
      renderMissionDetail();
    }
  }, 4000);
}

function renderMissionReport(body, missionId, { markdown, report, approvals }) {
  let container = body.querySelector(".phantom-report");
  if (!container) {
    container = document.createElement("div");
    container.className = "phantom-report";
    body.appendChild(container);
  }
  container.innerHTML = "";

  const heading = document.createElement("h3");
  heading.textContent = "Phantom Report";
  container.appendChild(heading);

  // report/approvals are only present once synthesis has produced a
  // structured result under this feature; a report.md written before this
  // shipped has neither — fall back to raw-markdown rendering so history
  // isn't lost.
  if (!report) {
    const pre = document.createElement("pre");
    pre.className = "mission-report";
    pre.textContent = markdown;
    container.appendChild(pre);
    return;
  }

  const summary = document.createElement("p");
  summary.className = "phantom-report-summary";
  summary.textContent = report.summary;
  container.appendChild(summary);

  if (report.workerFindings?.length) {
    const findingsHeading = document.createElement("h4");
    findingsHeading.textContent = "What each worker found";
    container.appendChild(findingsHeading);
    const findingsList = document.createElement("ul");
    findingsList.className = "phantom-report-findings";
    for (const f of report.workerFindings) {
      const li = document.createElement("li");
      li.innerHTML = `<b>${escapeHtml(f.workerName)}:</b> ${escapeHtml(f.found)}`;
      findingsList.appendChild(li);
    }
    container.appendChild(findingsList);
  }

  if (report.nextSteps?.length) {
    const stepsHeading = document.createElement("h4");
    stepsHeading.textContent = "Next steps";
    container.appendChild(stepsHeading);
    const stepsList = document.createElement("div");
    stepsList.className = "phantom-report-steps";
    for (const step of report.nextSteps) {
      stepsList.appendChild(renderPhantomStepRow(missionId, step, approvals?.[step.id]));
    }
    container.appendChild(stepsList);
  }

  const rawToggle = document.createElement("button");
  rawToggle.type = "button";
  rawToggle.className = "ghost";
  rawToggle.textContent = "Show full report";
  const rawPre = document.createElement("pre");
  rawPre.className = "mission-report hidden";
  rawPre.textContent = markdown;
  rawToggle.addEventListener("click", () => {
    rawPre.classList.toggle("hidden");
    rawToggle.textContent = rawPre.classList.contains("hidden") ? "Show full report" : "Hide full report";
  });
  container.appendChild(rawToggle);
  container.appendChild(rawPre);
}

function renderPhantomStepRow(missionId, step, decision) {
  const row = document.createElement("div");
  row.className = "phantom-step-row";
  row.innerHTML = `
    <div class="phantom-step-text">
      <div class="phantom-step-desc">${escapeHtml(step.description)}</div>
      <div class="phantom-step-rationale">${escapeHtml(step.rationale)}</div>
    </div>
    <div class="phantom-step-actions"></div>
  `;
  const actions = row.querySelector(".phantom-step-actions");

  if (decision === "approved" || decision === "skipped") {
    const tag = document.createElement("span");
    tag.className = `phantom-step-tag phantom-step-tag-${decision}`;
    tag.textContent = decision === "approved" ? "✓ Approved" : "Skipped";
    actions.appendChild(tag);
    return row;
  }

  const errorEl = document.createElement("span");
  errorEl.className = "phantom-step-error hidden";

  const decide = async (nextDecision) => {
    errorEl.classList.add("hidden");
    try {
      const res = await api(`/api/missions/${missionId}/report/steps/${step.id}`, {
        method: "POST",
        body: JSON.stringify({ decision: nextDecision }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "failed");
      const replacement = renderPhantomStepRow(missionId, step, nextDecision);
      row.replaceWith(replacement);
    } catch (err) {
      errorEl.textContent = friendlyError(err.message);
      errorEl.classList.remove("hidden");
    }
  };

  actions.appendChild(smallMissionBtn("Approve", () => decide("approved")));
  actions.appendChild(smallMissionBtn("Skip", () => decide("skipped")));
  actions.appendChild(errorEl);
  return row;
}

function smallMissionBtn(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mw-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
