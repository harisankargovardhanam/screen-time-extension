// Category buckets for well-known sites; everything else is "Other".
const CATEGORY_OF = {
  "youtube.com": "Video", "netflix.com": "Video", "twitch.tv": "Video",
  "primevideo.com": "Video", "hotstar.com": "Video", "vimeo.com": "Video",
  "disneyplus.com": "Video", "hulu.com": "Video",
  "facebook.com": "Social", "instagram.com": "Social", "twitter.com": "Social",
  "x.com": "Social", "reddit.com": "Social", "tiktok.com": "Social",
  "snapchat.com": "Social", "pinterest.com": "Social", "threads.net": "Social",
  "whatsapp.com": "Social", "discord.com": "Social", "telegram.org": "Social",
  "github.com": "Work", "stackoverflow.com": "Work", "gitlab.com": "Work",
  "google.com": "Work", "notion.so": "Work", "slack.com": "Work",
  "atlassian.net": "Work", "jira.com": "Work", "figma.com": "Work",
  "linkedin.com": "Work", "claude.ai": "Work", "chatgpt.com": "Work",
  "openai.com": "Work", "anthropic.com": "Work", "docs.google.com": "Work",
  "bbc.com": "News", "cnn.com": "News", "nytimes.com": "News",
  "theguardian.com": "News", "reuters.com": "News", "news.google.com": "News",
  "thehindu.com": "News", "indiatimes.com": "News",
};

const CATEGORY_COLORS = {
  Video: "#d93025",
  Social: "#f538a0",
  Work: "#146c2e",
  News: "#e37400",
  Other: "#9aa0a6",
};

// Weight of each category when computing the productivity score.
const CATEGORY_WEIGHT = { Work: 1, News: 0.5, Other: 0.5, Video: 0, Social: 0 };

const PALETTE = [
  "#0b57d0", "#e37400", "#146c2e", "#a142f4", "#d93025",
  "#12a4af", "#f538a0", "#616161",
];
const OTHER_COLOR = "#9aa0a6";
const TOP_SITES_IN_CHART = 5;

function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return seconds > 0 ? `${seconds}s` : "0m";
}

function faviconUrl(domain, size = 32) {
  const url = new URL(chrome.runtime.getURL("/_favicon/"));
  url.searchParams.set("pageUrl", `https://${domain}/`);
  url.searchParams.set("size", String(size));
  return url.toString();
}

function normalizeLimit(value) {
  if (typeof value === "number") return { minutes: value, block: false };
  return value;
}

function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      key: dateKey(d),
      label: d.toLocaleDateString(undefined, { weekday: "short" }),
      isToday: i === 0,
    });
  }
  return days;
}

async function main() {
  const store = await chrome.storage.local.get([
    "data", "hourly", "limits", "snoozeLog", "settings",
  ]);
  const data = store.data || {};
  const hourly = store.hourly || {};
  const limits = store.limits || {};
  const snoozeLog = store.snoozeLog || {};

  const week = lastNDays(7);
  const todayData = data[dateKey(new Date())] || {};

  // Aggregate 7-day totals per site.
  const weekTotals = {};
  for (const day of week) {
    for (const [domain, s] of Object.entries(data[day.key] || {})) {
      weekTotals[domain] = (weekTotals[domain] || 0) + s;
    }
  }
  const rankedSites = Object.entries(weekTotals).sort((a, b) => b[1] - a[1]);

  renderHeader();
  renderSummary(todayData, weekTotals, data, rankedSites);
  renderCategories(todayData);
  renderProductivity(todayData, data, limits);
  renderStackedChart(week, data, rankedSites);
  renderHeatmap(hourly[dateKey(new Date())] || []);
  renderLimitsOverview(limits, todayData, snoozeLog);
  renderTable(rankedSites, todayData, weekTotals);
  setupSettings(store.settings || {});

  document.getElementById("export").addEventListener("click", () => exportCsv(data));
}

