/* Mission Mode — decompose one objective into distinct Claude CLI worker
   assignments, dispatch them to real terminals on the wall, and track their
   progress. Shares globals from app.js (api, cards, addCard, openTerminal,
   escapeHtml, providerIcon, renderStatus, renderRuntime, emptyStatus). */

// Mission Mode is not Claude-only — any agent CLI Termina knows how to run
// in audit vs write mode is assignable per worker. Mirrors mission/adapters.js.
const AGENT_PROVIDERS = ["claude", "codex"];

let missionView = "list"; // "list" | "create" | "detail"
let missionDetailId = null;
let missionCreateState = null; // { objective, workerCount, workspaceRoot, workspaceStrategy, roles, name }
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
      `<span class="mission-row-meta">${workerCount} worker${workerCount === 1 ? "" : "s"} · ${escapeHtml(m.workspaceStrategy)} · ${escapeHtml(m.status)}</span>`;
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

function renderMissionCreateStepObjective(body) {
  const state = missionCreateState || {
    name: "",
    objective: "",
    workspaceRoot: "",
    workerCount: 3,
    workspaceStrategy: "audit",
  };

  const form = document.createElement("div");
  form.className = "mission-form";
  form.innerHTML = `
    <label>Mission name<input id="mf-name" type="text" value="${escapeHtml(state.name)}" placeholder="e.g. Launch readiness audit" /></label>
    <label>Objective<textarea id="mf-objective" rows="4" placeholder="Prepare PhantomForce for launch. Audit the frontend, backend, security...">${escapeHtml(state.objective)}</textarea></label>
    <label>Workspace root (path)<input id="mf-workspace" type="text" value="${escapeHtml(state.workspaceRoot)}" placeholder="C:\\path\\to\\repo" /></label>
    <div class="mission-form-row">
      <label>Workers<input id="mf-count" type="number" min="2" max="10" value="${state.workerCount}" /></label>
      <label>Workspace strategy
        <select id="mf-strategy">
          <option value="audit" ${state.workspaceStrategy === "audit" ? "selected" : ""}>Read-only audit (shared path, no edits)</option>
          <option value="worktrees" ${state.workspaceStrategy === "worktrees" ? "selected" : ""}>Isolated git worktrees (workers can edit)</option>
        </select>
      </label>
    </div>
    <div class="mission-form-actions">
      <button type="button" id="mf-cancel" class="ghost">Cancel</button>
      <button type="button" id="mf-decompose" class="primary">Analyze Objective →</button>
    </div>
    <p id="mf-error" class="mission-error hidden"></p>
  `;
  body.appendChild(form);

  document.getElementById("mf-cancel").addEventListener("click", () => {
    missionCreateState = null;
    missionView = "list";
    renderMissionView();
  });

  document.getElementById("mf-decompose").addEventListener("click", async () => {
    const name = document.getElementById("mf-name").value.trim() || "Untitled mission";
    const objective = document.getElementById("mf-objective").value.trim();
    const workspaceRoot = document.getElementById("mf-workspace").value.trim();
    const workerCount = Math.max(2, Math.min(10, parseInt(document.getElementById("mf-count").value, 10) || 3));
    const workspaceStrategy = document.getElementById("mf-strategy").value;
    const errorEl = document.getElementById("mf-error");
    errorEl.classList.add("hidden");

    if (!objective || !workspaceRoot) {
      errorEl.textContent = "Objective and workspace root are required.";
      errorEl.classList.remove("hidden");
      return;
    }

    const btn = document.getElementById("mf-decompose");
    btn.disabled = true;
    btn.textContent = "Analyzing objective… (this runs a real claude -p call, can take up to ~30s)";

    try {
      const res = await api("/api/missions/decompose", {
        method: "POST",
        body: JSON.stringify({ objective, workerCount, workspaceRoot }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "decomposition failed");
      missionCreateState = { name, objective, workspaceRoot, workerCount, workspaceStrategy, roles: res.roles, decomposeCostUsd: res.costUsd };
      renderMissionView();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = "Analyze Objective →";
      errorEl.textContent = String(err.message || err);
      errorEl.classList.remove("hidden");
    }
  });
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
      const res = await api("/api/missions", {
        method: "POST",
        body: JSON.stringify({
          name: state.name,
          objective: state.objective,
          workspaceRoot: state.workspaceRoot,
          workspaceStrategy: state.workspaceStrategy,
          roles: state.roles,
        }),
      }).then((r) => r.json());
      if (!res.ok) throw new Error(res.error || "mission launch failed");
      attachMissionWorkerTiles(res.mission);
      missionCreateState = null;
      missionView = "detail";
      missionDetailId = res.mission.id;
      renderMissionView();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = `Launch Mission (${state.roles.length} workers)`;
      const el = document.getElementById("mf-launch-error");
      el.textContent = String(err.message || err);
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
    <p class="mission-hint">${escapeHtml(mission.workspaceStrategy)} · ${escapeHtml(mission.workspaceRoot)}</p>
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

  const footer = document.createElement("div");
  footer.className = "mission-detail-footer";
  const synthBtn = document.createElement("button");
  synthBtn.type = "button";
  synthBtn.className = "primary";
  synthBtn.textContent = "Trigger Final Synthesis";
  synthBtn.addEventListener("click", async () => {
    synthBtn.disabled = true;
    synthBtn.textContent = "Synthesizing… (real claude -p call, can take a couple minutes)";
    try {
      const r = await api(`/api/missions/${mission.id}/synthesize`, { method: "POST" }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      renderMissionReport(body, r.markdown);
    } catch (err) {
      synthBtn.textContent = `Synthesis failed: ${err.message}`;
    }
  });
  footer.appendChild(synthBtn);
  body.appendChild(footer);

  const reportRes = await api(`/api/missions/${mission.id}/report`).then((r) => r.json()).catch(() => ({ ok: false }));
  if (reportRes.ok) renderMissionReport(body, reportRes.markdown);

  clearInterval(missionRefreshTimer);
  missionRefreshTimer = setInterval(() => {
    if (missionView === "detail" && missionDetailId === mission.id && !document.getElementById("mission-modal").classList.contains("hidden")) {
      renderMissionDetail();
    }
  }, 4000);
}

function renderMissionReport(body, markdown) {
  let pre = body.querySelector(".mission-report");
  if (!pre) {
    pre = document.createElement("pre");
    pre.className = "mission-report";
    body.appendChild(pre);
  }
  pre.textContent = markdown;
}

function smallMissionBtn(label, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "mw-btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}
