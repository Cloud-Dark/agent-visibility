# Functional Requirements Document - Agent Monitoring Plugin

> Status: Final
> Last updated: 2026-10-06

## Contents

- [FR-001 Auto-start server](#fr-001-auto-start-server)
- [FR-002 Record spawn and stop](#fr-002-record-spawn-and-stop)
- [FR-003 Per-agent activity](#fr-003-per-agent-activity)
- [FR-004 Dashboard](#fr-004-dashboard)
- [FR-005 Transports](#fr-005-transports)
- [FR-006 Port rules](#fr-006-port-rules)
- [FR-007 LAN bind](#fr-007-lan-bind)

## FR-001 Auto-start server

The server shall start automatically when a Claude Code session runs, via the SessionStart hook, with UserPromptSubmit acting as watchdog.

Acceptance criteria:

- SessionStart runs hooks/ensure-server.js, which spawns server.js as a detached daemon.
- UserPromptSubmit runs hooks/ensure-server.js with --quiet, which only writes to monitor.log and does not print to the terminal.
- A healthy existing server is reused, not restarted, on subsequent prompts.
- The dashboard URL message prints once at session start.

## FR-002 Record spawn and stop

The system shall record subagent spawn and stop events through hooks/record.js.

Acceptance criteria:

- SubagentStart invokes record.js with argument start and sets agent status to running.
- SubagentStop invokes record.js with argument stop and sets agent status to done with stopped_at timestamp.
- Each spawn and stop appends an event of type spawn or stop to state.json, capped at 200 events.
- Hook JSON arrives on stdin; missing agent_id falls back to a generated agent id.

## FR-003 Per-agent activity

The system shall record per-agent tool activity through hooks/activity.js on PostToolUse.

Acceptance criteria:

- PostToolUse fires activity.js only for the matcher tools: Read, Write, Edit, Bash, Glob, Grep, Task, TodoWrite, WebFetch, WebSearch.
- Main session calls without agent_id are not tracked.
- Each record stores timestamp, tool name, and summary; activity history keeps the last 50 entries per agent.
- Files touched keeps up to 30 distinct file paths per agent.
- Tools SendMessage and Artifact are skipped.

## FR-004 Dashboard

The server shall serve a single page dashboard at GET / with live agent and event views.

Acceptance criteria:

- Connection section shows toggle pills for webhook, SSE stream, and socket.io, plus SSE address and socket.io status.
- Agents section shows one card per agent with running or done indicator, stale marker when a running agent has no activity for more than 2 minutes, type, agent_id, start and stop times, doing summary, files touched, and activity dropdown.
- Live stream section shows realtime events via EventSource on /api/stream.
- Recent events section shows a table of the last 30 events.
- Webhooks section lists registered URLs with an add form.
- Meta line shows host, port, uptime, and Network URL with LAN IP when bound to 0.0.0.0.
- Page auto-refreshes every 3 seconds.

## FR-005 Transports

The system shall support webhook, SSE stream, and socket.io transports, each toggled on or off.

Acceptance criteria:

- All three transports are active by default.
- Status is readable via GET /api/transports and MCP transports_get.
- Status is writable via POST /api/transports and MCP transports_set.
- Webhook: registered URLs receive JSON POSTs for agent.spawn and agent.stop events; URLs must start with http(s)://; add, list, and remove work via REST and MCP webhook tools.
- SSE: GET /api/stream emits data lines per event plus a : ping heartbeat every 15 seconds; returns 403 when the sse transport is disabled.
- socket.io: server enables socket.io when the dependency is installed, emitting agent-event on new events and hello on connection; dashboard reports enabled or not installed.

## FR-006 Port rules

The auto-start logic shall apply deterministic port rules around the default port 9761.

Acceptance criteria:

- If the candidate port answers /__health as this monitor and the recorded pid is alive, the existing server is reused.
- If the port answers as this monitor but the pid file points at a dead process, the old entry is cleared and a fresh server starts on the same port.
- If the port is used by another app, the next port is tried (9762, 9763, and further).
- If the port answers as this monitor with no pid file, the server is adopted and recorded.

## FR-007 LAN bind

The server shall support flexible bind addresses for local or LAN access.

Acceptance criteria:

- Default bind is 127.0.0.1 (local machine only).
- 0.0.0.0 binds all interfaces and the dashboard meta plus GET /api/agents include LAN IPs with a Network URL.
- A specific IP binds that interface only.
- Host is set via AGENT_MONITOR_HOST env or node server.js --host; port via AGENT_MONITOR_PORT env.
- Health endpoint GET /__health reports monitor id, port, host, and pid for ownership detection.