function categoryTotals(todayData) {
  const totals = { Video: 0, Social: 0, Work: 0, News: 0, Other: 0 };
  for (const [domain, s] of Object.entries(todayData)) {
    totals[CATEGORY_OF[domain] || "Other"] += s;
  }
  return totals;
}

function renderCategories(todayData) {
  const totals = categoryTotals(todayData);
  const entries = Object.entries(totals).filter(([, s]) => s > 0);
  const total = entries.reduce((sum, [, s]) => sum + s, 0);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 42 42");
  const R = 15.9155; // circumference = 100 for easy percentages
  const C = 100;

  if (total === 0) {
    const bg = document.createElementNS(svgNS, "circle");
    bg.setAttribute("cx", 21); bg.setAttribute("cy", 21); bg.setAttribute("r", R);
    bg.setAttribute("fill", "none");
    bg.setAttribute("stroke", "var(--surface-variant)");
    bg.setAttribute("stroke-width", 5);
    svg.appendChild(bg);
  } else {
    let offset = 25; // start at 12 o'clock
    for (const [cat, seconds] of entries) {
      const pct = (seconds / total) * C;
      const arc = document.createElementNS(svgNS, "circle");
      arc.setAttribute("cx", 21); arc.setAttribute("cy", 21); arc.setAttribute("r", R);
      arc.setAttribute("fill", "none");
      arc.setAttribute("stroke", CATEGORY_COLORS[cat]);
      arc.setAttribute("stroke-width", 5);
      arc.setAttribute("stroke-dasharray", `${pct} ${C - pct}`);
      arc.setAttribute("stroke-dashoffset", offset);
      const title = document.createElementNS(svgNS, "title");
      title.textContent = `${cat}: ${formatDuration(seconds)}`;
      arc.appendChild(title);
      svg.appendChild(arc);
      offset -= pct;
    }
  }
  document.getElementById("cat-donut").replaceChildren(svg);

  const legend = document.getElementById("cat-legend");
  legend.innerHTML = "";
  const shown = entries.length ? entries : Object.entries(totals);
  for (const [cat, seconds] of shown.sort((a, b) => b[1] - a[1])) {
    const item = document.createElement("div");
    item.className = "legend-item";
    const left = document.createElement("span");
    left.className = "legend-left";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = CATEGORY_COLORS[cat];
    left.append(swatch, document.createTextNode(cat));
    const time = document.createElement("span");
    time.className = "legend-time";
    time.textContent = formatDuration(seconds);
    item.append(left, time);
    legend.appendChild(item);
  }
}

function renderProductivity(todayData, data, limits) {
  const totals = categoryTotals(todayData);
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  const weighted = Object.entries(totals).reduce(
    (sum, [cat, s]) => sum + s * CATEGORY_WEIGHT[cat],
    0
  );
  const score = total > 0 ? Math.round((weighted / total) * 100) : 0;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 42 42");
  const R = 15.9155, C = 100;
  const color = score >= 60 ? "#146c2e" : score >= 30 ? "#e37400" : "#d93025";

  const bg = document.createElementNS(svgNS, "circle");
  bg.setAttribute("cx", 21); bg.setAttribute("cy", 21); bg.setAttribute("r", R);
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "var(--surface-variant)");
  bg.setAttribute("stroke-width", 5);
  svg.appendChild(bg);

  const val = document.createElementNS(svgNS, "circle");
  val.setAttribute("cx", 21); val.setAttribute("cy", 21); val.setAttribute("r", R);
  val.setAttribute("fill", "none");
  val.setAttribute("stroke", color);
  val.setAttribute("stroke-width", 5);
  val.setAttribute("stroke-linecap", "round");
  val.setAttribute("stroke-dasharray", `${score} ${C - score}`);
  val.setAttribute("stroke-dashoffset", 25);
  svg.appendChild(val);

  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", 21); text.setAttribute("y", 21.5);
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("dominant-baseline", "central");
  text.setAttribute("font-size", "10");
  text.setAttribute("font-weight", "600");
  text.setAttribute("fill", "currentColor");
  text.textContent = total > 0 ? score : "—";
  svg.appendChild(text);

  document.getElementById("score-ring").replaceChildren(svg);

  // Streak: consecutive days (ending today) with every limited site under
  // its limit. Only meaningful when limits exist.
  const limitEntries = Object.entries(limits);
  if (limitEntries.length === 0) return;

  let streak = 0;
  for (let i = 0; i < 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const day = data[dateKey(d)] || {};
    const underAll = limitEntries.every(([domain, raw]) => {
      const limit = normalizeLimit(raw);
      return (day[domain] || 0) < limit.minutes * 60;
    });
    if (!underAll) break;
    streak++;
    if (i > 0 && Object.keys(day).length === 0) break; // no data = stop counting
  }

  const el = document.getElementById("streak");
  el.hidden = false;
  el.textContent =
    streak > 1
      ? `🔥 ${streak}-day streak under your limits`
      : streak === 1
        ? "🔥 Under your limits today — keep going"
        : "Over a limit today — streak resets";
}

