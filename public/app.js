const $ = (id) => document.getElementById(id);
let latestStatus = null;
let toastTimer = null;

function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(Number(value || 0));
}
function dateTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function shortTime(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function duration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds || 0)));
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map(v => String(v).padStart(2, "0")).join(":");
}
function relativeTime(value) {
  if (!value) return "Never received";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}
async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}
function setStatusDot(element, online) {
  element.classList.toggle("online", !!online);
  element.classList.toggle("offline", !online);
}
function renderStatus(data) {
  latestStatus = data;
  const occupied = data.status === "occupied";
  const active = data.activeSession;
  const device = data.device || {};
  const reading = device.lastReading || {};
  const metrics = data.metrics || {};

  $("parkingStatus").textContent = occupied ? "Occupied" : "Available";
  $("parkingDot").classList.toggle("occupied", occupied);
  $("parkingStatus").style.color = occupied ? "#b98412" : "#16885b";
  $("sessionHint").textContent = occupied ? "Vehicle detected in parking bay" : "Waiting for vehicle detection";
  $("slotTag").textContent = "SLOT 01";
  $("durationValue").textContent = active ? duration(active.durationSeconds) : "00:00:00";
  $("entryValue").textContent = active ? `Entry ${dateTime(active.entryTime)}` : "No active session";
  $("feeValue").textContent = money(active ? active.currentFee : 0);
  $("rateCaption").textContent = `${money(metrics.hourlyRate)} per started hour`;
  $("revenueValue").textContent = money(metrics.revenueToday);
  $("sessionsCaption").textContent = `${metrics.completedSessionsToday || 0} completed sessions`;
  $("lastUpdated").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  $("todayLabel").textContent = new Date().toLocaleDateString([], { weekday: "short", month: "short", day: "2-digit" }).toUpperCase();

  $("carIllustration").classList.toggle("occupied", occupied);
  $("bayLabel").textContent = occupied ? "SLOT 01 · OCCUPIED" : "SLOT 01 · AVAILABLE";
  $("monitorTag").textContent = occupied ? "VEHICLE DETECTED" : (device.connected ? "SENSOR ONLINE" : "AWAITING DATA");
  $("monitorTag").className = "outline-tag " + (occupied ? "warn" : device.connected ? "good" : "");
  $("sensorState").textContent = reading.occupied === undefined ? "Sensor awaiting data" : (reading.occupied ? "Vehicle detected" : "No vehicle detected");
  $("sensorSub").textContent = device.connected ? "IR obstacle sensor · GPIO 27" : "Waiting for ESP32 heartbeat";
  $("sensorRing").style.background = occupied ? "#fff5d8" : "#edf4ff";
  $("sensorRing").style.color = occupied ? "#bd8c17" : "#4787f5";
  $("rawReading").textContent = reading.raw === null || reading.raw === undefined ? "RAW —" : `RAW ${reading.raw}`;

  const connected = !!device.connected;
  $("deviceStatus").textContent = connected ? "Online" : "Offline";
  $("deviceTag").textContent = connected ? "CONNECTED" : "NO HEARTBEAT";
  $("deviceTag").className = "outline-tag " + (connected ? "good" : "");
  $("sideStatusText").textContent = connected ? "ESP32 connected" : "Waiting for device";
  $("sideStatusSub").textContent = connected ? `Last seen ${relativeTime(device.lastSeen)}` : "Connect your ESP32 to begin";
  setStatusDot($("deviceDot"), connected);
  setStatusDot($("sideStatusDot"), connected);
  $("heartbeatValue").textContent = relativeTime(device.lastSeen);
  $("uptimeValue").textContent = device.uptimeSeconds === null || device.uptimeSeconds === undefined ? "—" : duration(device.uptimeSeconds);
  $("rssiValue").textContent = reading.rssi === null || reading.rssi === undefined ? "—" : `${reading.rssi} dBm`;

  const power = metrics.powerWatts;
  $("powerValue").innerHTML = power === null || power === undefined ? '— <small>W</small>' : `${Number(power).toFixed(2)} <small>W</small>`;
  $("powerMeterFill").style.width = power === null || power === undefined ? "0%" : `${Math.max(0, Math.min(100, Number(power))) }%`;
  $("voltageValue").textContent = metrics.voltage === null || metrics.voltage === undefined ? "— V" : `${Number(metrics.voltage).toFixed(2)} V`;
  $("currentValue").textContent = metrics.current === null || metrics.current === undefined ? "— A" : `${Number(metrics.current).toFixed(3)} A`;
  $("energyValue").textContent = metrics.energyWh === null || metrics.energyWh === undefined ? "— Wh" : `${Number(metrics.energyWh).toFixed(2)} Wh`;

  if (data.config) {
    if (document.activeElement !== $("hourlyRate")) $("hourlyRate").value = data.config.hourlyRate;
    if (document.activeElement !== $("heartbeatTimeout")) $("heartbeatTimeout").value = data.config.heartbeatTimeoutSeconds;
  }
}
function renderHistory(items) {
  const body = $("historyBody");
  if (!items.length) {
    body.innerHTML = '<tr><td colspan="6" class="empty-cell">No sessions match these filters.</td></tr>';
  } else {
    body.innerHTML = items.map(s => {
      const secs = s.durationSeconds ?? (s.status === "active" ? Math.floor((Date.now() - new Date(s.entryTime).getTime()) / 1000) : 0);
      const status = s.status === "active" ? "active" : "completed";
      return `<tr>
        <td><span class="session-id">${escapeHtml(String(s.id || "").slice(0, 8).toUpperCase())}</span></td>
        <td>${escapeHtml(dateTime(s.entryTime))}</td>
        <td>${escapeHtml(s.exitTime ? dateTime(s.exitTime) : "—")}</td>
        <td>${duration(secs)}</td>
        <td class="fee-cell">${money(s.status === "active" ? calculateClientFee(secs) : s.fee)}</td>
        <td><span class="status-pill ${status}">${status === "active" ? "ACTIVE" : "COMPLETED"}</span></td>
      </tr>`;
    }).join("");
  }
  $("historyCount").textContent = `Showing ${items.length} session${items.length === 1 ? "" : "s"}`;
}
function calculateClientFee(seconds) {
  const rate = Number(latestStatus?.config?.hourlyRate ?? 30);
  return seconds > 0 ? Math.ceil(seconds / 3600) * rate : 0;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
async function refreshHistory() {
  const params = new URLSearchParams({ limit: "100", status: $("historyStatus").value });
  if ($("historyDate").value) params.set("date", $("historyDate").value);
  const data = await api(`/api/history?${params}`);
  const items = [...data.items];
  if (latestStatus?.activeSession && ($("historyStatus").value === "all" || $("historyStatus").value === "active")) {
    const a = latestStatus.activeSession;
    if (!$("historyDate").value || a.entryTime.slice(0, 10) === $("historyDate").value) {
      items.unshift({ ...a, status: "active", durationSeconds: a.durationSeconds, fee: a.currentFee });
    }
  }
  renderHistory(items);
}
async function refreshAll() {
  try {
    const status = await api("/api/status");
    renderStatus(status);
    await refreshHistory();
    $("footerTime").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (err) {
    $("lastUpdated").textContent = "Server unavailable";
    showToast("Cannot reach the local server. Check that `npm start` is running.");
  }
}
async function postAction(url, body) {
  const data = await api(url, { method: "POST", body: JSON.stringify(body) });
  if (data.status) renderStatus(data.status);
  await refreshHistory();
  return data;
}
$("refreshBtn").addEventListener("click", () => refreshAll());
$("historyStatus").addEventListener("change", refreshHistory);
$("historyDate").addEventListener("change", refreshHistory);
$("clearFilterBtn").addEventListener("click", () => { $("historyDate").value = ""; $("historyStatus").value = "all"; refreshHistory(); });
$("configForm").addEventListener("submit", async e => {
  e.preventDefault();
  const hourlyRate = Number($("hourlyRate").value);
  const heartbeatTimeoutSeconds = Number($("heartbeatTimeout").value);
  try {
    await api("/api/config", { method: "POST", body: JSON.stringify({ hourlyRate, heartbeatTimeoutSeconds }) });
    $("configMessage").textContent = "Saved successfully.";
    showToast("Configuration saved.");
    await refreshAll();
  } catch (err) {
    $("configMessage").textContent = err.message;
    showToast(err.message);
  }
});
$("demoEnterBtn").addEventListener("click", async () => {
  try { await postAction("/api/demo", { action: "enter" }); showToast("Demo vehicle entry recorded."); }
  catch (err) { showToast(err.message); }
});
$("demoExitBtn").addEventListener("click", async () => {
  try { await postAction("/api/demo", { action: "exit" }); showToast("Demo vehicle exit recorded."); }
  catch (err) { showToast(err.message); }
});
$("exportBtn").addEventListener("click", async () => {
  try {
    const params = new URLSearchParams({ limit: "500", status: $("historyStatus").value });
    if ($("historyDate").value) params.set("date", $("historyDate").value);
    const data = await api(`/api/history?${params}`);
    const headers = ["Session ID", "Entry Time", "Exit Time", "Duration Seconds", "Duration", "Fee INR", "Status", "Source"];
    const rows = data.items.map(s => [s.id, s.entryTime, s.exitTime || "", s.durationSeconds || 0, duration(s.durationSeconds || 0), s.fee || 0, s.status, s.source || "esp32"]);
    const csv = [headers, ...rows].map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `parking-sessions-${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (err) { showToast(err.message); }
});
function openHelp() { $("helpModal").hidden = false; }
function closeHelp() { $("helpModal").hidden = true; }
$("apiHelpBtn").addEventListener("click", openHelp);
$("closeHelpBtn").addEventListener("click", closeHelp);
$("closeHelpBtn2").addEventListener("click", closeHelp);
$("helpModal").addEventListener("click", e => { if (e.target === $("helpModal")) closeHelp(); });
document.querySelectorAll(".nav-link").forEach(link => {
  link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach(a => a.classList.remove("active"));
    link.classList.add("active");
  });
});
refreshAll();
setInterval(refreshAll, 2000);
