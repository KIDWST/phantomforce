const TOKEN = "ai-demo-owner-token";
const requestedProduct = new URLSearchParams(location.search).get("product") || "phantom-oracle";
const state = { snapshot: null, selectedProductId: requestedProduct, selectedArtifactId: "", editingArtifactId: "", busy: false, online: navigator.onLine, search: "", deleteTarget: "" };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const titleCase = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const requestKey = (prefix) => `${prefix}:${crypto.randomUUID()}`;

function setStatus(message = "", kind = "") { const root = $("#status-region"); root.textContent = message; root.className = `status-region ${kind}`.trim(); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Authorization: `Bearer ${TOKEN}`, ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(payload?.error?.message || `Request failed (${response.status}).`); error.code = payload?.error?.code || "REQUEST_FAILED"; error.fieldErrors = payload?.error?.fieldErrors || []; throw error; }
  return payload;
}
function selectedProduct() { return state.snapshot?.products.find((product) => product.id === state.selectedProductId) || state.snapshot?.products[0] || null; }
function productArtifacts(productId = state.selectedProductId) { return (state.snapshot?.artifacts || []).filter((artifact) => artifact.productId === productId); }
function selectedArtifact() { return (state.snapshot?.artifacts || []).find((artifact) => artifact.id === state.selectedArtifactId) || null; }
function latestAnalysis(artifactId) { return (state.snapshot?.analyses || []).filter((analysis) => analysis.artifactId === artifactId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null; }

function productNav() {
  const query = state.search.toLowerCase(); const products = (state.snapshot?.products || []).filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(query));
  $("#product-nav").innerHTML = products.length ? products.map((product) => {
    const index = state.snapshot.products.findIndex((item) => item.id === product.id) + 1;
    return `<button class="product-link" type="button" data-product="${esc(product.id)}" aria-current="${product.id === state.selectedProductId ? "page" : "false"}" style="--product-accent:${esc(product.accent)}"><span class="number">${String(index).padStart(2, "0")}</span><span class="name">${esc(product.name.replace("PHANTOM ", ""))}</span><span class="dot" aria-hidden="true"></span></button>`;
  }).join("") : `<p class="rail-copy">No product matches that filter.</p>`;
  $("#portfolio-count").textContent = `${state.snapshot?.products.length || 0} fixed products`;
}

function contract(product) {
  document.documentElement.style.setProperty("--accent", product.accent);
  $("#product-category").textContent = product.category; $("#product-title").textContent = product.name; $("#product-tagline").textContent = product.tagline; $("#product-promise").textContent = product.promise;
  $("#product-non-goals").textContent = product.nonGoals.join(" · "); $("#primary-module").textContent = product.primaryModule; $("#object-type").textContent = `Primary durable object: ${titleCase(product.objectType)}`;
  $("#module-list").innerHTML = product.modules.map((module) => `<li>${esc(module)}</li>`).join("");
  $("#analysis-contract").innerHTML = `<b>Task:</b> ${esc(product.analysisContract.taskId)}<br><b>Active path:</b> ${esc(product.analysisContract.activePath)}<br><b>Fallback path:</b> ${esc(product.analysisContract.fallbackPath)}<br><b>External models:</b> off · <b>Cost ceiling:</b> $0 · <b>Human review:</b> required`;
  const entitled = product.entitlement?.status === "active"; $("#entitlement-badge").textContent = entitled ? `${product.entitlement.plan} entitled` : "not entitled"; $("#entitlement-badge").className = `badge ${entitled ? "success" : "danger"}`;
  $("#artifact-count").textContent = String(productArtifacts(product.id).length); $("#analysis-count").textContent = String((state.snapshot?.analyses || []).filter((analysis) => analysis.productId === product.id).length);
}

