/* PhantomForce — Voice Channels: the standalone "mini Discord" workspace.
 * Any authenticated PhantomForce user can create a text+voice channel,
 * invite specific real accounts to it, and chat/talk independent of any
 * game. Voice itself is built on the shared app/js/voicecore.js module —
 * the exact same code path app/js/phantomplay.js uses for in-game party
 * voice. See docs/superpowers/specs/2026-07-17-voice-channels-design.md.
 */

import { currentTenantId, session, ctx, wsName, currentWs } from "./store.js?v=phantom-live-20260718-1";
import { VoiceCore } from "./voicecore.js?v=phantom-live-20260718-1";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function authHeaders(json = false) {
  const token = session.token();
  return { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { "Content-Type": "application/json" } : {}) };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...authHeaders(Boolean(options.body)), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.error === "string" ? payload.error : `Voice channels request failed (${response.status}).`);
  return payload;
}

const ui = {
  loading: true,
  error: "",
  channels: [],
  activeChannelId: null,
  activeChannel: null,
  messages: [],
  messageDraft: "",
  createOpen: false,
  createName: "",
  createVisibility: "public",
  createBusy: false,
  inviteBusy: false,
  inviteNote: "",
  memberDirectory: [],
  memberDirectoryError: "",
  memberDirectoryLoaded: false,
};

let voice = null; // VoiceCore instance for the currently-open channel, if connected
let voiceState = null;
let paintFn = () => {};
let hashCleanupBound = false;

function myLabel() {
  return ctx.session?.label || ctx.session?.name || "You";
}

function disconnectVoice() {
  if (voice) { voice.destroy(); voice = null; voiceState = null; }
}

// Custom workspace defs in this codebase have no framework-level unmount
// hook today (renderPhantomPlay's own returned cleanup is similarly never
// invoked by main.js's workspace switcher) — so this module watches
// hash navigation itself and tears voice down when the user leaves this
// workspace, rather than leaving a mic connected in the background.
function ensureHashCleanup() {
  if (hashCleanupBound) return;
  hashCleanupBound = true;
  window.addEventListener("hashchange", () => {
    const onThisPage = /^#(page|ws)\/voicechannels/.test(location.hash);
    if (!onThisPage) disconnectVoice();
  });
  window.addEventListener("beforeunload", () => disconnectVoice());
}

async function hydrate() {
  ui.loading = true;
  ui.error = "";
  paintFn();
  try {
    const result = await api(`/api/voice/channels?tenant_id=${encodeURIComponent(currentTenantId())}`);
    ui.channels = Array.isArray(result.channels) ? result.channels : [];
    if (ui.activeChannelId && ui.channels.some((channel) => channel.id === ui.activeChannelId)) {
      await openChannel(ui.activeChannelId, false);
    }
  } catch (error) {
    ui.error = error.message;
  } finally {
    ui.loading = false;
    paintFn();
  }
}

async function openChannel(channelId, repaint = true) {
  disconnectVoice();
  ui.activeChannelId = channelId;
  try {
    const [snapshot, messagesResult] = await Promise.all([
      api(`/api/voice/channels/${encodeURIComponent(channelId)}?tenant_id=${encodeURIComponent(currentTenantId())}`),
      api(`/api/voice/channels/${encodeURIComponent(channelId)}/messages?tenant_id=${encodeURIComponent(currentTenantId())}`),
    ]);
    ui.activeChannel = snapshot.channel;
    ui.messages = messagesResult.messages || [];
  } catch (error) {
    ui.error = error.message;
  }
  if (repaint) paintFn();
}

async function createChannel(form) {
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  if (!name) { ui.error = "Give the channel a name first."; paintFn(); return; }
  ui.createBusy = true;
  paintFn();
  try {
    const result = await api("/api/voice/channels", { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), name, visibility: ui.createVisibility }) });
    ui.channels.unshift(result.channel);
    ui.createOpen = false;
    ui.createName = "";
    await openChannel(result.channel.id, false);
  } catch (error) {
    ui.error = error.message;
  } finally {
    ui.createBusy = false;
    paintFn();
  }
}

async function joinChannel(channelId) {
  try {
    await api(`/api/voice/channels/${encodeURIComponent(channelId)}/join`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId() }) });
    await openChannel(channelId, false);
    await hydrate();
  } catch (error) {
    ui.error = error.message;
    paintFn();
  }
}

async function leaveChannel(channelId) {
  disconnectVoice();
  try {
    await api(`/api/voice/channels/${encodeURIComponent(channelId)}/leave`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId() }) });
  } catch (error) {
    ui.error = error.message;
  }
  if (ui.activeChannelId === channelId) { ui.activeChannelId = null; ui.activeChannel = null; ui.messages = []; }
  await hydrate();
}

async function sendMessage(form) {
  const data = new FormData(form);
  const text = String(data.get("text") || "").trim();
  if (!text || !ui.activeChannelId) return;
  form.reset();
  try {
    const result = await api(`/api/voice/channels/${encodeURIComponent(ui.activeChannelId)}/messages`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), text }) });
    ui.messages = [...ui.messages, result.message];
  } catch (error) {
    ui.error = error.message;
  }
  paintFn();
}

