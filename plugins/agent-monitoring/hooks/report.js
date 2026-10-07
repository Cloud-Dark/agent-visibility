"use strict";
// Hook client: forwards one Claude Code hook event to the monitor server
// (POST /api/ingest). The server is the only writer of state.json, so
// concurrent hooks can no longer overwrite each other.
// Usage: report.js <session-start|prompt|subagent-start|subagent-stop|tool|session-end>
// Hook JSON arrives on stdin. Never blocks Claude Code: always exits 0.
const { readStdinJson } = require("../lib/store");
const { ingest, sessionName } = require("../lib/client");
const { summarizeTool } = require("../lib/summarize");

const KINDS = new Set(["session-start", "prompt", "subagent-start", "subagent-stop", "tool", "session-end"]);
const SKIP_TOOLS = new Set(["SendMessage", "Artifact"]);

async function main() {
  const kind = process.argv[2];
  if (!KINDS.has(kind)) return;
  const input = await readStdinJson();
  const ev = {
    kind,
    session_id: input.session_id || null,
    cwd: input.cwd || process.cwd(),
    agent_id: input.agent_id || input.agentId || null,
    agent_type: input.agent_type || input.agentType || input.subagent_type || null,
    transcript: input.transcript_path || null,
    ts: new Date().toISOString(),
  };
  if (kind === "session-start") {
    ev.name = sessionName();
    ev.source = input.source || null;
  }
  if (kind === "prompt" && typeof input.prompt === "string") {
    ev.prompt = input.prompt.slice(0, 300);
  }
  if (kind === "tool") {
    const tool = input.tool_name || input.toolName || "unknown";
    if (SKIP_TOOLS.has(tool)) return;
    const ti = input.tool_input || input.toolInput || {};
    ev.tool = tool;
    ev.summary = summarizeTool(tool, ti);
    ev.file = ti.file_path || ti.path || null;
  }
  await ingest(ev);
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
