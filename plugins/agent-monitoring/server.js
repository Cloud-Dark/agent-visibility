"use strict";
// Agent monitor server. Runs on this machine (started by the plugin's
// SessionStart hook) or as a central server for many machines:
//   node server.js --host 0.0.0.0
// Claude Code clients (hooks on any machine) POST events to /api/ingest
// with the client token; the dashboard is behind a password login.
// Transports: webhook (outbound POST), SSE (/api/stream), socket.io.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { DEFAULT_PORT, DEFAULT_HOST, DEFAULT_TRANSPORTS, loadServerInfo, fireWebhooks } = require("./lib/store");
const registry = require("./lib/registry");
const auth = require("./lib/auth");
const chat = require("./lib/chat");
const agentinfo = require("./lib/agentinfo");

const MONITOR_ID = "claude-agent-monitor";
const PORT = Number(process.env.AGENT_MONITOR_PORT || DEFAULT_PORT);
// Bind address: 127.0.0.1 (default, this machine only) or 0.0.0.0 (LAN /
// central server). Override with AGENT_MONITOR_HOST or --host 0.0.0.0.
const HOST = process.argv.includes("--host")
  ? process.argv[process.argv.indexOf("--host") + 1] || DEFAULT_HOST
  : DEFAULT_HOST;
