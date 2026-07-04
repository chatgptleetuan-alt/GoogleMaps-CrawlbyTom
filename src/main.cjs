const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

const repoOwner = "chatgptleetuan-alt";
const repoName = "GoogleMaps-CrawlbyTom";
const releasesUrl = `https://github.com/${repoOwner}/${repoName}/releases`;

let mainWindow;
let state;
let running = false;
let stopRequested = false;
let stateSendTimer = null;
const locationCache = new Map();

const allColumns = [
  "keyword", "search_location", "business_name", "phone_number", "website", "address", "latitude", "longitude",
  "distance_km", "bird_distance_km", "driving_distance_km", "rating", "review_count", "category", "google_maps_url", "status", "created_at"
];

const defaults = {
  config: {
    browserChannel: "msedge",
    locationMode: "city",
    city: "",
    province: "",
    district: "",
    address: "",
    mapsLink: "",
    radiusKm: "",
    currentLat: "",
    currentLng: "",
    maxResults: "",
    delayMin: "",
    delayMax: "",
    retry: "",
    threads: "",
    distanceMode: "bird",
    headless: false,
    proxyList: "",
    proxyUrl: "",
    exportColumns: allColumns
  },
  currentCampaignId: "",
  campaigns: [],
  history: [],
  results: [],
  logs: [],
  license: { status: "local", version: app.getVersion() }
};

function dataFile() {
  return path.join(app.getPath("userData"), "data.json");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadState() {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2), "utf8");
    return clone(defaults);
  }
  try {
    const loaded = JSON.parse(fs.readFileSync(file, "utf8"));
    return {
      ...clone(defaults),
      ...loaded,
      config: { ...clone(defaults.config), ...(loaded.config || {}) },
      license: { ...clone(defaults.license), ...(loaded.license || {}) }
    };
  } catch {
    return clone(defaults);
  }
}

function saveState() {
  fs.writeFileSync(dataFile(), JSON.stringify(state, null, 2), "utf8");
}

function log(level, message, campaignId = state.currentCampaignId) {
  state.logs.unshift({ id: crypto.randomUUID(), campaignId, time: new Date().toISOString(), level, message });
  state.logs = state.logs.slice(0, 1000);
  saveState();
  sendState();
}

function publicState() {
  state.license.version = app.getVersion();
  return { ...state, running, columns: allColumns };
}

function sendState(immediate = false) {
  if (immediate) {
    if (stateSendTimer) {
      clearTimeout(stateSendTimer);
      stateSendTimer = null;
    }
    mainWindow?.webContents.send("state", publicState());
    return;
  }
  if (stateSendTimer) return;
  stateSendTimer = setTimeout(() => {
    stateSendTimer = null;
    mainWindow?.webContents.send("state", publicState());
  }, 180);
}

function createWindow() {
  state = loadState();
  mainWindow = new BrowserWindow({
    width: 1680,
    height: 920,
    minWidth: 1180,
    minHeight: 740,
    title: "Google Maps Crawler Desktop",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "geolocation");
  });
  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());

ipcMain.handle("get-state", () => publicState());

ipcMain.handle("save-config", (_event, config) => {
  state.config = { ...state.config, ...config };
  saveState();
  return publicState();
});

ipcMain.handle("open-data-folder", () => shell.openPath(app.getPath("userData")));

ipcMain.handle("open-external", (_event, url) => {
  if (url) shell.openExternal(url);
});

ipcMain.handle("check-update", async () => {
  try {
    log("info", "Dang kiem tra ban cap nhat tren GitHub Releases...");
    const release = await githubLatestRelease();
    const latestVersion = normalizeVersion(release.tag_name || release.name);
    const currentVersion = normalizeVersion(app.getVersion());
    if (!latestVersion) throw new Error("Khong doc duoc version cua release moi nhat");
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      log("info", `Dang la ban moi nhat: ${app.getVersion()}`);
      return { ok: true, updated: false, message: `Dang la ban moi nhat (${app.getVersion()})` };
    }
    const asset = (release.assets || []).find((item) => /\.exe$/i.test(item.name || "") && /setup|crawler/i.test(item.name || ""));
    if (!asset) {
      await shell.openExternal(releasesUrl);
      throw new Error("Release moi chua co file installer .exe. Da mo trang Releases.");
    }
    const target = path.join(app.getPath("temp"), asset.name);
    log("info", `Dang tai ban ${latestVersion}: ${asset.name}`);
    await downloadFile(asset.browser_download_url, target);
    log("info", `Da tai xong. Chay installer: ${target}`);
    spawn(target, [], { detached: true, stdio: "ignore" }).unref();
    app.quit();
    return { ok: true, updated: true, message: "Dang mo installer cap nhat..." };
  } catch (error) {
    log("error", `Cap nhat loi: ${error.message}`);
    return { ok: false, message: error.message };
  }
});

