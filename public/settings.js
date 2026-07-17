/* settings.js — shared app-wide preferences (localStorage-backed) plus
   the Settings panel UI (Connections section unchanged/relocated here,
   Terminal-behavior section new). Shared by app.js and superuser.js. */

const SETTINGS_KEY = "termina.settings";
const SETTINGS_DEFAULTS = { hoverFocus: true };

const TerminaSettings = {
  _read() {
    try {
      return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
    } catch {
      return { ...SETTINGS_DEFAULTS };
    }
  },
  get(key) {
    return this._read()[key];
  },
  set(key, value) {
    const current = this._read();
    current[key] = value;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
  },
};

function hoverFocusEnabled() {
  return TerminaSettings.get("hoverFocus") !== false;
}

function renderSettingsBehaviorSection() {
  const container = document.getElementById("settings-behavior");
  if (!container) return;
  container.innerHTML = `
    <label class="settings-toggle-row">
      <input type="checkbox" id="setting-hover-focus" ${hoverFocusEnabled() ? "checked" : ""} />
      <span>
        <b>Hover to focus terminals</b>
        <small>Moving the mouse over a terminal gives it keyboard focus automatically — no click
        needed. Off restores click-to-focus.</small>
      </span>
    </label>
  `;
  document.getElementById("setting-hover-focus").addEventListener("change", (e) => {
    TerminaSettings.set("hoverFocus", e.target.checked);
  });
}

document.getElementById("connections-btn").addEventListener("click", () => {
  document.getElementById("connections-modal").classList.remove("hidden");
  renderSettingsBehaviorSection();
  if (typeof renderConnections === "function") renderConnections();
});
