const $ = (id) => document.getElementById(id);
let appState = null;
let activeKeyword = "all";
let activeCampaignId = "";
let selectedRows = new Set();
let configHydrated = false;
let columnsHydrated = false;
let domReady = false;
let pendingState = null;
let renderFrame = 0;
let lastRowsSignature = "";
let lastTabsSignature = "";
let lastLogsSignature = "";
let lastHistorySignature = "";
let previewCoords = null;

const configFields = [
  "province", "city", "district", "address", "mapsLink", "radiusKm", "currentLat", "currentLng",
  "maxResults", "threads", "delayMin", "delayMax", "retry", "browserChannel", "distanceMode", "headless", "proxyList", "proxyUrl"
];

function readConfig() {
  const config = Object.fromEntries(configFields.map((field) => {
    const el = $(field);
    return [field, el?.type === "checkbox" ? el.checked : el?.value ?? ""];
  }));
  const hasTextLocation = [config.address, config.mapsLink, config.province, config.district].some((value) => String(value || "").trim());
  config.locationMode = hasTextLocation ? "address" : (config.currentLat && config.currentLng ? "current" : "address");
  config.exportColumns = checkedColumns("exportColumns");
  return config;
}

function writeConfig(config) {
  for (const field of configFields) {
    const el = $(field);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = Boolean(config[field]);
    else el.value = config[field] ?? "";
  }
}

function keywords() {
  return $("keywords").value.split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
}

function visibleRows() {
  if (!appState) return [];
  const q = $("search").value.trim().toLowerCase();
  return appState.results.filter((row) => {
    const keywordOk = activeKeyword === "all" || row.keyword === activeKeyword;
    const campaignOk = !activeCampaignId || row.campaignId === activeCampaignId;
    const searchOk = !q || [row.keyword, row.business_name, row.phone_number, row.website, row.address].some((value) => String(value || "").toLowerCase().includes(q));
    return campaignOk && keywordOk && searchOk;
  });
}

function render(state, options = {}) {
  appState = state;
  if (options.hydrateConfig || !configHydrated) {
    writeConfig(state.config || {});
    configHydrated = true;
  }
  $("runState").textContent = state.running ? "Running" : "Ready";
  $("totalRows").textContent = `${state.results.length} ket qua`;
  $("start").disabled = state.running;
  $("stop").disabled = !state.running;
  $("version").textContent = state.license?.version || "1.0.10";
  $("licenseStatus").textContent = state.license?.status || "local";
  const percent = state.progress?.percent || 0;
  $("progressText").textContent = state.progress?.message || (state.running ? "Dang chay" : "Ready");
  $("progressPercent").textContent = `${percent}%`;
  $("progressFill").style.width = `${percent}%`;
  renderColumns(options);
  renderTabs(options);
  renderRows(options);
  renderLogs(options);
  renderHistory(options);
}

function renderColumns(options = {}) {
  if (columnsHydrated && !options.hydrateColumns) return;
  const selected = new Set(appState.config?.exportColumns || appState.columns || []);
  const html = (appState.columns || []).map((key) => `<label><input type="checkbox" value="${esc(key)}" ${selected.has(key) ? "checked" : ""}>${esc(key)}</label>`).join("");
  $("columns").innerHTML = html;
  $("exportColumns").innerHTML = html;
  columnsHydrated = true;
}

function checkedColumns(containerId) {
  return Array.from($(containerId).querySelectorAll("input:checked")).map((input) => input.value);
}

function resultStamp() {
  const results = appState?.results || [];
  return `${results.length}:${results[0]?.id || ""}:${results[results.length - 1]?.id || ""}`;
}

function renderTabs(options = {}) {
  const counts = new Map();
  const source = activeCampaignId ? appState.results.filter((row) => row.campaignId === activeCampaignId) : appState.results;
  const signature = `${activeCampaignId}:${activeKeyword}:${resultStamp()}`;
  if (!options.force && signature === lastTabsSignature) return;
  lastTabsSignature = signature;
  for (const row of source) counts.set(row.keyword, (counts.get(row.keyword) || 0) + 1);
  const tabs = [`<button class="tab ${activeKeyword === "all" ? "active" : ""}" data-keyword="all">Tat ca (${source.length})</button>`]
    .concat([...counts.entries()].map(([keyword, count]) => `<button class="tab ${activeKeyword === keyword ? "active" : ""}" data-keyword="${esc(keyword)}">${esc(keyword)} (${count})</button>`));
  $("keywordTabs").innerHTML = tabs.join("");
}

