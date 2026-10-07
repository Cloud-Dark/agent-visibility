"use strict";
// SessionStart / UserPromptSubmit hook: make sure the monitor server is up.
// - AGENT_MONITOR_URL points to another machine: nothing to start here
//   (this Claude Code is only a client); just report whether it answers.
// - Port answers /__health as OUR monitor and the pid file agrees: reuse it.
// - Port answers as our monitor but the pid file is stale: adopt that pid.
// - Port used by another app (any other answer, or a timeout): try port+1.
// - --quiet (every prompt): only check the saved port; full scan only on
//   SessionStart, so a prompt is never delayed by a long port scan.
// Always exits 0 so it never blocks Claude Code.
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { DEFAULT_PORT, DEFAULT_HOST, MAX_PORT_TRIES, loadServerInfo, saveServerInfo, ensureDir, stateDir } = require("../lib/store");
const client = require("../lib/client");

const MONITOR_ID = "claude-agent-monitor";
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const QUIET = process.argv.includes("--quiet");
const HOST = process.env.AGENT_MONITOR_HOST || DEFAULT_HOST;

function displayUrl(port) {
  if (HOST === "0.0.0.0") {
    try {
      for (const list of Object.values(require("os").networkInterfaces())) {
        for (const n of list || []) if (n.family === "IPv4" && !n.internal) return `http://${n.address}:${port}`;
      }
    } catch {}
  }
  return `http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${port}`;
}

function logLine(msg) {
  try {
    ensureDir();
    const f = path.join(stateDir(), "monitor.log");
    let size = 0;
    try {
      size = fs.statSync(f).size;
    } catch {}
    if (size > 100 * 1024) fs.writeFileSync(f, "", "utf8");
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}\n`, "utf8");
  } catch {}
}

const say = (msg) => {
  logLine(msg);
  if (!QUIET) console.log(msg);
};

// null = free (connection refused); {monitor...} = ours; {occupied} = anything else.
function healthCheck(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/__health", timeout: 1500 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(data);
          resolve(j && j.monitor === MONITOR_ID ? j : { occupied: true });
        } catch {
          resolve({ occupied: true });
        }
      });
    });
    // A slow answer is not a free port: treat it as occupied.
    req.on("timeout", () => {
      req.destroy();
      resolve({ occupied: true, timeout: true });
    });
    req.on("error", (err) => resolve(err && err.code === "ECONNREFUSED" ? null : { occupied: true }));
  });
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function startServer(port) {
  const child = spawn(process.execPath, [path.join(PLUGIN_ROOT, "server.js")], {
    env: { ...process.env, AGENT_MONITOR_PORT: String(port), AGENT_MONITOR_HOST: HOST },
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.on("error", (e) => logLine(`agent-monitor: spawn failed: ${e.message}`));
  child.unref();
  saveServerInfo({ pid: child.pid, port, host: HOST, started_at: new Date().toISOString() });
  return child.pid;
}

async function remoteMode() {
  const r = await client.request("GET", "/__health", undefined, null, 2500);
  const url = client.baseUrl();
  if (r.status === 200 && r.body && r.body.monitor === MONITOR_ID) say(`agent-monitor: reporting to ${url}`);
  else say(`agent-monitor: remote server ${url} not reachable (${r.error || r.status})`);
}

async function main() {
  if (client.isRemote()) return remoteMode();

  const prev = loadServerInfo();
  const ports = [];
  if (QUIET && prev && prev.port) ports.push(prev.port);
  else for (let i = 0; i < MAX_PORT_TRIES; i++) ports.push(DEFAULT_PORT + i);

  for (const port of ports) {
    const health = await healthCheck(port);
    if (health && health.monitor === MONITOR_ID) {
      // Ours and answering: reuse. If the pid file is stale or points
      // elsewhere, adopt the pid the server reports.
      if (!prev || prev.port !== port || prev.pid !== health.pid) {
        saveServerInfo({ pid: health.pid || null, port, host: health.host || HOST, started_at: health.started_at || new Date().toISOString() });
      } else {
        saveServerInfo({ ...prev, checked_at: new Date().toISOString() });
      }
      return say(`agent-monitor: dashboard at ${displayUrl(port)} (running, pid ${health.pid})`);
    }
    if (health && health.occupied) {
      if (QUIET) return logLine(`agent-monitor: port ${port} busy or slow, leaving it for the next session start`);
      continue; // another app (or a hung process): never kill it, try the next port
    }
    // Free port. Never kill anything here: a stale pid may belong to
    // another program after a reboot.
    const pid = startServer(port);
    return say(`agent-monitor: dashboard at ${displayUrl(port)} (started pid ${pid})`);
  }
  say(`agent-monitor: no free port in ${DEFAULT_PORT}-${DEFAULT_PORT + MAX_PORT_TRIES - 1}`);
}

main()
  .catch((err) => logLine(`agent-monitor: ensure-server failed: ${err.message}`))
  .finally(() => process.exit(0));
