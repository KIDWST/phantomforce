/* Mission DVR — a scrub timeline across every isolated worker in a mission,
   with checkpoint markers and a token-cost sparkline. Scrubbing replays a
   worker's recorded frames into a detached, read-only pane — it never
   touches the worker's live PTY session or its WebSocket. Branching from a
   checkpoint opens a brand-new sibling tile; the original worker is never
   interrupted. Shares globals from app.js/mission.js (api, escapeHtml). */

const TIMELINE_BRANCH_CAVEAT =
  "Branching restores this worker's FILES to this point in time and starts a fresh live agent there. " +
  "It does not resume the original process, memory, or any running dev server — only the filesystem and a summary of what happened.";

async function mountTimeline(container, missionId) {
  container.innerHTML = `<p class="timeline-loading">Loading recordings…</p>`;

  const [missionRes, checkpointsRes, tokensRes] = await Promise.all([
    api(`/api/missions/${missionId}`).then((r) => r.json()).catch(() => ({ ok: false })),
    api(`/api/missions/${missionId}/checkpoints`).then((r) => r.json()).catch(() => ({ ok: false })),
    api(`/api/missions/${missionId}/tokens`).then((r) => r.json()).catch(() => ({ ok: false })),
  ]);
  if (!missionRes.ok || !checkpointsRes.ok || !tokensRes.ok) {
    container.innerHTML = `<p class="timeline-error">Could not load timeline data.</p>`;
    return;
  }

  const mission = missionRes.mission;
  const checkpoints = checkpointsRes.checkpoints;
  const history = tokensRes.history;
  const workers = mission.workers.filter((w) => w.branch); // only isolated workers ever get checkpoints/recordings

  if (!workers.length) {
    container.innerHTML =
      `<p class="timeline-empty">No isolated workers on this mission — nothing to record. ` +
      `Timeline is only available for write-mode workers in isolated worktrees.</p>`;
    return;
  }

  const starts = workers.map((w) => new Date(w.startedAt ?? mission.createdAt).getTime()).filter((t) => !Number.isNaN(t));
  const start = starts.length ? Math.min(...starts) : mission.createdAt;
  const end = Date.now();
  const span = Math.max(end - start, 1000);

  container.innerHTML = `
    <p class="timeline-caveat">${escapeHtml(TIMELINE_BRANCH_CAVEAT)}</p>
    <div class="timeline-scrub" title="Click anywhere to replay the mission at that moment"></div>
    <div class="timeline-tracks"></div>
    <div class="timeline-replay hidden">
      <div class="timeline-replay-head">
        <span class="timeline-replay-badge">REPLAY</span>
        <button type="button" class="timeline-replay-exit">Back to live</button>
      </div>
      <pre class="timeline-replay-output"></pre>
    </div>
  `;

  const tracks = container.querySelector(".timeline-tracks");
  for (const worker of workers) {
    const track = document.createElement("div");
    track.className = "timeline-track";
    track.dataset.workerId = worker.id;
    track.innerHTML = `
      <div class="timeline-track-label">${escapeHtml(worker.name)}</div>
      <div class="timeline-track-lane"></div>
      <svg class="timeline-sparkline" preserveAspectRatio="none" viewBox="0 0 100 100"></svg>
    `;
    tracks.appendChild(track);

    const lane = track.querySelector(".timeline-track-lane");
    for (const cp of checkpoints.filter((c) => c.workerId === worker.id)) {
      const pct = (((cp.ts - start) / span) * 100).toFixed(2);
      const tick = document.createElement("button");
      tick.type = "button";
      tick.className = "timeline-checkpoint-tick";
      tick.style.left = `${pct}%`;
      tick.title = `${cp.ledgerEventType} — ${new Date(cp.ts).toLocaleTimeString()}`;
      tick.addEventListener("click", (e) => {
        e.stopPropagation();
        openBranchPopover(tick, missionId, worker, cp);
      });
      lane.appendChild(tick);
    }

    const spark = track.querySelector(".timeline-sparkline");
    renderTimelineSparkline(spark, history.filter((h) => h.workerId === worker.id), start, span);
  }

  const scrub = container.querySelector(".timeline-scrub");
  scrub.addEventListener("click", async (e) => {
    const rect = scrub.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const ts = start + pct * span;
    await enterTimelineReplay(container, missionId, workers, ts);
  });

  container.querySelector(".timeline-replay-exit").addEventListener("click", () => {
    container.querySelector(".timeline-replay").classList.add("hidden");
  });
}