async function githubLatestRelease() {
  const res = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`, {
    headers: { "user-agent": "GoogleMapsCrawlerDesktop-Updater" }
  });
  if (res.status === 404) {
    await shell.openExternal(releasesUrl);
    throw new Error("Repo chua co GitHub Release. Can tao Release va upload installer .exe truoc.");
  }
  if (!res.ok) throw new Error(`GitHub API HTTP ${res.status}`);
  return res.json();
}

async function downloadFile(url, target) {
  const res = await fetch(url, { headers: { "user-agent": "GoogleMapsCrawlerDesktop-Updater" } });
  if (!res.ok) throw new Error(`Tai file loi HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, buffer);
}

function normalizeVersion(value) {
  const match = String(value || "").match(/\d+\.\d+\.\d+/);
  return match?.[0] || "";
}

function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

ipcMain.handle("stop-crawl", () => {
  stopRequested = true;
  log("warn", "Dang yeu cau dung scan sau tac vu hien tai");
  return publicState();
});

ipcMain.handle("delete-rows", (_event, ids) => {
  const set = new Set(ids || []);
  state.results = state.results.filter((row) => !set.has(row.id));
  saveState();
  return publicState();
});

ipcMain.handle("update-row", (_event, id, patch) => {
  state.results = state.results.map((row) => row.id === id ? { ...row, ...(patch || {}) } : row);
  saveState();
  return publicState();
});

ipcMain.handle("rename-campaign", (_event, campaignId, name) => {
  const cleanName = String(name || "").trim();
  if (!cleanName) return publicState();
  for (const list of [state.campaigns, state.history]) {
    const item = list.find((campaign) => campaign.id === campaignId);
    if (item) item.name = cleanName;
  }
  saveState();
  return publicState();
});

ipcMain.handle("clear-results", (_event, scope) => {
  if (scope?.campaignId) state.results = state.results.filter((row) => row.campaignId !== scope.campaignId);
  else if (scope?.keyword) state.results = state.results.filter((row) => row.keyword !== scope.keyword);
  else state.results = [];
  saveState();
  return publicState();
});

ipcMain.handle("delete-campaign", (_event, campaignId) => {
  state.campaigns = state.campaigns.filter((item) => item.id !== campaignId);
  state.history = state.history.filter((item) => item.id !== campaignId);
  state.results = state.results.filter((item) => item.campaignId !== campaignId);
  state.logs = state.logs.filter((item) => item.campaignId !== campaignId);
  if (state.currentCampaignId === campaignId) state.currentCampaignId = state.campaigns[0]?.id || "";
  saveState();
  return publicState();
});

ipcMain.handle("preview-location", async (_event, config) => {
  const preview = await previewScanLocation({ ...state.config, ...(config || {}) });
  if (preview.ok) {
    log("info", `Kiem tra toa do: ${preview.label} -> ${preview.lat}, ${preview.lng}`);
  } else {
    log("warn", `Kiem tra toa do loi: ${preview.message}`);
  }
  return preview;
});

ipcMain.handle("current-location", async () => {
  try {
    const data = await fetchIpLocation();
    const lat = data.lat ? String(data.lat) : "";
    const lng = data.lng ? String(data.lng) : "";
    if (!lat || !lng) throw new Error("Khong co toa do trong phan hoi dinh vi IP");
    state.config.currentLat = lat;
    state.config.currentLng = lng;
    if (data.city) state.config.city = data.city;
    if (data.region) state.config.province = data.region;
    state.locationOk = true;
    saveState();
    log("info", `Da dinh vi vi tri hien tai: ${lat}, ${lng}`);
  } catch (error) {
    state.locationOk = false;
    log("error", `Khong lay duoc vi tri hien tai: ${error.message}`);
  }
  return publicState();
});

ipcMain.handle("browserleaks-location", async () => {
  try {
    log("info", "Dang mo BrowserLeaks Geo. Hay bam Allow neu trinh duyet hoi quyen vi tri.");
    const coords = await fetchBrowserLeaksLocation();
    state.config.currentLat = String(coords.lat);
    state.config.currentLng = String(coords.lng);
    state.locationOk = true;
    saveState();
    log("info", `Da lay toa do tu BrowserLeaks: ${coords.lat}, ${coords.lng}`);
  } catch (error) {
    state.locationOk = false;
    log("error", `BrowserLeaks khong tra ve toa do: ${error.message}`);
  }
  return publicState();
});