function consentControls(product) {
  const consent = state.snapshot?.workspace?.consent?.[product.id] || { status: "not_requested" }; const granted = consent.status === "granted";
  $("#consent-badge").textContent = granted ? "consent granted" : consent.status === "withdrawn" ? "consent withdrawn" : "consent needed"; $("#consent-badge").className = `badge ${granted ? "success" : "warning"}`;
  $("#consent-controls").innerHTML = granted ? `<p>Purpose: ${esc(consent.purpose)} Retention intent: ${esc(consent.retentionDays)} days. Withdrawal restricts dependent artifacts and stales analysis.</p><button class="button subtle" type="button" data-consent="withdrawn">Withdraw consent</button>` : `<p>This local workflow stores the entered domain fields and provenance note in the demo workspace. Nothing is sent to an external model or data provider.</p><button class="button primary" type="button" data-consent="granted">Grant 30-day demo consent</button>`;
  return granted;
}

function dynamicForm(product, enabled) {
  $("#dynamic-fields").innerHTML = product.fields.map((definition) => {
    const required = definition.required ? "required" : ""; const label = `${esc(definition.label)}${definition.required ? " <em>required</em>" : ""}`; const help = definition.help ? `<small>${esc(definition.help)}</small>` : "";
    const control = definition.type === "textarea" ? `<textarea name="${esc(definition.id)}" rows="3" maxlength="12000" ${required}></textarea>` : definition.type === "select" ? `<select name="${esc(definition.id)}" ${required}>${definition.options.map((option) => `<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select>` : `<input name="${esc(definition.id)}" type="${esc(definition.type)}" ${definition.type === "number" ? 'step="any"' : ""} ${required} />`;
    return `<label class="field ${definition.type === "textarea" ? "full" : ""}"><span>${label}</span>${control}${help}</label>`;
  }).join("");
  for (const element of $("#artifact-form").elements) element.disabled = !enabled || state.busy;
}

function artifactList(product) {
  const items = productArtifacts(product.id); const root = $("#artifact-list");
  root.innerHTML = items.length ? items.map((artifact) => `<button class="artifact-card" type="button" data-artifact="${esc(artifact.id)}" aria-current="${artifact.id === state.selectedArtifactId}"><span><strong>${esc(artifact.title)}</strong><small>revision ${artifact.revision} · ${esc(new Date(artifact.updatedAt).toLocaleString())}</small></span><span class="badge ${artifact.status === "published" ? "success" : artifact.status === "analysis_review" ? "warning" : ""}">${esc(titleCase(artifact.status))}</span></button>`).join("") : `<div class="empty"><div><h3>No ${esc(product.artifactLabel.toLowerCase())} yet</h3><p>Grant consent, load the reversible demo, and create the first domain object.</p></div></div>`;
}

function renderCell(value) {
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" ? JSON.stringify(item) : item).join("; ");
  if (value && typeof value === "object") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value ?? "—");
}
function renderTable(rows) {
  if (!rows?.length) return ""; const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `<div class="analysis-table-wrap"><table class="analysis-table"><thead><tr>${keys.map((key) => `<th scope="col">${esc(titleCase(key))}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${keys.map((key) => `<td>${esc(renderCell(row[key]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function coreLoopWorkspace(coreLoop) {
  if (!coreLoop) return "";
  const modules = (coreLoop.modules || []).map((module) => `<li>${esc(module)}</li>`).join("");
  const records = Object.entries(coreLoop).filter(([key]) => !["schemaVersion", "productId", "deterministic", "externalProviderUsed", "modules"].includes(key)).map(([key, value]) => {
    const serialized = JSON.stringify(value, null, 2); const preview = serialized.length > 8000 ? `${serialized.slice(0, 8000)}\n… bounded browser preview` : serialized;
    return `<details class="core-record"><summary>${esc(titleCase(key))}</summary><pre>${esc(preview)}</pre></details>`;
  }).join("");
  return `<section class="core-loop" aria-labelledby="core-loop-title"><div class="panel-head"><div><p class="overline">MILESTONE 2</p><h3 id="core-loop-title">Complete core loop</h3></div><span class="badge success">deterministic · $0</span></div><ol class="core-modules">${modules}</ol>${records}</section>`;
}

function analysisWorkspace(product) {
  const root = $("#analysis-workspace"); const artifact = selectedArtifact();
  if (!artifact) { $("#review-badge").textContent = "none selected"; $("#review-badge").className = "badge"; root.className = "analysis-workspace empty"; root.innerHTML = `<div><div class="empty-symbol" aria-hidden="true"></div><h3>Select an artifact</h3><p>Run the product's deterministic domain method, inspect formulas and warnings, then accept, correct, or reject it.</p></div>`; return; }
  const analysis = latestAnalysis(artifact.id); root.className = "analysis-workspace"; $("#review-badge").textContent = analysis ? titleCase(analysis.status) : "not analyzed"; $("#review-badge").className = `badge ${analysis?.status === "pending_review" ? "warning" : analysis?.status === "reviewed" ? "success" : ""}`;
  const evidence = artifact.evidence.map((item) => `<span class="provenance">source · ${esc(item.label)} · ${esc(item.contentHash.slice(0, 10))}</span>`).join("");
  const archiveAction = artifact.status === "archived" ? `<button class="button subtle" type="button" data-restore-archive="${esc(artifact.id)}">Restore</button>` : `<button class="button subtle" type="button" data-archive="${esc(artifact.id)}">Archive</button>`;
  const head = `<div class="selected-head"><div><p class="overline">${esc(product.artifactLabel)}</p><h3>${esc(artifact.title)}</h3><p>${esc(product.name)} · ${esc(titleCase(artifact.status))} · revision ${artifact.revision} · dependency ${esc(artifact.dependencyState || "fresh")}</p></div><div class="actions"><button class="button subtle" type="button" data-edit="${esc(artifact.id)}">Edit source</button><button class="button subtle" type="button" data-export="${esc(artifact.id)}">Export</button><button class="button subtle" type="button" data-duplicate="${esc(artifact.id)}">Duplicate</button>${archiveAction}<button class="button danger" type="button" data-delete="${esc(artifact.id)}">Delete</button></div></div><div class="evidence-row">${evidence}</div>`;
  if (!analysis) { root.innerHTML = `${head}<div class="empty"><div><h3>No analysis yet</h3><p>The calculation will use only declared inputs and preserve source fields.</p><button class="button primary" type="button" data-analyze="${esc(artifact.id)}">Run ${esc(product.primaryModule)} analysis</button></div></div>`; return; }
  if (analysis.status === "stale") { root.innerHTML = `${head}<div class="review-box stale-state"><b>Previous analysis is stale</b><p>${esc(analysis.staleReason || artifact.dependencyReason || "A source dependency changed.")} The prior output is preserved in history but cannot be accepted as current.</p><button class="button primary" type="button" data-analyze="${esc(artifact.id)}">Run updated ${esc(product.primaryModule)} analysis</button></div>`; return; }
  const output = analysis.output; const metrics = output.metrics.map((item) => `<div class="metric-card"><small>${esc(item.name)}</small><b>${esc(item.value)} ${esc(item.unit)}</b><details><summary>Formula and inputs</summary><p>${esc(item.formula)}</p><p>${esc(JSON.stringify(item.inputs))}</p><p>Rounding: ${esc(item.rounding)}</p></details></div>`).join("");
  const warnings = output.warnings.length ? `<ul class="warning-list">${output.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : "";
  const review = analysis.status === "pending_review" ? `<div class="review-box"><label class="field full"><span>Human correction (required only for Correct)</span><textarea id="correction-text" rows="3" maxlength="4000" placeholder="Record the unsupported assumption, wrong input, or missing caveat."></textarea></label><div class="actions"><button class="button primary" type="button" data-review="accepted">Accept</button><button class="button subtle" type="button" data-review="corrected">Correct and accept</button><button class="button danger" type="button" data-review="rejected">Reject</button></div></div>` : `<div class="review-box"><b>Human disposition: ${esc(titleCase(analysis.finalDisposition))}</b>${analysis.correction ? `<p>${esc(analysis.correction)}</p>` : ""}<p>Source artifact fields remain unchanged.</p></div>`;
  const deleteConfirmation = state.deleteTarget === artifact.id ? `<div class="review-box" role="alertdialog" aria-labelledby="delete-title" aria-describedby="delete-description"><b id="delete-title">Delete this artifact?</b><p id="delete-description">A recoverable local copy is retained for 30 days. The exact identifier is sent as confirmation.</p><div class="actions"><button class="button danger" type="button" data-confirm-delete="${esc(artifact.id)}">Confirm exact deletion</button><button class="button subtle" type="button" data-cancel-delete>Cancel</button></div></div>` : "";
  root.innerHTML = `${head}<p>${esc(output.summary)}</p><div class="metric-grid">${metrics}</div><p class="method"><b>Method:</b> ${esc(output.method)}</p>${warnings}${renderTable(output.table)}${coreLoopWorkspace(output.coreLoop)}<p class="details-copy">Provider path: ${esc(analysis.providerPath)} · External model used: no · Cost: $0 · Claims: ${output.claims.length} · Review required: yes</p>${review}${deleteConfirmation}`;
}

function diagnostics() {
  const value = state.snapshot?.diagnostics; if (!value) return; $("#diagnostic-state").textContent = value.ok ? "local service active" : "degraded"; $("#schema-value").textContent = `v${value.schemaVersion}`; $("#pending-value").textContent = String(value.pendingReviewCount);
}
function render() {
  if (!state.snapshot) return; const product = selectedProduct(); $("#workspace-name").textContent = `${state.snapshot.workspace.name} · ${state.snapshot.workspace.role}`;
  productNav(); contract(product); const consent = consentControls(product); dynamicForm(product, consent); artifactList(product); analysisWorkspace(product); diagnostics(); $("#main").setAttribute("aria-busy", String(state.busy)); $("#create-title").textContent = state.editingArtifactId ? "Edit versioned source" : "Create domain artifact"; $("#create-button").textContent = state.editingArtifactId ? "Save revision" : "Create artifact"; $("#service-label").textContent = state.online ? "Local service active" : "Browser offline"; $(".service-dot").className = `service-dot ${state.online ? "online" : ""}`;
}
async function refresh({ preserveStatus = false } = {}) {
  if (!preserveStatus) setStatus("Loading the governed domain workspace…");
  try { state.snapshot = await api("/api/v1/snapshot"); if (!state.snapshot.products.some((product) => product.id === state.selectedProductId)) state.selectedProductId = state.snapshot.products[0]?.id || ""; if (state.selectedArtifactId && !state.snapshot.artifacts.some((item) => item.id === state.selectedArtifactId)) state.selectedArtifactId = ""; render(); if (!preserveStatus) setStatus(""); }
  catch (error) { setStatus(`Local service unavailable. Source work remains on disk. ${error.message}`, "error"); }
}
async function withBusy(action, successMessage) {
  if (state.busy) return; state.busy = true; setStatus("Working through the durable local job…", "loading"); render();
  try { await action(); await refresh({ preserveStatus: true }); setStatus(successMessage); }
  catch (error) { const fields = error.fieldErrors?.map((item) => `${item.field}: ${item.message}`).join(" "); setStatus(`${error.message}${fields ? ` ${fields}` : ""}`, "error"); }
  finally { state.busy = false; render(); }
}

document.addEventListener("click", async (event) => {
  const productButton = event.target.closest("[data-product]");
  if (productButton) { state.selectedProductId = productButton.dataset.product; history.replaceState(null, "", `/?product=${encodeURIComponent(state.selectedProductId)}`); state.selectedArtifactId = ""; state.editingArtifactId = ""; state.deleteTarget = ""; document.body.classList.remove("nav-open"); $("#menu-button").setAttribute("aria-expanded", "false"); render(); $("#main").focus(); return; }
  const artifactButton = event.target.closest("[data-artifact]"); if (artifactButton) { state.selectedArtifactId = artifactButton.dataset.artifact; state.deleteTarget = ""; render(); return; }
  const consentButton = event.target.closest("[data-consent]"); if (consentButton) { const status = consentButton.dataset.consent; await withBusy(() => api(`/api/v1/products/${state.selectedProductId}/consent`, { method: "POST", body: JSON.stringify({ status, purpose: "Create, calculate, review, export, and delete local domain artifacts.", retentionDays: 30 }) }), status === "granted" ? "Consent granted for this product." : "Consent withdrawn; dependent artifacts are restricted and analyses are stale."); return; }
  const analyzeButton = event.target.closest("[data-analyze]"); if (analyzeButton) { await withBusy(() => api(`/api/v1/artifacts/${analyzeButton.dataset.analyze}/analyses`, { method: "POST", headers: { "Idempotency-Key": requestKey("analysis") }, body: "{}" }), "Domain analysis calculated and held for human review."); return; }
  const reviewButton = event.target.closest("[data-review]"); if (reviewButton) { const analysis = latestAnalysis(state.selectedArtifactId); const correction = $("#correction-text")?.value || ""; const decision = reviewButton.dataset.review; await withBusy(() => api(`/api/v1/analyses/${analysis.id}/review`, { method: "POST", headers: { "Idempotency-Key": requestKey("review") }, body: JSON.stringify({ decision, correction }) }), `Analysis ${decision}. Source fields were preserved.`); return; }
  const editButton = event.target.closest("[data-edit]"); if (editButton) { const artifact = state.snapshot.artifacts.find((item) => item.id === editButton.dataset.edit); if (!artifact) return; state.editingArtifactId = artifact.id; render(); const form = $("#artifact-form"); for (const [name, value] of Object.entries(artifact.fields)) if (form.elements[name]) form.elements[name].value = value; const source = artifact.evidence?.at(-1); form.elements.evidenceNote.value = source?.content || ""; form.elements.evidenceLabel.value = source?.label || ""; setStatus(`Editing revision ${artifact.revision}. Saving will stale dependent analysis and preserve version history.`); $(".create-panel").scrollIntoView({ behavior: "smooth", block: "start" }); form.elements[0]?.focus(); return; }
  const duplicateButton = event.target.closest("[data-duplicate]"); if (duplicateButton) { await withBusy(async () => { const result = await api(`/api/v1/artifacts/${duplicateButton.dataset.duplicate}/duplicate`, { method: "POST", headers: { "Idempotency-Key": requestKey("duplicate") }, body: "{}" }); state.selectedArtifactId = result.artifact.id; }, "Artifact duplicated with independent provenance IDs."); return; }
  const archiveButton = event.target.closest("[data-archive]"); if (archiveButton) { await withBusy(async () => { await api(`/api/v1/artifacts/${archiveButton.dataset.archive}/archive`, { method: "POST", body: "{}" }); state.selectedArtifactId = ""; }, "Artifact archived and removed from active work."); return; }
  const restoreArchive = event.target.closest("[data-restore-archive]"); if (restoreArchive) { await withBusy(() => api(`/api/v1/artifacts/${restoreArchive.dataset.restoreArchive}/restore-archive`, { method: "POST", body: "{}" }), "Archived artifact restored to a draft state."); return; }
  const exportButton = event.target.closest("[data-export]"); if (exportButton) { try { const response = await fetch(`/api/v1/artifacts/${exportButton.dataset.export}/export`, { headers: { Authorization: `Bearer ${TOKEN}` } }); if (!response.ok) throw new Error("Export could not be created."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `phantom-ai-${exportButton.dataset.export}.json`; anchor.click(); URL.revokeObjectURL(url); setStatus("Portable source-linked JSON export created locally."); } catch (error) { setStatus(error.message, "error"); } return; }
  const deleteButton = event.target.closest("[data-delete]"); if (deleteButton) { state.deleteTarget = deleteButton.dataset.delete; render(); $("[data-confirm-delete]")?.focus(); return; }
  if (event.target.closest("[data-cancel-delete]")) { state.deleteTarget = ""; render(); return; }
  const confirmDelete = event.target.closest("[data-confirm-delete]"); if (confirmDelete) { const id = confirmDelete.dataset.confirmDelete; await withBusy(async () => { await api(`/api/v1/artifacts/${id}`, { method: "DELETE", headers: { "X-Confirm-Delete": `DELETE ${id}` } }); state.selectedArtifactId = ""; state.deleteTarget = ""; }, "Artifact deleted with a 30-day local recovery record."); }
});

$("#artifact-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const product = selectedProduct(); const form = new FormData(event.currentTarget); const fields = Object.fromEntries(product.fields.map((definition) => [definition.id, form.get(definition.id)])); const evidenceNote = form.get("evidenceNote"); const evidenceLabel = form.get("evidenceLabel");
  if (state.editingArtifactId) {
    const artifact = state.snapshot.artifacts.find((item) => item.id === state.editingArtifactId); await withBusy(async () => { const result = await api(`/api/v1/artifacts/${artifact.id}`, { method: "PATCH", headers: { "Idempotency-Key": requestKey("artifact-update") }, body: JSON.stringify({ expectedRevision: artifact.revision, fields }) }); state.selectedArtifactId = result.artifact.id; state.editingArtifactId = ""; }, `${product.artifactLabel} revision saved; dependent analysis is stale until recomputed.`); return;
  }
  await withBusy(async () => { const result = await api(`/api/v1/products/${product.id}/artifacts`, { method: "POST", headers: { "Idempotency-Key": requestKey("artifact") }, body: JSON.stringify({ fields, evidenceNote, evidenceLabel }) }); state.selectedArtifactId = result.artifact.id; }, `${product.artifactLabel} created and persisted locally.`);
});
$("#sample-button").addEventListener("click", () => { const form = $("#artifact-form"); const product = selectedProduct(); for (const [name, value] of Object.entries(product.sample)) if (form.elements[name]) form.elements[name].value = value; form.elements.evidenceNote.value = `Reversible ${product.name} demo fixture. Values are declared planning inputs, not external facts.`; form.elements.evidenceLabel.value = "Versioned local demo fixture"; setStatus("Demo loaded into the form. Nothing is persisted until Create artifact is selected."); });
$("#clear-button").addEventListener("click", () => { $("#artifact-form").reset(); state.editingArtifactId = ""; render(); setStatus("Unsaved domain input cleared; edit mode canceled."); });
$("#product-search").addEventListener("input", (event) => { state.search = event.target.value; productNav(); });
$("#refresh-button").addEventListener("click", () => refresh());
$("#theme-button").addEventListener("click", () => { const light = document.documentElement.dataset.theme !== "light"; document.documentElement.dataset.theme = light ? "light" : "dark"; $("#theme-button").textContent = light ? "Dark" : "Light"; });
$("#menu-button").addEventListener("click", () => { const open = document.body.classList.toggle("nav-open"); $("#menu-button").setAttribute("aria-expanded", String(open)); });
window.addEventListener("keydown", (event) => { if (event.key === "Escape") { document.body.classList.remove("nav-open"); $("#menu-button").setAttribute("aria-expanded", "false"); } if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { event.preventDefault(); $("#product-search").focus(); } });
window.addEventListener("online", () => { state.online = true; refresh({ preserveStatus: true }); setStatus("Connection restored. Persisted work refreshed."); });
window.addEventListener("offline", () => { state.online = false; render(); setStatus("Browser offline. Existing state remains visible; mutations are paused.", "error"); });

refresh();
