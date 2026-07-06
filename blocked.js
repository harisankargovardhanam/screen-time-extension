const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "";
const backUrl = params.get("back") || "";
const reason = params.get("reason") || "limit";

document.getElementById("domain").textContent = domain || "this site";

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function todayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

async function setup() {
  const store = await chrome.storage.local.get([
    "data", "limits", "snoozeLog", "settings", "focus",
  ]);
  const snoozeMinutes = (store.settings && store.settings.snoozeMinutes) || 5;
  const snoozeBtn = document.getElementById("snooze");

  if (reason === "focus") {
    // No snoozing during a focus session.
    document.querySelector("h1").textContent = "Focus mode is on";
    document.querySelector(".block-domain-line").innerHTML =
      "This site is paused while your <strong>focus session</strong> runs.";
    snoozeBtn.hidden = true;
    if (store.focus && store.focus.until) {
      const left = Math.max(0, Math.ceil((store.focus.until - Date.now()) / 60000));
      document.getElementById("usage").textContent = `${left} min left in this session.`;
    }
    return;
  }

  snoozeBtn.textContent = `Snooze ${snoozeMinutes} min`;

  if (domain) {
    const spent = ((store.data || {})[todayKey()] || {})[domain] || 0;
    const raw = (store.limits || {})[domain];
    const minutes = typeof raw === "number" ? raw : raw ? raw.minutes : null;
    if (minutes) {
      document.getElementById("usage").textContent =
        `${formatDuration(spent)} used of your ${minutes} min limit.`;
    }

    const count = ((store.snoozeLog || {})[todayKey()] || {})[domain] || 0;
    if (count > 0) {
      const line = document.getElementById("snooze-count");
      line.hidden = false;
      line.textContent = `Already snoozed ${count}× today.`;
    }
  }
}

document.getElementById("snooze").addEventListener("click", async () => {
  if (!domain) return;
  const store = await chrome.storage.local.get(["snoozes", "snoozeLog", "settings"]);
  const snoozeMinutes = (store.settings && store.settings.snoozeMinutes) || 5;

  const snoozes = store.snoozes || {};
  snoozes[domain] = Date.now() + snoozeMinutes * 60 * 1000;

  // Count today's snoozes per site (older days are dropped).
  const key = todayKey();
  const log = { [key]: (store.snoozeLog || {})[key] || {} };
  log[key][domain] = (log[key][domain] || 0) + 1;

  await chrome.storage.local.set({ snoozes, snoozeLog: log });
  location.href = backUrl || `https://${domain}/`;
});

document.getElementById("close").addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
});

setup();
