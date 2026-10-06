# Technical Requirements Document - Agent Monitoring Plugin

> Status: Final
> Last updated: 2026-10-06

## Contents

- [TR-001 Runtime](#tr-001-runtime)
- [TR-002 Dependencies](#tr-002-dependencies)
- [TR-003 Optional socket.io](#tr-003-optional-socketio)
- [TR-004 MCP protocol](#tr-004-mcp-protocol)
- [TR-005 File-based state](#tr-005-file-based-state)
- [TR-006 Windows PowerShell BOM handling](#tr-006-windows-powershell-bom-handling)
- [TR-007 Traceability](#tr-007-traceability)

## TR-001 Runtime

The plugin shall run on Node.js 18 or higher with no build step.

Rationale: server.js, mcp-server.js, hooks, and lib/store.js use only built-in modules (http, https, fs, os, path, child_process) except for the optional socket.io import.

## TR-002 Dependencies

There shall be no mandatory runtime dependencies.

Rationale: REST endpoints, SSE streaming, webhook POSTs, hooks, and the MCP stdio server run on plain Node.js. Only socket.io requires npm install in plugins/agent-monitoring.

## TR-003 Optional socket.io

socket.io support shall be optional and degrade gracefully when not installed.

Rationale: server.js wraps require("socket.io") in try/catch. When missing, io stays null, REST and SSE keep working, and the dashboard reports not installed.

## TR-004 MCP protocol

The MCP server shall speak JSON-RPC over stdio with protocol version 2024-11-05.

Rationale: mcp-server.js reads newline delimited JSON from stdin and implements initialize, notifications/initialized, tools/list, and tools/call. It exposes 9 tools: agents_list, agents_get, monitor_status, events_recent, webhook_add, webhook_list, webhook_remove, transports_get, transports_set. Server info reports name agent-monitor.

## TR-005 File-based state

Runtime state shall be file-based under the temp directory path claude-agent-monitor, with no database.

Rationale: lib/store.js defines stateDir from TEMP, TMP, or os.tmpdir. state.json holds agents, events, webhooks, transports, and updated_at. server.json holds pid, port, host, and started_at. monitor.log holds startup lines with rotation at 100 KB. saveState writes through a .tmp file plus rename. Events are capped at 200 entries.

## TR-006 Windows PowerShell BOM handling

Stdin JSON parsing shall strip a leading byte order mark.

Rationale: lib/store.js readStdinJson removes a leading BOM character before JSON.parse, because PowerShell pipes can add one. Parse failure resolves to an empty or raw object, and hook entry points catch errors and exit 0 so hooks never block the agent.

## TR-007 Traceability

Each technical requirement maps to source files:

- TR-001: server.js, mcp-server.js, hooks/ensure-server.js, hooks/record.js, hooks/activity.js, lib/store.js
- TR-002: server.js, mcp-server.js, lib/store.js
- TR-003: server.js (socket.io block), plugins/agent-monitoring package manifest
- TR-004: mcp-server.js, .mcp.json
- TR-005: lib/store.js, hooks/record.js, hooks/activity.js, hooks/ensure-server.js
- TR-006: lib/store.js readStdinJson
