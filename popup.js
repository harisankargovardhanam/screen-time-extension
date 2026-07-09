const MAX_BARS = 5;
let firstRender = true;
let lastChartSig = "";
let lastLimitsSig = "";

function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function todayKey() {
  return dateKey(new Date());
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

// Live clock format: 4:07, 12:34, 1:02:34
function formatClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "co.kr", "co.in", "co.nz",
  "co.za", "com.au", "com.br", "com.mx", "com.ar", "com.sg", "com.tr",
  "com.hk", "com.tw", "com.cn", "com.my", "co.id",
]);

function baseDomain(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

function normalizeDomain(input) {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, "").replace(/^www\./, "");
  d = d.split("/")[0];
  return d ? baseDomain(d) : d;
}

// Limits used to be stored as a bare number of minutes.
function normalizeLimit(value) {
  if (typeof value === "number") return { minutes: value, block: false };
  return value;
}

// Weekend-aware limit minutes for a given date.
function effectiveMinutes(limit, date = new Date()) {
  const day = date.getDay();
  if ((day === 0 || day === 6) && limit.weekendMinutes) return limit.weekendMinutes;
  return limit.minutes;
}

function faviconUrl(domain, size = 32) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", `https://${domain}/`);
  url.searchParams.set("size", String(size));
  return url.toString();
}

async function render() {
  const store = await chrome.storage.local.get([
    "data", "limits", "tracking", "focus", "snoozeLog", "paused", "settings",
  ]);
  const data = store.data || {};
  const limits = store.limits || {};
  const todayData = { ...(data[todayKey()] || {}) };

  // Include the currently running intervals so the popup feels live.
  // tracking is an array of {domain, start}; old versions stored one object.
  const raw = store.tracking;
  const intervals = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const interval of intervals) {
    if (!interval || !interval.domain || !interval.start) continue;
    const elapsed = Math.round((Date.now() - interval.start) / 1000);
    if (elapsed > 0 && elapsed < 60 * 60) {
      todayData[interval.domain] = (todayData[interval.domain] || 0) + elapsed;
    }
  }

  const chipLabel = intervals
    .filter((t) => t && t.domain)
    .map((t) => t.domain)
    .join(" · ");

  renderHeader();
  renderPaused(store.paused);
  renderHero(todayData, data, chipLabel, store.settings || {});
  renderFocus(store.focus);
  renderChart(todayData, limits);
  renderLimits(limits, todayData, store.snoozeLog || {});
  firstRender = false;
}

function renderFocus(focus) {
  const active = focus && focus.until > Date.now();
  document.getElementById("focus-idle").hidden = active;
  document.getElementById("focus-active").hidden = !active;
  const status = document.getElementById("focus-status");
  status.hidden = !active;
  if (active) {
    status.textContent = "running";
    const left = Math.max(0, Math.round((focus.until - Date.now()) / 1000));
    document.getElementById("focus-countdown").textContent = formatClock(left);
  }
}

function renderHeader() {
  document.getElementById("date-label").textContent = new Date().toLocaleDateString(
    undefined,
    { weekday: "short", month: "short", day: "numeric" }
  );
}

function renderPaused(paused) {
  document.getElementById("paused-banner").hidden = !paused;
  document.getElementById("pause-icon").hidden = !!paused;
  document.getElementById("play-icon").hidden = !paused;
  document.getElementById("toggle-pause").title = paused ? "Resume tracking" : "Pause tracking";
}

