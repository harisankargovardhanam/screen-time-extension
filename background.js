// Site Time Tracker - background service worker (Manifest V3)
//
// Tracking model:
//  - "tracking" in storage holds [{ domain, start }] for every site currently
//    accumulating time: the focused tab's site (when the page is actually in
//    use) plus any tab that is playing sound (background music/videos).
//  - Every relevant event (tab switch, url change, window focus, idle change,
//    audible change, heartbeat alarm) flushes elapsed time into today's
//    bucket and restarts the intervals.
//  - Data is keyed by date string, so each day naturally starts at zero.
//
// Storage layout:
//  - data:      { "2026-07-05": { "youtube.com": seconds } }
//  - hourly:    { "2026-07-05": [24 x seconds] }
//  - limits:    { "youtube.com": { minutes: 30, block: true } }
//  - notified:  { "2026-07-05": ["youtube.com"] }
//  - snoozes:   { "youtube.com": untilTimestampMs }
//  - snoozeLog: { "2026-07-05": { "youtube.com": count } }
//  - tracking:  [{ domain, start }]
//  - focus:     { until: timestampMs } | null
//  - settings:  { activityTimeoutSec, snoozeMinutes, breakEveryMin, badge }
//  - usage:     { since, lastSeen, breakNotifiedAt }  (continuous-use tracking)

const HEARTBEAT_MINUTES = 1;
// If more time than this passes between flushes, the browser was probably
// closed or the machine asleep - cap the credited time to avoid overcounting.
const MAX_ELAPSED_MS = (HEARTBEAT_MINUTES * 60 + 30) * 1000;
const HISTORY_DAYS = 30;
const IDLE_DETECTION_SECONDS = 60;
// A gap in browsing longer than this resets the continuous-use clock.
const USAGE_GAP_MS = 5 * 60 * 1000;

const DEFAULT_SETTINGS = {
  activityTimeoutSec: 60, // page counts as "in use" this long after an interaction
  snoozeMinutes: 5,
  breakEveryMin: 60, // continuous browsing before a break reminder; 0 = off
  badge: true,
};

// Common two-part public suffixes so "bbc.co.uk" doesn't collapse to "co.uk".
const TWO_PART_TLDS = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "co.jp", "co.kr", "co.in", "co.nz",
  "co.za", "com.au", "com.br", "com.mx", "com.ar", "com.sg", "com.tr",
  "com.hk", "com.tw", "com.cn", "com.my", "co.id",
]);

function todayKey(ts = Date.now()) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Collapse subdomains to the registrable domain: music.youtube.com -> youtube.com
function baseDomain(host) {
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (TWO_PART_TLDS.has(lastTwo)) return parts.slice(-3).join(".");
  return lastTwo;
}

function domainFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return baseDomain(u.hostname.replace(/^www\./, ""));
  } catch {
    return null;
  }
}

// Limits used to be stored as a bare number of minutes.
function normalizeLimit(value) {
  if (typeof value === "number") return { minutes: value, block: false };
  return value;
}

async function getSettings() {
  const store = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(store.settings || {}) };
}

function blockedPageUrl(domain, backUrl, reason) {
  const url = new URL(chrome.runtime.getURL("blocked.html"));
  url.searchParams.set("domain", domain);
  if (backUrl) url.searchParams.set("back", backUrl);
  if (reason) url.searchParams.set("reason", reason);
  return url.toString();
}

