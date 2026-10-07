"use strict";
// Permission-prompt MCP server for dashboard/API prompt runs.
// `claude -p --permission-prompt-tool mcp__agentmon_approval__approve`
// calls this tool whenever a tool needs permission. We forward the
// request to the monitor server and wait for Approve/Reject from the
// dashboard (or auto-allow when YOLO is on). No dependencies.
const http = require("http");

const PORT = Number(process.env.AGENT_MONITOR_PORT || 9761);
// Secret the server gave this run. It authenticates every request and
// ties approvals to this run only.
const RUN_SECRET = process.env.AGENT_MONITOR_RUN_SECRET || "";

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path,
        method,
        headers: {
          Authorization: `Bearer ${RUN_SECRET}`,
          ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
        },
        timeout: 60000,
      },
      (res) => {
        let out = "";
        res.on("data", (c) => (out += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(out));
          } catch {
            reject(new Error(`bad response ${res.statusCode}`));
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("monitor timeout")));
    req.on("error", reject);
    if (data) req.end(data);
    else req.end();
  });
}

async function decide(args) {
  const created = await request("POST", "/api/run/approvals", {
    tool_name: args.tool_name,
    input: args.input,
    tool_use_id: args.tool_use_id,
  });
  if (created.error) return { behavior: "deny", message: `agent-monitor: ${created.error}` };
  let a = created;
  while (a.status === "pending") {
    a = await request("GET", `/api/run/approvals/${a.id}?wait_ms=25000`);
  }
  if (a.status === "allowed") return { behavior: "allow", updatedInput: args.input || {} };
  return { behavior: "deny", message: a.message || "Rejected from agent-monitor dashboard" };
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: (params && params.protocolVersion) || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "agentmon_approval", version: "0.1.0" },
      },
    });
  }
  if (method === "tools/list") {
    return send({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "approve",
            description: "Ask the agent-monitor dashboard user to approve or reject a tool call.",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: { type: "string" },
                input: { type: "object" },
                tool_use_id: { type: "string" },
              },
              required: ["tool_name"],
            },
          },
        ],
      },
    });
  }
  if (method === "tools/call") {
    let verdict;
    try {
      verdict = await decide((params && params.arguments) || {});
    } catch (e) {
      // Monitor unreachable: fail closed.
      verdict = { behavior: "deny", message: `agent-monitor unreachable: ${e.message}` };
    }
    return send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(verdict) }] } });
  }
  if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method: ${method}` } });
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    handle(msg).catch(() => {});
  }
});