function renderHero(todayData, data, activeDomain, settings = {}) {
  const totalSeconds = Object.values(todayData).reduce((s, v) => s + v, 0);
  document.getElementById("total").textContent = formatClock(totalSeconds);

  // Daily goal progress
  const goalMin = settings.dailyGoalMin || 0;
  const goalWrap = document.getElementById("goal-progress");
  goalWrap.hidden = !goalMin;
  if (goalMin) {
    const fraction = totalSeconds / (goalMin * 60);
    const fill = document.getElementById("goal-fill");
    fill.style.width = `${Math.min(fraction, 1) * 100}%`;
    fill.classList.toggle("over", fraction >= 1);
    document.getElementById("goal-text").textContent =
      fraction >= 1 ? "over goal" : `goal ${goalMin}m`;
  }

  // Active-site chip
  const chip = document.getElementById("active-site");
  if (activeDomain) {
    chip.hidden = false;
    document.getElementById("active-site-name").textContent = activeDomain;
  } else {
    chip.hidden = true;
  }

  // 7-day mini chart
  const week = document.getElementById("week-chart");
  week.innerHTML = "";
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dateKey(d);
    const dayData = i === 0 ? todayData : data[key] || {};
    days.push({
      key,
      total: Object.values(dayData).reduce((s, v) => s + v, 0),
      isToday: i === 0,
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
    });
  }
  const max = Math.max(...days.map((d) => d.total), 1);
  for (const day of days) {
    const bar = document.createElement("div");
    bar.className = "week-bar" + (day.isToday ? " today" : "");
    bar.style.height = `${Math.max(7, (day.total / max) * 100)}%`;
    bar.title = `${day.label}: ${formatDuration(day.total)}`;
    week.appendChild(bar);
  }
}

function renderChart(todayData, limits) {
  const chart = document.getElementById("chart");
  const emptyMsg = document.getElementById("empty-msg");
  const siteCount = document.getElementById("site-count");

  const entries = Object.entries(todayData).sort((a, b) => b[1] - a[1]);
  siteCount.textContent = entries.length ? `${entries.length} sites` : "";
  document.getElementById("view-all").hidden = entries.length <= MAX_BARS;

  if (entries.length === 0) {
    chart.innerHTML = "";
    emptyMsg.hidden = false;
    lastChartSig = "";
    return;
  }
  emptyMsg.hidden = true;

  const max = entries[0][1];
  const visible = entries.slice(0, MAX_BARS);

  // Same sites in the same order: update numbers in place so favicons and
  // DOM nodes survive the 1-second tick without rebuilding.
  const sig = visible.map(([d]) => d).join("|");
  if (sig === lastChartSig) {
    const rows = chart.querySelectorAll(".site-row");
    visible.forEach(([domain, seconds], i) => {
      const row = rows[i];
      if (!row) return;
      row.querySelector(".site-time").textContent = formatClock(seconds);
      const fill = row.querySelector(".site-fill");
      fill.style.transition = "none";
      fill.style.width = `${Math.max(2, (seconds / max) * 100)}%`;
      const limit = limits[domain] && normalizeLimit(limits[domain]);
      fill.classList.toggle("over-limit", !!(limit && seconds >= effectiveMinutes(limit) * 60));
    });
    return;
  }
  lastChartSig = sig;
  chart.innerHTML = "";
  entries.slice(0, MAX_BARS).forEach(([domain, seconds], i) => {
    const row = document.createElement("div");
    row.className = "site-row";
    if (firstRender) {
      row.style.animationDelay = `${i * 30}ms`;
    } else {
      row.style.animation = "none";
    }

    const icon = document.createElement("img");
    icon.className = "site-favicon";
    icon.src = faviconUrl(domain);
    icon.alt = "";

    const name = document.createElement("span");
    name.className = "site-name";
    name.textContent = domain;
    name.title = domain;

    const time = document.createElement("span");
    time.className = "site-time";
    time.textContent = formatClock(seconds);

    const track = document.createElement("div");
    track.className = "site-track";
    const fill = document.createElement("div");
    fill.className = "site-fill";
    const limit = limits[domain] && normalizeLimit(limits[domain]);
    if (limit && seconds >= effectiveMinutes(limit) * 60) {
      fill.classList.add("over-limit");
    }
    track.appendChild(fill);

    row.append(icon, name, time, track);
    chart.appendChild(row);

    const width = `${Math.max(2, (seconds / max) * 100)}%`;
    if (firstRender) {
      // Animate the bar in after layout.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          fill.style.width = width;
        })
      );
    } else {
      fill.style.transition = "none";
      fill.style.width = width;
    }
  });
}