function renderRows(options = {}) {
  const rows = visibleRows();
  const selectedSignature = [...selectedRows].sort().join(",");
  const signature = `${activeCampaignId}:${activeKeyword}:${$("search").value}:${resultStamp()}:${selectedSignature}`;
  if (!options.force && signature === lastRowsSignature) return;
  lastRowsSignature = signature;
  const displayRows = rows.slice(0, 500);
  $("rows").innerHTML = displayRows.map((row, index) => `
    <tr>
      <td><input class="rowCheck" type="checkbox" value="${esc(row.id)}" ${selectedRows.has(row.id) ? "checked" : ""}></td>
      <td>${index + 1}</td>
      <td>${esc(row.keyword)}</td>
      <td class="placeName"><b>${esc(row.business_name)}</b></td>
      <td>${esc(row.phone_number || "Chua cap nhat")}</td>
      <td>${row.website ? `<a href="#" data-open="${esc(row.website)}">${esc(short(row.website))}</a>` : "Chua cap nhat"}</td>
      <td>${esc(row.address || "Chua cap nhat")}</td>
      <td>${row.latitude && row.longitude ? `${row.latitude}, ${row.longitude}` : "Chua cap nhat"}</td>
      <td>${esc(row.distance_km || "")}</td>
      <td>${esc(row.driving_distance_km || "")}</td>
      <td>${esc(row.rating || "")}</td>
      <td>${esc(row.review_count || 0)}</td>
      <td class="ok">${esc(row.status || "Thanh cong")}</td>
      <td>${row.google_maps_url ? `<button class="rowBtn" title="Mo Google Maps" data-open="${esc(row.google_maps_url)}">Map</button>` : ""}</td>
      <td><button class="rowBtn danger" title="Xoa dong" data-delete="${esc(row.id)}">X</button></td>
    </tr>
  `).join("");
  $("headCheck").checked = rows.length > 0 && rows.every((row) => selectedRows.has(row.id));
}

function renderLogs(options = {}) {
  const logs = appState.logs || [];
  const signature = `${logs.length}:${logs[0]?.id || ""}`;
  if (!options.force && signature === lastLogsSignature) return;
  lastLogsSignature = signature;
  $("logs").textContent = appState.logs
    .slice(0, 200)
    .map((log) => `[${new Date(log.time).toLocaleTimeString()}] [${log.level.toUpperCase()}] ${log.message}`)
    .join("\n");
}

function renderHistory(options = {}) {
  const history = appState.history || [];
  const signature = history.map((item) => `${item.id}:${item.name}:${item.status}:${item.finishedAt || ""}`).join("|");
  if (!options.force && signature === lastHistorySignature) return;
  lastHistorySignature = signature;
  $("historyList").innerHTML = (appState.history || []).map((item) => `
    <div class="historyItem" data-campaign-open="${esc(item.id)}">
      <div><b>${esc(item.name)}</b><div class="muted">${esc((item.keywords || []).join(", "))}</div></div>
      <div>${esc(item.status)}</div>
      <div>${new Date(item.startedAt).toLocaleString()}</div>
      <button class="danger" data-campaign-delete="${esc(item.id)}">Xoa</button>
    </div>
  `).join("");
}

function selectedVisibleIds() {
  return visibleRows().filter((row) => selectedRows.has(row.id)).map((row) => row.id);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}

