# Roadmap
> Status: Final
> Last updated: 2026-10-06

This roadmap records the release history of plugin agent-monitoring v0.2.0 and planned next steps.

## v0.1.0 - Done

Status: shipped.

Scope:

* Live web dashboard with agent list and auto refresh
* Webhook outbound POST on agent spawn and stop
* Auto start server on Claude Code session via SessionStart hook
* state.json based storage under temp directory

## v0.2.0 - Done

Status: shipped. Current version.

Scope:

* Three selectable transports: webhook, SSE stream, socket.io with on/off toggles
* Per agent activity tracking via PostToolUse hook
* LAN bind support: default 127.0.0.1, optional 0.0.0.0 with LAN IP display
* Smart port rules with health check and automatic fallback to 9762 and above
* GitHub marketplace distribution: Cloud-Dark/agent-visibility
* 9 MCP tools under server agent-monitor
* Dashboard connection pills, live stream box, and stale agent marking

Verified facts:

* 5-agent spawn test passed
* SSE stream verified
* LAN bind verified

## Next ideas - Planned

Status: planned, not started.

1. Auth token for LAN mode. Add optional shared token for dashboard and API when bound to 0.0.0.0.
2. Automated tests. Add scripted checks for record, activity, transports, and API endpoints.
3. npm publish. Evaluate publishing the monitor as an installable package in addition to the Claude marketplace channel.
