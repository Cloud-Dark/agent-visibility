"use strict";
// Shared helpers: state dir, state file, http helpers. No dependencies.
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_PORT = Number(process.env.AGENT_MONITOR_PORT || "9761") || 9761;
const DEFAULT_HOST = process.env.AGENT_MONITOR_HOST || "127.0.0.1";
const MAX_PORT_TRIES = 100;

function stateDir() {
  const base = process.env.TEMP || process.env.TMP || os.tmpdir();
  return path.join(base, "claude-agent-monitor");
}

function stateFile() {
  return path.join(stateDir(), "state.json");
}

function serverFile() {
  return path.join(stateDir(), "server.json");
}

function ensureDir() {
  fs.mkdirSync(stateDir(), { recursive: true });
}

function blankState() {
  return {
    agents: {},
    events: [],
    webhooks: [],
    transports: { webhook: true, sse: true, socketio: true },
    updated_at: null,
  };
}

const DEFAULT_TRANSPORTS = { webhook: true, sse: true, socketio: true };

function loadState() {
  try {
    const raw = fs.readFileSync(stateFile(), "utf8").replace(/^﻿/, ""); // tolerate BOM from editors/PowerShell
    const s = JSON.parse(raw);
    if (!s.agents) s.agents = {};
    if (!Array.isArray(s.events)) s.events = [];
    if (!Array.isArray(s.webhooks)) s.webhooks = [];
    s.transports = { ...DEFAULT_TRANSPORTS, ...(s.transports || {}) };
    return s;
  } catch {
    return blankState();
  }
}

// Atomic-ish write: tmp + rename.
function saveState(s) {
  ensureDir();
  s.updated_at = new Date().toISOString();
  const tmp = stateFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf8");
  fs.renameSync(tmp, stateFile());
}

function loadServerInfo() {
  try {
    return JSON.parse(fs.readFileSync(serverFile(), "utf8"));
  } catch {
    return null;
  }
}

function saveServerInfo(info) {
  ensureDir();
  fs.writeFileSync(serverFile(), JSON.stringify(info, null, 2), "utf8");
}

function pushEvent(s, type, agent) {
  s.events.push({
    ts: new Date().toISOString(),
    type,
    agent_id: agent.agent_id,
    agent_type: agent.agent_type || null,
  });
  if (s.events.length > 200) s.events = s.events.slice(-200);
}

// Fire webhooks without blocking the hook (detached POST).
function fireWebhooks(webhooks, payload, enabled = true) {
  if (!enabled) return;
  if (!webhooks || webhooks.length === 0) return;
  const body = JSON.stringify(payload);
  for (const url of webhooks) {
    try {
      const u = new URL(url);
      const mod = u.protocol === "https:" ? require("https") : require("http");
      const req = mod.request(
        {
          hostname: u.hostname,
          port: u.port || (u.protocol === "https:" ? 443 : 80),
          path: u.pathname + u.search,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 4000,
        },
        (res) => res.resume()
      );
      req.on("error", () => {});
      req.end(body);
    } catch {
      // ignore bad webhook URLs
    }
  }
}

function readStdinJson(timeoutMs = 3000) {
  return new Promise((resolve) => {
    let data = "";
    const t = setTimeout(() => resolve({}), timeoutMs);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => {
      clearTimeout(t);
      data = data.replace(/^﻿/, ""); // strip BOM (PowerShell pipes add one)
      try {
        resolve(data.trim() ? JSON.parse(data) : {});
      } catch {
        resolve({ _raw: data });
      }
    });
    if (process.stdin.isTTY) {
      clearTimeout(t);
      resolve({});
    }
  });
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_HOST,
  MAX_PORT_TRIES,
  DEFAULT_TRANSPORTS,
  stateDir,
  stateFile,
  serverFile,
  ensureDir,
  loadState,
  saveState,
  loadServerInfo,
  saveServerInfo,
  pushEvent,
  fireWebhooks,
  readStdinJson,
};
