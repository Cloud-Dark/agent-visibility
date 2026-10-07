"use strict";
// One-line summary of a tool call, shared by the activity hook.
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

module.exports = { summarizeTool };
