/* PhantomForce Asset Cloud — the business's creative memory.
   A polished media library over the real org-scoped backend: upload (drag or
   pick), search, filter, organize, favorite, brand, version, archive/trash,
   and reuse anywhere. Every action is a real server call; nothing here is a
   decorative button. Renders only for database-auth sessions with an active
   org (assetsAvailable) — otherwise the surface shows a clear sign-in note. */

import { ctx } from "./store.js?v=phantom-live-20260719-56";
import {
  assetsAvailable, canManageActiveOrg, uploadAsset, listAssets, fetchAsset,
  patchAsset, assetLifecycle, deleteAsset, restoreAssetVersion,
  listAssetFolders, createAssetFolder, assetBlobUrl, saveToAssetCloud,
} from "./orgs.js?v=phantom-live-20260719-56";

export { saveToAssetCloud };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtSize = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const KIND_ICON = { image: "🖼️", video: "🎬", audio: "🎵", font: "🔤", document: "📄", element: "✦", other: "◻︎" };

const VIEWS = [
  ["library", "All assets"], ["favorites", "Favorites"], ["brand", "Brand"],
  ["archived", "Archived"], ["trash", "Trash"],
];
const KIND_FILTERS = [
  ["", "Any type"], ["image", "Images"], ["video", "Video"], ["audio", "Audio"],
  ["font", "Fonts"], ["element", "Elements"], ["document", "Docs"],
];

const ui = {
  view: "library", kind: "", search: "", sort: "newest", orientation: "",
  folderId: "", folders: [], busy: false, openAssetId: null,
};
let searchTimer = null;

/* revoke blob URLs from the previous render so we don't leak memory */
let liveBlobUrls = [];
function trackBlob(url) { if (url) liveBlobUrls.push(url); return url; }
function releaseBlobs() { liveBlobUrls.forEach((u) => URL.revokeObjectURL(u)); liveBlobUrls = []; }

export function renderAssetCloud(el) {
  if (!assetsAvailable()) {
    el.innerHTML = `
      <div class="ac-signin">
        <div class="ac-signin-card">
          <h3>Asset Cloud is your business's creative memory.</h3>
          <p>Sign in to a business account to upload, organize, and reuse your real logos, photos, video, audio, and brand assets everywhere in PhantomForce.</p>
        </div>
      </div>`;
    return;
  }
  el.innerHTML = shell();
  wire(el);
  loadFolders(el);
  loadAssets(el);
}