function short(value) {
  return String(value).replace(/^https?:\/\//, "").slice(0, 46);
}

function scheduleRender(state) {
  pendingState = state;
  if (!domReady || renderFrame) return;
  renderFrame = requestAnimationFrame(() => {
    renderFrame = 0;
    const nextState = pendingState;
    pendingState = null;
    if (nextState) render(nextState);
  });
}

window.crawler.onState(scheduleRender);

window.addEventListener("DOMContentLoaded", async () => {
  domReady = true;
  render(await window.crawler.getState(), { hydrateConfig: true, hydrateColumns: true, force: true });

  document.querySelectorAll(".nav").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".page").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    $(`page-${button.dataset.page}`).classList.add("active");
  }));

  $("keywordTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-keyword]");
    if (!button) return;
    activeKeyword = button.dataset.keyword;
    selectedRows.clear();
    renderTabs({ force: true });
    renderRows({ force: true });
  });

  $("rows").addEventListener("change", (event) => {
    if (!event.target.classList.contains("rowCheck")) return;
    if (event.target.checked) selectedRows.add(event.target.value);
    else selectedRows.delete(event.target.value);
  });

  $("rows").addEventListener("click", async (event) => {
    const open = event.target.closest("[data-open]");
    if (open) {
      event.preventDefault();
      await window.crawler.openExternal(open.dataset.open);
    }
    const del = event.target.closest("[data-delete]");
    if (del && confirm("Xoa dong nay?")) render(await window.crawler.deleteRows([del.dataset.delete]), { force: true });
  });

  $("historyList").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-campaign-delete]");
    if (btn) {
      event.stopPropagation();
      if (confirm("Xoa chien dich va du lieu lien quan?")) render(await window.crawler.deleteCampaign(btn.dataset.campaignDelete), { force: true });
      return;
    }
    const item = event.target.closest("[data-campaign-open]");
    if (item) {
      activeCampaignId = item.dataset.campaignOpen;
      activeKeyword = "all";
      selectedRows.clear();
      showPage("campaigns");
      renderTabs({ force: true });
      renderRows({ force: true });
    }
  });

  $("headCheck").addEventListener("change", (event) => {
    for (const row of visibleRows()) event.target.checked ? selectedRows.add(row.id) : selectedRows.delete(row.id);
    renderRows({ force: true });
  });
  $("selectAllColumns").addEventListener("click", () => {
    const boxes = Array.from($("columns").querySelectorAll("input[type='checkbox']"));
    const shouldCheck = boxes.some((box) => !box.checked);
    boxes.forEach((box) => { box.checked = shouldCheck; });
  });
  $("deleteSelected").addEventListener("click", async () => {
    const ids = selectedVisibleIds();
    if (ids.length && confirm(`Xoa ${ids.length} dong da chon?`)) {
      selectedRows.clear();
      render(await window.crawler.deleteRows(ids), { force: true });
    }
  });
  $("clearVisible").addEventListener("click", async () => {
    if (confirm("Xoa ket qua trong tab hien tai?")) {
      const scope = activeKeyword === "all" ? {} : { keyword: activeKeyword };
      selectedRows.clear();
      render(await window.crawler.clearResults(scope), { force: true });
    }
  });

  $("search").addEventListener("input", () => renderRows({ force: true }));
  $("saveConfig").addEventListener("click", async () => {
    const state = await window.crawler.saveConfig(readConfig());
    appState = state;
    render(state, { force: true });
  });
  $("locate").addEventListener("click", locateCurrentPosition);
  $("browserLeaks").addEventListener("click", locateWithBrowserLeaks);
  $("toggleSidebar").addEventListener("click", () => {
    document.body.classList.toggle("sidebarHidden");
    $("toggleSidebar").textContent = document.body.classList.contains("sidebarHidden") ? "Menu" : "Menu";
  });
  $("toggleScanPanel").addEventListener("click", () => {
    document.querySelector(".campaignGrid").classList.toggle("collapsed");
    $("toggleScanPanel").textContent = document.querySelector(".campaignGrid").classList.contains("collapsed") ? "Hien thiet lap" : "An thiet lap";
  });
  $("previewLocation").addEventListener("click", previewScanLocation);
  $("openPreviewMap").addEventListener("click", () => {
    if (!previewCoords) return alert("Chua co toa do. Bam Kiem tra toa do truoc.");
    window.crawler.openExternal(`https://www.google.com/maps/search/?api=1&query=${previewCoords.lat},${previewCoords.lng}`);
  });
  setupResultSplitter();
  $("openFolder").addEventListener("click", () => window.crawler.openDataFolder());
  $("checkUpdate").addEventListener("click", async () => {
    $("checkUpdate").disabled = true;
    $("checkUpdate").textContent = "Dang kiem tra...";
    const result = await window.crawler.checkUpdate();
    $("checkUpdate").disabled = false;
    $("checkUpdate").textContent = "Tu dong tai va cap nhat";
    if (result?.message) alert(result.message);
  });
  $("openRelease").addEventListener("click", () => window.crawler.openExternal("https://github.com/chatgptleetuan-alt/GoogleMaps-CrawlbyTom/releases"));
  $("newCampaign").addEventListener("click", async () => {
    await window.crawler.saveConfig(readConfig());
    $("campaignName").value = `Scan ${new Date().toLocaleString()}`;
    $("search").value = "";
    activeCampaignId = "";
    activeKeyword = "all";
    selectedRows.clear();
    const state = await window.crawler.getState();
    appState = state;
    render(state, { force: true });
  });
  $("start").addEventListener("click", async () => {
    activeCampaignId = "";
    activeKeyword = "all";
    await window.crawler.startCrawl({ campaignName: $("campaignName").value, keywords: keywords(), config: readConfig() });
  });
  $("stop").addEventListener("click", () => window.crawler.stopCrawl());
  $("csv").addEventListener("click", () => exportNow("csv"));
  $("xlsx").addEventListener("click", () => exportNow("xlsx"));
});

