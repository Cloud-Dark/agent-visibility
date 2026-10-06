"use strict";
// MCP server (stdio) exposing agent-monitor tools. No dependencies.
const { loadState, saveState, loadServerInfo } = require("./lib/store");

function tool(name, description, inputSchema, handler) {
  return { name, description, inputSchema, handler };
}

function runningFilter(agents, status) {
  if (!status || status === "all") return agents;
  return agents.filter((a) => a.status === status);
}

const TOOLS = [
  tool(
    "agents_list",
    "List recorded Claude Code subagents (running and finished).",
    {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "running", "done"] },
      },
    },
    (args) => {
      const s = loadState();
      const agents = runningFilter(Object.values(s.agents), args.status || "all");
      return { agents, count: agents.length };
    }
  ),
  tool(
    "agents_get",
    "Get detail of one subagent by agent_id.",
    {
      type: "object",
      properties: { agent_id: { type: "string" } },
      required: ["agent_id"],
    },
    (args) => {
      const s = loadState();
      const agent = s.agents[args.agent_id];
      if (!agent) throw new Error(`unknown agent_id: ${args.agent_id}`);
      return { agent };
    }
  ),
  tool(
    "monitor_status",
    "Monitor server status: port, pid, uptime, agent counts.",
    { type: "object", properties: {} },
    () => {
      const s = loadState();
      const info = loadServerInfo() || {};
      const agents = Object.values(s.agents);
      return {
        port: info.port || null,
        pid: info.pid || null,
        started_at: info.started_at || null,
        state_updated_at: s.updated_at,
        running: agents.filter((a) => a.status === "running").length,
        done: agents.filter((a) => a.status === "done").length,
        webhooks: s.webhooks.length,
      };
    }
  ),
  tool(
    "events_recent",
    "Recent spawn/stop events.",
    {
      type: "object",
      properties: { limit: { type: "number" } },
    },
    (args) => {
      const s = loadState();
      const limit = Math.min(Number(args.limit || 20), 200);
      return { events: s.events.slice(-limit).reverse() };
    }
  ),
  tool(
    "webhook_add",
    "Register a webhook URL to receive agent.spawn / agent.stop POSTs.",
    {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    (args) => {
      if (!/^https?:\/\//.test(args.url)) throw new Error("url must start with http(s)://");
      const s = loadState();
      if (!s.webhooks.includes(args.url)) {
        s.webhooks.push(args.url);
        saveState(s);
      }
      return { webhooks: s.webhooks };
    }
  ),
  tool(
    "webhook_list",
    "List registered webhook URLs.",
    { type: "object", properties: {} },
    () => ({ webhooks: loadState().webhooks })
  ),
  tool(
    "webhook_remove",
    "Remove a registered webhook URL.",
    {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
    (args) => {
      const s = loadState();
      s.webhooks = s.webhooks.filter((w) => w !== args.url);
      saveState(s);
      return { webhooks: s.webhooks };
    }
  ),
  tool(
    "transports_get",
    "Get which transports are enabled (webhook, sse, socketio).",
    { type: "object", properties: {} },
    () => ({ transports: loadState().transports })
  ),
  tool(
    "transports_set",
    "Enable/disable transports: webhook (outbound POST), sse (GET /api/stream), socketio.",
    {
      type: "object",
      properties: {
        webhook: { type: "boolean" },
        sse: { type: "boolean" },
        socketio: { type: "boolean" },
      },
    },
    (args) => {
      const s = loadState();
      for (const k of ["webhook", "sse", "socketio"]) {
        if (typeof args[k] === "boolean") s.transports[k] = args[k];
      }
      saveState(s);
      return { transports: s.transports };
    }
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