function progressRing(fraction, over) {
  const r = 12;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(fraction, 1);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 30 30");
  svg.setAttribute("class", "ring" + (over ? " over" : ""));
  svg.innerHTML =
    `<circle class="ring-bg" cx="15" cy="15" r="${r}"></circle>` +
    `<circle class="ring-val" cx="15" cy="15" r="${r}" ` +
    `stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - clamped)}"></circle>` +
    `<text x="15" y="15.5">${Math.round(fraction * 100)}</text>`;
  return svg;
}

function renderLimits(limits, todayData, snoozeLog = {}) {
  const snoozedToday = snoozeLog[todayKey()] || {};
  const usageText = (domain, spent, limit, over) => {
    const minutes = effectiveMinutes(limit);
    let text = over
      ? `Over limit — ${formatClock(spent)} of ${minutes}m`
      : `${formatClock(spent)} of ${minutes}m`;
    if (limit.weekendMinutes) text += ` · wknd ${limit.weekendMinutes}m`;
    const count = snoozedToday[domain] || 0;
    if (count > 0) text += ` · snoozed ${count}×`;
    return text;
  };
  const list = document.getElementById("limits-list");
  const noLimits = document.getElementById("no-limits");

  const entries = Object.entries(limits).sort((a, b) => a[0].localeCompare(b[0]));
  noLimits.hidden = entries.length > 0;

  // Same limits config: refresh usage text and rings in place.
  const sig = entries
    .map(([d, raw]) => {
      const l = normalizeLimit(raw);
      return `${d}:${l.minutes}:${l.weekendMinutes || 0}:${l.block ? 1 : 0}`;
    })
    .join("|");
  if (sig === lastLimitsSig && sig !== "") {
    const rows = list.querySelectorAll(".limit-row");
    entries.forEach(([domain, raw], i) => {
      const row = rows[i];
      if (!row) return;
      const limit = normalizeLimit(raw);
      const spent = todayData[domain] || 0;
      const fraction = spent / (effectiveMinutes(limit) * 60);
      const over = fraction >= 1;
      const usage = row.querySelector(".limit-usage");
      usage.className = "limit-usage" + (over ? " over" : "");
      usage.textContent = usageText(domain, spent, limit, over);
      row.querySelector(".ring").replaceWith(progressRing(fraction, over));
    });
    return;
  }
  lastLimitsSig = sig;
  list.innerHTML = "";

  for (const [domain, raw] of entries) {
    const limit = normalizeLimit(raw);
    const spent = todayData[domain] || 0;
    const fraction = spent / (effectiveMinutes(limit) * 60);
    const over = fraction >= 1;

    const row = document.createElement("div");
    row.className = "limit-row";

    const icon = document.createElement("img");
    icon.className = "site-favicon";
    icon.src = faviconUrl(domain);
    icon.alt = "";

    const info = document.createElement("div");
    info.className = "limit-info";
    const name = document.createElement("span");
    name.className = "limit-domain";
    name.textContent = domain;
    name.title = domain;
    if (limit.block) {
      const badge = document.createElement("span");
      badge.className = "limit-badge";
      badge.textContent = "blocks";
      badge.title = "This site gets blocked when the limit is reached";
      name.appendChild(badge);
    }
    const usage = document.createElement("span");
    usage.className = "limit-usage" + (over ? " over" : "");
    usage.textContent = usageText(domain, spent, limit, over);
    info.append(name, usage);

    const ring = progressRing(fraction, over);

    const remove = document.createElement("button");
    remove.className = "icon-btn";
    remove.title = `Remove limit for ${domain}`;
    remove.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16">' +
      '<path d="M6.4 19 5 17.6 10.6 12 5 6.4 6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4z" fill="currentColor"/></svg>';
    remove.addEventListener("click", async () => {
      const store = await chrome.storage.local.get("limits");
      const current = store.limits || {};
      delete current[domain];
      await chrome.storage.local.set({ limits: current });
      render();
    });

    row.append(icon, info, ring, remove);
    list.appendChild(row);
  }
}