// Returns { domains, activeDomain }:
//  - domains: every site that should accumulate time right now. Audible tabs
//    (music, videos) count regardless of focus or system idle state, so
//    YouTube playing in a background tab keeps logging.
//  - activeDomain: the focused tab's site (for the toolbar badge), or null.
async function getTrackingState() {
  const settings = await getSettings();
  const domains = new Set();

  const audibleTabs = await chrome.tabs.query({ audible: true });
  for (const tab of audibleTabs) {
    if (tab.mutedInfo && tab.mutedInfo.muted) continue;
    const d = tab.url && domainFromUrl(tab.url);
    if (d) domains.add(d);
  }

  let activeDomain = null;
  const win = await chrome.windows.getLastFocused({ populate: false }).catch(() => null);
  if (win && win.focused) {
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    if (tab && tab.url) {
      activeDomain = domainFromUrl(tab.url);
      if (activeDomain && !domains.has(activeDomain)) {
        // Non-audible foreground tab: needs the system awake and a recent
        // interaction on the page to count.
        const idleState = await chrome.idle.queryState(IDLE_DETECTION_SECONDS);
        if (idleState === "active") {
          let recentlyUsed = true;
          try {
            const res = await chrome.tabs.sendMessage(tab.id, "activity?");
            if (res && res.idleMs > settings.activityTimeoutSec * 1000) {
              recentlyUsed = false;
            }
          } catch {
            // Content script not present (tab predates install, PDF...).
            // Fall back to the system-idle check that already passed above.
          }
          if (recentlyUsed) domains.add(activeDomain);
        }
      }
    }
  }

  return { domains: [...domains], activeDomain };
}

// Flush elapsed time for every currently tracked site into today's bucket,
// then start fresh intervals for `newDomains`.
async function switchTracking(newDomains, activeDomain) {
  const now = Date.now();
  const store = await chrome.storage.local.get(["tracking", "data", "hourly"]);
  const data = store.data || {};
  const hourly = store.hourly || {};

  // tracking used to be a single {domain, start} object.
  const previous = Array.isArray(store.tracking)
    ? store.tracking
    : store.tracking
      ? [store.tracking]
      : [];

  for (const interval of previous) {
    if (!interval || !interval.domain || !interval.start) continue;
    let elapsed = now - interval.start;
    if (elapsed <= 0) continue;
    if (elapsed > MAX_ELAPSED_MS) elapsed = MAX_ELAPSED_MS;
    const seconds = Math.round(elapsed / 1000);
    // Credit the time to the day the interval started in, so time around
    // midnight lands in the right bucket.
    const key = todayKey(interval.start);
    if (!data[key]) data[key] = {};
    data[key][interval.domain] = (data[key][interval.domain] || 0) + seconds;

    if (!hourly[key]) hourly[key] = new Array(24).fill(0);
    const hour = new Date(interval.start).getHours();
    hourly[key][hour] += seconds;
  }

  pruneOldDays(data);
  pruneOldDays(hourly);

  // Active tab's site first so the popup's "currently browsing" chip shows it.
  const ordered = [...newDomains].sort((a, b) =>
    (b === activeDomain ? 1 : 0) - (a === activeDomain ? 1 : 0)
  );
  const newTracking = ordered.map((domain) => ({ domain, start: now }));
  await chrome.storage.local.set({ tracking: newTracking, data, hourly });

  await checkLimits(data);
  await checkBreakReminder(newTracking.length > 0);
  await updateBadge(activeDomain, data);
}

function pruneOldDays(byDate) {
  const keys = Object.keys(byDate).sort();
  while (keys.length > HISTORY_DAYS) {
    delete byDate[keys.shift()];
  }
}

