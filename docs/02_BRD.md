# Business Requirements Document - Agent Monitoring Plugin

> Status: Final
> Last updated: 2026-10-06

## Contents

- [1. Purpose](#1-purpose)
- [2. Business Needs](#2-business-needs)
- [3. Justification](#3-justification)
- [4. Business Impact](#4-business-impact)
- [5. Constraints](#5-constraints)
- [6. Open Items](#6-open-items)

## 1. Purpose

This document describes the business requirements for the agent-monitoring plugin (repository Cloud-Dark/agent-visibility, plugin version 0.2.0). The plugin gives visibility into Claude Code subagents that are running, what each agent is doing, and when agents start and stop.

## 2. Business Needs

- BN-01: Operators who spawn multiple subagents need a single live view of which agents are running, finished, or stale.
- BN-02: Operators need per-agent detail: agent type, agent_id, start and stop times, last tool summary, files touched, and recent activity history.
- BN-03: Downstream systems need spawn and stop events forwarded as webhook POSTs, SSE streams, or socket.io messages.
- BN-04: The monitor server must start automatically when a Claude Code session runs, without manual steps.

## 3. Justification

Without this plugin, subagent activity is only visible inside individual session transcripts. That makes it hard to answer "which agents are running and what are they doing" during parallel work. The plugin records SubagentStart and SubagentStop events and PostToolUse activity into a shared state file, and exposes it through a local dashboard, REST API, and 9 MCP tools.

## 4. Business Impact

- Operators can check agent status from a browser dashboard with 3 second auto-refresh plus SSE live updates.
- Event consumers can subscribe through webhook, SSE stream, or socket.io, with each transport toggled on or off.
- Claude itself can answer status questions through MCP tools such as agents_list and monitor_status.
- LAN access is possible by binding 0.0.0.0, with a Network URL shown in the dashboard meta.

## 5. Constraints

- Node.js 18 or higher is required.
- Default bind is 127.0.0.1 (local machine only). Binding 0.0.0.0 exposes the dashboard to the local network with no authentication.
- Runtime state lives in the temp directory under claude-agent-monitor (state.json, server.json, monitor.log). Log rotation truncates monitor.log at 100 KB.
- Port default is 9761 with automatic fallback to 9762, 9763, and further. Port 97612 is invalid because the TCP maximum is 65535.
- socket.io works only when its dependency is installed with npm install in the plugin folder. REST, SSE, and webhook paths run on plain Node.js.

## 6. Open Items

- Authentication model for LAN exposure: _TBD_.
- Retention policy for state.json history beyond the 200 event cap: _TBD_.