function setupResultSplitter() {
  const splitter = $("resultSplitter");
  const area = document.querySelector(".resultsArea");
  if (!splitter || !area) return;
  splitter.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    splitter.setPointerCapture(event.pointerId);
    const startY = event.clientY;
    const startHeight = Number(getComputedStyle(area).getPropertyValue("--log-height").replace("px", "")) || 122;
    const move = (moveEvent) => {
      const next = Math.max(70, Math.min(360, startHeight - (moveEvent.clientY - startY)));
      area.style.setProperty("--log-height", `${next}px`);
    };
    const up = () => {
      splitter.removeEventListener("pointermove", move);
      splitter.removeEventListener("pointerup", up);
      splitter.removeEventListener("pointercancel", up);
    };
    splitter.addEventListener("pointermove", move);
    splitter.addEventListener("pointerup", up);
    splitter.addEventListener("pointercancel", up);
  });
}

function showPage(page) {
  document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  document.querySelectorAll(".page").forEach((item) => item.classList.remove("active"));
  $(`page-${page}`).classList.add("active");
}

async function locateWithBrowserLeaks() {
  alert("App se mo BrowserLeaks Geo trong Chrome/Edge. Neu trinh duyet hoi quyen vi tri, hay bam Allow roi cho app tu dien Lat/Lng.");
  const state = await window.crawler.browserLeaksLocation();
  if (state.locationOk) {
    $("currentLat").value = state.config.currentLat || "";
    $("currentLng").value = state.config.currentLng || "";
  }
  render(state, { force: true });
  if (state.locationOk) alert(`Da lay toa do BrowserLeaks: ${state.config.currentLat}, ${state.config.currentLng}`);
  else alert("BrowserLeaks khong tra ve toa do. Kiem tra log hoac nhap Lat/Lng thu cong.");
}

async function previewScanLocation() {
  $("previewLocation").disabled = true;
  $("previewLocation").textContent = "Dang kiem tra";
  try {
    const result = await window.crawler.previewLocation(readConfig());
    if (!result?.ok) {
      previewCoords = null;
      $("previewCoords").value = result?.message || "Khong dinh vi duoc khu vuc";
      alert($("previewCoords").value);
      return;
    }
    previewCoords = { lat: result.lat, lng: result.lng };
    $("previewCoords").value = `${result.label}: ${result.lat}, ${result.lng}`;
  } finally {
    $("previewLocation").disabled = false;
    $("previewLocation").textContent = "Kiem tra toa do";
  }
}

async function locateCurrentPosition() {
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      $("currentLat").value = position.coords.latitude.toFixed(7);
      $("currentLng").value = position.coords.longitude.toFixed(7);
      const state = await window.crawler.saveConfig(readConfig());
      appState = state;
      render(state, { force: true });
      alert("Da lay vi tri hien tai bang quyen trinh duyet.");
    }, async () => {
      const state = await window.crawler.currentLocation();
      if (state.locationOk) {
        $("currentLat").value = state.config.currentLat || "";
        $("currentLng").value = state.config.currentLng || "";
      }
      render(state, { force: true });
      if (state.locationOk) alert(`Da lay toa do: ${state.config.currentLat}, ${state.config.currentLng}`);
      else alert("Khong lay duoc GPS/permission va IP cung khong tra ve toa do. Ban co the nhap Lat/Lng thu cong.");
    }, { enableHighAccuracy: true, timeout: 12000 });
  } else {
    const state = await window.crawler.currentLocation();
    if (state.locationOk) {
      $("currentLat").value = state.config.currentLat || "";
      $("currentLng").value = state.config.currentLng || "";
    }
    render(state, { force: true });
    if (state.locationOk) alert(`Da lay toa do: ${state.config.currentLat}, ${state.config.currentLng}`);
    else alert("Khong lay duoc toa do. Ban co the nhap Lat/Lng thu cong.");
  }
}

async function exportNow(format) {
  const file = await window.crawler.exportFile({
    format,
    ids: selectedVisibleIds(),
    campaignId: activeCampaignId,
    keyword: activeKeyword === "all" ? "" : activeKeyword,
    columns: checkedColumns("columns"),
    deleteAfterExport: $("deleteAfterExport").checked
  });
  if (file) alert(`Da xuat file:\n${file}`);
}