document.getElementById("limit-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const domainInput = document.getElementById("limit-domain");
  const minutesInput = document.getElementById("limit-minutes");

  const blockInput = document.getElementById("limit-block");
  const weekendInput = document.getElementById("limit-weekend");

  const domain = normalizeDomain(domainInput.value);
  const minutes = parseInt(minutesInput.value, 10);
  if (!domain || !minutes || minutes < 1) return;
  const weekendMinutes = parseInt(weekendInput.value, 10);

  const store = await chrome.storage.local.get(["limits", "achievements"]);
  const limits = store.limits || {};
  limits[domain] = { minutes, block: blockInput.checked };
  if (weekendMinutes >= 1) limits[domain].weekendMinutes = weekendMinutes;

  const achievements = store.achievements || {};
  if (!achievements["boundary-setter"]) {
    achievements["boundary-setter"] = Date.now();
  }
  await chrome.storage.local.set({ limits, achievements });

  domainInput.value = "";
  minutesInput.value = "";
  weekendInput.value = "";
  blockInput.checked = false;
  render();
});

// --- Pause / resume tracking ---

async function setPaused(paused) {
  await chrome.storage.local.set({ paused });
  chrome.runtime.sendMessage("refresh").catch(() => {});
  render();
}

document.getElementById("toggle-pause").addEventListener("click", async () => {
  const store = await chrome.storage.local.get("paused");
  setPaused(!store.paused);
});

document.getElementById("resume-btn").addEventListener("click", () => setPaused(false));

document.getElementById("open-stats").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
});

document.getElementById("view-all").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("stats.html") });
});

// --- Segmented tabs ---

function switchTab(name) {
  for (const btn of document.querySelectorAll(".segment")) {
    const active = btn.dataset.tab === name;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  }
  document.getElementById("tab-overview").hidden = name !== "overview";
  document.getElementById("tab-limits").hidden = name !== "limits";
  localStorage.setItem("activeTab", name);
}

for (const btn of document.querySelectorAll(".segment")) {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
}

switchTab(localStorage.getItem("activeTab") || "overview");

for (const btn of document.querySelectorAll(".focus-btn[data-minutes]")) {
  btn.addEventListener("click", async () => {
    const minutes = parseInt(btn.dataset.minutes, 10);
    const until = Date.now() + minutes * 60 * 1000;
    await chrome.storage.local.set({ focus: { until } });
    chrome.alarms.create("focus-end", { when: until });
    chrome.runtime.sendMessage("refresh").catch(() => {});
    render();
  });
}

document.getElementById("focus-stop").addEventListener("click", async () => {
  await chrome.storage.local.set({ focus: null });
  chrome.alarms.clear("focus-end");
  render();
});

// --- Settings panel ---

const DEFAULT_SETTINGS = {
  activityTimeoutSec: 60,
  snoozeMinutes: 5,
  breakEveryMin: 60,
  badge: true,
};

async function loadSettings() {
  const store = await chrome.storage.local.get("settings");
  const settings = { ...DEFAULT_SETTINGS, ...(store.settings || {}) };
  document.getElementById("set-activity").value = settings.activityTimeoutSec;
  document.getElementById("set-snooze").value = settings.snoozeMinutes;
  document.getElementById("set-break").value = settings.breakEveryMin;
  document.getElementById("set-badge").checked = settings.badge;
}

document.getElementById("toggle-settings").addEventListener("click", async () => {
  const panel = document.getElementById("settings-panel");
  if (panel.hidden) await loadSettings();
  panel.hidden = !panel.hidden;
});

document.getElementById("save-settings").addEventListener("click", async () => {
  const settings = {
    activityTimeoutSec: Math.max(15, parseInt(document.getElementById("set-activity").value, 10) || 60),
    snoozeMinutes: Math.max(1, parseInt(document.getElementById("set-snooze").value, 10) || 5),
    breakEveryMin: Math.max(0, parseInt(document.getElementById("set-break").value, 10) || 0),
    badge: document.getElementById("set-badge").checked,
  };
  await chrome.storage.local.set({ settings });
  chrome.runtime.sendMessage("refresh").catch(() => {});
  const saved = document.getElementById("settings-saved");
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 2000);
});

render();
setInterval(render, 1000);