// Extra allowed browser origins (comma separated), e.g. behind a proxy.
const EXTRA_ORIGINS = String(process.env.AGENT_MONITOR_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
// Set when served behind HTTPS so the login cookie gets the Secure flag.
const SECURE_COOKIE = process.env.AGENT_MONITOR_SECURE_COOKIE === "1";
const BOOT_AT = new Date().toISOString();
const PUBLIC = path.join(__dirname, "public");
const AUTH = auth.loadOrCreate();

const send = (res, code, type, body, headers = {}) => {
  res.writeHead(code, {
    "Content-Type": type,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...headers,
  });
  res.end(body);
};
const json = (res, code, obj, headers) => send(res, code, "application/json; charset=utf-8", JSON.stringify(obj), headers);

const MAX_BODY = 256 * 1024;
// JSON bodies only: a browser cannot send application/json cross-site
// without a CORS preflight, which this server never approves.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers["content-type"] || "");
    if (!type.toLowerCase().startsWith("application/json")) {
      req.resume();
      return reject(Object.assign(new Error("Content-Type must be application/json"), { status: 415 }));
    }
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      data += c;
      if (data.length > MAX_BODY) {
        req.destroy();
        reject(Object.assign(new Error("body too large"), { status: 413 }));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error("invalid JSON"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function lanIps() {
  try {
    const out = [];
    for (const list of Object.values(require("os").networkInterfaces())) {
      for (const n of list || []) if (n.family === "IPv4" && !n.internal) out.push(n.address);
    }
    return out;
  } catch {
    return [];
  }
}

const clientIp = (req) => String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
const isLoopback = (req) => ["127.0.0.1", "::1"].includes(clientIp(req));

// ---- who is calling ----
// "user"   : dashboard login cookie, or API token (other apps)
// "client" : Claude Code hook with the client token (ingest only)
// "run"    : a prompt run's own secret (its approvals only)
function originOk(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser client, or same-origin GET
  const host = req.headers.host;
  return origin === `http://${host}` || origin === `https://${host}` || EXTRA_ORIGINS.includes(origin);
}

function isUser(req) {
  const b = auth.bearer(req);
  if (b && auth.safeEqual(b, AUTH.api_token)) return true;
  return auth.cookieValid(AUTH, req.headers.cookie);
}

const isClient = (req) => {
  const b = auth.bearer(req);
  return !!b && (auth.safeEqual(b, AUTH.client_token) || auth.safeEqual(b, AUTH.api_token));
};

// ---- login rate limit (per IP) ----
const loginFails = new Map(); // ip -> { n, until }
function loginBlocked(ip) {
  const f = loginFails.get(ip);
  return f && f.until > Date.now();
}
function loginFailed(ip) {
  const f = loginFails.get(ip) || { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 5) {
    f.until = Date.now() + Math.min(60000 * 2 ** (f.n - 5), 15 * 60000);
  }
  loginFails.set(ip, f);
}

// ---- live broadcast (SSE + socket.io), dashboard users only ----
const sseClients = new Set();
let io = null;

function broadcast(payload) {
  const s = registry.get();
  const t = s.transports || DEFAULT_TRANSPORTS;
  if (t.sse !== false) {
    const line = `data: ${JSON.stringify(payload)}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(line);
      } catch {
        sseClients.delete(res);
      }
    }
  }
  if (io && t.socketio !== false) io.to("users").emit("agent-event", payload);
  if (payload.event === "agent.spawn" || payload.event === "agent.stop") {
    fireWebhooks(s.webhooks, payload, t.webhook !== false);
  }
}

setInterval(() => {
  for (const p of registry.tick()) broadcast(p);
}, 5000);

// ---- views ----
function withName(s, a) {
  const names = s.names || {};
  const meta = agentinfo.readMeta(a);
  return { ...a, name: names[a.agent_id] || null, description: (meta && meta.description) || null };
}

function sessionView(s, sess) {
  const agents = registry.sessionAgents(sess.session_id);
  return {
    ...sess,
    agents_running: agents.filter((a) => a.status === "running").length,
    agents_total: agents.length,
  };
}

function promptText(body) {
  const text = typeof body.prompt === "string" ? body.prompt : typeof body.text === "string" ? body.text : "";
  if (!text.trim()) return { error: "prompt is required" };
  if (text.length > 20000) return { error: "prompt too long (max 20000 chars)" };
  return { text: text.trim() };
}

let indexHtml = null;
function staticFile(name) {
  if (name === "index.html" && indexHtml) return indexHtml;
  const data = fs.readFileSync(path.join(PUBLIC, name));
  if (name === "index.html") indexHtml = data;
  return data;
}

const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

// ---- routes ----
async function route(req, res, u) {
  const p = u.pathname;
  const m = req.method;

  // Public: health (used by ensure-server to find "our" server).
  if (m === "GET" && p === "/__health") {
    const info = loadServerInfo() || {};
    return json(res, 200, { monitor: MONITOR_ID, port: PORT, host: HOST, pid: process.pid, started_at: info.started_at || BOOT_AT });
  }

  // Cross-site browser requests are refused everywhere else.
  if (!originOk(req)) return json(res, 403, { error: "cross-origin request refused" });

  // Public: login page and login/logout.
  if (m === "GET" && p === "/login") {
    return send(res, 200, "text/html; charset=utf-8", staticFile("login.html"), { "Content-Security-Policy": CSP, "X-Frame-Options": "DENY" });
  }
  if (m === "POST" && p === "/api/login") {
    const ip = clientIp(req);
    if (loginBlocked(ip)) return json(res, 429, { error: "too many attempts, wait a few minutes" });
    const body = await readBody(req);
    if (!auth.safeEqual(String(body.password || ""), AUTH.password)) {
      loginFailed(ip);
      return json(res, 401, { error: "wrong password" });
    }
    loginFails.delete(ip);
    return json(res, 200, { ok: true }, { "Set-Cookie": auth.makeCookie(AUTH, SECURE_COOKIE) });
  }
  if (m === "POST" && p === "/api/logout") {
    return json(res, 200, { ok: true }, { "Set-Cookie": auth.clearCookie() });
  }

  // Run-scoped: approval-mcp.js of one prompt run, by its run secret.
  if (p === "/api/run/approvals" || p.startsWith("/api/run/approvals/")) {
    if (!isLoopback(req)) return json(res, 403, { error: "run endpoints are loopback-only" });
    const secret = auth.bearer(req);
    const id = p.split("/")[4] || "";
    if (m === "POST" && !id) return json(res, 201, chat.createApproval(await readBody(req), secret));
    if (m === "GET" && id) {
      if (!chat.approvalForRun(id, secret)) return json(res, 404, { error: "unknown approval" });
      const waitMs = Math.min(Number(u.searchParams.get("wait_ms")) || 0, 60000);
      return json(res, 200, await chat.waitApproval(id, waitMs));
    }
    return json(res, 405, { error: "method not allowed" });
  }

  // Client: Claude Code hooks report sessions, prompts, agents, tools.
  if (m === "POST" && p === "/api/ingest") {
    if (!isClient(req)) return json(res, 401, { error: "client token required" });
    const body = await readBody(req);
    for (const payload of registry.apply(body, { ip: clientIp(req) })) broadcast(payload);
    return json(res, 200, { ok: true });
  }

  // Everything below needs a logged-in user (cookie) or the API token.
  const user = isUser(req);
  if (m === "GET" && (p === "/" || p === "/index.html")) {
    if (!user) return send(res, 302, "text/plain", "login required", { Location: "/login" });
    return send(res, 200, "text/html; charset=utf-8", staticFile("index.html"), { "Content-Security-Policy": CSP, "X-Frame-Options": "DENY", "Cache-Control": "no-store" });
  }
  if (m === "GET" && p === "/pixel.js") {
    if (!user) return json(res, 401, { error: "login required" });
    return send(res, 200, "text/javascript; charset=utf-8", staticFile("pixel.js"));
  }
  if (!user) return json(res, 401, { error: "login required" });

  const s = registry.get();
  const info = loadServerInfo() || {};

  if (m === "GET" && p === "/api/agents") {
    const agents = Object.values(s.agents)
      .sort((a, b) => String(b.started_at || "").localeCompare(String(a.started_at || "")))
      .map((a) => withName(s, a));
    const sessions = Object.values(s.sessions || {})
      .sort((a, b) => String(b.last_seen || "").localeCompare(String(a.last_seen || "")))
      .map((x) => sessionView(s, x));
    return json(res, 200, {
      server: {
        port: PORT,
        host: HOST,
        lan_ips: HOST === "0.0.0.0" ? lanIps() : [],
        pid: process.pid,
        started_at: info.started_at || BOOT_AT,
        state_updated_at: s.updated_at,
        socketio: !!io,
        transports: s.transports,
      },
      webhooks: s.webhooks,
      transports: s.transports,
      sessions,
      agents,
    });
  }
  if (m === "GET" && p === "/api/sessions") {
    return json(res, 200, { sessions: Object.values(s.sessions || {}).map((x) => sessionView(s, x)) });
  }
  if (m === "DELETE" && p.startsWith("/api/sessions/")) {
    const sid = p.split("/")[3] || "";
    if (!registry.ID_RE.test(sid)) return json(res, 400, { error: "bad session id" });
    registry.forgetSession(sid);
    broadcast({ event: "session.removed", session_id: sid });
    return json(res, 200, { ok: true });
  }
  if (p.startsWith("/api/agents/")) {
    const parts = p.split("/");
    const id = parts[3] || "";
    if (!agentinfo.ID_RE.test(id)) return json(res, 400, { error: "bad agent id" });
    const a = s.agents[id];
    if (!a) return json(res, 404, { error: "unknown agent" });
    if (m === "GET" && parts.length === 4) {
      return json(res, 200, { agent: withName(s, a), detail: agentinfo.readDetail(a) });
    }
    if ((m === "PUT" || m === "POST") && parts[4] === "name" && parts.length === 5) {
      const body = await readBody(req);
      const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
      registry.setName(id, name);
      broadcast({ event: "agent.renamed", agent_id: id, name: name || null });
      return json(res, 200, { agent_id: id, name: name || null });
    }
    return json(res, 405, { error: "method not allowed" });
  }
  if (m === "GET" && p === "/api/events") {
    const limit = Math.min(Number(u.searchParams.get("limit") || "50"), 200);
    return json(res, 200, { events: s.events.slice(-limit).reverse() });
  }
  if (p === "/api/transports") {
    if (m === "GET") return json(res, 200, { transports: s.transports || DEFAULT_TRANSPORTS });
    if (m === "POST") {
      const body = await readBody(req);
      const next = { ...(s.transports || DEFAULT_TRANSPORTS) };
      for (const k of ["webhook", "sse", "socketio"]) if (typeof body[k] === "boolean") next[k] = body[k];
      registry.setTransports(next);
      return json(res, 200, { transports: next });
    }
  }
  if (m === "GET" && p === "/api/stream") {
    if (s.transports && s.transports.sse === false) return json(res, 403, { error: "sse transport disabled" });
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(`data: ${JSON.stringify({ event: "connected", ts: new Date().toISOString() })}\n\n`);
    sseClients.add(res);
    const hb = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(hb);
      }
    }, 15000);
    req.on("close", () => {
      clearInterval(hb);
      sseClients.delete(res);
    });
    return;
  }
  if (p === "/api/webhooks") {
    if (m === "GET") return json(res, 200, { webhooks: s.webhooks });
    const body = await readBody(req);
    if (m === "POST") {
      if (!body.url || !/^https?:\/\//.test(body.url)) return json(res, 400, { error: "url must start with http(s)://" });
      if (!s.webhooks.includes(body.url)) registry.setWebhooks([...s.webhooks, body.url]);
      return json(res, 200, { webhooks: registry.get().webhooks });
    }
    if (m === "DELETE") {
      registry.setWebhooks(s.webhooks.filter((w) => w !== body.url));
      return json(res, 200, { webhooks: registry.get().webhooks });
    }
  }
  // Dashboard chat box: one conversation kept in state.json.
  if (p === "/api/chat") {
    if (m === "GET") return json(res, 200, chat.status());
    if (m === "DELETE") return json(res, 200, chat.reset());
    if (m === "POST") {
      const pt = promptText(await readBody(req));
      if (pt.error) return json(res, 400, pt);
      const run = chat.sendDashboard(pt.text, broadcast);
      return json(res, 202, { run_id: run.run_id });
    }
  }
  if (p === "/api/yolo") {
    if (m === "GET") return json(res, 200, { yolo: chat.getYolo() });
    if (m === "POST") {
      const body = await readBody(req);
      return json(res, 200, chat.setYolo(body.yolo === true, broadcast));
    }
  }
  // Approvals: users list and decide. Runs create them via /api/run/approvals.
  if (p === "/api/approvals" || p.startsWith("/api/approvals/")) {
    const id = p.split("/")[3] || "";
    if (!id && m === "GET") {
      return json(res, 200, { yolo: chat.getYolo(), approvals: chat.listApprovals(u.searchParams.get("status") || undefined) });
    }
    if (id && m === "GET") {
      const waitMs = Math.min(Number(u.searchParams.get("wait_ms")) || 0, 60000);
      const a = await chat.waitApproval(id, waitMs);
      return a ? json(res, 200, a) : json(res, 404, { error: "unknown approval id" });
    }
    if (id && m === "POST") {
      const body = await readBody(req);
      if (body.decision !== "allow" && body.decision !== "deny") return json(res, 400, { error: 'decision must be "allow" or "deny"' });
      const msg = typeof body.message === "string" ? body.message.slice(0, 500) : null;
      return json(res, 200, chat.resolveApproval(id, body.decision === "allow" ? "allowed" : "denied", msg || (body.decision === "deny" ? "Rejected from agent-monitor dashboard" : null)));
    }
    return json(res, 405, { error: "method not allowed" });
  }
  // Prompt API for other apps (API token). POST runs a prompt; pass
  // session_id to continue a conversation, wait=true to get the answer.
  if (p === "/api/prompts" || p.startsWith("/api/prompts/")) {
    const runId = p.split("/")[3] || "";
    if (m === "GET" && !runId) return json(res, 200, { runs: chat.listRuns() });
    if (m === "POST" && !runId) {
      const body = await readBody(req);
      const pt = promptText(body);
      if (pt.error) return json(res, 400, pt);
      const run = chat.startRun({ text: pt.text, session_id: body.session_id, cwd: body.cwd }, broadcast);
      const wait = body.wait === true || u.searchParams.get("wait") === "true";
      if (!wait) return json(res, 202, chat.publicRun(run));
      const timeoutMs = Math.min(Number(body.timeout_ms) || 300000, 600000);
      return json(res, 200, chat.publicRun(await chat.waitFor(run.run_id, timeoutMs)));
    }
    if (runId) {
      if (!chat.getRun(runId)) return json(res, 404, { error: "unknown run_id (runs live in memory, max 50)" });
      if (m === "GET") {
        const waitMs = Math.min(Number(u.searchParams.get("wait_ms")) || 0, 600000);
        return json(res, 200, waitMs ? chat.publicRun(await chat.waitFor(runId, waitMs)) : chat.getRun(runId));
      }
      if (m === "DELETE") return json(res, 200, chat.publicRun(chat.cancel(runId)));
    }
    return json(res, 405, { error: "method not allowed" });
  }
  return json(res, 404, { error: "not found" });
}

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res, new URL(req.url, "http://localhost"));
  } catch (err) {
    if (!res.headersSent) json(res, err.status || 500, { error: err.message });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  // Optional socket.io. Same auth as the dashboard (cookie or API token).
  try {
    const { Server } = require("socket.io");
    io = new Server(server, { cors: { origin: EXTRA_ORIGINS.length ? EXTRA_ORIGINS : false } });
    io.use((socket, next) => {
      const req = socket.request;
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const ok = (token && auth.safeEqual(String(token), AUTH.api_token)) || auth.cookieValid(AUTH, req.headers.cookie);
      if (!ok) return next(new Error("unauthorized"));
      next();
    });
    io.on("connection", (socket) => {
      socket.join("users");
      socket.emit("hello", { monitor: MONITOR_ID, ts: new Date().toISOString() });
    });
  } catch {
    io = null; // dependency not installed: REST + SSE still work
  }
});

const shutdown = () => {
  try {
    registry.flush();
  } catch {}
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
