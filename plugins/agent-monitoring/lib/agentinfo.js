"use strict";
// Reads Claude Code's own per-subagent files to describe what an agent
// was asked to do and everything it did:
//   <session>.jsonl                      parent transcript (hook transcript_path)
//   <session>/subagents/agent-<id>.jsonl subagent transcript
//   <session>/subagents/agent-<id>.meta.json  { agentType, description, ... }
const fs = require("fs");
const path = require("path");

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_TEXT = 4000;
const MAX_RESULT = 600;
const MAX_ITEMS = 150;
const metaCache = new Map(); // agent_id -> meta (only cached once found)

function subagentFiles(agent) {
  if (!agent || !ID_RE.test(agent.agent_id || "") || !agent.transcript) return null;
  const t = String(agent.transcript);
  if (!t.endsWith(".jsonl")) return null;
  const dir = path.join(path.dirname(t), path.basename(t, ".jsonl"), "subagents");
  return {
    jsonl: path.join(dir, `agent-${agent.agent_id}.jsonl`),
    meta: path.join(dir, `agent-${agent.agent_id}.meta.json`),
  };
}

function readMeta(agent) {
  if (metaCache.has(agent.agent_id)) return metaCache.get(agent.agent_id);
  const files = subagentFiles(agent);
  if (!files) return null;
  try {
    const meta = JSON.parse(fs.readFileSync(files.meta, "utf8"));
    metaCache.set(agent.agent_id, meta);
    return meta;
  } catch {
    return null; // not written yet, retry next time
  }
}

const clip = (s, n) => {
  const str = String(s == null ? "" : s);
  return str.length > n ? str.slice(0, n) + `… (+${str.length - n} chars)` : str;
};

function inputSummary(name, input) {
  const i = input || {};
  const v = i.command || i.file_path || i.path || i.pattern || i.url || i.query || i.description || i.prompt;
  if (v) return clip(v, 300);
  try {
    return clip(JSON.stringify(i), 300);
  } catch {
    return "";
  }
}

function resultText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && b.type === "text" ? b.text : b && b.type === "image" ? "[image]" : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

// Full detail for one agent: task, timeline of tool calls and messages,
// final answer. Falls back to hook-recorded activity if no transcript.
function readDetail(agent) {
  const meta = readMeta(agent) || {};
  const out = {
    description: meta.description || null,
    agent_type: meta.agentType || agent.agent_type || null,
    task: null,
    timeline: [],
    result: null,
    tool_count: 0,
    source: "hooks",
  };
  const files = subagentFiles(agent);
  let raw = null;
  if (files) {
    try {
      raw = fs.readFileSync(files.jsonl, "utf8");
    } catch {}
  }
  if (!raw) {
    out.timeline = (agent.activity || []).map((a) => ({ ts: a.ts, kind: "tool", tool: a.tool, input: a.summary }));
    out.tool_count = out.timeline.length;
    return out;
  }
  out.source = "transcript";
  const byToolId = new Map();
  let lastText = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = ev.message;
    if (!msg) continue;
    const content = msg.content;
    if (ev.type === "user" && typeof content === "string") {
      if (out.task == null) out.task = clip(content, MAX_TEXT);
      else out.timeline.push({ ts: ev.timestamp, kind: "message", text: clip(content, MAX_RESULT) });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b) continue;
      if (ev.type === "assistant" && b.type === "tool_use") {
        const item = { ts: ev.timestamp, kind: "tool", tool: b.name, input: inputSummary(b.name, b.input), result: null, is_error: false };
        out.timeline.push(item);
        byToolId.set(b.id, item);
        out.tool_count++;
      } else if (ev.type === "assistant" && b.type === "text" && b.text) {
        lastText = b.text;
        out.timeline.push({ ts: ev.timestamp, kind: "text", text: clip(b.text, MAX_RESULT) });
      } else if (ev.type === "user" && b.type === "tool_result") {
        const item = byToolId.get(b.tool_use_id);
        if (item) {
          item.result = clip(resultText(b.content), MAX_RESULT);
          item.is_error = !!b.is_error;
        }
      } else if (ev.type === "user" && b.type === "text" && out.task == null) {
        out.task = clip(b.text, MAX_TEXT);
      }
    }
  }
  if (out.timeline.length > MAX_ITEMS) {
    out.truncated = out.timeline.length - MAX_ITEMS;
    out.timeline = out.timeline.slice(-MAX_ITEMS);
  }
  if (agent.status === "done" && lastText) out.result = clip(lastText, MAX_TEXT);
  return out;
}

module.exports = { readMeta, readDetail, ID_RE };
