# Glossary

> Status: Final
> Last updated: 2026-10-06

| Term | Definition |
|------|------------|
| Activity | One recorded tool call for an agent: timestamp, tool name, and summary. Kept at most 50 per agent. |
| Agent | A recorded Claude Code subagent entry in `state.json`, keyed by agent id, with type, status, timestamps, activity, and files touched. |
| Agent id | The identifier for one subagent, taken from hook fields `agent_id`, `agentId`, or generated as `agent-<timestamp>` when absent. |
| Agent type | The subagent kind (for example `Explore`), taken from hook fields `agent_type`, `agentType`, or `subagent_type`. |
| Dashboard | The single HTML page served at `GET /` showing connection toggles, agent cards, live stream, recent events, and webhooks. |
| Event | A spawn or stop record with timestamp, type, agent id, and agent type. Served as `agent.spawn` or `agent.stop` on transports. Kept at most 200. |
| Hook | A Claude Code lifecycle callback wired in `hooks.json` that runs a Node script on session, subagent, or tool events. |
| LAN IP | A non internal IPv4 address shown as a Network URL when the server binds `0.0.0.0`. |
| Marketplace | The distribution entry for this plugin: marketplace name `agentmonitoring`, sourced from GitHub `Cloud-Dark/agent-visibility`. |
| MCP | Model Context Protocol. The `agent-monitor` stdio server in `mcp-server.js` exposes agent and transport tools to Claude. |
| Monitor log | The `monitor.log` runtime file with server startup lines, rotated when larger than 100 KB. |
| Plugin | The distributable unit named `agent-monitoring` (v0.2.0) under `plugins/agent-monitoring/`. |
| Runtime directory | The OS temp subdirectory `claude-agent-monitor` holding `state.json`, `server.json`, and `monitor.log`. |
| Server info | The `server.json` record with server pid, port, host, and start time, written by `ensure-server.js`. |
| Socket.io | One of the three selectable transports. Broadcasts `agent-event` payloads and a `hello` message on connect when the dependency is installed. |
| SSE | Server-Sent Events. The `GET /api/stream` transport that pushes `data:` lines plus a `: ping` heartbeat every 15 seconds. |
| Stale | A `running` agent whose last activity (or start) is older than 2 minutes, flagged by the server poll. |
| State.json | The shared JSON file with `agents`, `events`, `webhooks`, `transports`, and `updated_at`. Read by server, dashboard, and MCP. |
| Subagent | A child agent session spawned from the main Claude Code session. Only subagent sessions carry an agent id and are tracked. |
| Transport | One selectable event channel: `webhook`, `sse`, or `socketio`. Each has an independent on or off flag. |
| Watchdog | The `UserPromptSubmit` hook running `ensure-server.js --quiet` to restart a dead server without printing to the terminal. |
| Webhook | An outbound HTTP POST of each spawn or stop payload to a registered URL, sent fire and forget with a 4 second timeout. |
