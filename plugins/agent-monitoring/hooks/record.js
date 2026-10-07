"use strict";
// SubagentStart/SubagentStop hook: record agent lifecycle into state.json
// and forward an event to registered webhooks.
// Usage: record.js <start|stop>   (hook JSON arrives on stdin)
const {
  loadState,
  saveState,
  pushEvent,
  fireWebhooks,
  readStdinJson,
} = require("../lib/store");

async function main() {
  const action = process.argv[2] === "stop" ? "stop" : "start";
  const input = await readStdinJson();

  const agentId =
    input.agent_id || input.agentId || `agent-${Date.now().toString(36)}`;
  const agentType = input.agent_type || input.agentType || input.subagent_type || null;
  const now = new Date().toISOString();

  const s = loadState();
  const prev = s.agents[agentId] || {};
  // Merge into the existing entry so activity, files_touched and
  // last_summary written by activity.js survive the stop event.
  const agent = {
    ...prev,
    agent_id: agentId,
    agent_type: agentType || prev.agent_type || null,
    status: action === "start" ? "running" : "done",
    started_at: prev.started_at || (action === "start" ? now : null),
    stopped_at: action === "stop" ? now : prev.stopped_at || null,
    transcript: input.transcript_path || input.transcriptPath || prev.transcript || null,
    model: input.model || prev.model || null,
  };
  s.agents[agentId] = agent;
  pushEvent(s, action === "start" ? "spawn" : "stop", agent);
  saveState(s);

  fireWebhooks(s.webhooks, {
    event: action === "start" ? "agent.spawn" : "agent.stop",
    ts: now,
    agent,
  }, s.transports ? s.transports.webhook !== false : true);
}

main().catch(() => process.exit(0)); // never block the agent