async function checkLimits(data) {
  const key = todayKey();
  const todayData = data[key] || {};
  const store = await chrome.storage.local.get(["limits", "notified", "snoozes", "focus"]);
  const limits = store.limits || {};
  const notified = store.notified || {};
  const snoozes = store.snoozes || {};
  const notifiedToday = notified[key] || [];
  const focusActive = store.focus && store.focus.until > Date.now();

  let changed = false;
  for (const [domain, raw] of Object.entries(limits)) {
    const limit = normalizeLimit(raw);
    const spentSeconds = todayData[domain] || 0;

    // During a focus session every limited site is blocked outright.
    if (focusActive) {
      await blockOpenTabs(domain, "focus");
      continue;
    }

    if (spentSeconds < limit.minutes * 60) continue;

    if (!notifiedToday.includes(domain)) {
      chrome.notifications.create(`limit-${domain}-${key}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Time limit reached",
        message: `You have spent over ${limit.minutes} min on ${domain} today.`,
        priority: 2,
      });
      notifiedToday.push(domain);
      changed = true;
    }

    if (limit.block && Date.now() >= (snoozes[domain] || 0)) {
      await blockOpenTabs(domain, "limit");
    }
  }

  if (changed) {
    // Keep only today's notified list; old days are irrelevant.
    await chrome.storage.local.set({ notified: { [key]: notifiedToday } });
  }
}

async function blockOpenTabs(domain, reason) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url && domainFromUrl(tab.url) === domain) {
      chrome.tabs.update(tab.id, { url: blockedPageUrl(domain, tab.url, reason) });
    }
  }
}

// Reason a navigation to `domain` should be blocked right now, or null.
async function blockReason(domain) {
  const store = await chrome.storage.local.get(["limits", "data", "snoozes", "focus"]);
  const raw = (store.limits || {})[domain];
  if (!raw) return null;

  if (store.focus && store.focus.until > Date.now()) return "focus";

  const limit = normalizeLimit(raw);
  if (!limit.block) return null;

  const spent = ((store.data || {})[todayKey()] || {})[domain] || 0;
  if (spent < limit.minutes * 60) return null;

  const snoozedUntil = (store.snoozes || {})[domain] || 0;
  return Date.now() >= snoozedUntil ? "limit" : null;
}

// --- Break reminder: nudge after long continuous browsing ---

async function checkBreakReminder(browsingNow) {
  const settings = await getSettings();
  if (!settings.breakEveryMin) return;

  const now = Date.now();
  const store = await chrome.storage.local.get("usage");
  let usage = store.usage || { since: now, lastSeen: 0, breakNotifiedAt: 0 };

  if (!browsingNow) return; // clock only advances while actually browsing

  if (now - usage.lastSeen > USAGE_GAP_MS) {
    // Long enough pause - start a fresh stretch.
    usage = { since: now, lastSeen: now, breakNotifiedAt: 0 };
  } else {
    usage.lastSeen = now;
  }

  const stretchMs = now - usage.since;
  const everyMs = settings.breakEveryMin * 60 * 1000;
  if (stretchMs >= everyMs && now - usage.breakNotifiedAt >= everyMs) {
    const minutes = Math.round(stretchMs / 60000);
    const hours = Math.floor(minutes / 60);
    const pretty = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes} min`;
    chrome.notifications.create(`break-${now}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Time to stretch 🧘",
      message: `You've been browsing for ${pretty} straight. Take a short break - your eyes will thank you.`,
      priority: 1,
    });
    usage.breakNotifiedAt = now;
  }

  await chrome.storage.local.set({ usage });
}

// --- Toolbar badge: live time on the current site ---

function badgeText(seconds) {
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem > 0 ? `${h}h${String(rem).padStart(2, "0")}` : `${h}h`;
}

async function updateBadge(activeDomain, data) {
  const settings = await getSettings();
  if (!settings.badge) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  // Focus session countdown takes over the badge.
  const store = await chrome.storage.local.get(["focus", "limits"]);
  if (store.focus && store.focus.until > Date.now()) {
    const left = Math.ceil((store.focus.until - Date.now()) / 60000);
    chrome.action.setBadgeText({ text: `${left}m` });
    chrome.action.setBadgeBackgroundColor({ color: "#a142f4" });
    return;
  }

  if (!activeDomain) {
    chrome.action.setBadgeText({ text: "" });
    return;
  }

  const spent = (data[todayKey()] || {})[activeDomain] || 0;
  const raw = (store.limits || {})[activeDomain];

  let color = "#5f6368"; // neutral gray
  if (raw) {
    const limit = normalizeLimit(raw);
    const fraction = spent / (limit.minutes * 60);
    if (fraction >= 1) color = "#b3261e"; // over limit - red
    else if (fraction >= 0.8) color = "#e37400"; // getting close - orange
    else color = "#0b57d0"; // limited site - blue
  }

  chrome.action.setBadgeText({ text: badgeText(spent) });
  chrome.action.setBadgeBackgroundColor({ color });
}

async function refresh() {
  const { domains, activeDomain } = await getTrackingState();
  await switchTracking(domains, activeDomain);
}

// --- Weekly report ---

function scheduleWeeklyReport() {
  const now = new Date();
  const next = new Date(now);
  next.setDate(now.getDate() + ((7 - now.getDay()) % 7)); // upcoming Sunday
  next.setHours(19, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 7);
  chrome.alarms.create("weekly-report", {
    when: next.getTime(),
    periodInMinutes: 7 * 24 * 60,
  });
}

async function sendWeeklyReport() {
  const store = await chrome.storage.local.get("data");
  const data = store.data || {};

  const sumRange = (startOffset, endOffset) => {
    let total = 0;
    const sites = {};
    for (let i = startOffset; i < endOffset; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      for (const [domain, s] of Object.entries(data[todayKey(d.getTime())] || {})) {
        total += s;
        sites[domain] = (sites[domain] || 0) + s;
      }
    }
    return { total, sites };
  };

  const thisWeek = sumRange(0, 7);
  const lastWeek = sumRange(7, 14);
  const top = Object.entries(thisWeek.sites).sort((a, b) => b[1] - a[1])[0];

  const fmt = (s) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  let trend = "";
  if (lastWeek.total > 0) {
    const diff = Math.round(((thisWeek.total - lastWeek.total) / lastWeek.total) * 100);
    trend = diff >= 0 ? ` (${diff}% more than last week)` : ` (${-diff}% less than last week)`;
  }

  chrome.notifications.create(`weekly-${Date.now()}`, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Your week in review",
    message:
      `Screen time: ${fmt(thisWeek.total)}${trend}.` +
      (top ? ` Top site: ${top[0]} (${fmt(top[1])}).` : ""),
    priority: 1,
  });
}

