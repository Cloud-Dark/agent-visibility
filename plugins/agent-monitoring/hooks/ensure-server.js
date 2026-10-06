"use strict";
// SessionStart hook: make sure the monitor server is up.
// Rules:
// - If the port answers /__health as OUR monitor -> kill the old process,
//   then start a fresh one on the same port.
// - If the port is used by another app -> bump port (+1, up to +100).
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const {
  DEFAULT_PORT,
  DEFAULT_HOST,
  MAX_PORT_TRIES,
  loadServerInfo,
  saveServerInfo,
} = require("../lib/store");

const MONITOR_ID = "claude-agent-monitor";
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const QUIET = process.argv.includes("--quiet");
// Bind host: AGENT_MONITOR_HOST env (127.0.0.1 = local only, 0.0.0.0 = LAN like `npm run dev -- --host`).
const HOST = process.env.AGENT_MONITOR_HOST || DEFAULT_HOST;

function displayUrl(port) {
  if (HOST === "0.0.0.0") {
    try {
      const nets = require("os").networkInterfaces();
      for (const list of Object.values(nets)) {
        for (const n of list || []) {
          if (n.family === "IPv4" && !n.internal) return `http://${n.address}:${port}`;
        }
      }
    } catch {}
  }
  return `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${port}`;
}

function logLine(msg) {
  try {
    const fs = require("fs");
    const { ensureDir, stateDir } = require("../lib/store");
    ensureDir();
    const f = require("path").join(stateDir(), "monitor.log");
    let size = 0;
    try {
      size = fs.statSync(f).size;
    } catch {}
    if (size > 100 * 1024) fs.writeFileSync(f, "", "utf8"); // rotate
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`, "utf8");
  } catch {}
}

function healthCheck(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/__health", timeout: 1500 },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(data);
            resolve(j && j.monitor === MONITOR_ID ? j : null);
          } catch {
            resolve({ occupied: true });
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", (err) => {
      // ECONNREFUSED = free port; anything else (e.g. parseable non-JSON
      // 200 from another app) counts as occupied.
      if (err && err.code === "ECONNREFUSED") resolve(null);
      else resolve({ occupied: true });
    });
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killOld(info) {
  if (!info || !info.pid || !processAlive(info.pid)) return false;
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/PID", String(info.pid), "/F"], {
        stdio: "ignore",
      });
    } else {
      process.kill(info.pid, "SIGTERM");
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  let port = DEFAULT_PORT;
  for (let i = 0; i < MAX_PORT_TRIES; i++) {
    const candidate = DEFAULT_PORT + i;
    const health = await healthCheck(candidate);
    if (health && health.monitor === MONITOR_ID) {
      // Ours BUT already healthy: reuse it, don't restart (avoids flapping
      // when ensure-server runs on every prompt). Only restart when the
      // pid file points at a dead process.
      const prev = loadServerInfo();
      if (prev && prev.port === candidate && !processAlive(prev.pid)) {
        killOld(prev);
        await new Promise((r) => setTimeout(r, 500));
        port = candidate;
        break;
      }
      if (prev && prev.port === candidate && processAlive(prev.pid)) {
        port = candidate;
        saveServerInfo({ ...prev, port, checked_at: new Date().toISOString() });
        const msg = `agent-monitor: dashboard at ${displayUrl(port)} (already running, pid ${prev.pid})`;
        logLine(msg);
        if (!QUIET) console.log(msg);
        return;
      }
      // Health says ours but no pid file — adopt it.
      port = candidate;
      saveServerInfo({ pid: health.pid || null, port, host: HOST, started_at: health.started_at || new Date().toISOString() });
      const msg2 = `agent-monitor: dashboard at ${displayUrl(port)} (adopted existing)`;
      logLine(msg2);
      if (!QUIET) console.log(msg2);
      return;
    }
    if (health && health.occupied) {
      continue; // another app — try next port
    }
    const prev = loadServerInfo();
    if (prev && prev.port === candidate && processAlive(prev.pid)) {
      // Stale health check but pid file says ours — restart.
      killOld(prev);
      await new Promise((r) => setTimeout(r, 500));
    }
    port = candidate;
    break;
  }

  const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, "server.js")], {
    env: { ...process.env, AGENT_MONITOR_PORT: String(port), AGENT_MONITOR_HOST: HOST },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
  saveServerInfo({ pid: child.pid, port, host: HOST, started_at: new Date().toISOString() });

  // SessionStart stdout is shown to the user — keep it to one line.
  const startedMsg = `agent-monitor: dashboard at ${displayUrl(port)}`;
  logLine(`${startedMsg} (started pid ${child.pid})`);
  if (!QUIET) console.log(startedMsg);
}

main().catch((err) => {
  logLine(`agent-monitor: failed to start server: ${err.message}`);
  if (!QUIET) console.error(`agent-monitor: failed to start server: ${err.message}`);
  process.exit(0); // never block session start
});