async function ensureMemberDirectory() {
  if (ui.memberDirectoryLoaded) return;
  ui.memberDirectoryLoaded = true;
  try {
    const orgId = currentTenantId();
    const result = await api(`/orgs/${encodeURIComponent(orgId)}/members`);
    ui.memberDirectory = Array.isArray(result.members) ? result.members : [];
  } catch (error) {
    // Not every auth provider backs a Prisma org (see docs/DATABASE_SETUP.md
    // — demo/prisma-dev/owner-production sessions have no org member
    // directory). Degrade honestly to a manual actorId invite instead of
    // pretending a directory exists.
    ui.memberDirectoryError = "A live member directory needs a database-backed workspace. You can still invite someone if you know their account id.";
  }
  paintFn();
}

async function inviteUser(userIdOrLabel) {
  if (!ui.activeChannelId || !userIdOrLabel) return;
  ui.inviteBusy = true;
  paintFn();
  try {
    await api(`/api/voice/channels/${encodeURIComponent(ui.activeChannelId)}/invite`, { method: "POST", body: JSON.stringify({ tenantId: currentTenantId(), userId: userIdOrLabel }) });
    ui.inviteNote = "Invited. They'll see this channel next time they open Voice Channels.";
    await openChannel(ui.activeChannelId, false);
  } catch (error) {
    ui.inviteNote = `Blocked: ${error.message}`;
  } finally {
    ui.inviteBusy = false;
    paintFn();
  }
}

function toggleVoice() {
  if (voice) { disconnectVoice(); paintFn(); return; }
  if (!ui.activeChannelId) return;
  voice = new VoiceCore({ tenantId: currentTenantId(), channelId: ui.activeChannelId, myLabel: myLabel() });
  voice.addEventListener("state", (event) => { voiceState = event.detail; paintFn(); });
  voice.addEventListener("error", (event) => { ui.error = event.detail.message; paintFn(); });
  voice.connect();
  paintFn();
}

function connectionDotClass(state) {
  if (state === "connected") return "is-live";
  if (state === "connecting" || state === "new") return "is-pending";
  return "is-away";
}

function voicePanelHtml() {
  if (!ui.activeChannelId) return "";
  const connected = voice && voiceState?.connected;
  return `<div class="vc-voice-panel">
    <div class="vc-voice-head">
      <b>Voice</b>
      <button type="button" class="${connected ? "vc-danger" : "vc-primary"}" data-vc-toggle-voice>${connected ? "Leave voice" : "Join voice"}</button>
      ${connected ? `<button type="button" class="vc-mic ${voiceState?.muted ? "is-muted" : ""}" data-vc-mute title="${voiceState?.muted ? "Unmute" : "Mute"}">${voiceState?.muted ? "🔇" : "🎙️"}</button>` : ""}
    </div>
    ${connected && voiceState?.participants?.length
      ? `<div class="vc-participants">${voiceState.participants.map((p) => `<span class="vc-participant ${p.speaking ? "is-speaking" : ""}"><em class="pp-conn-dot ${connectionDotClass(p.connectionState)}"></em>${esc(p.label)}${p.muted ? " 🔇" : ""}</span>`).join("")}</div>`
      : connected ? `<p class="vc-empty-note">Just you so far.</p>` : ""}
  </div>`;
}

function messagesHtml() {
  if (!ui.messages.length) return `<div class="vc-empty-note">No messages yet. Say hello.</div>`;
  return ui.messages.map((message) => `<div class="vc-msg"><b>${esc(message.authorLabel)}</b><span>${esc(message.text)}</span><i>${new Date(message.createdAt).toLocaleString()}</i></div>`).join("");
}

function inviteHtml() {
  if (!ui.activeChannel || ui.activeChannel.visibility !== "invite_only") return "";
  const directory = ui.memberDirectory.filter((member) => !ui.activeChannel.memberIds.includes(member.userId));
  return `<div class="vc-invite">
    <b>Invite someone</b>
    ${ui.memberDirectoryError ? `<p class="vc-empty-note">${esc(ui.memberDirectoryError)}</p><form data-vc-invite-manual><input type="text" name="userId" placeholder="Account id to invite" required/><button type="submit">Invite</button></form>`
      : directory.length
        ? `<div class="vc-invite-list">${directory.map((member) => `<button type="button" data-vc-invite="${esc(member.userId)}">${esc(member.name || member.email || member.userId)}</button>`).join("")}</div>`
        : `<p class="vc-empty-note">Everyone in this workspace is already a member or invited.</p>`}
    ${ui.inviteNote ? `<p class="vc-invite-note">${esc(ui.inviteNote)}</p>` : ""}
  </div>`;
}