// --- One-time migration: merge old subdomain keys and bare-number limits ---

async function migrateStorage() {
  const store = await chrome.storage.local.get(["data", "limits"]);
  const data = store.data || {};
  const limits = store.limits || {};

  const migratedData = {};
  for (const [day, sites] of Object.entries(data)) {
    migratedData[day] = {};
    for (const [domain, seconds] of Object.entries(sites)) {
      const base = baseDomain(domain);
      migratedData[day][base] = (migratedData[day][base] || 0) + seconds;
    }
  }

  const migratedLimits = {};
  for (const [domain, value] of Object.entries(limits)) {
    migratedLimits[baseDomain(domain)] = normalizeLimit(value);
  }

  await chrome.storage.local.set({ data: migratedData, limits: migratedLimits });
}

// --- Event wiring ---

function init() {
  chrome.alarms.create("heartbeat", { periodInMinutes: HEARTBEAT_MINUTES });
  chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  scheduleWeeklyReport();
}

chrome.runtime.onInstalled.addListener(async (details) => {
  init();
  await migrateStorage();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
  refresh();
});

chrome.runtime.onStartup.addListener(() => {
  init();
  // Browser was closed since the last flush; drop the stale interval.
  chrome.storage.local.set({ tracking: [] }).then(refresh);
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "heartbeat") refresh();
  if (alarm.name === "weekly-report") sendWeeklyReport();
  if (alarm.name === "focus-end") {
    await chrome.storage.local.set({ focus: null });
    chrome.notifications.create(`focus-done-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Focus session complete 🎉",
      message: "Nice work. Limited sites are available again.",
      priority: 2,
    });
    refresh();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg === "refresh") refresh();
});

chrome.tabs.onActivated.addListener(() => refresh());

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // A tab started or stopped playing sound - re-evaluate what to track.
  if ("audible" in changeInfo) {
    refresh();
    return;
  }

  if (!changeInfo.url) return;

  // Enforce blocks on any navigation, active tab or not.
  const domain = domainFromUrl(changeInfo.url);
  if (domain) {
    const reason = await blockReason(domain);
    if (reason) {
      chrome.tabs.update(tabId, { url: blockedPageUrl(domain, changeInfo.url, reason) });
      return;
    }
  }

  if (tab.active) refresh();
});

chrome.windows.onFocusChanged.addListener(() => refresh());

chrome.idle.onStateChanged.addListener(() => refresh());
