const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "parking-data.json");
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

fs.mkdirSync(DATA_DIR, { recursive: true });

const defaultStore = {
  config: { hourlyRate: 30, heartbeatTimeoutSeconds: 20 },
  device: { connected: false, lastSeen: null, lastReading: null, uptimeSeconds: 0 },
  activeSession: null,
  sessions: [],
  events: []
};

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      return { ...defaultStore, ...parsed, config: { ...defaultStore.config, ...(parsed.config || {}) } };
    }
  } catch (err) {
    console.error("Could not read saved data:", err.message);
  }
  return structuredClone(defaultStore);
}

let store = loadStore();
let saveTimer = null;

function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const temp = DATA_FILE + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(store, null, 2));
      fs.renameSync(temp, DATA_FILE);
    } catch (err) {
      console.error("Could not save data:", err.message);
    }
  }, 100);
}

function isoNow() { return new Date().toISOString(); }
function safeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function durationSeconds(start, end = Date.now()) {
  return Math.max(0, Math.floor((end - new Date(start).getTime()) / 1000));
}
function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}
function calculateFee(seconds, rate = store.config.hourlyRate) {
  if (!seconds || seconds < 0) return 0;
  return Math.ceil(seconds / 3600) * rate;
}
function recordEvent(type, details = {}) {
  store.events.unshift({ id: crypto.randomUUID(), type, at: isoNow(), ...details });
  store.events = store.events.slice(0, 200);
}
function getPublicStatus() {
  const now = Date.now();
  const lastSeenMs = store.device.lastSeen ? new Date(store.device.lastSeen).getTime() : 0;
  const online = !!lastSeenMs && (now - lastSeenMs) <= store.config.heartbeatTimeoutSeconds * 1000;
  store.device.connected = online;

  let active = null;
  if (store.activeSession) {
    const seconds = durationSeconds(store.activeSession.entryTime, now);
    active = {
      ...store.activeSession,
      durationSeconds: seconds,
      duration: formatDuration(seconds),
      currentFee: calculateFee(seconds)
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  const todaysSessions = store.sessions.filter(s => (s.exitTime || s.entryTime || "").slice(0, 10) === today);
  const completedToday = todaysSessions.filter(s => s.status === "completed");
  const revenueToday = completedToday.reduce((sum, s) => sum + (Number(s.fee) || 0), 0);

  const reading = store.device.lastReading || {};
  const voltage = safeNumber(reading.voltage);
  const current = safeNumber(reading.current);
  const measuredPower = safeNumber(reading.power);
  const power = measuredPower !== null ? measuredPower :
    (voltage !== null && current !== null ? voltage * current : null);
  const energyWh = safeNumber(reading.energyWh);

  return {
    serverTime: isoNow(),
    status: active ? "occupied" : "available",
    activeSession: active,
    device: {
      connected: online,
      lastSeen: store.device.lastSeen,
      uptimeSeconds: store.device.uptimeSeconds,
      lastReading: reading
    },
    metrics: {
      revenueToday,
      completedSessionsToday: completedToday.length,
      sessionsToday: todaysSessions.length,
      hourlyRate: store.config.hourlyRate,
      powerWatts: power,
      voltage,
      current,
      energyWh,
      energyKWh: energyWh !== null ? energyWh / 1000 : null
    },
    config: store.config
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Device-Key"
  });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 100000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}
function parseUrl(req) {
  return new URL(req.url, `http://${req.headers.host || "localhost"}`);
}
function serveStatic(req, res, pathname) {
  let target = pathname === "/" ? "/index.html" : pathname;
  target = path.normalize(target).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, target);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(fullPath).toLowerCase();
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  });
}