function channelListHtml() {
  if (!ui.channels.length) return `<div class="vc-empty-note">No channels yet. Create the first one.</div>`;
  return ui.channels.map((channel) => `<button type="button" class="vc-channel-row ${channel.id === ui.activeChannelId ? "is-active" : ""}" data-vc-open="${esc(channel.id)}">
    <b>${esc(channel.name)}</b><i>${channel.visibility === "invite_only" ? "Invite only" : "Public"} · ${channel.presence?.length || 0} in voice</i>
  </button>`).join("");
}

export function renderVoiceChannels(el, opts = {}) {
  ensureHashCleanup();
  paintFn = () => renderVoiceChannels(el, opts);

  el.innerHTML = `<div class="vc-shell">
    <header class="vc-head">
      <div><p class="vc-kicker">VOICE CHANNELS · ${esc(wsName(currentWs()))}</p><h2>Talk with your workspace, independent of any game.</h2><p>Create a channel, invite specific PhantomForce accounts or leave it open to the workspace, and jump into voice — no Discord, no downloads, audio goes browser-to-browser.</p></div>
      <button type="button" class="vc-primary" data-vc-new>New channel</button>
    </header>
    ${ui.error ? `<div class="vc-banner"><span>${esc(ui.error)}</span><button type="button" data-vc-clear-error>Dismiss</button></div>` : ""}
    ${ui.createOpen ? `<form class="vc-create-form" data-vc-create-form>
      <label>Name<input type="text" name="name" maxlength="60" placeholder="e.g. Game Night" required/></label>
      <label class="vc-switch-row"><input type="radio" name="visibility" value="public" ${ui.createVisibility === "public" ? "checked" : ""} data-vc-visibility/> Public — anyone in this workspace can join</label>
      <label class="vc-switch-row"><input type="radio" name="visibility" value="invite_only" ${ui.createVisibility === "invite_only" ? "checked" : ""} data-vc-visibility/> Invite only — you choose who joins</label>
      <div class="vc-form-actions"><button type="submit" class="vc-primary" ${ui.createBusy ? "disabled" : ""}>Create</button><button type="button" data-vc-cancel-create>Cancel</button></div>
    </form>` : ""}
    <div class="vc-layout">
      <aside class="vc-channel-list">${ui.loading ? `<div class="vc-empty-note">Loading channels…</div>` : channelListHtml()}</aside>
      <section class="vc-channel-view">
        ${!ui.activeChannel ? `<div class="vc-empty-note">Pick a channel, or create one.</div>` : `
          <header class="vc-channel-head">
            <div><h3>${esc(ui.activeChannel.name)}</h3><span>${ui.activeChannel.visibility === "invite_only" ? "Invite only" : "Public"} · ${ui.activeChannel.memberIds.length} member${ui.activeChannel.memberIds.length === 1 ? "" : "s"}</span></div>
            <button type="button" data-vc-leave-channel="${esc(ui.activeChannel.id)}">Leave channel</button>
          </header>
          ${voicePanelHtml()}
          ${inviteHtml()}
          <div class="vc-messages" data-vc-messages>${messagesHtml()}</div>
          <form class="vc-composer" data-vc-send-form>
            <input type="text" name="text" maxlength="2000" placeholder="Message this channel…" autocomplete="off"/>
            <button type="submit">Send</button>
          </form>`}
      </section>
    </div>
  </div>`;

  el.querySelector("[data-vc-new]")?.addEventListener("click", () => { ui.createOpen = !ui.createOpen; paintFn(); });
  el.querySelector("[data-vc-cancel-create]")?.addEventListener("click", () => { ui.createOpen = false; paintFn(); });
  el.querySelector("[data-vc-clear-error]")?.addEventListener("click", () => { ui.error = ""; paintFn(); });
  el.querySelector("[data-vc-create-form]")?.addEventListener("submit", (event) => { event.preventDefault(); createChannel(event.currentTarget); });
  el.querySelectorAll("[data-vc-visibility]").forEach((input) => input.addEventListener("change", () => { ui.createVisibility = input.value; }));
  el.querySelectorAll("[data-vc-open]").forEach((button) => button.addEventListener("click", () => openChannel(button.dataset.vcOpen)));
  el.querySelectorAll("[data-vc-leave-channel]").forEach((button) => button.addEventListener("click", () => leaveChannel(button.dataset.vcLeaveChannel)));
  el.querySelector("[data-vc-send-form]")?.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(event.currentTarget); });
  el.querySelector("[data-vc-toggle-voice]")?.addEventListener("click", toggleVoice);
  el.querySelector("[data-vc-mute]")?.addEventListener("click", () => voice?.toggleMuted());
  el.querySelectorAll("[data-vc-invite]").forEach((button) => button.addEventListener("click", () => inviteUser(button.dataset.vcInvite)));
  el.querySelector("[data-vc-invite-manual]")?.addEventListener("submit", (event) => { event.preventDefault(); inviteUser(new FormData(event.currentTarget).get("userId")); });

  if (ui.activeChannel?.visibility === "invite_only") ensureMemberDirectory();
  if (ui.loading && !ui.channels.length) hydrate();
  const messagesEl = el.querySelector("[data-vc-messages]");
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}
