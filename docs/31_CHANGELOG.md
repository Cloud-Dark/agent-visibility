# Changelog - Agent Monitoring Plugin

> Status: Final
> Last updated: 2026-10-06

## Contents

- [Unreleased](#unreleased)
- [0.2.0](#020)
- [0.1.0](#010)

This changelog follows Keep a Changelog format.

## Unreleased

- None.

## 0.2.0

Date: 2026-10-06

### Added

- Selectable transports: webhook, SSE stream, and socket.io, each toggled on or off from the dashboard, REST API, or MCP tools.
- SSE live stream at GET /api/stream with 15 second heartbeat and 403 response when the sse transport is disabled.
- Optional socket.io broadcast of agent events with hello message on connection when the dependency is installed.
- Transports REST endpoints GET and POST /api/transports.
- MCP tools transports_get and transports_set alongside agents_list, agents_get, monitor_status, events_recent, webhook_add, webhook_list, and webhook_remove.
- Flexible bind address with AGENT_MONITOR_HOST, --host flag, LAN IP reporting, and Network URL in the dashboard meta.

### Fixed

- Reuse healthy server instead of restarting on every prompt, ending ensure-server flapping.
- Watchdog UserPromptSubmit runs quiet with log only output.

## 0.1.0

Date: 2026-10-06

### Added

- Monitor server with web dashboard, REST API, and webhook forwarding.
- Auto-start through SessionStart hook with UserPromptSubmit watchdog.
- Subagent spawn and stop recording through SubagentStart and SubagentStop hooks.
- Per-agent activity recording through PostToolUse hook with tool summary and files touched.
- MCP stdio server exposing agent status, events, and webhook tools.
- Port rules with default 9761 and automatic fallback when occupied.
- File-based runtime state under the temp directory claude-agent-monitor.
