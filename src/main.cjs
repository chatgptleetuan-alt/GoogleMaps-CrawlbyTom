const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");

let mainWindow;
let state;
let running = false;
let stopRequested = false;

const allColumns = [
  "keyword", "search_location", "business_name", "phone_number", "website", "address", "latitude", "longitude",
  "distance_km", "rating", "review_count", "category", "google_maps_url", "status", "created_at"
];

const defaults = {
  config: {
    browserChannel: "msedge",
    locationMode: "city",
    city: "Da Nang",
    province: "Da Nang",
    district: "",
    address: "",
    mapsLink: "",
    radiusKm: 5,
    currentLat: "",
    currentLng: "",
    maxResults: 50,
    delayMin: 1500,
    delayMax: 4000,
    retry: 1,
    threads: 1,
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
  license: { status: "local", version: "1.1.0" }
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
  return { ...state, running, columns: allColumns };
}

function sendState() {
  mainWindow?.webContents.send("state", publicState());
}

function createWindow() {
  state = loadState();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 860,
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

ipcMain.handle("current-location", async () => {
  try {
    const res = await fetch("https://ipapi.co/json/");
    const data = await res.json();
    const lat = data.latitude ? String(data.latitude) : "";
    const lng = data.longitude ? String(data.longitude) : "";
    state.config.currentLat = lat;
    state.config.currentLng = lng;
    if (data.city) state.config.city = data.city;
    if (data.region) state.config.province = data.region;
    saveState();
    log("info", `Da dinh vi gan dung theo IP: ${lat}, ${lng}`);
  } catch (error) {
    log("error", `Khong lay duoc vi tri hien tai: ${error.message}`);
  }
  return publicState();
});

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
  const target = buildSearchTarget(keyword, config);
  log("info", `Luong ${workerNo}: quet "${keyword}" tai ${target.label}`, campaignId);
  const existingCount = state.results.filter((row) => row.keyword === keyword && row.search_scope === target.scopeKey).length;
  const wantNew = Number(config.maxResults || 50);
  const crawlDepth = Math.min(500, existingCount + wantNew);
  const urls = await collectPlaceUrls(page, target.url, crawlDepth, campaignId);
  log("info", `Luong ${workerNo}: "${keyword}" da co ${existingCount}, keo ${urls.length} link de lay them ${wantNew}`, campaignId);
  let inserted = 0;
  for (const url of urls) {
    if (stopRequested) break;
    const lead = await retry(() => extractPlace(page, url, keyword, campaignId), Number(config.retry || 0), campaignId);
    if (lead?.business_name) {
      lead.search_scope = target.scopeKey;
      lead.search_location = target.label;
      applyDistance(lead, config);
      const exists = isDuplicate(lead);
      if (exists) {
        log("info", `Bo qua trung: ${lead.business_name}`, campaignId);
      } else {
        state.results.unshift(lead);
        state.results = state.results.slice(0, 100000);
        inserted++;
        log("info", `Them moi ${keyword} #${inserted}: ${lead.business_name}`, campaignId);
        saveState();
        sendState();
        if (inserted >= wantNew) break;
      }
    }
    await sleep(randomDelay(config));
  }
}

function buildSearchTarget(keyword, config) {
  const mode = config.locationMode || "city";
  if (mode === "mapsLink" && config.mapsLink) {
    const coords = coordsFromText(config.mapsLink);
    if (coords) {
      const scopeKey = `maps:${coords.lat},${coords.lng}:r${Number(config.radiusKm || 5)}`;
      return {
        label: `link Maps ${coords.lat},${coords.lng}`,
        scopeKey,
        url: `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${coords.lat},${coords.lng},${Number(config.radiusKm || 5) + 10}z`
      };
    }
    return { label: "link Maps", scopeKey: `mapslink:${config.mapsLink}`, url: config.mapsLink };
  }
  if (mode === "address" && config.address) {
    const query = `${keyword} near ${config.address}`;
    return { label: config.address, scopeKey: `address:${normalizeScope(config.address)}:r${Number(config.radiusKm || 5)}`, url: `https://www.google.com/maps/search/${encodeURIComponent(query)}` };
  }
  if (mode === "current" && config.currentLat && config.currentLng) {
    const scopeKey = `current:${config.currentLat},${config.currentLng}:r${Number(config.radiusKm || 5)}`;
    return {
      label: `vi tri hien tai ${config.currentLat},${config.currentLng}`,
      scopeKey,
      url: `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${config.currentLat},${config.currentLng},${Number(config.radiusKm || 5) + 10}z`
    };
  }
  const place = [config.district, config.city, config.province].filter(Boolean).join(", ");
  return { label: place || "Google Maps", scopeKey: `city:${normalizeScope(place || "global")}`, url: `https://www.google.com/maps/search/${encodeURIComponent(`${keyword} ${place}`.trim())}` };
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

function originCoords(config) {
  if (config.currentLat && config.currentLng) return { lat: Number(config.currentLat), lng: Number(config.currentLng) };
  if (config.mapsLink) {
    const coords = coordsFromText(config.mapsLink);
    if (coords) return { lat: Number(coords.lat), lng: Number(coords.lng) };
  }
  return null;
}

function applyDistance(lead, config) {
  const origin = originCoords(config);
  const lat = Number(lead.latitude);
  const lng = Number(lead.longitude);
  if (!origin || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
  lead.distance_km = Number(haversineKm(origin.lat, origin.lng, lat, lng).toFixed(2));
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