async function fetchIpLocation() {
  const windowsLocation = await fetchWindowsLocation().catch(() => null);
  if (windowsLocation?.lat && windowsLocation?.lng) return windowsLocation;
  const providers = [
    {
      url: "https://ipwho.is/",
      map: (data) => ({ lat: data.latitude, lng: data.longitude, city: data.city, region: data.region })
    },
    {
      url: "https://ipapi.co/json/",
      map: (data) => ({ lat: data.latitude, lng: data.longitude, city: data.city, region: data.region })
    },
    {
      url: "https://ipinfo.io/json",
      map: (data) => {
        const [lat, lng] = String(data.loc || "").split(",");
        return { lat, lng, city: data.city, region: data.region };
      }
    }
  ];
  const errors = [];
  for (const provider of providers) {
    try {
      const res = await fetch(provider.url, { headers: { "user-agent": "GoogleMapsCrawlerDesktop/1.0" } });
      if (!res.ok) throw new Error(`${provider.url} HTTP ${res.status}`);
      const mapped = provider.map(await res.json());
      if (mapped.lat && mapped.lng) return mapped;
      errors.push(`${provider.url}: empty coordinates`);
    } catch (error) {
      errors.push(`${provider.url}: ${error.message}`);
    }
  }
  throw new Error(errors.join("; "));
}

function fetchWindowsLocation() {
  return new Promise((resolve, reject) => {
    const script = [
      "Add-Type -AssemblyName System.Device",
      "$watcher = New-Object System.Device.Location.GeoCoordinateWatcher([System.Device.Location.GeoPositionAccuracy]::High)",
      "$started = $watcher.TryStart($false, [TimeSpan]::FromSeconds(10))",
      "$coord = $watcher.Position.Location",
      "if ($started -and -not $coord.IsUnknown) { Write-Output \"$($coord.Latitude),$($coord.Longitude)\" } else { exit 2 }"
    ].join("; ");
    execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], { timeout: 13000 }, (error, stdout) => {
      if (error) return reject(error);
      const [lat, lng] = String(stdout || "").trim().split(",");
      if (!lat || !lng) return reject(new Error("Windows Location returned empty coordinates"));
      resolve({ lat, lng, city: "", region: "" });
    });
  });
}

async function fetchBrowserLeaksLocation() {
  const { chromium } = require("playwright-core");
  const profileDir = path.join(app.getPath("userData"), "browserleaks-profile");
  fs.mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    channel: state.config.browserChannel || "msedge",
    viewport: { width: 1100, height: 820 },
    args: ["--lang=vi-VN"]
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    await page.goto("https://browserleaks.com/geo", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1500);
    await clickGeoButton(page);
    const started = Date.now();
    while (Date.now() - started < 90000) {
      const coords = await readCoordsFromPage(page);
      if (coords) return coords;
      await page.waitForTimeout(1000);
    }
    throw new Error("Het thoi gian cho. Co the ban chua bam Allow hoac trinh duyet khong cap quyen vi tri.");
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function clickGeoButton(page) {
  const candidates = [
    () => page.getByText("Get Current Position", { exact: true }).click({ timeout: 5000 }),
    () => page.locator("button").filter({ hasText: "Get Current Position" }).click({ timeout: 5000 }),
    () => page.locator("input[type='button'],button").evaluateAll((items) => {
      const item = items.find((el) => /Get Current Position/i.test(el.textContent || el.value || ""));
      if (item) item.click();
    })
  ];
  for (const attempt of candidates) {
    try {
      await attempt();
      return;
    } catch {}
  }
}

async function readCoordsFromPage(page) {
  return page.evaluate(() => {
    const text = document.body.innerText || "";
    const byLabel = (label) => {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = text.match(new RegExp(`${escaped}\\s*[:\\n\\t ]+(-?\\d+(?:\\.\\d+)?)`, "i"));
      return match?.[1] || "";
    };
    let lat = byLabel("Latitude");
    let lng = byLabel("Longitude");
    if (!lat || !lng) {
      const pair = text.match(/(-?\d{1,3}\.\d{4,})\s*[,;\n ]+\s*(-?\d{1,3}\.\d{4,})/);
      if (pair) {
        lat = pair[1];
        lng = pair[2];
      }
    }
    const latNum = Number(lat);
    const lngNum = Number(lng);
    if (Number.isFinite(latNum) && Number.isFinite(lngNum) && Math.abs(latNum) <= 90 && Math.abs(lngNum) <= 180) {
      return { lat: latNum, lng: lngNum };
    }
    return null;
  });
}

ipcMain.handle("export", async (_event, options) => {
  if (typeof options === "string") options = { format: options };
  const format = options?.format || "xlsx";
  const columns = normalizeColumns(options?.columns);
  const rows = filterRows(options || {});
  const defaultPath = path.join(app.getPath("desktop"), `google-maps-data.${format}`);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath,
    filters: format === "xlsx" ? [{ name: "Excel", extensions: ["xlsx"] }] : [{ name: "CSV", extensions: ["csv"] }]
  });
  if (canceled || !filePath) return null;
  if (format === "csv") fs.writeFileSync(filePath, toCsv(rows, columns), "utf8");
  else {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Google Maps Data");
    ws.columns = columns.map((key) => ({ header: key, key, width: 24 }));
    ws.addRows(rows);
    await wb.xlsx.writeFile(filePath);
  }
  if (options?.deleteAfterExport) {
    const ids = new Set(rows.map((row) => row.id));
    state.results = state.results.filter((row) => !ids.has(row.id));
    saveState();
    sendState();
  }
  return filePath;
});