function setupSettings(saved) {
  const defaults = { activityTimeoutSec: 60, snoozeMinutes: 5, breakEveryMin: 60, badge: true };
  const settings = { ...defaults, ...saved };

  document.getElementById("set-activity").value = settings.activityTimeoutSec;
  document.getElementById("set-snooze").value = settings.snoozeMinutes;
  document.getElementById("set-break").value = settings.breakEveryMin;
  document.getElementById("set-badge").checked = settings.badge;

  document.getElementById("save-settings").addEventListener("click", async () => {
    const next = {
      activityTimeoutSec: Math.max(15, parseInt(document.getElementById("set-activity").value, 10) || 60),
      snoozeMinutes: Math.max(1, parseInt(document.getElementById("set-snooze").value, 10) || 5),
      breakEveryMin: Math.max(0, parseInt(document.getElementById("set-break").value, 10) || 0),
      badge: document.getElementById("set-badge").checked,
    };
    await chrome.storage.local.set({ settings: next });
    const saved = document.getElementById("settings-saved");
    saved.hidden = false;
    setTimeout(() => (saved.hidden = true), 2000);
  });

  document.getElementById("export-json").addEventListener("click", async () => {
    const all = await chrome.storage.local.get(null);
    const blob = new Blob([JSON.stringify(all, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `screen-time-backup-${dateKey(new Date())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("import-json").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (typeof parsed !== "object" || !parsed || (!parsed.data && !parsed.limits)) {
        alert("Not a valid Screen Time backup file.");
        return;
      }
      await chrome.storage.local.set(parsed);
      location.reload();
    } catch {
      alert("Could not read that file as JSON.");
    }
  });
}

function renderHeader() {
  document.getElementById("date-label").textContent = new Date().toLocaleDateString(
    undefined,
    { weekday: "long", month: "long", day: "numeric", year: "numeric" }
  );
}

function renderSummary(todayData, weekTotals, data, rankedSites) {
  const todayTotal = Object.values(todayData).reduce((s, v) => s + v, 0);
  const weekTotal = Object.values(weekTotals).reduce((s, v) => s + v, 0);
  // Average over days that actually have data, so a fresh install isn't diluted.
  const activeDays = lastNDays(7).filter(
    (d) => Object.keys(data[d.key] || {}).length > 0
  ).length;

  document.getElementById("stat-today").textContent = formatDuration(todayTotal);
  document.getElementById("stat-week").textContent = formatDuration(weekTotal);
  document.getElementById("stat-avg").textContent = formatDuration(
    activeDays ? Math.round(weekTotal / activeDays) : 0
  );
  document.getElementById("stat-top").textContent = rankedSites.length
    ? rankedSites[0][0]
    : "—";
  if (rankedSites.length) {
    document.getElementById("stat-top").title =
      `${rankedSites[0][0]} — ${formatDuration(rankedSites[0][1])} this week`;
  }
}

function renderStackedChart(week, data, rankedSites) {
  const topSites = rankedSites.slice(0, TOP_SITES_IN_CHART).map(([d]) => d);
  const colorOf = (domain) => {
    const i = topSites.indexOf(domain);
    return i === -1 ? OTHER_COLOR : PALETTE[i % PALETTE.length];
  };

  // Build per-day stacks: top sites individually, rest lumped as Other.
  const stacks = week.map((day) => {
    const sites = data[day.key] || {};
    const segments = topSites
      .map((domain) => ({ domain, seconds: sites[domain] || 0 }))
      .filter((s) => s.seconds > 0);
    const other = Object.entries(sites)
      .filter(([d]) => !topSites.includes(d))
      .reduce((sum, [, s]) => sum + s, 0);
    if (other > 0) segments.push({ domain: "Other", seconds: other });
    return { ...day, segments, total: segments.reduce((s, x) => s + x.seconds, 0) };
  });

  const max = Math.max(...stacks.map((s) => s.total), 1);
  const W = 840, H = 200, PAD_BOTTOM = 24, PAD_TOP = 16;
  const barW = 44;
  const slot = W / 7;

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

  stacks.forEach((day, i) => {
    const x = slot * i + (slot - barW) / 2;
    let y = H - PAD_BOTTOM;

    for (const seg of day.segments) {
      const h = (seg.seconds / max) * (H - PAD_BOTTOM - PAD_TOP);
      y -= h;
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
      rect.setAttribute("width", barW);
      rect.setAttribute("height", Math.max(h, 0));
      rect.setAttribute("rx", 3);
      rect.setAttribute("fill", seg.domain === "Other" ? OTHER_COLOR : colorOf(seg.domain));
      const title = document.createElementNS(svgNS, "title");
      title.textContent = `${seg.domain}: ${formatDuration(seg.seconds)} (${day.label})`;
      rect.appendChild(title);
      svg.appendChild(rect);
    }

    // Day label
    const label = document.createElementNS(svgNS, "text");
    label.setAttribute("x", x + barW / 2);
    label.setAttribute("y", H - 6);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("font-size", "12");
    label.setAttribute("fill", "currentColor");
    label.setAttribute("opacity", day.isToday ? "1" : "0.55");
    label.setAttribute("font-weight", day.isToday ? "600" : "400");
    label.textContent = day.label;
    svg.appendChild(label);

    // Total above bar
    if (day.total > 0) {
      const totalLabel = document.createElementNS(svgNS, "text");
      totalLabel.setAttribute("x", x + barW / 2);
      totalLabel.setAttribute("y", Math.max(y - 5, 11));
      totalLabel.setAttribute("text-anchor", "middle");
      totalLabel.setAttribute("font-size", "10");
      totalLabel.setAttribute("fill", "currentColor");
      totalLabel.setAttribute("opacity", "0.65");
      totalLabel.textContent = formatDuration(day.total);
      svg.appendChild(totalLabel);
    }
  });

  document.getElementById("stacked-chart").replaceChildren(svg);

  // Legend
  const legend = document.getElementById("legend");
  legend.innerHTML = "";
  const items = topSites.map((d, i) => [d, PALETTE[i % PALETTE.length]]);
  if (rankedSites.length > topSites.length) items.push(["Other", OTHER_COLOR]);
  for (const [name, color] of items) {
    const item = document.createElement("span");
    item.className = "legend-item";
    const swatch = document.createElement("span");
    swatch.className = "legend-swatch";
    swatch.style.background = color;
    item.append(swatch, document.createTextNode(name));
    legend.appendChild(item);
  }
}

function renderHeatmap(hours) {
  const heatmap = document.getElementById("heatmap");
  heatmap.innerHTML = "";
  const max = Math.max(...hours, 1);

  for (let h = 0; h < 24; h++) {
    const seconds = hours[h] || 0;
    const cell = document.createElement("div");
    cell.className = "heat-cell";
    if (seconds > 0) {
      const intensity = 0.25 + 0.75 * (seconds / max);
      cell.style.background = `color-mix(in srgb, var(--primary) ${Math.round(intensity * 100)}%, var(--surface-variant))`;
    }
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    const ampm = h < 12 ? "am" : "pm";
    cell.title = `${hour12}${ampm}: ${formatDuration(seconds)}`;
    heatmap.appendChild(cell);
  }
}

function renderLimitsOverview(limits, todayData, snoozeLog = {}) {
  const snoozedToday = snoozeLog[dateKey(new Date())] || {};
  const container = document.getElementById("limits-overview");
  const noLimits = document.getElementById("no-limits");
  container.innerHTML = "";

  const entries = Object.entries(limits).sort((a, b) => a[0].localeCompare(b[0]));
  noLimits.hidden = entries.length > 0;

  for (const [domain, raw] of entries) {
    const limit = normalizeLimit(raw);
    const spent = todayData[domain] || 0;
    const fraction = spent / (limit.minutes * 60);
    const over = fraction >= 1;

    const line = document.createElement("div");
    line.className = "limit-line";

    const top = document.createElement("div");
    top.className = "limit-line-top";
    const name = document.createElement("span");
    const snoozeCount = snoozedToday[domain] || 0;
    name.textContent =
      domain +
      (limit.block ? " · blocks" : "") +
      (snoozeCount > 0 ? ` · snoozed ${snoozeCount}× today` : "");
    const used = document.createElement("span");
    used.className = "used" + (over ? " over" : "");
    used.textContent = `${formatDuration(spent)} / ${limit.minutes}m`;
    top.append(name, used);

    const track = document.createElement("div");
    track.className = "limit-track";
    const fill = document.createElement("div");
    fill.className = "limit-fill" + (over ? " over" : "");
    fill.style.width = `${Math.min(fraction, 1) * 100}%`;
    track.appendChild(fill);

    line.append(top, track);
    container.appendChild(line);
  }
}

function renderTable(rankedSites, todayData, weekTotals) {
  const tbody = document.querySelector("#site-table tbody");
  tbody.innerHTML = "";
  const weekTotal = Object.values(weekTotals).reduce((s, v) => s + v, 0) || 1;

  for (const [domain, total] of rankedSites) {
    const tr = document.createElement("tr");

    const siteTd = document.createElement("td");
    const cell = document.createElement("div");
    cell.className = "site-cell";
    const img = document.createElement("img");
    img.src = faviconUrl(domain);
    img.alt = "";
    cell.append(img, document.createTextNode(domain));
    siteTd.appendChild(cell);

    const todayTd = document.createElement("td");
    todayTd.className = "num";
    todayTd.textContent = formatDuration(todayData[domain] || 0);

    const totalTd = document.createElement("td");
    totalTd.className = "num";
    totalTd.textContent = formatDuration(total);

    const avgTd = document.createElement("td");
    avgTd.className = "num";
    avgTd.textContent = formatDuration(Math.round(total / 7));

    const share = (total / weekTotal) * 100;
    const shareTd = document.createElement("td");
    shareTd.className = "num";
    shareTd.textContent = `${share.toFixed(1)}%`;
    const track = document.createElement("span");
    track.className = "share-track";
    const fill = document.createElement("span");
    fill.className = "share-fill";
    fill.style.width = `${share}%`;
    fill.style.display = "block";
    track.appendChild(fill);
    shareTd.appendChild(track);

    tr.append(siteTd, todayTd, totalTd, avgTd, shareTd);
    tbody.appendChild(tr);
  }
}

function exportCsv(data) {
  const rows = [["date", "site", "seconds", "minutes"]];
  for (const day of Object.keys(data).sort()) {
    for (const [domain, seconds] of Object.entries(data[day])) {
      rows.push([day, domain, seconds, (seconds / 60).toFixed(1)]);
    }
  }
  const csv = rows.map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `screen-time-${dateKey(new Date())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

main();