async function handleApi(req, res, url) {
  const route = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Device-Key" });
    return res.end();
  }

  if (req.method === "GET" && route === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "esp32-smart-parking", time: isoNow() });
  }

  if (req.method === "GET" && route === "/api/status") {
    return sendJson(res, 200, getPublicStatus());
  }

  if (req.method === "GET" && route === "/api/history") {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 100)));
    const status = url.searchParams.get("status");
    const date = url.searchParams.get("date");
    let items = [...store.sessions];
    if (status && status !== "all") items = items.filter(s => s.status === status);
    if (date) items = items.filter(s => (s.entryTime || "").slice(0, 10) === date);
    items.sort((a, b) => new Date(b.entryTime) - new Date(a.entryTime));
    return sendJson(res, 200, { items: items.slice(0, limit) });
  }

  if (req.method === "GET" && route === "/api/reports/daily") {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") || 7)));
    const report = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const list = store.sessions.filter(s => s.status === "completed" && (s.exitTime || "").slice(0, 10) === key);
      report.push({ date: key, sessions: list.length, revenue: list.reduce((n, s) => n + (Number(s.fee) || 0), 0) });
    }
    return sendJson(res, 200, { items: report });
  }

  if (req.method === "POST" && route === "/api/sensor") {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }

    const occupied = typeof body.occupied === "boolean"
      ? body.occupied
      : (typeof body.detected === "boolean" ? body.detected : null);
    if (occupied === null) return sendJson(res, 400, { error: "Send a boolean 'occupied' or 'detected' field." });

    const reading = {
      occupied,
      raw: safeNumber(body.raw),
      voltage: safeNumber(body.voltage),
      current: safeNumber(body.current),
      power: safeNumber(body.power),
      energyWh: safeNumber(body.energyWh),
      rssi: safeNumber(body.rssi),
      deviceUptimeSeconds: safeNumber(body.uptimeSeconds),
      receivedAt: isoNow()
    };
    store.device.lastSeen = isoNow();
    store.device.lastReading = reading;
    store.device.uptimeSeconds = reading.deviceUptimeSeconds ?? store.device.uptimeSeconds;

    if (occupied && !store.activeSession) {
      store.activeSession = {
        id: crypto.randomUUID(),
        entryTime: isoNow(),
        exitTime: null,
        status: "active",
        fee: 0,
        source: "esp32"
      };
      recordEvent("vehicle_entered", { sessionId: store.activeSession.id });
    } else if (!occupied && store.activeSession) {
      const session = store.activeSession;
      const seconds = durationSeconds(session.entryTime, Date.now());
      const completed = {
        ...session,
        exitTime: isoNow(),
        status: "completed",
        durationSeconds: seconds,
        duration: formatDuration(seconds),
        fee: calculateFee(seconds)
      };
      store.sessions.unshift(completed);
      store.sessions = store.sessions.slice(0, 2000);
      store.activeSession = null;
      recordEvent("vehicle_exited", { sessionId: completed.id, fee: completed.fee });
    }
    persist();
    return sendJson(res, 200, { ok: true, receivedAt: reading.receivedAt, status: getPublicStatus() });
  }

  if (req.method === "POST" && route === "/api/config") {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (body.hourlyRate !== undefined) {
      const rate = Number(body.hourlyRate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100000) return sendJson(res, 400, { error: "Hourly rate must be between 0 and 100000." });
      store.config.hourlyRate = rate;
    }
    if (body.heartbeatTimeoutSeconds !== undefined) {
      const timeout = Number(body.heartbeatTimeoutSeconds);
      if (!Number.isFinite(timeout) || timeout < 5 || timeout > 600) return sendJson(res, 400, { error: "Heartbeat timeout must be between 5 and 600 seconds." });
      store.config.heartbeatTimeoutSeconds = timeout;
    }
    persist();
    return sendJson(res, 200, { ok: true, config: store.config });
  }

  if (req.method === "POST" && route === "/api/demo") {
    let body;
    try { body = await readBody(req); } catch (e) { return sendJson(res, 400, { error: e.message }); }
    if (body.action === "enter") {
      if (!store.activeSession) {
        store.activeSession = { id: crypto.randomUUID(), entryTime: isoNow(), exitTime: null, status: "active", fee: 0, source: "demo" };
        recordEvent("demo_vehicle_entered", { sessionId: store.activeSession.id });
      }
    } else if (body.action === "exit") {
      if (store.activeSession) {
        const session = store.activeSession;
        const seconds = durationSeconds(session.entryTime, Date.now());
        store.sessions.unshift({ ...session, exitTime: isoNow(), status: "completed", durationSeconds: seconds, duration: formatDuration(seconds), fee: calculateFee(seconds) });
        store.sessions = store.sessions.slice(0, 2000);
        store.activeSession = null;
        recordEvent("demo_vehicle_exited", { fee: calculateFee(seconds) });
      }
    } else if (body.action === "clear-demo") {
      store.sessions = store.sessions.filter(s => s.source !== "demo");
      recordEvent("demo_history_cleared");
    } else {
      return sendJson(res, 400, { error: "Unknown demo action." });
    }
    persist();
    return sendJson(res, 200, { ok: true, status: getPublicStatus() });
  }

  return sendJson(res, 404, { error: "API route not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = parseUrl(req);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405); return res.end("Method not allowed");
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Smart Parking dashboard running at http://localhost:${PORT}`);
  console.log(`For ESP32 access on your LAN, use your computer's LAN IP with port ${PORT}.`);
});
