/* Connections panel — local, encrypted API key storage per provider. No
   accounts, no logins; this is single-user, local-only Termina. Shares
   globals from app.js/mission.js (api, escapeHtml, friendlyError). */

const CONNECTION_PROVIDER_META = {
  claude: { label: "Claude (Anthropic)" },
  codex: { label: "Codex (OpenAI)" },
  openrouter: { label: "OpenRouter", extraField: { label: "Model", placeholder: "z-ai/glm-5.2" } },
};

document.getElementById("connections-close").addEventListener("click", () => {
  document.getElementById("connections-modal").classList.add("hidden");
});
document.getElementById("connections-modal").addEventListener("click", (e) => {
  if (e.target.id === "connections-modal") document.getElementById("connections-modal").classList.add("hidden");
});

async function renderConnections() {
  const body = document.getElementById("connections-body");
  body.innerHTML = `<p class="mission-loading">Loading…</p>`;
  const res = await api("/api/connections").then((r) => r.json()).catch(() => ({ ok: false }));
  const connections = res.ok ? res.connections : {};
  body.innerHTML = "";

  for (const [provider, meta] of Object.entries(CONNECTION_PROVIDER_META)) {
    body.appendChild(renderConnectionRow(provider, meta, connections[provider]));
  }
}

function renderConnectionRow(provider, meta, entry) {
  const row = document.createElement("div");
  row.className = "connection-row";
  row.innerHTML = `
    <div class="connection-row-head">
      <b>${escapeHtml(meta.label)}</b>
      <span class="connection-status">${entry ? `Connected — saved key ending •••${escapeHtml(entry.last4)}` : "Using system default"}</span>
    </div>
    <div class="connection-row-actions">
      <input type="password" class="connection-key-input" placeholder="Paste API key" />
      ${meta.extraField ? `<input type="text" class="connection-extra-input" placeholder="${escapeHtml(meta.extraField.placeholder)}" value="${escapeHtml(entry?.extra ?? "")}" />` : ""}
      <button type="button" class="mw-btn connection-save">Save</button>
      ${entry ? `<button type="button" class="mw-btn connection-remove">Remove</button>` : ""}
    </div>
    <p class="connection-error hidden"></p>
  `;

  const errorEl = row.querySelector(".connection-error");
  row.querySelector(".connection-save").addEventListener("click", async () => {
    const input = row.querySelector(".connection-key-input");
    const extraInput = row.querySelector(".connection-extra-input");
    const apiKey = input.value.trim();
    errorEl.classList.add("hidden");
    if (!apiKey) {
      errorEl.textContent = "Paste a key first.";
      errorEl.classList.remove("hidden");
      return;
    }
    const res = await api(`/api/connections/${provider}`, {
      method: "POST",
      body: JSON.stringify({ apiKey, extra: extraInput?.value.trim() || undefined }),
    }).then((r) => r.json());
    if (!res.ok) {
      errorEl.textContent = friendlyError(res.error);
      errorEl.classList.remove("hidden");
      return;
    }
    renderConnections();
  });

  const removeBtn = row.querySelector(".connection-remove");
  removeBtn?.addEventListener("click", async () => {
    const res = await api(`/api/connections/${provider}`, { method: "DELETE" }).then((r) => r.json());
    if (!res.ok) {
      errorEl.textContent = friendlyError(res.error);
      errorEl.classList.remove("hidden");
      return;
    }
    renderConnections();
  });

  return row;
}
