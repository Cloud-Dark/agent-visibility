# Product Requirements Document

> Status: Final
> Last updated: 2026-10-06

## Contents

- [Problem](#problem)
- [Target users](#target-users)
- [MoSCoW features](#moscow-features)
- [User stories](#user-stories)
- [Metrics](#metrics)

## Problem

When several Claude Code subagents run at once, the user cannot see at a glance which agents are running, what each one is doing, or when each one started and stopped. There is no built in live list, no per agent activity detail, and no way to forward lifecycle events to external tools. The agent-monitoring plugin (v0.2.0) solves this with a local dashboard, a REST API, three event transports, and MCP tools, all fed by lifecycle and tool use hooks.

## Target users

| User | Needs |
|------|-------|
| Solo Claude Code developer | A local dashboard showing running, done, and stale agents with current activity |
| Power user running parallel agents | Per agent detail: last tool, recent activity, files touched, start and stop times |
| Integrator | Webhook POSTs, SSE stream, or socket.io events for spawn and stop |
| Claude Code session itself | MCP tools (`agent-monitor` server) so Claude can answer "which agents are running" |

Non user systems: webhook receivers, SSE consumers, socket.io v4 clients.

## MoSCoW features

Must have:

- Live dashboard (`GET /`) with agent cards, connection toggles, live stream, recent events table, and webhook form.
- Lifecycle recording via `SubagentStart` and `SubagentStop` hooks into shared state.
- Activity recording via `PostToolUse` hook for the matched tool set, keyed by agent id.
- Three independently toggleable transports: webhook outbound POST, SSE stream at `GET /api/stream`, socket.io broadcast.
- Auto start on `SessionStart` plus `UserPromptSubmit` watchdog with quiet mode.
- Port ownership rules: reuse a healthy monitor port, restart a dead one, step upward past foreign ports.
- REST read endpoints for agents and events; webhook and transport management endpoints.
- MCP tools for listing agents, agent detail, monitor status, recent events, webhook management, and transport control.

Should have:

- Stale marking for running agents with no activity for over 2 minutes.
- LAN bind option (`0.0.0.0` with LAN IP display) alongside the localhost default.
- Health endpoint (`GET /__health`) used for port ownership detection.
- Log rotation for the runtime log at 100 KB.

Could have:

- _TBD_. No further committed features are defined in the files read.

Will not have (this release):

- Authentication or access control.
- Main session tracking. Sessions without an agent id are ignored.
- Guaranteed delivery or retry for webhooks. POSTs are fire and forget with a 4 second timeout.

## User stories

1. As a developer, I open the printed dashboard URL after starting a session so that I can see all recorded agents.
2. As a developer, I read an agent card showing status, type, agent id, start and stop times, current task summary, and touched files so that I know what that agent is doing.
3. As a developer, I expand the activity dropdown so that I can review recent tool calls for one agent.
4. As an integrator, I register a webhook URL so that every spawn and stop arrives as a JSON POST.
5. As an integrator, I connect to the SSE stream so that I receive `agent.spawn` and `agent.stop` lines in real time.
6. As an integrator, I connect a socket.io v4 client so that I receive `hello` on connect and `agent-event` payloads thereafter.
7. As a developer, I toggle webhook, SSE, or socket.io off so that only the connections I want stay active.
8. As a developer, I ask Claude which agents are running so that it answers from MCP `agents_list`.
9. As a developer on a LAN, I set the bind host to `0.0.0.0` so that I can open the dashboard from another device via the displayed Network URL.
10. As a developer, I restart or prompt again when the server is down so that the watchdog brings it back without manual steps.

## Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Dashboard availability | Dashboard loads from the printed URL after session start | _TBD_ |
| Lifecycle accuracy | Spawn and stop events recorded per subagent | _TBD_ |
| Activity freshness | Tool use reflected in agent detail and last summary | _TBD_ |
| Transport reliability | Enabled transports deliver spawn and stop events | _TBD_ |
| Startup recovery | Watchdog restarts a dead server on next prompt | _TBD_ |

No numeric targets are stated in the files read, so all targets are marked _TBD_.
