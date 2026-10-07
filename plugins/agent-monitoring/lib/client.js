"use strict";
// HTTP client used by hooks and the MCP server to talk to the monitor
// server, local or remote.
//   AGENT_MONITOR_URL           server URL (default http://127.0.0.1:<port from server.json>)
//   AGENT_MONITOR_CLIENT_TOKEN  token for /api/ingest (default: local auth.json)
//   AGENT_MONITOR_TOKEN         API token for MCP tools (default: local auth.json)
const os = require("os");
const fs = require("fs");
const path = require("path");
const { DEFAULT_PORT, loadServerInfo } = require("./store");
const { readLocal } = require("./auth");

function baseUrl() {
  if (process.env.AGENT_MONITOR_URL) return process.env.AGENT_MONITOR_URL.replace(/\/+$/, "");
  const info = loadServerInfo();
  return `http://127.0.0.1:${(info && info.port) || DEFAULT_PORT}`;
}

function isRemote() {
  try {
    const h = new URL(baseUrl()).hostname;
    return !["127.0.0.1", "localhost", "::1", "[::1]"].includes(h);
  } catch {
    return false;
  }
}

function request(method, p, body, token, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(baseUrl() + p);
    } catch {
      return resolve({ status: 0, body: null, error: "bad AGENT_MONITOR_URL" });
    }
    const mod = u.protocol === "https:" ? require("https") : require("http");
    const data = body === undefined ? null : JSON.stringify(body);
    const headers = {};
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = mod.request(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers, timeout: timeoutMs },
      (res) => {
        let out = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = out ? JSON.parse(out) : null;
          } catch {}
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", (e) => resolve({ status: 0, body: null, error: e.message }));
    if (data) req.end(data);
    else req.end();
  });
}

// Display name of this Claude Code session from its registry entry
// (~/.claude/sessions/<CLAUDE_PID>.json), e.g. "agentmonitoring-77".
function sessionName() {
  const pid = process.env.CLAUDE_PID;
  if (!pid || !/^\d+$/.test(pid)) return null;
  try {
    const f = path.join(os.homedir(), ".claude", "sessions", `${pid}.json`);
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    return typeof j.name === "string" ? j.name : null;
  } catch {
    return null;
  }
}

// Send one event to /api/ingest. Never throws.
function ingest(event) {
  const token = readLocal().client_token;
  const pid = Number(process.env.CLAUDE_PID) || null;
  return request("POST", "/api/ingest", { ...event, host: os.hostname(), pid }, token);
}

function api(method, p, body) {
  return request(method, p, body, readLocal().api_token, 5000);
}

module.exports = { baseUrl, isRemote, request, ingest, api, sessionName };