ipcMain.handle("start-crawl", async (_event, payload) => {
  if (running) return publicState();
  running = true;
  stopRequested = false;
  state.config = { ...state.config, ...payload.config };
  const campaign = {
    id: crypto.randomUUID(),
    name: payload.campaignName || `Scan ${new Date().toLocaleString()}`,
    keywords: payload.keywords,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    status: "running"
  };
  state.currentCampaignId = campaign.id;
  state.campaigns.unshift(campaign);
  state.history.unshift(campaign);
  saveState();
  sendState();
  crawl(payload.keywords, state.config, campaign.id)
    .then(() => {
      campaign.status = stopRequested ? "stopped" : "completed";
      campaign.finishedAt = new Date().toISOString();
      log("info", `Ket thuc chien dich: ${campaign.name}`, campaign.id);
    })
    .catch((error) => {
      campaign.status = "failed";
      campaign.finishedAt = new Date().toISOString();
      log("error", error.message || String(error), campaign.id);
    })
    .finally(() => {
      running = false;
      stopRequested = false;
      saveState();
      sendState();
    });
  return publicState();
});

async function crawl(keywords, config, campaignId) {
  const { chromium } = require("playwright-core");
  const proxies = await loadProxies(config);
  const threads = Math.max(1, Math.min(8, Number(config.threads || 1)));
  const jobs = keywords.map((keyword) => ({ keyword }));
  let cursor = 0;
  log("info", `Bat dau ${keywords.length} keyword, ${threads} luong, ${proxies.length || 1} proxy`, campaignId);

  const workers = Array.from({ length: threads }, async (_, index) => {
    const proxyText = proxies.length ? proxies[index % proxies.length] : "";
    const browser = await launchBrowser(chromium, config, proxyText, index);
    const context = await browser.newContext({
      locale: "vi-VN",
      viewport: { width: 1366, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    });
    const page = await context.newPage();
    try {
      while (!stopRequested) {
        const job = jobs[cursor++];
        if (!job) break;
        await scanKeyword(page, job.keyword, config, campaignId, index + 1);
      }
    } finally {
      await browser.close().catch(() => undefined);
    }
  });
  await Promise.all(workers);
}

async function launchBrowser(chromium, config, proxyText, workerIndex) {
  const launchOptions = {
    headless: Boolean(config.headless),
    channel: config.browserChannel || "msedge",
    args: ["--lang=vi-VN"]
  };
  const proxy = parseProxy(proxyText);
  if (proxy) launchOptions.proxy = proxy;
  try {
    return await chromium.launch(launchOptions);
  } catch {
    log("warn", `Luong ${workerIndex + 1}: khong mo duoc ${launchOptions.channel}, thu Chrome`);
    return chromium.launch({ ...launchOptions, channel: "chrome" });
  }
}

async function scanKeyword(page, keyword, config, campaignId, workerNo) {
  const target = await buildSearchTarget(page, keyword, config, campaignId);
  log("info", `Luong ${workerNo}: quet "${keyword}" tai ${target.label}`, campaignId);
  const existingCount = state.results.filter((row) => row.keyword === keyword && row.search_scope === target.scopeKey).length;
  const wantNew = Number(config.maxResults || 50);
  const crawlDepth = target.coords ? Math.min(500, Math.max(existingCount + wantNew * 4, wantNew + 25)) : Math.min(500, existingCount + wantNew);
  const urls = await collectPlaceUrls(page, target.url, crawlDepth, campaignId);
  log("info", `Luong ${workerNo}: "${keyword}" da co ${existingCount}, keo ${urls.length} link de lay them ${wantNew}`, campaignId);
  const candidates = [];
  const localSeen = new Set();
  for (const url of urls) {
    if (stopRequested) break;
    const lead = await retry(() => extractPlace(page, url, keyword, campaignId), Number(config.retry || 0), campaignId);
    if (lead?.business_name) {
      lead.search_scope = target.scopeKey;
      lead.search_location = target.label;
      applyBirdDistance(lead, config, target);
      if (isOutsideRadius(lead, config, target)) {
        log("info", `Bo qua ngoai ban kinh ${config.radiusKm}km: ${lead.business_name} (${lead.bird_distance_km}km)`, campaignId);
        continue;
      }
      const exists = isDuplicate(lead);
      if (exists) {
        log("info", `Bo qua trung: ${lead.business_name}`, campaignId);
      } else {
        const key = duplicateKey(lead);
        if (!localSeen.has(key)) {
          localSeen.add(key);
          candidates.push(lead);
        }
      }
    }
    await sleep(randomDelay(config));
  }
  if (target.coords) candidates.sort((a, b) => Number(a.bird_distance_km || 999999) - Number(b.bird_distance_km || 999999));
  let inserted = 0;
  for (const lead of candidates.slice(0, wantNew)) {
    if (stopRequested) break;
    await applyDrivingDistance(page, lead, config, target, campaignId);
    state.results.unshift(lead);
    state.results = state.results.slice(0, 100000);
    inserted++;
    log("info", `Them moi ${keyword} #${inserted}: ${lead.business_name}`, campaignId);
    saveState();
    sendState();
    await sleep(randomDelay(config));
  }
}

async function buildSearchTarget(page, keyword, config, campaignId) {
  const directCoords = coordsFromText(config.mapsLink) || coordsFromText(config.address);
  if (directCoords) {
    const radius = Number(config.radiusKm || 5);
    return {
      label: `toa do ${directCoords.lat},${directCoords.lng}`,
      scopeKey: `direct:${directCoords.lat},${directCoords.lng}:r${radius}`,
      coords: directCoords,
      url: searchUrlAround(keyword, directCoords, radius)
    };
  }
  const mode = config.locationMode || "city";
  if (mode === "mapsLink" && config.mapsLink) {
    const coords = coordsFromText(config.mapsLink);
    if (coords) {
      const scopeKey = `maps:${coords.lat},${coords.lng}:r${Number(config.radiusKm || 5)}`;
      return {
        label: `link Maps ${coords.lat},${coords.lng}`,
        scopeKey,
        coords,
        url: searchUrlAround(keyword, coords, Number(config.radiusKm || 5))
      };
    }
    return { label: "link Maps", scopeKey: `mapslink:${config.mapsLink}`, url: config.mapsLink };
  }
  if (mode === "address" && config.address) {
    const place = withVietnam(config.address);
    const coords = await resolveSearchCenter(page, place, campaignId);
    if (coords) return targetFromCoords(keyword, config, config.address, `address:${normalizeScope(config.address)}`, coords);
    const query = `${keyword} near ${place}`;
    return { label: config.address, scopeKey: `address:${normalizeScope(config.address)}:r${Number(config.radiusKm || 5)}`, url: `https://www.google.com/maps/search/${encodeURIComponent(query)}` };
  }
  if (mode === "current" && config.currentLat && config.currentLng) {
    const scopeKey = `current:${config.currentLat},${config.currentLng}:r${Number(config.radiusKm || 5)}`;
    return {
      label: `vi tri hien tai ${config.currentLat},${config.currentLng}`,
      scopeKey,
      coords: { lat: String(config.currentLat), lng: String(config.currentLng) },
      url: searchUrlAround(keyword, { lat: config.currentLat, lng: config.currentLng }, Number(config.radiusKm || 5))
    };
  }
  const place = cityPlace(config);
  const coords = place ? await resolveSearchCenter(page, place, campaignId) : null;
  if (coords) return targetFromCoords(keyword, config, place, `city:${normalizeScope(place)}`, coords);
  const query = place ? `${keyword} near ${place}` : keyword;
  return { label: place || "Google Maps", scopeKey: `city:${normalizeScope(place || "global")}`, url: `https://www.google.com/maps/search/${encodeURIComponent(query)}` };
}

async function previewScanLocation(config) {
  const mode = config.locationMode || "city";
  if (mode === "current") {
    if (!config.currentLat || !config.currentLng) return { ok: false, message: "Chua co Lat/Lng hien tai" };
    return { ok: true, label: "Vi tri hien tai", lat: String(config.currentLat), lng: String(config.currentLng), source: "current" };
  }
  const directCoords = coordsFromText(config.mapsLink) || coordsFromText(config.address);
  if (directCoords) return { ok: true, label: "Toa do/Link Maps", lat: directCoords.lat, lng: directCoords.lng, source: "direct" };
  const label = locationLabelFromConfig(config);
  if (!label) return { ok: false, message: "Chua nhap khu vuc de dinh vi" };
  const coords = await fetchNominatimCoords(label, state.currentCampaignId || "") || await fetchGoogleLocationCoords(label, config, state.currentCampaignId || "");
  if (!coords) return { ok: false, message: `Khong dinh vi duoc "${label}"` };
  return { ok: true, label, lat: coords.lat, lng: coords.lng, source: coords.source || "maps" };
}

function targetFromCoords(keyword, config, label, scopePrefix, coords) {
  const radius = Number(config.radiusKm || 5);
  const zoom = radiusToZoom(radius);
  return {
    label: `${label} (${coords.lat},${coords.lng})`,
    scopeKey: `${scopePrefix}:${coords.lat},${coords.lng}:r${radius}`,
    coords,
    url: searchUrlAround(keyword, coords, radius)
  };
}

function searchUrlAround(keyword, coords, radiusKm) {
  const zoom = radiusToZoom(radiusKm);
  return `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${coords.lat},${coords.lng},${zoom}z`;
}

async function resolveSearchCenter(page, place, campaignId) {
  const key = normalizeScope(place);
  if (locationCache.has(key)) return locationCache.get(key);
  const nominatimCoords = await fetchNominatimCoords(place, campaignId);
  if (nominatimCoords) {
    locationCache.set(key, nominatimCoords);
    return nominatimCoords;
  }
  const googleCoords = await resolveGooglePlaceCoords(page, place, campaignId);
  if (googleCoords) {
    locationCache.set(key, googleCoords);
    return googleCoords;
  }
  return null;
}

async function resolveGooglePlaceCoords(page, place, campaignId) {
  try {
    const searchPlace = withVietnam(place);
    await page.goto(`https://www.google.com/maps/place/${encodeURIComponent(searchPlace)}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2500);
    await assertNoCaptcha(page);
    const started = Date.now();
    while (Date.now() - started < 12000) {
      const coords = coordsFromText(page.url());
      if (coords) {
        log("info", `Da dinh vi khu vuc "${place}" -> ${coords.lat}, ${coords.lng}`, campaignId);
        return { ...coords, source: "Google Maps" };
      }
      await page.waitForTimeout(500);
    }
    log("warn", `Khong dinh vi duoc khu vuc "${place}", se search bang chuoi dia diem`, campaignId);
  } catch (error) {
    log("warn", `Loi dinh vi khu vuc "${place}": ${error.message}`, campaignId);
  }
  return null;
}

async function fetchGoogleLocationCoords(place, config, campaignId) {
  const { chromium } = require("playwright-core");
  let browser;
  try {
    browser = await launchBrowser(chromium, { ...config, headless: true }, "", 0);
    const context = await browser.newContext({ locale: "vi-VN", viewport: { width: 1200, height: 820 } });
    const page = await context.newPage();
    return await resolveGooglePlaceCoords(page, place, campaignId);
  } catch (error) {
    log("warn", `Google Maps khong dinh vi duoc "${place}": ${error.message}`, campaignId);
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function fetchNominatimCoords(place, campaignId) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=vn&q=${encodeURIComponent(place)}`;
    const res = await fetch(url, { headers: { "user-agent": "GoogleMapsCrawlerDesktop/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const [item] = await res.json();
    const lat = item?.lat;
    const lng = item?.lon;
    if (!lat || !lng) return null;
    log("info", `Da dinh vi khu vuc "${place}" bang OSM -> ${lat}, ${lng}`, campaignId);
    return { lat: String(lat), lng: String(lng) };
  } catch (error) {
    log("warn", `OSM khong dinh vi duoc "${place}": ${error.message}`, campaignId);
    return null;
  }
}

function cityPlace(config) {
  const parts = [config.district, config.city, config.province].map((value) => String(value || "").trim()).filter(Boolean);
  let place = parts.join(", ");
  const onlyProvince = parts.length === 1 ? parts[0] : "";
  const cityMatch = onlyProvince.match(/^(?:tp\.?|thanh pho|th.nh ph.)\s+(.+)$/i);
  if (cityMatch) place = `${onlyProvince}, tinh ${cityMatch[1]}`;
  return withVietnam(place);
}

function locationLabelFromConfig(config) {
  const mode = config.locationMode || "city";
  const directText = String(config.address || config.mapsLink || "").trim();
  if (directText) return directText;
  if (mode === "mapsLink") return String(config.mapsLink || "").trim();
  if (mode === "address") return withVietnam(config.address);
  if (mode === "current") return [config.currentLat, config.currentLng].filter(Boolean).join(",");
  return cityPlace(config);
}

function withVietnam(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return /vi[eệ]t\s*nam|vietnam/i.test(clean) ? clean : `${clean}, Viet Nam`;
}

function radiusToZoom(radiusKm) {
  const radius = Number(radiusKm || 5);
  if (radius <= 2) return 15;
  if (radius <= 5) return 14;
  if (radius <= 12) return 13;
  if (radius <= 25) return 12;
  if (radius <= 50) return 11;
  return 10;
}

function normalizeScope(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function coordsFromText(text) {
  const value = String(text || "");
  const bang = value.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (bang) return { lat: bang[1], lng: bang[2] };
  const at = value.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (at) return { lat: at[1], lng: at[2] };
  const pair = value.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (pair) return { lat: pair[1], lng: pair[2] };
  return null;
}

function originCoords(config, target) {
  if ((config.locationMode || "city") === "current" && config.currentLat && config.currentLng) return { lat: Number(config.currentLat), lng: Number(config.currentLng) };
  if (target?.coords) return { lat: Number(target.coords.lat), lng: Number(target.coords.lng) };
  if (config.mapsLink) {
    const coords = coordsFromText(config.mapsLink);
    if (coords) return { lat: Number(coords.lat), lng: Number(coords.lng) };
  }
  return null;
}

function applyBirdDistance(lead, config, target) {
  const origin = originCoords(config, target);
  const lat = Number(lead.latitude);
  const lng = Number(lead.longitude);
  if (!origin || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const birdDistance = Number(haversineKm(origin.lat, origin.lng, lat, lng).toFixed(2));
  lead.bird_distance_km = birdDistance;
  lead.distance_km = birdDistance;
}

function isOutsideRadius(lead, config, target) {
  if (!target?.coords || !lead.bird_distance_km) return false;
  const radius = Number(config.radiusKm || 0);
  return radius > 0 && Number(lead.bird_distance_km) > radius;
}

async function applyDrivingDistance(page, lead, config, target, campaignId) {
  const origin = originCoords(config, target);
  const lat = Number(lead.latitude);
  const lng = Number(lead.longitude);
  if (!origin || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const mode = config.distanceMode || "bird";
  if (mode === "drive" || mode === "both") {
    const drivingDistance = await fetchDrivingDistanceKm(page, origin, { lat, lng }, campaignId);
    if (drivingDistance) {
      lead.driving_distance_km = drivingDistance;
      if (mode === "drive") lead.distance_km = drivingDistance;
    } else if (mode === "drive") {
      lead.distance_km = "";
    }
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const radius = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(value) {
  return value * Math.PI / 180;
}

async function fetchDrivingDistanceKm(page, origin, destination, campaignId) {
  try {
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=driving`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(3500);
    await assertNoCaptcha(page);
    const text = await page.locator("body").innerText({ timeout: 8000 });
    const distance = firstKmFromDirections(text);
    if (distance) return distance;
    log("warn", "Khong doc duoc KC lai xe tu Google Maps Directions", campaignId);
  } catch (error) {
    log("warn", `Loi lay KC lai xe: ${error.message}`, campaignId);
  }
  return "";
}

function firstKmFromDirections(text) {
  const normalized = String(text || "").replace(/\u00a0/g, " ");
  const matches = [...normalized.matchAll(/(\d+(?:[,.]\d+)?)\s*km/gi)]
    .map((match) => Number(match[1].replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!matches.length) return "";
  return Number(matches[0].toFixed(2));
}

async function collectPlaceUrls(page, searchUrl, maxResults, campaignId) {
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3500);
  await assertNoCaptcha(page);
  const urls = new Set();
  let stableRounds = 0;
  for (let round = 0; round < 60 && urls.size < maxResults && !stopRequested; round++) {
    const before = urls.size;
    const batch = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/maps/place/"]')).map((a) => a.href));
    for (const href of batch) urls.add(String(href).split("&")[0]);
    stableRounds = urls.size === before ? stableRounds + 1 : 0;
    if (stableRounds >= 5) break;
    const feed = page.locator('div[role="feed"]');
    if (await feed.count().catch(() => 0)) await feed.evaluate((el) => { el.scrollTop = el.scrollHeight; }).catch(() => undefined);
    else await page.mouse.wheel(0, 1600).catch(() => undefined);
    await page.waitForTimeout(1300);
    await assertNoCaptcha(page);
  }
  if (!urls.size) log("warn", "Khong thay danh sach ket qua, Google co the doi giao dien hoac dang chan truy cap", campaignId);
  return [...urls].slice(0, maxResults);
}

async function extractPlace(page, url, keyword, campaignId) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2200);
  await assertNoCaptcha(page);
  return page.evaluate(({ kw, campaignId }) => {
    const clean = (value) => value ? String(value).replace(/\s+/g, " ").trim() : "";
    const text = document.body.innerText || "";
    const name = clean(document.querySelector("h1")?.textContent);
    const website = document.querySelector('a[data-item-id="authority"]')?.href
      || Array.from(document.querySelectorAll("a[href^='http']")).map((a) => a.href).find((href) => !/google\.|gstatic\.|schema\.org/.test(href)) || "";
    const byData = (prefix) => clean(document.querySelector(`[data-item-id^="${prefix}"]`)?.innerText);
    const address = byData("address");
    const phone = byData("phone") || clean(text.match(/(?:\+?\d[\d\s().-]{7,}\d)/)?.[0]);
    const ratingMatch = text.match(/(\d+[,.]\d+)\s*(?:sao|stars?)?/i);
    const reviewMatch = text.match(/\(([\d.,]+)\)/);
    const atMatch = location.href.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    const bangMatch = location.href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    const coords = bangMatch || atMatch;
    const category = clean(Array.from(document.querySelectorAll("button, span"))
      .map((el) => el.textContent || "")
      .find((v) => v.length > 2 && v.length < 60 && !v.includes(kw) && !/\d|Đánh giá|Reviews|sao/.test(v)));
    return {
      id: crypto.randomUUID(),
      campaignId,
      keyword: kw,
      business_name: name,
      phone_number: phone,
      website,
      address,
      latitude: coords ? Number(coords[1]) : "",
      longitude: coords ? Number(coords[2]) : "",
      rating: ratingMatch ? Number(ratingMatch[1].replace(",", ".")) : "",
      review_count: reviewMatch ? Number(reviewMatch[1].replace(/[.,]/g, "")) : "",
      category,
      google_maps_url: location.href,
      status: "Thanh cong",
      created_at: new Date().toISOString()
    };
  }, { kw: keyword, campaignId });
}

async function assertNoCaptcha(page) {
  const text = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  if (/captcha|recaptcha|unusual traffic|not a robot|xác minh|không phải là rô-bốt/i.test(text)) {
    throw new Error("Google dang yeu cau xac minh/CAPTCHA. App se khong tu vuot CAPTCHA; hay giam toc do, doi proxy sach hoac xu ly thu cong.");
  }
}

async function retry(fn, retries, campaignId) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (error) {
      last = error;
      if (i < retries) {
        log("warn", `Retry ${i + 1}/${retries}: ${error.message}`, campaignId);
        await sleep(1500 * (i + 1));
      }
    }
  }
  throw last;
}

async function loadProxies(config) {
  const pasted = splitLines(config.proxyList);
  if (config.proxyUrl) {
    try {
      const res = await fetch(config.proxyUrl);
      const text = await res.text();
      return [...new Set([...pasted, ...splitLines(text)])];
    } catch (error) {
      log("error", `Khong tai duoc proxy URL: ${error.message}`);
    }
  }
  return [...new Set(pasted)];
}

function splitLines(text) {
  return String(text || "").split(/\r?\n|,/).map((value) => value.trim()).filter(Boolean);
}

function parseProxy(proxy) {
  if (!proxy?.trim()) return null;
  try {
    const parsed = new URL(proxy.includes("://") ? proxy : `http://${proxy}`);
    return {
      server: `${parsed.protocol}//${parsed.hostname}:${parsed.port || 8080}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined
    };
  } catch {
    return null;
  }
}

function randomDelay(config) {
  const min = Number(config.delayMin || 1500);
  const max = Number(config.delayMax || min);
  return min + Math.random() * Math.max(0, max - min);
}

function isDuplicate(lead) {
  const key = duplicateKey(lead);
  return state.results.some((item) => duplicateKey(item) === key);
}

function duplicateKey(row) {
  return row.google_maps_url || row.phone_number || `${row.business_name}|${row.address}`;
}

function filterRows(options) {
  let rows = state.results;
  if (options.ids?.length) {
    const ids = new Set(options.ids);
    rows = rows.filter((row) => ids.has(row.id));
  }
  if (options.campaignId) rows = rows.filter((row) => row.campaignId === options.campaignId);
  if (options.keyword) rows = rows.filter((row) => row.keyword === options.keyword);
  return rows;
}

function normalizeColumns(columns) {
  const selected = (columns || state.config.exportColumns || allColumns).filter((key) => allColumns.includes(key));
  return selected.length ? selected : allColumns;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toCsv(rows, columns) {
  return "\ufeff" + [columns.join(","), ...rows.map((row) => columns.map((key) => JSON.stringify(row[key] ?? "")).join(","))].join("\n");
}