function shell() {
  const manager = canManageActiveOrg();
  return `
    <div class="ac">
      <div class="ac-drop" data-ac-drop hidden><div class="ac-drop-inner">Drop files to add them to your library</div></div>

      <header class="ac-head">
        <div class="ac-head-main">
          <h3>Asset Cloud</h3>
          <p>Your business's creative memory — reuse it anywhere in PhantomForce.</p>
        </div>
        <div class="ac-head-actions">
          <label class="btn btn-primary ac-upload-btn">
            Upload
            <input type="file" data-ac-file multiple accept="image/*,video/*,audio/*,.woff,.woff2,.ttf,.otf,.pdf,.svg" hidden />
          </label>
        </div>
      </header>

      <nav class="ac-views" role="tablist">
        ${VIEWS.map(([id, label]) => `<button class="ac-view ${ui.view === id ? "is-active" : ""}" data-ac-view="${id}" role="tab">${esc(label)}</button>`).join("")}
      </nav>

      <div class="ac-toolbar">
        <input class="ac-search" data-ac-search type="search" placeholder="Search titles, tags…" value="${esc(ui.search)}" />
        <select class="ac-select" data-ac-kind>${KIND_FILTERS.map(([v, l]) => `<option value="${v}" ${ui.kind === v ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>
        <select class="ac-select" data-ac-orientation>
          <option value="" ${ui.orientation === "" ? "selected" : ""}>Any shape</option>
          <option value="landscape" ${ui.orientation === "landscape" ? "selected" : ""}>Landscape</option>
          <option value="portrait" ${ui.orientation === "portrait" ? "selected" : ""}>Portrait</option>
          <option value="square" ${ui.orientation === "square" ? "selected" : ""}>Square</option>
        </select>
        <select class="ac-select" data-ac-sort>
          <option value="newest" ${ui.sort === "newest" ? "selected" : ""}>Newest</option>
          <option value="oldest" ${ui.sort === "oldest" ? "selected" : ""}>Oldest</option>
          <option value="name" ${ui.sort === "name" ? "selected" : ""}>Name</option>
          <option value="largest" ${ui.sort === "largest" ? "selected" : ""}>Largest</option>
        </select>
        <select class="ac-select" data-ac-folder>
          <option value="" ${ui.folderId === "" ? "selected" : ""}>All folders</option>
          ${ui.folders.map((f) => `<option value="${esc(f.id)}" ${ui.folderId === f.id ? "selected" : ""}>${esc(f.name)} (${f.assetCount})</option>`).join("")}
        </select>
        ${manager ? `<button class="btn btn-quiet ac-newfolder" data-ac-newfolder type="button">New folder</button>` : ""}
      </div>

      <div class="ac-grid" data-ac-grid><div class="ac-loading">Loading your library…</div></div>
      <div class="ac-detail" data-ac-detail hidden></div>
    </div>`;
}

async function loadFolders(el) {
  ui.folders = await listAssetFolders().catch(() => []);
  const select = el.querySelector("[data-ac-folder]");
  if (select) {
    select.innerHTML = `<option value="">All folders</option>` +
      ui.folders.map((f) => `<option value="${esc(f.id)}" ${ui.folderId === f.id ? "selected" : ""}>${esc(f.name)} (${f.assetCount})</option>`).join("");
  }
}

async function loadAssets(el) {
  const grid = el.querySelector("[data-ac-grid]");
  if (!grid) return;
  const { assets } = await listAssets({
    view: ui.view, kind: ui.kind || undefined, search: ui.search || undefined,
    sort: ui.sort, orientation: ui.orientation || undefined, folder_id: ui.folderId || undefined,
    limit: 60,
  });
  if (!document.body.contains(grid)) return;
  releaseBlobs();
  if (!assets.length) {
    grid.innerHTML = `<div class="ac-empty">${ui.search || ui.kind ? "No assets match these filters." : ui.view === "trash" ? "Trash is empty." : "No assets yet — upload your first one."}</div>`;
    return;
  }
  grid.innerHTML = assets.map(assetCard).join("");
  /* lazily load real thumbnails as blob URLs (bearer auth required) */
  for (const asset of assets) {
    if (asset.kind === "image" && asset.has_thumbnail) {
      assetBlobUrl(asset.id, "thumbnail").then((url) => {
        if (!url) return;
        const img = grid.querySelector(`[data-ac-thumb="${asset.id}"]`);
        if (img) { img.style.backgroundImage = `url(${trackBlob(url)})`; img.classList.add("is-loaded"); }
      });
    }
  }
}

function assetCard(asset) {
  const flags = asset.flags || {};
  return `
    <button class="ac-card" data-ac-open="${esc(asset.id)}" type="button" draggable="true" data-ac-drag="${esc(asset.id)}">
      <div class="ac-thumb ac-thumb-${esc(asset.kind)}" data-ac-thumb="${esc(asset.id)}">
        ${asset.kind === "image" && asset.has_thumbnail ? "" : `<span class="ac-thumb-ic">${KIND_ICON[asset.kind] || "◻︎"}</span>`}
        ${asset.state === "processing" ? `<span class="ac-badge ac-badge-proc">processing</span>` : ""}
        ${asset.state === "failed" ? `<span class="ac-badge ac-badge-fail">failed</span>` : ""}
        ${asset.favorite ? `<span class="ac-star" title="Favorite">★</span>` : ""}
        ${asset.brand ? `<span class="ac-brandtag" title="Brand asset">brand</span>` : ""}
      </div>
      <div class="ac-card-meta">
        <b>${esc(asset.title)}</b>
        <i>${esc(asset.kind)}${asset.width ? ` · ${asset.width}×${asset.height}` : ""} · ${fmtSize(asset.sizeBytes)}${flags.official ? " · official" : ""}</i>
      </div>
    </button>`;
}

async function openDetail(el, assetId) {
  const detail = el.querySelector("[data-ac-detail]");
  if (!detail) return;
  ui.openAssetId = assetId;
  detail.hidden = false;
  detail.innerHTML = `<div class="ac-loading">Loading…</div>`;
  const data = await fetchAsset(assetId);
  if (!data || !data.asset) { detail.hidden = true; return; }
  const a = data.asset;
  const flags = a.flags || {};
  const manager = canManageActiveOrg();
  const previewUrl = a.kind === "image" ? await assetBlobUrl(assetId, "file") : null;
  detail.innerHTML = `
    <div class="ac-detail-panel">
      <button class="ac-detail-x" data-ac-close type="button" aria-label="Close">×</button>
      <div class="ac-detail-preview">
        ${a.kind === "image" && previewUrl ? `<img src="${trackBlob(previewUrl)}" alt="${esc(a.title)}" />`
          : a.kind === "video" ? `<div class="ac-detail-nopreview"><span>🎬</span><p>Video preview isn't generated on this host. The original is stored and downloadable.</p></div>`
          : `<div class="ac-detail-nopreview"><span>${KIND_ICON[a.kind] || "◻︎"}</span><p>${esc(a.kind)} asset</p></div>`}
      </div>
      <div class="ac-detail-body">
        <input class="ac-detail-title" data-ac-title value="${esc(a.title)}" ${flags.locked ? "disabled" : ""} />
        <div class="ac-detail-facts">
          <span><b>Type</b>${esc(a.mimeType)}</span>
          ${a.width ? `<span><b>Size</b>${a.width}×${a.height}</span>` : ""}
          <span><b>File</b>${fmtSize(a.sizeBytes)}</span>
          <span><b>Version</b>v${a.version}</span>
          <span><b>Source</b>${esc(a.source)}</span>
          <span><b>Added</b>${new Date(a.createdAt).toLocaleDateString()}</span>
        </div>
        <label class="ac-detail-tags-l">Tags
          <input class="ac-detail-tags" data-ac-tags value="${esc((a.tags || []).join(", "))}" placeholder="comma, separated" ${flags.locked ? "disabled" : ""} />
        </label>
        <div class="ac-detail-toggles">
          <button class="ac-toggle ${a.favorite ? "is-on" : ""}" data-ac-fav type="button">★ Favorite</button>
          ${manager ? `<button class="ac-toggle ${a.brand ? "is-on" : ""}" data-ac-brand type="button">Brand asset</button>` : ""}
        </div>
        ${manager ? `<div class="ac-detail-flags">
          ${["official", "approved", "deprecated", "clientFacing", "aiReferenceAllowed", "downloadAllowed", "locked"].map((k) => `
            <label class="ac-flag"><input type="checkbox" data-ac-flag="${k}" ${flags[k] ? "checked" : ""} /> ${k.replace(/([A-Z])/g, " $1").toLowerCase()}</label>`).join("")}
        </div>` : ""}
        ${data.usage && data.usage.length ? `<div class="ac-usage"><b>Used in ${data.usage.length} place(s):</b> ${data.usage.map((u) => esc(u.refLabel)).join(", ")}</div>` : ""}
        ${data.versions && data.versions.length ? `<div class="ac-versions"><b>Version history</b>${data.versions.map((v) => `<button class="ac-version" data-ac-restore="${v.versionNumber}" type="button">v${v.versionNumber} · ${fmtSize(v.sizeBytes)} · restore</button>`).join("")}</div>` : ""}
        <div class="ac-detail-actions">
          <button class="btn btn-quiet" data-ac-save type="button" ${flags.locked ? "disabled" : ""}>Save changes</button>
          ${ui.view === "trash"
            ? `<button class="btn btn-quiet" data-ac-life="restore" type="button">Restore</button>${manager ? `<button class="btn btn-danger" data-ac-delete type="button">Delete forever</button>` : ""}`
            : `<button class="btn btn-quiet" data-ac-life="${a.archivedAt ? "unarchive" : "archive"}" type="button">${a.archivedAt ? "Unarchive" : "Archive"}</button>
               <button class="btn btn-quiet" data-ac-life="trash" type="button">Move to trash</button>`}
        </div>
      </div>
    </div>`;
  wireDetail(el, a);
}

function wireDetail(el, asset) {
  const detail = el.querySelector("[data-ac-detail]");
  const close = () => { detail.hidden = true; ui.openAssetId = null; };
  detail.querySelector("[data-ac-close]")?.addEventListener("click", close);
  detail.querySelector("[data-ac-fav]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget; /* capture before await — the event is gone after */
    const on = !btn.classList.contains("is-on");
    const r = await patchAsset(asset.id, { favorite: on });
    if (r.ok) { btn.classList.toggle("is-on", on); loadAssets(el); }
  });
  detail.querySelector("[data-ac-brand]")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    const on = !btn.classList.contains("is-on");
    const r = await patchAsset(asset.id, { brand: on });
    if (r.ok) { btn.classList.toggle("is-on", on); loadAssets(el); }
  });
  detail.querySelector("[data-ac-save]")?.addEventListener("click", async () => {
    const title = detail.querySelector("[data-ac-title]")?.value.trim();
    const tags = detail.querySelector("[data-ac-tags]")?.value.split(",").map((t) => t.trim()).filter(Boolean);
    const flags = {};
    detail.querySelectorAll("[data-ac-flag]").forEach((cb) => { flags[cb.dataset.acFlag] = cb.checked; });
    const patch = { title, tags };
    if (canManageActiveOrg()) patch.flags = flags;
    const r = await patchAsset(asset.id, patch);
    if (r.ok) { detail.hidden = true; loadAssets(el); loadFolders(el); }
    else notifyInline(el, r.error === "asset_locked" ? "This asset is locked." : `Save failed: ${r.error}`);
  });
  detail.querySelectorAll("[data-ac-life]").forEach((btn) => btn.addEventListener("click", async () => {
    const r = await assetLifecycle(asset.id, btn.dataset.acLife);
    if (r.ok) {
      if (btn.dataset.acLife === "trash" && r.warnings?.length) {
        notifyInline(el, `Moved to trash. It was used in ${r.warnings.length} place(s): ${r.warnings.map((w) => w.refLabel).join(", ")}`);
      }
      detail.hidden = true; loadAssets(el); loadFolders(el);
    }
  }));
  detail.querySelector("[data-ac-delete]")?.addEventListener("click", async () => {
    if (!confirm("Delete this asset forever? This cannot be undone.")) return;
    const r = await deleteAsset(asset.id);
    if (r.ok) {
      if (r.dependency_warnings?.length) notifyInline(el, `Deleted. It had been used in ${r.dependency_warnings.length} place(s).`);
      detail.hidden = true; loadAssets(el);
    } else notifyInline(el, `Delete failed: ${r.error}`);
  });
  detail.querySelectorAll("[data-ac-restore]").forEach((btn) => btn.addEventListener("click", async () => {
    const r = await restoreAssetVersion(asset.id, Number(btn.dataset.acRestore));
    if (r.ok) { openDetail(el, asset.id); loadAssets(el); }
  }));
}

function notifyInline(el, message) {
  const bar = document.createElement("div");
  bar.className = "ac-toast";
  bar.textContent = message;
  el.querySelector(".ac")?.appendChild(bar);
  setTimeout(() => bar.remove(), 5200);
}

/* ---------------- ingestion ---------------- */

async function ingestFiles(el, files) {
  const list = [...files].filter(Boolean);
  if (!list.length) return;
  ui.busy = true;
  let added = 0, skipped = 0, failed = 0;
  for (const file of list) {
    const dataUrl = await readAsDataUrl(file).catch(() => null);
    if (!dataUrl) { failed += 1; continue; }
    const r = await uploadAsset(dataUrl, file.name, { source: "upload", onDuplicate: "keep_both" });
    if (r.ok) { r.deduplicated ? (skipped += 1) : (added += 1); }
    else { failed += 1; }
  }
  ui.busy = false;
  notifyInline(el, `Added ${added} asset${added === 1 ? "" : "s"}${skipped ? `, ${skipped} already in library` : ""}${failed ? `, ${failed} failed (unsupported or too large)` : ""}.`);
  loadAssets(el);
  loadFolders(el);
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- wiring ---------------- */

function wire(el) {
  const rerenderGrid = () => loadAssets(el);
  el.querySelectorAll("[data-ac-view]").forEach((btn) => btn.addEventListener("click", () => {
    ui.view = btn.dataset.acView;
    el.querySelectorAll("[data-ac-view]").forEach((b) => b.classList.toggle("is-active", b === btn));
    rerenderGrid();
  }));
  el.querySelector("[data-ac-search]")?.addEventListener("input", (e) => {
    ui.search = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(rerenderGrid, 260);
  });
  el.querySelector("[data-ac-kind]")?.addEventListener("change", (e) => { ui.kind = e.target.value; rerenderGrid(); });
  el.querySelector("[data-ac-orientation]")?.addEventListener("change", (e) => { ui.orientation = e.target.value; rerenderGrid(); });
  el.querySelector("[data-ac-sort]")?.addEventListener("change", (e) => { ui.sort = e.target.value; rerenderGrid(); });
  el.querySelector("[data-ac-folder]")?.addEventListener("change", (e) => { ui.folderId = e.target.value; rerenderGrid(); });
  el.querySelector("[data-ac-newfolder]")?.addEventListener("click", async () => {
    const name = prompt("New folder name:");
    if (!name?.trim()) return;
    const r = await createAssetFolder(name.trim());
    if (r.ok) loadFolders(el);
  });
  el.querySelector("[data-ac-file]")?.addEventListener("change", (e) => {
    ingestFiles(el, e.target.files);
    e.target.value = "";
  });
  el.addEventListener("click", (e) => {
    const card = e.target.closest("[data-ac-open]");
    if (card) openDetail(el, card.dataset.acOpen);
  });
  /* drag out to editors: carry the stable asset id */
  el.addEventListener("dragstart", (e) => {
    const card = e.target.closest("[data-ac-drag]");
    if (!card) return;
    e.dataTransfer.setData("application/x-phantom-asset", card.dataset.acDrag);
    e.dataTransfer.effectAllowed = "copy";
  });
  /* drag files IN */
  const drop = el.querySelector("[data-ac-drop]");
  let dragDepth = 0;
  el.addEventListener("dragenter", (e) => {
    if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
    dragDepth += 1; if (drop) drop.hidden = false;
  });
  el.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
  el.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0 && drop) drop.hidden = true; });
  el.addEventListener("drop", (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault(); dragDepth = 0; if (drop) drop.hidden = true;
    ingestFiles(el, e.dataTransfer.files);
  });
}