function renderTimelineSparkline(svg, samples, start, span) {
  if (!samples.length) return;
  const maxCost = Math.max(...samples.map((s) => s.costUsd ?? 0), 0.01);
  const points = samples
    .map((s) => {
      const x = (((s.ts - start) / span) * 100).toFixed(2);
      const y = (100 - Math.min(100, ((s.costUsd ?? 0) / maxCost) * 100)).toFixed(2);
      return `${x},${y}`;
    })
    .join(" ");
  svg.innerHTML = `<polyline points="${points}" fill="none" stroke="currentColor" stroke-width="2" />`;
}

// v1 replays the first worker's track in the pane; multi-pane synchronized
// replay across every worker at once is a natural follow-up, not required
// for the core "scrub to a point in time and see what happened" value.
async function enterTimelineReplay(container, missionId, workers, ts) {
  const replay = container.querySelector(".timeline-replay");
  const output = replay.querySelector(".timeline-replay-output");
  replay.classList.remove("hidden");
  replay.querySelector(".timeline-replay-badge").textContent = `REPLAY — ${new Date(ts).toLocaleTimeString()}`;
  output.textContent = "Loading recorded output…";

  const worker = workers[0];
  const res = await api(`/api/missions/${missionId}/recordings/${worker.id}`).then((r) => r.json()).catch(() => ({ ok: false }));
  if (!res.ok) {
    output.textContent = "Recording unavailable for this worker.";
    return;
  }
  const upTo = res.frames.filter((f) => f.ts <= ts).map((f) => f.data);
  output.textContent = upTo.join("");
}

function openBranchPopover(anchor, missionId, worker, checkpoint) {
  document.querySelector(".timeline-branch-popover")?.remove();

  const popover = document.createElement("div");
  popover.className = "timeline-branch-popover";
  popover.innerHTML = `
    <p class="timeline-branch-caveat">${escapeHtml(TIMELINE_BRANCH_CAVEAT)}</p>
    <input type="text" class="timeline-branch-note" placeholder="Optional note for the new worker" />
    <div class="timeline-branch-actions">
      <button type="button" class="mw-btn timeline-branch-cancel">Cancel</button>
      <button type="button" class="primary timeline-branch-confirm">Branch from here</button>
    </div>
  `;
  const rect = anchor.getBoundingClientRect();
  popover.style.left = `${rect.left}px`;
  popover.style.top = `${rect.bottom + 6}px`;
  document.body.appendChild(popover);

  const removePopover = (e) => {
    if (!popover.contains(e.target) && e.target !== anchor) {
      popover.remove();
      document.removeEventListener("click", removePopover);
    }
  };
  setTimeout(() => document.addEventListener("click", removePopover), 0);

  popover.querySelector(".timeline-branch-cancel").addEventListener("click", () => popover.remove());
  popover.querySelector(".timeline-branch-confirm").addEventListener("click", async () => {
    const note = popover.querySelector(".timeline-branch-note").value.trim();
    const confirmBtn = popover.querySelector(".timeline-branch-confirm");
    confirmBtn.disabled = true;
    confirmBtn.textContent = "Branching…";
    const res = await api(`/api/missions/${missionId}/workers/${worker.id}/branch`, {
      method: "POST",
      body: JSON.stringify({ checkpointSha: checkpoint.sha, note: note || undefined }),
    }).then((r) => r.json()).catch(() => ({ ok: false, error: "network_error" }));
    popover.remove();
    if (!res.ok) {
      window.alert(`Branch failed: ${friendlyError(res.error)}`);
    } else {
      renderMissionView();
    }
  });
}
