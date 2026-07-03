const $ = (id) => document.getElementById(id);
let appState = null;
let activeKeyword = "all";
let activeCampaignId = "";
let selectedRows = new Set();

const configFields = [
  "province", "city", "district", "address", "mapsLink", "radiusKm", "currentLat", "currentLng",
  "maxResults", "threads", "delayMin", "delayMax", "retry", "browserChannel", "headless", "proxyList", "proxyUrl"
];

function readConfig() {
  const config = Object.fromEntries(configFields.map((field) => {
    const el = $(field);
    return [field, el?.type === "checkbox" ? el.checked : el?.value ?? ""];
  }));
  config.locationMode = document.querySelector('input[name="locationMode"]:checked')?.value || "city";
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
  const mode = config.locationMode || "city";
  const radio = document.querySelector(`input[name="locationMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
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

function render(state) {
  appState = state;
  writeConfig(state.config || {});
  $("runState").textContent = state.running ? "Running" : "Ready";
  $("totalRows").textContent = `${state.results.length} ket qua`;
  $("start").disabled = state.running;
  $("stop").disabled = !state.running;
  $("version").textContent = state.license?.version || "1.1.0";
  $("licenseStatus").textContent = state.license?.status || "local";
  renderColumns();
  renderTabs();
  renderRows();
  renderLogs();
  renderHistory();
}

function renderColumns() {
  const selected = new Set(appState.config?.exportColumns || appState.columns || []);
  const html = (appState.columns || []).map((key) => `<label><input type="checkbox" value="${esc(key)}" ${selected.has(key) ? "checked" : ""}>${esc(key)}</label>`).join("");
  $("columns").innerHTML = html;
  $("exportColumns").innerHTML = html;
}

function checkedColumns(containerId) {
  return Array.from($(containerId).querySelectorAll("input:checked")).map((input) => input.value);
}

function renderTabs() {
  const counts = new Map();
  const source = activeCampaignId ? appState.results.filter((row) => row.campaignId === activeCampaignId) : appState.results;
  for (const row of source) counts.set(row.keyword, (counts.get(row.keyword) || 0) + 1);
  const tabs = [`<button class="tab ${activeKeyword === "all" ? "active" : ""}" data-keyword="all">Tat ca (${source.length})</button>`]
    .concat([...counts.entries()].map(([keyword, count]) => `<button class="tab ${activeKeyword === keyword ? "active" : ""}" data-keyword="${esc(keyword)}">${esc(keyword)} (${count})</button>`));
  $("keywordTabs").innerHTML = tabs.join("");
}

function renderRows() {
  const rows = visibleRows();
  $("rows").innerHTML = rows.map((row, index) => `
    <tr>
      <td><input class="rowCheck" type="checkbox" value="${esc(row.id)}" ${selectedRows.has(row.id) ? "checked" : ""}></td>
      <td>${index + 1}</td>
      <td>${esc(row.keyword)}</td>
      <td class="placeName"><b>${esc(row.business_name)}</b><div class="muted">${esc(row.category || "")}</div></td>
      <td>${esc(row.phone_number || "Chua cap nhat")}</td>
      <td>${row.website ? `<a href="#" data-open="${esc(row.website)}">${esc(short(row.website))}</a>` : "Chua cap nhat"}</td>
      <td>${esc(row.address || "Chua cap nhat")}</td>
      <td>${row.latitude && row.longitude ? `${row.latitude}, ${row.longitude}` : "Chua cap nhat"}</td>
      <td>${esc(row.distance_km || "")}</td>
      <td>${esc(row.rating || "")}</td>
      <td>${esc(row.review_count || 0)}</td>
      <td class="ok">${esc(row.status || "Thanh cong")}</td>
      <td>${row.google_maps_url ? `<button class="rowBtn" data-open="${esc(row.google_maps_url)}">Maps</button>` : ""}</td>
      <td><button class="rowBtn danger" data-delete="${esc(row.id)}">Xoa</button></td>
    </tr>
  `).join("");
  $("headCheck").checked = rows.length > 0 && rows.every((row) => selectedRows.has(row.id));
}

function renderLogs() {
  $("logs").textContent = appState.logs
    .slice(0, 200)
    .map((log) => `[${new Date(log.time).toLocaleTimeString()}] [${log.level.toUpperCase()}] ${log.message}`)
    .join("\n");
}

function renderHistory() {
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

window.crawler.onState(render);

window.addEventListener("DOMContentLoaded", async () => {
  render(await window.crawler.getState());

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
    renderTabs();
    renderRows();
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
    if (del && confirm("Xoa dong nay?")) render(await window.crawler.deleteRows([del.dataset.delete]));
  });

  $("historyList").addEventListener("click", async (event) => {
    const btn = event.target.closest("[data-campaign-delete]");
    if (btn) {
      event.stopPropagation();
      if (confirm("Xoa chien dich va du lieu lien quan?")) render(await window.crawler.deleteCampaign(btn.dataset.campaignDelete));
      return;
    }
    const item = event.target.closest("[data-campaign-open]");
    if (item) {
      activeCampaignId = item.dataset.campaignOpen;
      activeKeyword = "all";
      selectedRows.clear();
      showPage("campaigns");
      renderTabs();
      renderRows();
    }
  });

  $("headCheck").addEventListener("change", (event) => {
    for (const row of visibleRows()) event.target.checked ? selectedRows.add(row.id) : selectedRows.delete(row.id);
    renderRows();
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
      render(await window.crawler.deleteRows(ids));
    }
  });
  $("clearVisible").addEventListener("click", async () => {
    if (confirm("Xoa ket qua trong tab hien tai?")) {
      const scope = activeKeyword === "all" ? {} : { keyword: activeKeyword };
      selectedRows.clear();
      render(await window.crawler.clearResults(scope));
    }
  });

  $("search").addEventListener("input", renderRows);
  $("saveConfig").addEventListener("click", async () => render(await window.crawler.saveConfig(readConfig())));
  $("locate").addEventListener("click", locateCurrentPosition);
  $("openFolder").addEventListener("click", () => window.crawler.openDataFolder());
  $("checkUpdate").addEventListener("click", () => window.crawler.openExternal("https://github.com/chatgptleetuan-alt/GoogleMaps-CrawlbyTom"));
  $("start").addEventListener("click", async () => {
    activeCampaignId = "";
    activeKeyword = "all";
    await window.crawler.startCrawl({ campaignName: $("campaignName").value, keywords: keywords(), config: readConfig() });
  });
  $("stop").addEventListener("click", () => window.crawler.stopCrawl());
  $("csv").addEventListener("click", () => exportNow("csv"));
  $("xlsx").addEventListener("click", () => exportNow("xlsx"));
});

function showPage(page) {
  document.querySelectorAll(".nav").forEach((item) => item.classList.toggle("active", item.dataset.page === page));
  document.querySelectorAll(".page").forEach((item) => item.classList.remove("active"));
  $(`page-${page}`).classList.add("active");
}

async function locateCurrentPosition() {
  if ("geolocation" in navigator) {
    navigator.geolocation.getCurrentPosition(async (position) => {
      $("currentLat").value = position.coords.latitude.toFixed(7);
      $("currentLng").value = position.coords.longitude.toFixed(7);
      render(await window.crawler.saveConfig(readConfig()));
      alert("Da lay vi tri hien tai bang quyen trinh duyet.");
    }, async () => {
      const state = await window.crawler.currentLocation();
      render(state);
      if (state.locationOk) alert(`Da lay toa do: ${state.config.currentLat}, ${state.config.currentLng}`);
      else alert("Khong lay duoc GPS/permission va IP cung khong tra ve toa do. Ban co the nhap Lat/Lng thu cong.");
    }, { enableHighAccuracy: true, timeout: 12000 });
  } else {
    const state = await window.crawler.currentLocation();
    render(state);
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
