# Project Charter

> Status: Final
> Last updated: 2026-10-06

## Contents

- [Vision](#vision)
- [Goals](#goals)
- [Scope](#scope)
- [Stakeholders](#stakeholders)
- [Success criteria](#success-criteria)

## Vision

Give every Claude Code user a clear, local, real time view of which subagents are running, what each one is doing, and when each one starts or stops. The plugin is named agent-monitoring (version 0.2.0) in the Cloud-Dark/agent-visibility repository. It runs a small local server with a web dashboard, a REST API, and three selectable event transports (webhook, SSE stream, socket.io), plus MCP tools so Claude itself can answer questions about running agents.

## Goals

1. Show live subagent state (running, done, stale) in a local web dashboard with auto refresh and SSE live updates.
2. Record per agent detail: type, start and stop times, last tool summary, recent activity history, and files touched.
3. Forward spawn and stop events to webhook URLs, an SSE stream, and socket.io, each independently switchable on or off.
4. Start automatically with each Claude Code session and recover via a watchdog hook, with no manual server management.
5. Expose the same state through REST and MCP tools (MCP server name `agent-monitor`).
6. Run with plain Node.js 18 or newer and no mandatory dependencies. Only socket.io requires an install.

## Scope

In scope:

- Local monitor server (`server.js`): dashboard page, REST API, SSE stream, optional socket.io broadcast.
- Lifecycle hooks (`hooks.json`, `record.js`, `activity.js`, `ensure-server.js`): session auto start and watchdog, spawn and stop recording, per tool activity recording.
- Shared state (`lib/store.js`): file based state in the runtime directory, webhook POST fan out, stdin JSON parsing.
- MCP server (`mcp-server.js`): read and configuration tools over stdio.
- Marketplace packaging: plugin manifest (`plugin.json`), MCP manifest (`.mcp.json`), marketplace manifest, socket.io dependency declaration in `package.json`.

Out of scope:

- Authentication, multi user access control, and any hosted or cloud service. The server binds to localhost by default and has no login.
- Persistence beyond the local runtime directory. Runtime files are not committed.
- Historical analytics, alerting rules, and long term log retention beyond the 100 KB log rotation. Marked _TBD_ where not defined in source.
- Tracking of the main session. Only subagent sessions that carry an agent id are recorded.

## Stakeholders

| Stakeholder | Interest |
|-------------|----------|
| Claude Code user | Opens the dashboard, registers webhooks, asks Claude about agents |
| Plugin maintainer (agentmonitoring) | Owns the plugin manifest, hooks, server, and marketplace entry |
| Downstream webhook receiver | Receives `agent.spawn` and `agent.stop` POST payloads |
| SSE or socket.io client | Consumes the live event stream |

## Success criteria

1. After marketplace install, starting a new Claude Code session prints a dashboard URL and the dashboard loads.
2. Spawning a subagent creates a `running` entry with type and start time; stopping it flips the entry to `done` with a stop time.
3. Tool use inside a subagent updates its last summary, activity history, and files touched.
4. Each transport can be toggled independently from the dashboard, the REST API, or MCP, and the disabled transport stops delivering events.
5. Port conflicts resolve without manual steps: a stale monitor-owned port is reused, a foreign-owned port is skipped upward.
6. All hooks exit without blocking the session or the tool call, even on failure.
