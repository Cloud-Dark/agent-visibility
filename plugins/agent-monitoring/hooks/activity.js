"use strict";
// PostToolUse hook: record per-agent activity (tool calls with summaries)
// so the dashboard can show what each agent is working on.
// Reads hook JSON from stdin: { agent_id, tool_name/tool_input/tool_response, ... }
const { loadState, saveState, readStdinJson } = require("../lib/store");

function summarizeTool(name, input) {
  const i = input || {};
  switch (name) {
    case "Read":
      return `Read ${i.file_path || i.path || "?"}`;
    case "Write":
      return `Write ${i.file_path || i.path || "?"}`;
    case "Edit":
      return `Edit ${i.file_path || i.path || "?"}`;
    case "Bash":
      return `Bash: ${String(i.command || "").slice(0, 100)}`;
    case "Glob":
      return `Glob ${i.pattern || "?"}`;
    case "Grep":
      return `Grep "${String(i.pattern || "").slice(0, 60)}"`;
    case "Task":
      return `Spawn ${i.subagent_type || i.description || "subagent"}`;
    case "WebFetch":
      return `Fetch ${i.url || "?"}`;
    case "WebSearch":
      return `Search "${String(i.query || "").slice(0, 60)}"`;
    case "TodoWrite":
      try {
        const todos = i.todos || [];
        const done = todos.filter((t) => t.status === "completed").length;
        const cur = todos.find((t) => t.status === "in_progress");
        return cur
          ? `Todo ${done}/${todos.length}: ${cur.content || cur.activeForm || "?"}`
          : `Todo ${done}/${todos.length}`;
      } catch {
        return "Todo update";
      }
    default:
      return name || "tool";
  }
}

async function main() {
  const input = await readStdinJson();
  // Main session has no agent_id — only track subagents.
  const agentId = input.agent_id || input.agentId;
  if (!agentId) return;

  const toolName =
    input.tool_name || input.toolName || input.tool || "unknown";
  // Skip noisy/secret-ish tools
  if (toolName === "SendMessage" || toolName === "Artifact") return;

  const summary = summarizeTool(toolName, input.tool_input || input.toolInput);
  const now = new Date().toISOString();

  const s = loadState();
  const prev = s.agents[agentId] || { agent_id: agentId };
  const activity = Array.isArray(prev.activity) ? prev.activity : [];
  activity.push({ ts: now, tool: toolName, summary });
  while (activity.length > 50) activity.shift();

  // Track distinct files touched
  const files = prev.files_touched || [];
  const cand =
    (input.tool_input && (input.tool_input.file_path || input.tool_input.path)) ||
    (input.toolInput && (input.toolInput.file_path || input.toolInput.path));
  if (cand && !files.includes(cand)) {
    files.push(cand);
    while (files.length > 30) files.shift();
  }

  s.agents[agentId] = {
    ...prev,
    agent_id: agentId,
    status: prev.status || "running",
    started_at: prev.started_at || now,
    last_activity_at: now,
    last_summary: summary,
    stale: false, // active again: leave the lounge
    activity,
    files_touched: files,
  };
  // Light event only for Task spawns (avoid flooding events with every tool)
  saveState(s);
}

main().catch(() => process.exit(0)); // never block tools
