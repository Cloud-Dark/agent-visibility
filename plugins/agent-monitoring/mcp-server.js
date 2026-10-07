"use strict";
// MCP server (stdio) exposing agent-monitor tools. Talks to the monitor
// server over its REST API (local, or AGENT_MONITOR_URL), so it works
// the same against a central server. No dependencies.
const { api, baseUrl } = require("./lib/client");

function tool(name, description, inputSchema, handler) {
  return { name, description, inputSchema, handler };
}

async function call(method, path, body) {
  const r = await api(method, path, body);
  if (r.status === 0) throw new Error(`monitor server ${baseUrl()} not reachable: ${r.error}`);
  if (r.status === 401) throw new Error("monitor server rejected the API token (set AGENT_MONITOR_TOKEN for a remote server)");
  if (r.status >= 400) throw new Error((r.body && r.body.error) || `HTTP ${r.status}`);
  return r.body;
}

const TOOLS = [
  tool(
    "agents_list",
    "List recorded Claude Code subagents (running and finished), across every connected Claude Code session.",
    { type: "object", properties: { status: { type: "string", enum: ["all", "running", "done"] } } },
    async (args) => {
      const { agents } = await call("GET", "/api/agents");
      const st = args.status || "all";
      const list = st === "all" ? agents : agents.filter((a) => a.status === st);
      return { agents: list, count: list.length };
    }
  ),
  tool(
    "agents_get",
    "Get detail of one subagent by agent_id: task, every tool call with result, final answer.",
    { type: "object", properties: { agent_id: { type: "string" } }, required: ["agent_id"] },
    (args) => call("GET", "/api/agents/" + encodeURIComponent(args.agent_id))
  ),
  tool(
    "sessions_list",
    "List connected Claude Code sessions (clients): host, folder, ready/busy/offline, agents running.",
    { type: "object", properties: {} },
    () => call("GET", "/api/sessions")
  ),
  tool(
    "monitor_status",
    "Monitor server status: URL, port, pid, uptime, sessions online, agent counts.",
    { type: "object", properties: {} },
    async () => {
      const r = await call("GET", "/api/agents");
      const live = r.sessions.filter((s) => s.status === "ready" || s.status === "busy");
      return {
        url: baseUrl(),
        port: r.server.port,
        host: r.server.host,
        pid: r.server.pid,
        started_at: r.server.started_at,
        sessions_online: live.length,
        sessions_total: r.sessions.length,
        running: r.agents.filter((a) => a.status === "running").length,
        done: r.agents.filter((a) => a.status === "done").length,
        webhooks: (r.webhooks || []).length,
      };
    }
  ),
  tool(
    "events_recent",
    "Recent spawn/stop events.",
    { type: "object", properties: { limit: { type: "number" } } },
    (args) => call("GET", "/api/events?limit=" + Math.min(Number(args.limit || 20), 200))
  ),
  tool(
    "webhook_add",
    "Register a webhook URL to receive agent.spawn / agent.stop POSTs.",
    { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    (args) => call("POST", "/api/webhooks", { url: args.url })
  ),
  tool("webhook_list", "List registered webhook URLs.", { type: "object", properties: {} }, () => call("GET", "/api/webhooks")),
  tool(
    "webhook_remove",
    "Remove a registered webhook URL.",
    { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    (args) => call("DELETE", "/api/webhooks", { url: args.url })
  ),
  tool("transports_get", "Get which transports are enabled (webhook, sse, socketio).", { type: "object", properties: {} }, () =>
    call("GET", "/api/transports")
  ),
  tool(
    "transports_set",
    "Enable/disable transports: webhook (outbound POST), sse (GET /api/stream), socketio.",
    {
      type: "object",
      properties: { webhook: { type: "boolean" }, sse: { type: "boolean" }, socketio: { type: "boolean" } },
    },
    (args) => call("POST", "/api/transports", args)
  ),
];

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handle(line).catch((e) => send({ error: String(e && e.message || e) }));
  }
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }
  const { id, method, params } = msg;
  const reply = (result) => send({ jsonrpc: "2.0", id, result });
  const fail = (message, code = -32603) =>
    send({ jsonrpc: "2.0", id, error: { code, message } });

  try {
    if (method === "initialize") {
      return reply({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agent-monitor", version: "0.1.0" },
      });
    }
    if (method === "notifications/initialized") return; // no-op
    if (method === "tools/list") {
      return reply({
        tools: TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
    }
    if (method === "tools/call") {
      const t = TOOLS.find((x) => x.name === (params && params.name));
      if (!t) return fail(`unknown tool: ${params && params.name}`, -32602);
      const out = await t.handler((params && params.arguments) || {});
      return reply({ content: [{ type: "text", text: JSON.stringify(out, null, 2) }] });
    }
    return fail(`unknown method: ${method}`, -32601);
  } catch (e) {
    return fail(e.message || String(e));
  }
}
