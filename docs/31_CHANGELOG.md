# Changelog - Agent Monitoring Plugin

> Status: Final
> Last updated: 2026-10-07

## Contents

- [Unreleased](#unreleased)
- [0.3.0](#030)
- [0.2.0](#020)
- [0.1.0](#010)

This changelog follows Keep a Changelog format.

## Unreleased

- None.

## 0.3.0

Date: 2026-10-07

### Added

- Dashboard chat box: type a prompt and press Enter to run it in Claude Code. The conversation continues across prompts through the same session_id.
- Prompt API for other apps: POST/GET /api/prompts and GET/DELETE /api/prompts/<run_id>, with wait mode, long-poll, SSE chat.* events, and a prompt.done webhook event.
- Approve and Reject buttons for tool permission requests, forwarded from headless runs through approval-mcp.js (--permission-prompt-tool). Endpoints: GET /api/approvals and POST /api/approvals/<id>.
- YOLO toggle (dashboard button and POST /api/yolo) that auto-approves every permission request. Off by default and reset on server restart.
- AGENT_MONITOR_TOKEN for non-localhost access to the prompt, approval, and YOLO endpoints (Bearer or X-Monitor-Token header).
- Env vars AGENT_MONITOR_CWD, AGENT_MONITOR_CHAT_MODE, and AGENT_MONITOR_MAX_RUNS.

### Security

- Prompt, approval, and YOLO endpoints are localhost-only unless a token is configured. Pending approvals are denied after 10 minutes or when their run ends.
- Runs drop inherited CLAUDECODE, CLAUDE_PID, and CLAUDE_CODE_* env vars so they do not inherit the parent session state.

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
